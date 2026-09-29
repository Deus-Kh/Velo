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
import { ratchetDecrypt, ratchetEncrypt, type MessageEnvelope, type MessageHeader } from '../../src/ratchet/message';
import { decodeContent, encodeContent, isActionContent, isControlContent, textContent, type ActionContent, type Content } from '../../src/content/envelope';
import type { AssociatedData } from '../../src/ratchet/envelope';
import { glareWinner, initInitiatorSession, initResponderSession, sessionHasReceived } from '../../src/ratchet/session';
import type { RatchetSessionV2 } from '../../src/types/session';
import { groupDecryptContent, groupEncryptContent } from '../../src/senderkey/message';
import { createSenderKeyState, senderKeyDistributionMessage, senderKeyStateFromDistribution, type SenderKeyState } from '../../src/senderkey/state';
import { FakeServer, type GroupCopyDTO, type GroupSendResult, type NewMessageDTO, type ServerIdentity } from './fakeServer';
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
export type ReceivedGroupMessage = { groupId: string; fromUserId: string; text: string; serverMessageId: string };
/** storage/senderKeyStore.ts records, as the harness models them. */
type OwnSenderKeyRecord = { epoch: number; state: SenderKeyState };
type DistributionRecord = { epoch: number; keyId: number; userIds: string[] };

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
  /** T3.6: the plaintext headers this client sealed, by clientMessageId (the wire carries them encrypted). */
  readonly sentHeaders = new Map<string, MessageHeader>();
  /** T6.2: control content received over pairwise sessions (sender-key distributions and requests). */
  readonly controlInbox: Array<{ fromUserId: string; content: Content; serverMessageId: string }> = [];
  /** T6.4: group messages this client opened. */
  readonly groupInbox: ReceivedGroupMessage[] = [];
  /** T7.1–T7.7: actions (reaction, edit, delete, timer, profile) received over a pairwise session or a group chain; the app's store layer applies them. */
  readonly actionInbox: Array<{ fromUserId: string; groupId: string | null; content: ActionContent; serverMessageId: string }> = [];
  /** T6.4: sender-key traffic this client sent over pairwise sessions (assertions only). */
  readonly distributionsSent: Array<{ to: string; groupId: string; keyId: number }> = [];
  readonly keyRequestsSent: Array<{ to: string; groupId: string }> = [];

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

  /** Socket events from the server (identity:changed, group:changed). */
  onEvent(event: string, payload: unknown): void {
    if (event === 'identity:changed') {
      const peer = (payload as { userId: string }).userId;
      this.identityChanges.push(peer);
      this.blockedPeers.add(peer);
    }
    if (event === 'group:changed') this.onGroupChanged(payload as { groupId: string; epoch: number; change: { type: string; userIds: string[] } });
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

  /** The header this client sealed for one of its own messages (tests only; the wire carries it encrypted). */
  sentHeader(clientMessageId: string): MessageHeader {
    const h = this.sentHeaders.get(clientMessageId);
    if (!h) throw new Error('no sent header for ' + clientMessageId);
    return h;
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
    const session = initInitiatorSession({ peerUserId, sharedSecret: sessionKeys.rootKey, headerKeyA: sessionKeys.headerKeyA, nextHeaderKeyB: sessionKeys.nextHeaderKeyB, theirSignedPreKeyPublicKey });
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
      headerKeyA: sessionKeys.headerKeyA,
      nextHeaderKeyB: sessionKeys.nextHeaderKeyB,
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

    const step = ratchetEncrypt(session, encodeContent(textContent(text)), this.associatedData(peerUserId, 'out')); // T6.2 envelope
    this.persistStep(peerUserId, step.session);

    this.msgCounter += 1;
    const clientMessageId = this.userId + '-' + randomUUID();
    this.sentHeaders.set(clientMessageId, step.header);
    const dto = this.network.send(this.userId, {
      toUserId: peerUserId,
      clientMessageId,
      createdAt: Date.now() + this.clockSkewMs + this.msgCounter,
      protoVersion: 4,
      v4: step.envelope,
      initPacket,
    });
    this.storeMessage(peerUserId, { direction: 'out', text, createdAt: dto.createdAt, seq: dto.seq, serverMessageId: dto.serverMessageId });
    return dto;
  }

  /** T6.2: send control content over the pairwise session (a sender-key distribution or request). */
  sendContent(peerUserId: string, content: Content): NewMessageDTO {
    if (!this.network) throw new Error('client not attached to a network');
    const initPacket = this.startSession(peerUserId);
    const session = this.sessionState(peerUserId);
    if (!session) throw new ProtocolError('NO_SESSION', 'No v2 session for this peer');
    const step = ratchetEncrypt(session, encodeContent(content), this.associatedData(peerUserId, 'out'));
    this.persistStep(peerUserId, step.session);
    this.msgCounter += 1;
    const clientMessageId = this.userId + '-' + randomUUID();
    this.sentHeaders.set(clientMessageId, step.header);
    return this.network.send(this.userId, {
      toUserId: peerUserId,
      clientMessageId,
      createdAt: Date.now() + this.clockSkewMs + this.msgCounter,
      protoVersion: 4,
      v4: step.envelope,
      initPacket,
    });
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
      plaintext = this.bootstrapAndDecrypt(peerUserId, dto.initPacket, dto.v4).plaintext;
    } else if (dto.initPacket && !(this.store.getJson<string[]>('bootstrap-seen:' + peerUserId) ?? []).includes(dto.initPacket.ephPublicKey)) {
      // chat/incoming.ts: a packet for a session we do not have — glare or a peer reset. Candidate must decrypt.
      const candidate = this.decryptWithCandidate(peerUserId, dto.initPacket, dto.v4);
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
        const step = ratchetDecrypt(session, dto.v4, this.associatedData(peerUserId, 'in'));
        this.persistStep(peerUserId, step.session);
        this.store.delete(secondaryKey); // the peer sends on our session: the glare secondary is retired
        plaintext = step.plaintext;
      } catch (e) {
        const secondary = this.store.getJson<RatchetSessionV2>(secondaryKey);
        const code = e instanceof ProtocolError ? e.code : null;
        if (!secondary || (code !== 'DECRYPT_FAILED' && code !== 'HEADER_TAMPERED' && code !== 'UNKNOWN_OLD_MESSAGE')) throw e;
        const step = ratchetDecrypt(secondary, dto.v4, this.associatedData(peerUserId, 'in'));
        this.persistStep(peerUserId, session);
        this.store.setJson(secondaryKey, step.session);
        plaintext = step.plaintext;
      }
    }
    // T6.2: the plaintext is a content envelope; control messages never reach the text inbox.
    const content = decodeContent(plaintext);
    if (isControlContent(content)) {
      this.controlInbox.push({ fromUserId: peerUserId, content, serverMessageId: dto.serverMessageId });
      this.handleControl(peerUserId, content); // T6.4: a member's key is stored; a request is answered
      this.server.ackDelivered(this.userId, dto.serverMessageId);
      return plaintext;
    }
    if (content.kind !== 'text') {
      // T7.1: an action (reaction, edit, delete, timer, profile) is applied by the app's store layer (T7.2+); the harness records and acks it.
      if (isActionContent(content)) this.actionInbox.push({ fromUserId: peerUserId, groupId: null, content, serverMessageId: dto.serverMessageId });
      this.server.ackDelivered(this.userId, dto.serverMessageId);
      return plaintext;
    }
    plaintext = content.text;
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

  // ───────── groups (T6.4 / T6.5): chat/groupKeys.ts + chat/groupMessaging.ts ─────────

  private ownKeyRecord(groupId: string): OwnSenderKeyRecord | null {
    return this.store.getJson<OwnSenderKeyRecord>('sk-own:' + groupId);
  }

  /** Our sender-key state for the group (null before the first send or change notice). */
  ownSenderKey(groupId: string): SenderKeyState | null {
    return this.ownKeyRecord(groupId)?.state ?? null;
  }

  /** A member's state as we hold it (null = SENDER_KEY_MISSING on its next message). */
  peerSenderKey(groupId: string, userId: string): SenderKeyState | null {
    return this.store.getJson<SenderKeyState>('sk-peer:' + groupId + ':' + userId);
  }

  private distribution(groupId: string): DistributionRecord | null {
    return this.store.getJson<DistributionRecord>('sk-dist:' + groupId);
  }

  /** groupKeys.ensureOwnSenderKey: one key per membership epoch; a new epoch is a fresh keyId with nobody holding it yet. */
  private ensureOwnSenderKey(groupId: string, epoch: number): SenderKeyState {
    const existing = this.ownKeyRecord(groupId);
    if (existing && existing.epoch === epoch) return existing.state;
    const state = createSenderKeyState();
    this.store.setJson('sk-own:' + groupId, { epoch, state });
    this.store.setJson('sk-dist:' + groupId, { epoch, keyId: state.keyId, userIds: [] });
    return state;
  }

  private sendDistribution(groupId: string, state: SenderKeyState, to: string): void {
    this.sendContent(to, { v: 1, kind: 'skdm', groupId, skdm: senderKeyDistributionMessage(state) });
    this.distributionsSent.push({ to, groupId, keyId: state.keyId });
  }

  /** groupKeys.distributeSenderKey: our current key to every member who does not have it yet. */
  distributeSenderKey(groupId: string): string[] {
    const group = this.server.getGroup(this.userId, groupId);
    if (!group) return [];
    const state = this.ensureOwnSenderKey(groupId, group.epoch);
    const dist = this.distribution(groupId);
    const have = dist && dist.epoch === group.epoch && dist.keyId === state.keyId ? new Set(dist.userIds) : new Set<string>();
    const lacking = group.members.filter((u) => u !== this.userId && !have.has(u));
    for (const to of lacking) this.sendDistribution(groupId, state, to);
    this.store.setJson('sk-dist:' + groupId, { epoch: group.epoch, keyId: state.keyId, userIds: [...have, ...lacking] });
    return lacking;
  }

  /** groupKeys.handleControlContent: keys from members only; a request is answered with our key to that member. */
  private handleControl(fromUserId: string, content: Content): void {
    if (!isControlContent(content)) return;
    const group = this.server.getGroup(this.userId, content.groupId);
    if (!group || !group.members.includes(fromUserId)) return; // not a member (any more): ignored
    if (content.kind === 'skdm') {
      this.store.setJson('sk-peer:' + content.groupId + ':' + fromUserId, senderKeyStateFromDistribution(content.skdm));
      return;
    }
    const state = this.ensureOwnSenderKey(group.groupId, group.epoch);
    this.sendDistribution(group.groupId, state, fromUserId);
    const dist = this.distribution(group.groupId);
    const userIds = new Set(dist && dist.epoch === group.epoch && dist.keyId === state.keyId ? dist.userIds : []);
    userIds.add(fromUserId);
    this.store.setJson('sk-dist:' + group.groupId, { epoch: group.epoch, keyId: state.keyId, userIds: [...userIds] });
  }

  /** T6.5: everything the device holds for a group (removed, left, or the group is gone). */
  private wipeGroupKeys(groupId: string): void {
    this.store.delete('sk-own:' + groupId);
    this.store.delete('sk-dist:' + groupId);
    for (const k of this.store.keys('sk-peer:' + groupId + ':')) this.store.delete(k);
  }

  /** ChatListScreen / useGroupChat on group:changed: rotate for the new epoch, forget departed members, redistribute; or wipe if we are out. */
  private onGroupChanged(evt: { groupId: string; epoch: number; change: { type: string; userIds: string[] } }): void {
    const gone = (evt.change.type === 'removed' || evt.change.type === 'left') && evt.change.userIds.includes(this.userId);
    const group = gone ? null : this.server.getGroup(this.userId, evt.groupId);
    if (!group) {
      this.wipeGroupKeys(evt.groupId);
      return;
    }
    for (const k of this.store.keys('sk-peer:' + evt.groupId + ':')) {
      const member = k.slice(('sk-peer:' + evt.groupId + ':').length);
      if (!group.members.includes(member)) this.store.delete(k);
    }
    this.ensureOwnSenderKey(evt.groupId, group.epoch);
    this.distributeSenderKey(evt.groupId);
  }

  /** POST /groups: create; every member (us included) learns of it and distributes its key. */
  createGroup(memberIds: string[], name = 'group'): string {
    return this.server.createGroup(this.userId, memberIds, name);
  }

  addMembers(groupId: string, userIds: string[]): void {
    this.server.addMembers(groupId, this.userId, userIds);
  }

  removeMember(groupId: string, userId: string): void {
    this.server.removeMember(groupId, this.userId, userId);
  }

  leaveGroup(groupId: string): void {
    this.server.removeMember(groupId, this.userId, this.userId);
  }

  /** groupMessaging.sendGroupMessage: distribute to whoever lacks our key, encrypt, group:send, store locally. */
  sendGroup(groupId: string, text: string): GroupSendResult {
    const { result, createdAt } = this.sendGroupEnvelope(groupId, textContent(text));
    if (result.ok) this.storeMessage(FakeServer.groupConversationId(groupId), { direction: 'out', text, createdAt, seq: result.seq, serverMessageId: result.serverMessageId });
    return result;
  }

  /** T7.2: an action on the group chain (groupMessaging.sendGroupContent); nothing stored as a message. */
  sendGroupContent(groupId: string, content: Content): GroupSendResult {
    return this.sendGroupEnvelope(groupId, content).result;
  }

  private sendGroupEnvelope(groupId: string, content: Content): { result: GroupSendResult; createdAt: number } {
    if (!this.network) throw new Error('client not attached to a network');
    const group = this.server.getGroup(this.userId, groupId);
    if (!group) throw new Error(this.userId + ' is not a member of ' + groupId);
    this.distributeSenderKey(groupId);
    const state = this.ensureOwnSenderKey(groupId, group.epoch);
    const step = groupEncryptContent(state, content, { groupId, senderUserId: this.userId }); // T7.1 envelope
    this.store.setJson('sk-own:' + groupId, { epoch: group.epoch, state: step.state });
    this.msgCounter += 1;
    const clientMessageId = this.userId + '-' + randomUUID();
    const createdAt = Date.now() + this.clockSkewMs + this.msgCounter;
    const result = this.network.sendGroup(this.userId, { groupId, clientMessageId, createdAt, epoch: group.epoch, g1: step.message });
    return { result, createdAt };
  }

  /**
   * groupMessaging.ingestGroupItems for one live copy. Null = dropped (from a
   * non-member). Throws like the client's decrypt path: SENDER_KEY_MISSING
   * (after asking the member for its key), SENDER_KEY_STALE (same), a
   * signature failure, replay, or an old iteration with no retained key.
   */
  receiveGroup(copy: GroupCopyDTO): string | null {
    if (copy.fromUserId === this.userId) throw new Error('own copy must not be delivered to the harness client');
    const group = this.server.getGroup(this.userId, copy.groupId);
    if (!group) throw new ProtocolError('SENDER_KEY_MISSING', 'Not a member of this group: no keys held', { groupId: copy.groupId });
    if (!group.members.includes(copy.fromUserId)) {
      this.server.ackDelivered(this.userId, copy.serverMessageId); // dropped: a departed member's copy never lingers
      return null;
    }
    const state = this.peerSenderKey(copy.groupId, copy.fromUserId);
    if (!state) {
      this.requestSenderKey(copy.groupId, copy.fromUserId);
      throw new ProtocolError('SENDER_KEY_MISSING', 'No sender key for this member', { groupId: copy.groupId, fromUserId: copy.fromUserId });
    }
    let step;
    try {
      step = groupDecryptContent(state, copy.g1, { groupId: copy.groupId, senderUserId: copy.fromUserId });
    } catch (e) {
      if (e instanceof ProtocolError && e.code === 'SENDER_KEY_STALE') this.requestSenderKey(copy.groupId, copy.fromUserId);
      throw e;
    }
    this.store.setJson('sk-peer:' + copy.groupId + ':' + copy.fromUserId, step.state);
    if (step.content.kind !== 'text') {
      if (isActionContent(step.content)) this.actionInbox.push({ fromUserId: copy.fromUserId, groupId: copy.groupId, content: step.content, serverMessageId: copy.serverMessageId });
      this.server.ackDelivered(this.userId, copy.serverMessageId); // T7.1: actions are the store layer's (T7.2+)
      return null;
    }
    const text = step.content.text;
    this.groupInbox.push({ groupId: copy.groupId, fromUserId: copy.fromUserId, text, serverMessageId: copy.serverMessageId });
    this.storeMessage(FakeServer.groupConversationId(copy.groupId), { direction: 'in', text, createdAt: copy.createdAt, seq: copy.seq, serverMessageId: copy.serverMessageId });
    this.server.ackDelivered(this.userId, copy.serverMessageId);
    return text;
  }

  private requestSenderKey(groupId: string, fromUserId: string): void {
    this.keyRequestsSent.push({ to: fromUserId, groupId });
    this.sendContent(fromUserId, { v: 1, kind: 'skdm-request', groupId });
  }

  /** useGroupChat open: the local store, then whatever the server still holds for us in the group. */
  loadGroupHistory(groupId: string): Array<{ mine: boolean; from: string | null; text: string }> {
    const conversationId = FakeServer.groupConversationId(groupId);
    const stored = this.storedMessages(conversationId);
    for (const copy of this.server.undeliveredGroup(this.userId, groupId)) {
      if (stored.some((m) => m.serverMessageId === copy.serverMessageId)) {
        this.server.ackDelivered(this.userId, copy.serverMessageId);
        continue;
      }
      try {
        this.receiveGroup(copy);
      } catch {
        /* warned, skipped, left on the server */
      }
    }
    return this.storedMessages(conversationId).map((m) => ({
      mine: m.direction === 'out',
      from: m.direction === 'out' ? this.userId : (this.groupInbox.find((g) => g.serverMessageId === m.serverMessageId)?.fromUserId ?? null),
      text: m.text,
    }));
  }

  /** Locally stored group messages, in server order. */
  groupMessages(groupId: string): string[] {
    return this.storedMessages(FakeServer.groupConversationId(groupId)).map((m) => m.text);
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
