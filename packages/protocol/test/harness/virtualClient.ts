import { randomUUID } from 'crypto';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../../src/errors';
import { verifySignedPreKeyBundle } from '../../src/handshake/bundle';
import { signIdentityBinding, verifyIdentityBinding } from '../../src/identity/binding';
import { requireIdentityMatch } from '../../src/identity/trust';
import { x3dhInitiate, x3dhRespond, type X3DHInitPacket } from '../../src/handshake/x3dh';
import { rotateSignedPreKeySet, selectSignedPreKey, signSignedPreKey, type SignedPreKeyRecord, type SignedPreKeySet } from '../../src/handshake/signedPrekey';
import { normalizeB64 } from '../../src/primitives/base64';
import { ratchetDecrypt, ratchetEncrypt, type MessageEnvelope } from '../../src/ratchet/message';
import type { AssociatedData } from '../../src/ratchet/envelope';
import { glareWinner, initInitiatorSession, initResponderSession, sessionHasReceived } from '../../src/ratchet/session';
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
 * Identity trust mirrors the client's crypto/identityTrust.ts (T2.13): the
 * pin is created silently on first contact from a binding-verified
 * identity; every bundle and every initPacket must agree with it, or the
 * step fails with IDENTITY_MISMATCH; acceptNewIdentity re-pins and drops
 * the session.
 *
 * Sessions use the standard Double Ratchet bootstrap (T2.0): the initiator
 * ratchets once at creation against SPK_B; the responder copies its SPK
 * pair and ratchets on the first inbound message.
 */
type StoredPair = { publicKey: string; privateKey: string };

export type ReceivedMessage = { fromUserId: string; text: string; serverMessageId: string };

/** storage/messageStore.ts record, as far as the harness models it. */
export type StoredMessageRecord = { direction: 'in' | 'out'; text: string; createdAt: number; seq: number; serverMessageId: string };

export class VirtualClient {
  network: Network | null = null;
  readonly inbox: ReceivedMessage[] = [];
  /** Peers the server reported an identity change for (identity:changed). */
  readonly identityChanges: string[] = [];
  /** useChatE2EE 'identity_changed': sending to these peers is refused until the user accepts the new identity. */
  private readonly blockedPeers = new Set<string>();
  private msgCounter = 0; // orders createdAt; ids are random like the client's
  /** Added to this client's clock when stamping outgoing messages (T3.2 scenarios). */
  clockSkewMs = 0;

  constructor(
    readonly userId: string,
    readonly server: FakeServer,
    public store: MemoryStore = new MemoryStore(),
    /** Fake clock (ms); signed-prekey rotation and expiry depend on it. */
    readonly now: () => number = () => Date.now(),
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

    // crypto/prekeys.ts ensureSignedPreKeyForUser (T2.10): rotate when due, retain previous keys, upload the current one.
    const signSk = decodeBase64(sign.privateKey);
    const generate = (createdAt: number): SignedPreKeyRecord => {
      const kp = nacl.box.keyPair();
      const keyId = this.nextKeyId();
      const publicKey = encodeBase64(kp.publicKey);
      return { keyId, publicKey, privateKey: encodeBase64(kp.secretKey), signature: signSignedPreKey(signSk, keyId, publicKey), createdAt };
    };
    const { set } = rotateSignedPreKeySet(this.store.getJson<SignedPreKeySet>('signed-prekeys'), this.now(), generate);
    this.store.setJson('signed-prekeys', set);
    this.server.uploadSignedPreKey(this.userId, { keyId: set.current.keyId, publicKey: set.current.publicKey, signature: set.current.signature });

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

  // ───────── trust store ─────────

  pinIdentity(peerUserId: string, identity: ServerIdentity): void {
    this.store.setJson('trust:' + peerUserId, identity);
  }

  /** crypto/identityTrust.ts enforcePinnedIdentity: verify the binding, compare with the pin, pin on first contact. */
  private enforcePinnedIdentity(peerUserId: string, presented: ServerIdentity): ServerIdentity {
    verifyIdentityBinding(presented);
    const pinned = this.trustedIdentity(peerUserId);
    const result = requireIdentityMatch(pinned, presented, peerUserId);
    if (result === 'first-contact') this.pinIdentity(peerUserId, presented);
    return pinned ?? presented;
  }

  /** crypto/identityTrust.ts authenticateInitiator: the packet's DH key must be the pinned one. */
  private authenticateInitiator(peerUserId: string, initPacket: X3DHInitPacket): void {
    let pinned = this.trustedIdentity(peerUserId);
    if (!pinned) pinned = this.enforcePinnedIdentity(peerUserId, this.server.getIdentity(this.userId, peerUserId));
    requireIdentityMatch(
      pinned,
      { identitySignPublicKey: pinned.identitySignPublicKey, identityDhPublicKey: initPacket.initiatorIdentityDhPublicKey },
      peerUserId,
    );
  }

  /** The user accepted the peer's new identity: re-pin from the server and drop the session. */
  acceptNewIdentity(peerUserId: string): void {
    const fetched = this.server.getIdentity(this.userId, peerUserId);
    verifyIdentityBinding(fetched);
    this.pinIdentity(peerUserId, fetched);
    this.resetSession(peerUserId);
    this.blockedPeers.delete(peerUserId);
  }

  /** Socket events from the server (identity:changed). */
  onEvent(event: string, payload: unknown): void {
    if (event === 'identity:changed') {
      const peer = (payload as { userId: string }).userId;
      this.identityChanges.push(peer);
      this.blockedPeers.add(peer);
    }
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

  private persistStep(peerUserId: string, session: RatchetSessionV2): void {
    // ratchetAdapter.ts since T2.14: the session only; since T3.4 no key material leaves a step.
    this.saveSession(peerUserId, session);
  }

  /** storage/messageStore.ts: plaintext kept locally, sealed in the real client. */
  private storeMessage(peerUserId: string, m: StoredMessageRecord): void {
    const key = 'msgs:' + peerUserId;
    const list = this.store.getJson<StoredMessageRecord[]>(key) ?? [];
    if (list.some((x) => x.serverMessageId === m.serverMessageId)) return;
    list.push(m);
    // T3.2: conversation order is the server sequence, never the sender's clock.
    list.sort((a, b) => a.seq - b.seq || a.serverMessageId.localeCompare(b.serverMessageId));
    this.store.setJson(key, list);
  }

  /** Archived message keys for the pair: always 0 since T2.14 (kept so S16/S24 can assert it). */
  messageKeyCount(peerUserId: string): number {
    return this.store.size('v2mk:' + peerUserId + ':');
  }

  /** Locally stored messages for the pair, oldest first. */
  storedMessages(peerUserId: string): StoredMessageRecord[] {
    return this.store.getJson<StoredMessageRecord[]>('msgs:' + peerUserId) ?? [];
  }

  /** crypto/associatedData.ts: identities for the message MAC — ours from the store, the peer's from the pin. */
  private associatedData(peerUserId: string, direction: 'out' | 'in'): AssociatedData {
    const mine = this.store.getJson<StoredPair>('identity-sign');
    const pinned = this.trustedIdentity(peerUserId);
    if (!mine || !pinned) throw new ProtocolError('NO_SESSION', 'No pinned identity for this peer', { peerUserId });
    return direction === 'out'
      ? { senderIdentityKey: mine.publicKey, receiverIdentityKey: pinned.identitySignPublicKey }
      : { senderIdentityKey: pinned.identitySignPublicKey, receiverIdentityKey: mine.publicKey };
  }

  /** ensureV2Session: create the session if missing; the initPacket rides on the first send. */
  startSession(peerUserId: string): X3DHInitPacket | null {
    if (this.hasSession(peerUserId)) return null;

    const bundle = this.server.getPreKeyBundle(this.userId, peerUserId);
    verifySignedPreKeyBundle(bundle);
    this.enforcePinnedIdentity(peerUserId, {
      identitySignPublicKey: bundle.identitySignPublicKey,
      identityDhPublicKey: bundle.identityDhPublicKey,
      identityBindingSignature: bundle.identityBindingSignature,
    });

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

  /**
   * chat/incoming.ts bootstrapAndDecrypt (T2.11): authenticate the initiator, refuse a replayed
   * packet, build a candidate session and decrypt the message with it; persist only on success,
   * then drop the one-time prekey secret and remember the packet.
   */
  private bootstrapAndDecrypt(peerUserId: string, initPacket: X3DHInitPacket, envelope: MessageEnvelope): { plaintext: string; session: RatchetSessionV2 } {
    const candidate = this.decryptWithCandidate(peerUserId, initPacket, envelope);
    this.persistStep(peerUserId, candidate.session);
    this.finishBootstrap(peerUserId, initPacket);
    return { plaintext: candidate.plaintext, session: candidate.session };
  }

  /** Authenticate, refuse replays, build the candidate and decrypt with it. Persists nothing. */
  private decryptWithCandidate(peerUserId: string, initPacket: X3DHInitPacket, envelope: MessageEnvelope): { plaintext: string; session: RatchetSessionV2 } {
    this.authenticateInitiator(peerUserId, initPacket);
    const seen = this.store.getJson<string[]>('bootstrap-seen:' + peerUserId) ?? [];
    if (seen.includes(initPacket.ephPublicKey)) {
      throw new ProtocolError('REPLAY_DETECTED', 'Bootstrap packet already used for this peer', { peerUserId });
    }
    const candidate = this.candidateSession(peerUserId, initPacket);
    const step = ratchetDecrypt(candidate, envelope, this.associatedData(peerUserId, 'in'));
    return { plaintext: step.plaintext, session: step.session };
  }

  /** After the session is persisted: drop the one-time prekey secret and remember the packet. */
  private finishBootstrap(peerUserId: string, initPacket: X3DHInitPacket): void {
    if (initPacket.oneTimePreKeyId !== null) this.store.delete('opk:' + String(initPacket.oneTimePreKeyId));
    const seen = this.store.getJson<string[]>('bootstrap-seen:' + peerUserId) ?? [];
    this.store.setJson('bootstrap-seen:' + peerUserId, [...seen, initPacket.ephPublicKey].slice(-32));
  }

  /** x3dhRespond + initResponderSession without persisting anything. */
  private candidateSession(peerUserId: string, initPacket: X3DHInitPacket): RatchetSessionV2 {

    // The pair the packet names: current or retained; expired or unknown is SESSION_RESET_REQUIRED (T2.10).
    const spk = selectSignedPreKey(this.store.getJson<SignedPreKeySet>('signed-prekeys'), initPacket.signedPreKeyId, this.now());

    let opkSecret: Uint8Array | null = null;
    if (initPacket.oneTimePreKeyId !== null) {
      const raw = this.store.get('opk:' + String(initPacket.oneTimePreKeyId));
      opkSecret = raw ? decodeBase64(raw) : null;
    }

    const identityDh = this.store.getJson<StoredPair>('identity-dh');
    if (!identityDh) throw new ProtocolError('STORAGE_CORRUPTION', 'Identity DH key not found locally', { what: 'identityDh' });
    const sessionKeys = x3dhRespond({
      initPacket,
      signedPreKeySecretKey: decodeBase64(spk.privateKey),
      identityDhSecretKey: decodeBase64(identityDh.privateKey),
      oneTimePreKeySecretKey: opkSecret,
    });
    return initResponderSession({
      peerUserId,
      sharedSecret: sessionKeys.rootKey,
      signedPreKey: { publicKey: spk.publicKey, privateKey: spk.privateKey },
    });
  }

  // ───────── send / receive ─────────

  /** sendAuto + sendMessageV2 + encryptAndPersist. Returns what the server emitted. */
  send(peerUserId: string, text: string): NewMessageDTO {
    if (!this.network) throw new Error('client not attached to a network');
    if (this.blockedPeers.has(peerUserId)) {
      throw new ProtocolError('IDENTITY_MISMATCH', 'Identity of ' + peerUserId + ' changed; sending is blocked until the new identity is accepted', { peerUserId });
    }
    const initPacket = this.startSession(peerUserId);

    const session = this.sessionState(peerUserId);
    if (!session) throw new ProtocolError('NO_SESSION', 'No v2 session for this peer');

    const step = ratchetEncrypt(session, text, this.associatedData(peerUserId, 'out'));
    this.persistStep(peerUserId, step.session);

    this.msgCounter += 1;
    const dto = this.network.send(this.userId, {
      toUserId: peerUserId,
      clientMessageId: this.userId + '-' + randomUUID(),
      createdAt: Date.now() + this.clockSkewMs + this.msgCounter,
      protoVersion: 3,
      v3: step.envelope,
      initPacket,
    });
    this.storeMessage(peerUserId, { direction: 'out', text, createdAt: dto.createdAt, seq: dto.seq, serverMessageId: dto.serverMessageId });
    return dto;
  }

  /** The realtime message:new handler. Throws ProtocolError like the client's decrypt path. */
  receive(dto: NewMessageDTO): string {
    if (dto.fromUserId === this.userId) throw new Error('own echo must not be delivered to the harness client');
    const peerUserId = dto.fromUserId;
    const session = this.sessionState(peerUserId);
    const secondaryKey = 'session-secondary:' + peerUserId;

    let plaintext: string;
    if (!session) {
      if (!dto.initPacket) throw new ProtocolError('MISSING_BOOTSTRAP', 'Missing v2 session and initPacket for incoming message');
      plaintext = this.bootstrapAndDecrypt(peerUserId, dto.initPacket, dto.v3).plaintext;
    } else if (dto.initPacket && !(this.store.getJson<string[]>('bootstrap-seen:' + peerUserId) ?? []).includes(dto.initPacket.ephPublicKey)) {
      // chat/incoming.ts: a packet for a session we do not have — glare or a peer reset. Candidate must decrypt.
      const candidate = this.decryptWithCandidate(peerUserId, dto.initPacket, dto.v3);
      if (!sessionHasReceived(session) && glareWinner(this.userId, peerUserId)) {
        this.persistStep(peerUserId, session);
        this.store.setJson(secondaryKey, candidate.session);
      } else {
        this.persistStep(peerUserId, candidate.session);
        this.store.delete(secondaryKey);
      }
      this.finishBootstrap(peerUserId, dto.initPacket);
      plaintext = candidate.plaintext;
    } else {
      try {
        const step = ratchetDecrypt(session, dto.v3, this.associatedData(peerUserId, 'in'));
        this.persistStep(peerUserId, step.session);
        this.store.delete(secondaryKey); // the peer sends on our session: the glare secondary is retired
        plaintext = step.plaintext;
      } catch (e) {
        const secondary = this.store.getJson<RatchetSessionV2>(secondaryKey);
        const code = e instanceof ProtocolError ? e.code : null;
        if (!secondary || (code !== 'DECRYPT_FAILED' && code !== 'HEADER_TAMPERED' && code !== 'UNKNOWN_OLD_MESSAGE')) throw e;
        const step = ratchetDecrypt(secondary, dto.v3, this.associatedData(peerUserId, 'in'));
        this.persistStep(peerUserId, session);
        this.store.setJson(secondaryKey, step.session);
        plaintext = step.plaintext;
      }
    }
    this.inbox.push({ fromUserId: peerUserId, text: plaintext, serverMessageId: dto.serverMessageId });
    this.storeMessage(peerUserId, { direction: 'in', text: plaintext, createdAt: dto.createdAt, seq: dto.seq, serverMessageId: dto.serverMessageId });
    // socket/messaging.ts: the delivered ack goes out only after the message decrypted (T3.1: the server then deletes it).
    this.server.ackDelivered(this.userId, dto.serverMessageId);
    return plaintext;
  }

  /**
   * useChatE2EE history (T2.14 + T3.1): the local store first, then only the
   * ciphertext the server still holds for us, decrypted through the normal
   * receive path (which acks, so the server deletes it).
   */
  loadHistory(peerUserId: string): Array<{ mine: boolean; text: string }> {
    const stored = this.storedMessages(peerUserId);
    for (const it of this.server.undelivered(this.userId, peerUserId)) {
      if (stored.some((m) => m.serverMessageId === it.serverMessageId)) {
        this.server.ackDelivered(this.userId, it.serverMessageId); // stored earlier, ack was lost
        continue;
      }
      try {
        this.receive(it);
      } catch {
        /* mirrors the client: warned, skipped, and left on the server */
      }
    }
    return this.storedMessages(peerUserId).map((m) => ({ mine: m.direction === 'out', text: m.text }));
  }

  // ───────── lifecycle ─────────

  /** useChatE2EE.resetSession: session and archived keys for the pair. */
  resetSession(peerUserId: string): void {
    this.store.delete(this.sessionKey(peerUserId));
    this.store.delete('session-secondary:' + peerUserId);
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
  static restore(userId: string, server: FakeServer, json: string, now?: () => number): VirtualClient {
    return new VirtualClient(userId, server, MemoryStore.restore(json), now);
  }
}
