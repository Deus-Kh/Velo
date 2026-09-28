import { randomUUID } from 'crypto';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../../src/errors';
import { verifySignedPreKeyBundle } from '../../src/handshake/bundle';
import { signIdentityBinding } from '../../src/identity/binding';
import { x3dhInitiate, x3dhRespond, type X3DHInitPacket } from '../../src/handshake/x3dh';
import { normalizeB64 } from '../../src/primitives/base64';
import { utf8Decode } from '../../src/primitives/utf8';
import { ratchetDecrypt, ratchetEncrypt, type DerivedMessageKey, type V2Encrypted } from '../../src/ratchet/message';
import { initInitiatorSession, initResponderSession } from '../../src/ratchet/session';
import type { RatchetSessionV2 } from '../../src/types/session';
import { FakeServer, type NewMessageDTO, type ServerIdentity } from './fakeServer';
import { MemoryStore } from './memoryStore';
import type { Network } from './network';

/**
 * A client modelled on chats-client's orchestration over the pure package:
 * sessionBootstrap.ts (ensureV2Session / ensureV2SessionFromIncoming),
 * socket/messaging.ts (send, realtime receive), chat/ratchetAdapter.ts
 * (persist keys, then session, nothing on throw), useChatE2EE.ts
 * (history decrypt with stored-key fallback, resetSession) and the key
 * bootstrap in prekeys.ts / identityKeys.ts / identityDhKeys.ts.
 *
 * Identity pinning mirrors today's client: NewChatScreen pins on first
 * contact (TOFU) and nothing in the crypto path checks the pin (P0-9).
 * T2.13 changes the client and this model together.
 *
 * Sessions use the standard Double Ratchet bootstrap (T2.0): the initiator
 * ratchets once at creation against SPK_B; the responder copies its SPK
 * pair and ratchets on the first inbound message.
 */
type StoredPair = { publicKey: string; privateKey: string };
type StoredSignedPreKey = StoredPair & { keyId: number; signature: string };

export type ReceivedMessage = { fromUserId: string; text: string; serverMessageId: string };

export class VirtualClient {
  network: Network | null = null;
  readonly inbox: ReceivedMessage[] = [];
  private msgCounter = 0; // orders createdAt; ids are random like the client's

  constructor(
    readonly userId: string,
    readonly server: FakeServer,
    public store: MemoryStore = new MemoryStore(),
  ) {}

  // ───────── keys and registration ─────────

  register(opts: { oneTimePreKeys?: number } = {}): void {
    let sign = this.store.getJson<StoredPair>('identity-sign');
    if (!sign) {
      const kp = nacl.sign.keyPair();
      sign = { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
      this.store.setJson('identity-sign', sign);
    }
    let dh = this.store.getJson<StoredPair>('identity-dh');
    if (!dh) {
      const kp = nacl.box.keyPair();
      dh = { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
      this.store.setJson('identity-dh', dh);
    }
    this.server.uploadIdentityKeys(this.userId, {
      identitySignPublicKey: sign.publicKey,
      identityDhPublicKey: dh.publicKey,
      identityBindingSignature: signIdentityBinding(decodeBase64(sign.privateKey), dh.publicKey),
    });

    let spk = this.store.getJson<StoredSignedPreKey>('signed-prekey');
    if (!spk) {
      const kp = nacl.box.keyPair();
      spk = {
        keyId: this.nextKeyId(),
        publicKey: encodeBase64(kp.publicKey),
        privateKey: encodeBase64(kp.secretKey),
        signature: encodeBase64(nacl.sign.detached(kp.publicKey, decodeBase64(sign.privateKey))),
      };
      this.store.setJson('signed-prekey', spk);
    }
    this.server.uploadSignedPreKey(this.userId, { keyId: spk.keyId, publicKey: spk.publicKey, signature: spk.signature });

    this.uploadOneTimePreKeys(opts.oneTimePreKeys ?? 10);
  }

  uploadOneTimePreKeys(count: number): void {
    const items: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < count; i += 1) {
      const kp = nacl.box.keyPair();
      const keyId = this.nextKeyId();
      this.store.set('opk:' + String(keyId), encodeBase64(kp.secretKey));
      items.push({ keyId, publicKey: encodeBase64(kp.publicKey) });
    }
    if (items.length) this.server.uploadOneTimePreKeys(this.userId, items);
  }

  private nextKeyId(): number {
    // Unique per client across restarts: keyIds are persisted with the keys.
    const next = (this.store.getJson<number>('keyid-counter') ?? 0) + 1;
    this.store.setJson('keyid-counter', next);
    return next * 1000 + Math.floor(Math.random() * 1000);
  }

  identityKeys(): ServerIdentity {
    const sign = this.store.getJson<StoredPair>('identity-sign');
    const dh = this.store.getJson<StoredPair>('identity-dh');
    if (!sign || !dh) throw new Error('not registered');
    return {
      identitySignPublicKey: sign.publicKey,
      identityDhPublicKey: dh.publicKey,
      identityBindingSignature: signIdentityBinding(decodeBase64(sign.privateKey), dh.publicKey),
    };
  }

  // ───────── trust store (display-only today, P0-9) ─────────

  pinIdentity(peerUserId: string, identity: ServerIdentity): void {
    this.store.setJson('trust:' + peerUserId, identity);
  }

  trustedIdentity(peerUserId: string): ServerIdentity | null {
    return this.store.getJson<ServerIdentity>('trust:' + peerUserId);
  }

  // ───────── sessions ─────────

  private sessionKey(peerUserId: string): string {
    return 'session:' + peerUserId;
  }

  sessionState(peerUserId: string): RatchetSessionV2 | null {
    return this.store.getJson<RatchetSessionV2>(this.sessionKey(peerUserId));
  }

  hasSession(peerUserId: string): boolean {
    return this.store.has(this.sessionKey(peerUserId));
  }

  private saveSession(peerUserId: string, session: RatchetSessionV2): void {
    this.store.setJson(this.sessionKey(peerUserId), session);
  }

  private persistStep(peerUserId: string, session: RatchetSessionV2, derivedKeys: DerivedMessageKey[]): void {
    // ratchetAdapter.ts order: keys first, then the session.
    for (const k of derivedKeys) {
      this.store.set('v2mk:' + peerUserId + ':' + k.direction + ':' + k.dhPub + ':' + String(k.n), k.messageKeyB64);
    }
    this.saveSession(peerUserId, session);
  }

  private storedMessageKey(peerUserId: string, direction: 'in' | 'out', dhPub: string, n: number): string | null {
    return this.store.get('v2mk:' + peerUserId + ':' + direction + ':' + dhPub + ':' + String(n));
  }

  messageKeyCount(peerUserId: string): number {
    return this.store.size('v2mk:' + peerUserId + ':');
  }

  /** ensureV2Session: create the session if missing; the initPacket rides on the first send. */
  startSession(peerUserId: string): X3DHInitPacket | null {
    if (this.hasSession(peerUserId)) return null;

    const bundle = this.server.getPreKeyBundle(this.userId, peerUserId);
    verifySignedPreKeyBundle(bundle);

    // NewChatScreen: TOFU pin on first contact. Nothing enforces it yet (P0-9).
    if (!this.trustedIdentity(peerUserId)) {
      this.pinIdentity(peerUserId, {
        identitySignPublicKey: bundle.identitySignPublicKey,
        identityDhPublicKey: bundle.identityDhPublicKey,
        identityBindingSignature: bundle.identityBindingSignature,
      });
    }

    const dh = this.store.getJson<StoredPair>('identity-dh');
    if (!dh) throw new Error('not registered');

    const { initPacket, sessionKeys, theirSignedPreKeyPublicKey } = x3dhInitiate({
      bundle,
      peerUserId,
      identityDhPublicKey: dh.publicKey,
      identityDhSecretKey: decodeBase64(dh.privateKey),
    });
    const session = initInitiatorSession({ peerUserId, sharedSecret: sessionKeys.rootKey, theirSignedPreKeyPublicKey });
    this.saveSession(peerUserId, session);
    return initPacket;
  }

  /** ensureV2SessionFromIncoming. */
  private bootstrapFromInitPacket(peerUserId: string, initPacket: X3DHInitPacket): void {
    if (this.hasSession(peerUserId)) return;

    const spk = this.store.getJson<StoredSignedPreKey>('signed-prekey');
    if (!spk) throw new ProtocolError('STORAGE_CORRUPTION', 'Signed prekey not found locally', { what: 'signedPreKey' });

    let opkSecret: Uint8Array | null = null;
    if (initPacket.oneTimePreKeyId !== null) {
      const raw = this.store.get('opk:' + String(initPacket.oneTimePreKeyId));
      opkSecret = raw ? decodeBase64(raw) : null;
    }

    const sessionKeys = x3dhRespond({ initPacket, signedPreKeySecretKey: decodeBase64(spk.privateKey), oneTimePreKeySecretKey: opkSecret });
    if (initPacket.oneTimePreKeyId !== null) this.store.delete('opk:' + String(initPacket.oneTimePreKeyId));

    const session = initResponderSession({
      peerUserId,
      sharedSecret: sessionKeys.rootKey,
      signedPreKey: { publicKey: spk.publicKey, privateKey: spk.privateKey },
    });
    this.saveSession(peerUserId, session);
  }

  // ───────── send / receive ─────────

  /** sendAuto + sendMessageV2 + encryptAndPersist. Returns what the server emitted. */
  send(peerUserId: string, text: string): NewMessageDTO {
    if (!this.network) throw new Error('client not attached to a network');
    const initPacket = this.startSession(peerUserId);

    const session = this.sessionState(peerUserId);
    if (!session) throw new ProtocolError('NO_SESSION', 'No v2 session for this peer');

    const step = ratchetEncrypt(session, text);
    this.persistStep(peerUserId, step.session, step.derivedKeys);

    this.msgCounter += 1;
    return this.network.send(this.userId, {
      toUserId: peerUserId,
      clientMessageId: this.userId + '-' + randomUUID(),
      createdAt: Date.now() + this.msgCounter,
      protoVersion: 2,
      v2: step.envelope,
      initPacket,
    });
  }

  /** The realtime message:new handler. Throws ProtocolError like the client's decrypt path. */
  receive(dto: NewMessageDTO): string {
    if (dto.fromUserId === this.userId) throw new Error('own echo must not be delivered to the harness client');
    const peerUserId = dto.fromUserId;

    if (!this.hasSession(peerUserId) && dto.initPacket) {
      this.bootstrapFromInitPacket(peerUserId, dto.initPacket);
    }
    const session = this.sessionState(peerUserId);
    if (!session) {
      throw dto.initPacket
        ? new ProtocolError('SESSION_RESET_REQUIRED', 'Failed to establish v2 session from incoming initPacket')
        : new ProtocolError('MISSING_BOOTSTRAP', 'Missing v2 session and initPacket for incoming message');
    }

    const step = ratchetDecrypt(session, dto.v2);
    this.persistStep(peerUserId, step.session, step.derivedKeys);
    this.inbox.push({ fromUserId: peerUserId, text: step.plaintext, serverMessageId: dto.serverMessageId });
    return step.plaintext;
  }

  /** useChatE2EE history load in 'live' mode, oldest first. */
  loadHistory(peerUserId: string): Array<{ mine: boolean; text: string }> {
    const out: Array<{ mine: boolean; text: string }> = [];
    for (const it of this.server.history(FakeServer.conversationId(this.userId, peerUserId))) {
      const mine = it.fromUserId === this.userId;
      const dhPub = normalizeB64(it.v2.header.dhPub);
      let text = '[Encrypted]';

      if (!mine && !this.hasSession(peerUserId) && it.initPacket) {
        try {
          this.bootstrapFromInitPacket(peerUserId, it.initPacket);
        } catch {
          /* mirrors the client: warn and fall through */
        }
      }

      if (!mine && this.hasSession(peerUserId)) {
        try {
          const step = ratchetDecrypt(this.sessionState(peerUserId)!, it.v2);
          this.persistStep(peerUserId, step.session, step.derivedKeys);
          text = step.plaintext;
        } catch {
          const mk = this.storedMessageKey(peerUserId, 'in', dhPub, it.v2.header.n);
          text = mk ? openWithStoredKey(mk, it.v2) : '[Encrypted]';
        }
      } else if (mine) {
        const mk = this.storedMessageKey(peerUserId, 'out', dhPub, it.v2.header.n);
        text = mk ? openWithStoredKey(mk, it.v2) : '[Encrypted]';
      }
      out.push({ mine, text });
    }
    return out;
  }

  // ───────── lifecycle ─────────

  /** useChatE2EE.resetSession: session and archived keys for the pair. */
  resetSession(peerUserId: string): void {
    this.store.delete(this.sessionKey(peerUserId));
    for (const k of this.store.keys('v2mk:' + peerUserId + ':')) this.store.delete(k);
  }

  /** Reinstall: everything local is gone, identity keys and the in-memory inbox included. */
  wipe(): void {
    this.store.clear();
    this.inbox.length = 0;
  }

  serialize(): string {
    return this.store.serialize();
  }

  /** App restart: a fresh process over the persisted store. */
  static restore(userId: string, server: FakeServer, json: string): VirtualClient {
    return new VirtualClient(userId, server, MemoryStore.restore(json));
  }
}

function openWithStoredKey(mkB64: string, v2: V2Encrypted): string {
  const plain = nacl.secretbox.open(
    decodeBase64(normalizeB64(v2.ciphertext)),
    decodeBase64(normalizeB64(v2.nonce)),
    decodeBase64(normalizeB64(mkB64)),
  );
  return plain ? utf8Decode(plain) : '[Decrypt failed]';
}
