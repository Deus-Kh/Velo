import type { PreKeyBundle } from '../../src/handshake/types';
import type { X3DHInitPacket } from '../../src/handshake/x3dh';
import type { MessageEnvelope } from '../../src/ratchet/message';

/**
 * Model of chats-server's key routes and message:send path, faithful to
 * the parts the protocol depends on:
 *  - GET /keys/bundle consumes the oldest unused one-time prekey and serves
 *    a bundle without one when the pool is empty (keys.routes.ts);
 *  - message:send dedupes by (sender, clientMessageId); a message carries
 *    only its own initPacket (the first-initPacket synthesis was removed in
 *    T2.13);
 *  - T3.1: ciphertext is held only until the recipient acks delivery; the
 *    ack leaves a metadata-only receipt. `undelivered` is what a client syncs.
 *
 * `malicious` hooks model a compromised or on-path server: substituting the
 * bundle or the initPacket a client receives, or relabelling the sender.
 */
export type ServerIdentity = { identitySignPublicKey: string; identityDhPublicKey: string; identityBindingSignature: string };

type ServerUser = {
  userId: string;
  identity: ServerIdentity | null;
  identityHistory: ServerIdentity[];
  identityChangedAt: number | null;
  signedPreKeys: Array<{ keyId: number; publicKey: string; signature: string; createdAt: number }>;
  oneTimePreKeys: Array<{ keyId: number; publicKey: string; used: boolean; createdAt: number }>;
};

export type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  protoVersion: 4;
  v4: MessageEnvelope;
  initPacket: X3DHInitPacket | null;
};

export type NewMessageDTO = {
  serverMessageId: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  protoVersion: 4;
  v4: MessageEnvelope;
  initPacket: X3DHInitPacket | null;
  clientMessageId: string;
  createdAt: number;
  /** T3.2: server-assigned per-conversation order. */
  seq: number;
};

export type MaliciousHooks = {
  substituteBundle?: (bundle: PreKeyBundle, requesterId: string) => PreKeyBundle;
  substituteIdentity?: (identity: ServerIdentity, requesterId: string, targetId: string) => ServerIdentity;
  /** Applied to what the recipient receives, after synthesis. */
  substituteInitPacket?: (initPacket: X3DHInitPacket | null, dto: NewMessageDTO) => X3DHInitPacket | null;
  /** Relabel the sender the recipient sees (impersonation). */
  relabelSender?: (fromUserId: string, dto: NewMessageDTO) => string;
};

export const MAX_UNUSED_ONE_TIME_PREKEYS = 500;
export const MAX_SIGNED_PREKEYS_PER_USER = 5;

export type Receipt = { serverMessageId: string; conversationId: string; fromUserId: string; toUserId: string; clientMessageId: string; createdAt: number; seq: number; status: 'delivered' | 'read'; deliveredAt: number };

export class FakeServer {
  readonly users = new Map<string, ServerUser>();
  /** Undelivered ciphertext (T3.1: delivered messages are stripped to `receipts`). */
  readonly messages: NewMessageDTO[] = [];
  readonly receipts: Receipt[] = [];
  /** Conversation members, like ConversationModel (survives message deletion). */
  readonly conversations = new Map<string, [string, string]>();
  /** ConversationModel.lastSeq (T3.2). */
  private readonly lastSeq = new Map<string, number>();
  readonly bundleIssues: Array<{ requesterId: string; targetId: string; oneTimePreKeyId: number | null }> = [];
  malicious: MaliciousHooks = {};
  /** Set by Network: routes an event to a client's socket room. */
  emitToUser: ((userId: string, event: string, payload: unknown) => void) | null = null;
  private seq = 0;

  static conversationId(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  private user(userId: string): ServerUser {
    let u = this.users.get(userId);
    if (!u) {
      u = { userId, identity: null, identityHistory: [], identityChangedAt: null, signedPreKeys: [], oneTimePreKeys: [] };
      this.users.set(userId, u);
    }
    return u;
  }

  /**
   * POST /keys/identity (T2.13): an identity change appends the old identity
   * to the history, purges the user's prekeys (they belonged to the old
   * install) and notifies every peer with a conversation.
   */
  uploadIdentityKeys(userId: string, identity: ServerIdentity): void {
    const u = this.user(userId);
    const prev = u.identity;
    const changed =
      !!prev && (prev.identitySignPublicKey !== identity.identitySignPublicKey || prev.identityDhPublicKey !== identity.identityDhPublicKey);
    u.identity = { ...identity };
    if (!changed || !prev) return;

    u.identityHistory.push(prev);
    u.identityChangedAt = ++this.seq;
    u.signedPreKeys = [];
    u.oneTimePreKeys = [];

    const peers = new Set<string>();
    for (const members of this.conversations.values()) {
      if (members[0] === userId) peers.add(members[1]);
      if (members[1] === userId) peers.add(members[0]);
    }
    for (const peerId of peers) this.emitToUser?.(peerId, 'identity:changed', { userId, identityChangedAt: u.identityChangedAt });
  }

  uploadSignedPreKey(userId: string, spk: { keyId: number; publicKey: string; signature: string }): void {
    const u = this.user(userId);
    const existing = u.signedPreKeys.find((s) => s.keyId === spk.keyId);
    if (existing) {
      existing.publicKey = spk.publicKey;
      existing.signature = spk.signature;
      return;
    }
    u.signedPreKeys.push({ ...spk, createdAt: ++this.seq });
    // keys.routes.ts (T2.10): keep the last MAX_SIGNED_PREKEYS_PER_USER per user.
    u.signedPreKeys = [...u.signedPreKeys].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SIGNED_PREKEYS_PER_USER);
  }

  uploadOneTimePreKeys(userId: string, items: Array<{ keyId: number; publicKey: string }>): void {
    const u = this.user(userId);
    const unused = u.oneTimePreKeys.filter((k) => !k.used).length;
    if (unused + items.length > MAX_UNUSED_ONE_TIME_PREKEYS) throw new Error('PREKEY_POOL_FULL');
    for (const it of items) {
      if (u.oneTimePreKeys.some((k) => k.keyId === it.keyId)) continue; // duplicates ignored
      u.oneTimePreKeys.push({ ...it, used: false, createdAt: ++this.seq });
    }
  }

  unusedOneTimePreKeyCount(userId: string): number {
    return this.user(userId).oneTimePreKeys.filter((k) => !k.used).length;
  }

  getIdentity(requesterId: string, targetId: string): ServerIdentity {
    const u = this.users.get(targetId);
    if (!u || !u.identity) throw new Error('NOT_FOUND');
    const identity = { ...u.identity };
    return this.malicious.substituteIdentity ? this.malicious.substituteIdentity(identity, requesterId, targetId) : identity;
  }

  getPreKeyBundle(requesterId: string, targetId: string): PreKeyBundle {
    if (requesterId === targetId) throw new Error('SELF_BUNDLE');
    const u = this.users.get(targetId);
    if (!u) throw new Error('NOT_FOUND');
    if (!u.identity) throw new Error('NO_IDENTITY_KEY');

    const signed = [...u.signedPreKeys].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!signed) throw new Error('NO_SIGNED_PREKEY');

    // Consume the oldest unused one-time prekey; null when the pool is empty.
    const oneTime = [...u.oneTimePreKeys].filter((k) => !k.used).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
    if (oneTime) oneTime.used = true;

    this.bundleIssues.push({ requesterId, targetId, oneTimePreKeyId: oneTime ? oneTime.keyId : null });

    const bundle: PreKeyBundle = {
      userId: targetId,
      identitySignPublicKey: u.identity.identitySignPublicKey,
      identityDhPublicKey: u.identity.identityDhPublicKey,
      identityBindingSignature: u.identity.identityBindingSignature,
      signedPreKey: { keyId: signed.keyId, publicKey: signed.publicKey, signature: signed.signature },
      oneTimePreKey: oneTime ? { keyId: oneTime.keyId, publicKey: oneTime.publicKey } : null,
      remainingOneTimePreKeys: this.unusedOneTimePreKeyCount(targetId),
      pqPreKey: null, // T3.5: served, never encapsulated to
    };
    return this.malicious.substituteBundle ? this.malicious.substituteBundle(bundle, requesterId) : bundle;
  }

  /** message:send. Returns what the recipient is emitted (after hooks). */
  storeMessage(fromUserId: string, dto: SendMessageDTO): NewMessageDTO {
    const conversationId = FakeServer.conversationId(fromUserId, dto.toUserId);
    this.conversations.set(conversationId, [fromUserId, dto.toUserId].sort() as [string, string]);
    // Dedupe by (sender, clientMessageId): a resend after delivery gets the same id and is not re-emitted.
    const delivered = this.receipts.find((r) => r.fromUserId === fromUserId && r.clientMessageId === dto.clientMessageId);
    const existing = this.messages.find((m) => m.fromUserId === fromUserId && m.clientMessageId === dto.clientMessageId)
      ?? (delivered ? { serverMessageId: delivered.serverMessageId, conversationId, fromUserId, toUserId: dto.toUserId, protoVersion: 4 as const, v4: dto.v4, initPacket: dto.initPacket, clientMessageId: dto.clientMessageId, createdAt: delivered.createdAt, seq: delivered.seq } : undefined);

    const stored: NewMessageDTO = existing ?? {
      serverMessageId: 'srv-' + String(++this.seq),
      conversationId,
      fromUserId,
      toUserId: dto.toUserId,
      protoVersion: 4,
      v4: dto.v4,
      initPacket: dto.initPacket,
      clientMessageId: dto.clientMessageId,
      createdAt: dto.createdAt,
      seq: (this.lastSeq.get(conversationId) ?? 0) + 1, // T3.2: atomic per conversation; the client clock never orders
    };
    if (!existing) {
      this.messages.push(stored);
      this.lastSeq.set(conversationId, stored.seq);
    }

    let out: NewMessageDTO = { ...stored };
    if (this.malicious.substituteInitPacket) out = { ...out, initPacket: this.malicious.substituteInitPacket(out.initPacket, out) };
    if (this.malicious.relabelSender) out = { ...out, fromUserId: this.malicious.relabelSender(out.fromUserId, out) };
    return out;
  }

  /** GET /messages/undelivered: ciphertext still held for `userId`, oldest first. */
  undelivered(userId: string, peerUserId?: string): NewMessageDTO[] {
    return this.messages
      .filter((m) => m.toUserId === userId && (!peerUserId || m.fromUserId === peerUserId))
      .sort((a, b) => a.seq - b.seq || a.serverMessageId.localeCompare(b.serverMessageId))
      .map((m) => ({ ...m }));
  }

  /**
   * message:delivered / POST /messages/delivered (T3.1): only the recipient may
   * ack; the ciphertext is deleted and a receipt remains; the sender is told.
   */
  ackDelivered(userId: string, serverMessageId: string): 'delivered' | 'NOT_FOUND' | 'FORBIDDEN' {
    const i = this.messages.findIndex((m) => m.serverMessageId === serverMessageId);
    if (i < 0) return this.receipts.some((r) => r.serverMessageId === serverMessageId && r.toUserId === userId) ? 'delivered' : 'NOT_FOUND';
    const m = this.messages[i]!;
    if (m.toUserId !== userId) return 'FORBIDDEN';
    this.messages.splice(i, 1);
    const deliveredAt = ++this.seq;
    this.receipts.push({ serverMessageId, conversationId: m.conversationId, fromUserId: m.fromUserId, toUserId: m.toUserId, clientMessageId: m.clientMessageId, createdAt: m.createdAt, seq: m.seq, status: 'delivered', deliveredAt });
    this.emitToUser?.(m.fromUserId, 'message:status-changed', { conversationId: m.conversationId, status: 'delivered', serverMessageId, deliveredAt, deliveredByUserId: userId });
    return 'delivered';
  }

  /** Ciphertext the server holds for a conversation (any direction). Zero once everything is delivered. */
  heldCiphertextCount(conversationId: string): number {
    return this.messages.filter((m) => m.conversationId === conversationId).length;
  }
}
