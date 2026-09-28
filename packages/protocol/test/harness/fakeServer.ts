import type { PreKeyBundle } from '../../src/handshake/types';
import type { X3DHInitPacket } from '../../src/handshake/x3dh';
import type { V2Encrypted } from '../../src/ratchet/message';

/**
 * Model of chats-server's key routes and message:send path, faithful to
 * the parts the protocol depends on:
 *  - GET /keys/bundle consumes the oldest unused one-time prekey and serves
 *    a bundle without one when the pool is empty (keys.routes.ts);
 *  - message:send dedupes by (sender, clientMessageId) and attaches the
 *    sender's FIRST stored initPacket to any later message that lacks one
 *    (setupSocket.ts, "firstWithInitPacket"); history returns stored docs.
 *
 * `malicious` hooks model a compromised or on-path server: substituting the
 * bundle or the initPacket a client receives, or relabelling the sender.
 */
export type ServerIdentity = { identitySignPublicKey: string; identityDhPublicKey: string };

type ServerUser = {
  userId: string;
  identity: ServerIdentity | null;
  signedPreKeys: Array<{ keyId: number; publicKey: string; signature: string; createdAt: number }>;
  oneTimePreKeys: Array<{ keyId: number; publicKey: string; used: boolean; createdAt: number }>;
};

export type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  protoVersion: 2;
  v2: V2Encrypted;
  initPacket: X3DHInitPacket | null;
};

export type NewMessageDTO = {
  serverMessageId: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  protoVersion: 2;
  v2: V2Encrypted;
  initPacket: X3DHInitPacket | null;
  clientMessageId: string;
  createdAt: number;
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

export class FakeServer {
  readonly users = new Map<string, ServerUser>();
  readonly messages: NewMessageDTO[] = [];
  readonly bundleIssues: Array<{ requesterId: string; targetId: string; oneTimePreKeyId: number | null }> = [];
  malicious: MaliciousHooks = {};
  private seq = 0;

  static conversationId(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  private user(userId: string): ServerUser {
    let u = this.users.get(userId);
    if (!u) {
      u = { userId, identity: null, signedPreKeys: [], oneTimePreKeys: [] };
      this.users.set(userId, u);
    }
    return u;
  }

  uploadIdentityKeys(userId: string, identity: ServerIdentity): void {
    this.user(userId).identity = { ...identity };
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
      signedPreKey: { keyId: signed.keyId, publicKey: signed.publicKey, signature: signed.signature },
      oneTimePreKey: oneTime ? { keyId: oneTime.keyId, publicKey: oneTime.publicKey } : null,
      remainingOneTimePreKeys: this.unusedOneTimePreKeyCount(targetId),
    };
    return this.malicious.substituteBundle ? this.malicious.substituteBundle(bundle, requesterId) : bundle;
  }

  /** message:send. Returns what the recipient is emitted (after synthesis and hooks). */
  storeMessage(fromUserId: string, dto: SendMessageDTO): NewMessageDTO {
    const existing = this.messages.find((m) => m.fromUserId === fromUserId && m.clientMessageId === dto.clientMessageId);
    const conversationId = FakeServer.conversationId(fromUserId, dto.toUserId);

    const stored: NewMessageDTO = existing ?? {
      serverMessageId: 'srv-' + String(++this.seq),
      conversationId,
      fromUserId,
      toUserId: dto.toUserId,
      protoVersion: 2,
      v2: dto.v2,
      initPacket: dto.initPacket,
      clientMessageId: dto.clientMessageId,
      createdAt: dto.createdAt,
    };
    if (!existing) this.messages.push(stored);

    let initPacket = stored.initPacket;
    if (!initPacket) {
      const first = this.messages.find((m) => m.conversationId === conversationId && m.fromUserId === fromUserId && m.initPacket);
      initPacket = first ? first.initPacket : null;
    }

    let out: NewMessageDTO = { ...stored, initPacket };
    if (this.malicious.substituteInitPacket) out = { ...out, initPacket: this.malicious.substituteInitPacket(out.initPacket, out) };
    if (this.malicious.relabelSender) out = { ...out, fromUserId: this.malicious.relabelSender(out.fromUserId, out) };
    return out;
  }

  /** History as persisted: initPacket only on the message that carried it. */
  history(conversationId: string): NewMessageDTO[] {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt || a.serverMessageId.localeCompare(b.serverMessageId))
      .map((m) => ({ ...m }));
  }
}
