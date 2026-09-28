import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { ConversationModel } from "../models/Conversation";
import { MessageModel } from "../models/Message";
import { sendMessagePushToUser } from "../push/firebase";
import { makeConversationId } from "../utils/conversation";
import { services } from "../lib/services";
import { PRESENCE_HEARTBEAT_MS } from "../lib/presence";
import { metrics } from "../lib/metrics";
import { GroupModel } from "../models/Group";
import { groupConversationId, isGroupMember } from "../lib/groups";
import { haveConversation } from "../lib/socketAuthz";
import { markDelivered, messageExpiry } from "../lib/delivery";
import { setRealtimeServer } from "../lib/realtime";
import { UserModel } from "../models/User";
import { log } from '../lib/logger';

/** Maximum encrypted message body accepted over the socket (P0-5 storage-flood control). */
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
/**
 * T3.6: the encrypted header is fixed-size: 24-byte nonce + 16-byte Poly1305 tag + 45-byte canonical
 * header (u8 version | u32 dhPubLen | 32-byte dhPub | u32 n | u32 pn). Mirrors packages/protocol ENCRYPTED_HEADER_LENGTH.
 * The server cannot see counters any more, so the counter bound is the receiver's (spec T2.6).
 */
const ENCRYPTED_HEADER_BYTES = 24 + 16 + 45;
/** Same bound expressed as base64 characters (4 chars per 3 bytes, padded). */
const MAX_CIPHERTEXT_B64_LENGTH = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4;

/** Wire v4 envelope (T3.6): encrypted header, secretbox payload, MAC over identities + encrypted header + ciphertext. Three opaque strings. */
type V4Payload = {
  encHeader: string;
  ciphertext: string;
  mac: string;
};

/** T6.3 group message: the sender-key ciphertext with its signature, opaque to the server. */
type GroupSendDTO = {
  groupId: string;
  clientMessageId: string;
  createdAt: number;
  epoch?: number;
  g1: { v: 1; keyId: number; iteration: number; ciphertext: string; signature: string };
};

type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  protoVersion?: 4;
  v4?: V4Payload | null; // v4 envelope (T3.6)
  replyTo?: {
    serverMessageId?: string | null;
    clientMessageId?: string | null;
  } | null;
  initPacket?: {
    peerUserId: string;
    ephPublicKey: string;
    signedPreKeyId: number;
    oneTimePreKeyId: number | null;
    initiatorIdentityDhPublicKey: string;
    pqPreKeyId?: number | null; // T3.5, ignored today
    kemCiphertext?: string | null;
  } | null;
};

function isNonEmptyString(v: unknown, minLen = 1): v is string {
  return typeof v === "string" && v.length >= minLen;
}

/** A v4 encrypted header decodes to exactly ENCRYPTED_HEADER_BYTES (T3.6). */
function isEncryptedHeader(v: string): boolean {
  try {
    return Buffer.from(v, "base64").length === ENCRYPTED_HEADER_BYTES;
  } catch {
    return false;
  }
}

function isValidObjectIdString(v: unknown): v is string {
  return typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
}

// T4.3 (P2-4): presence lives in services.presence (Redis in production, shared by every
// process; memory in development and tests), never in this module's memory.
async function getPresencePayload(userId: string) {
  return {
    userId,
    online: await services.presence.isOnline(userId),
    lastSeenAt: await services.presence.lastSeen(userId),
  };
}

async function emitPresence(io: Server, userId: string) {
  try {
    io.to(`presence:${userId}`).emit("presence:update", await getPresencePayload(userId));
  } catch (e) {
    log.warn({ err: (e as Error)?.message ?? e }, '[socket] presence emit failed');
  }
}

/**
 * Socket event authorization (P0-7). Every handler's check, in one place:
 *
 * | Event                | Identity source     | Check                                                              |
 * |----------------------|---------------------|--------------------------------------------------------------------|
 * | handshake            | JWT in auth.token   | signature + algorithm pinned; userId from claims                   |
 * | presence:subscribe   | socket.data.userId  | caller shares a conversation with the peer                         |
 * | presence:unsubscribe | socket.data.userId  | none needed (leaving a room is harmless)                           |
 * | typing:start / stop  | socket.data.userId  | shares a conversation; conversationId derived server-side          |
 * | message:send         | fromUserId = caller | recipient exists and is not the caller; per-user rate limit        |
 * | message:delivered    | socket.data.userId  | caller is the message's recipient; read is never regressed         |
 * | message:read         | socket.data.userId  | peer named by client; conversationId derived; shares a conversation|
 *
 * General principle: never accept a server-derivable identifier from a client.
 * conversationId is always makeConversationId(caller, peer).
 */
export function setupSocket(io: Server) {
  // HTTP routes and lib/delivery emit through lib/realtime; bind it here so every entry point (index.ts, tests) has it.
  setRealtimeServer(io);
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [config.JWT_ALGORITHM] }) as { userId: string };
      socket.data.userId = decoded.userId;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.data.userId);
    socket.join(userId); // room per userId
    metrics.socketConnections.inc();
    services.presence
      .connected(userId, socket.id)
      .then(() => emitPresence(io, userId))
      .catch((e) => log.warn({ err: (e as Error)?.message ?? e }, '[socket] presence connect failed'));
    // Keep this socket's presence entry alive across the TTL (a dead process stops refreshing).
    const heartbeat = setInterval(() => {
      services.presence.heartbeat(userId, socket.id).catch(() => {});
    }, PRESENCE_HEARTBEAT_MS);

    // Authorization: caller must share a conversation with the peer.
    socket.on("presence:subscribe", async (dto: { peerUserId?: string | null }) => {
      const peerUserId = String(dto?.peerUserId ?? "");
      if (!isValidObjectIdString(peerUserId)) return;
      if (!(await haveConversation(userId, peerUserId))) {
        log.warn({ userId, peerUserId }, "[socket] presence:subscribe refused (no conversation)");
        return;
      }

      socket.join(`presence:${peerUserId}`);
      socket.emit("presence:update", await getPresencePayload(peerUserId));
    });

    // Authorization: leaving a room you never joined is a no-op; nothing to check.
    socket.on("presence:unsubscribe", (dto: { peerUserId?: string | null }) => {
      const peerUserId = String(dto?.peerUserId ?? "");
      if (!isValidObjectIdString(peerUserId)) return;

      socket.leave(`presence:${peerUserId}`);
    });

    // Authorization: caller must share a conversation with the peer. The
    // conversationId is derived server-side, never taken from the client.
    const handleTyping = async (dto: { toUserId?: string | null }, isTyping: boolean) => {
      const toUserId = String(dto?.toUserId ?? "");
      if (!isValidObjectIdString(toUserId)) return;
      if (!(await haveConversation(userId, toUserId))) return;

      io.to(toUserId).emit("typing:update", {
        fromUserId: userId,
        conversationId: makeConversationId(userId, toUserId),
        isTyping,
      });
    };
    socket.on("typing:start", (dto: { toUserId?: string | null }) => void handleTyping(dto, true));
    socket.on("typing:stop", (dto: { toUserId?: string | null }) => void handleTyping(dto, false));

    socket.on("message:send", async (dto: SendMessageDTO, ack?: (r: any) => void) => {
      try {
        // Per-user send limit (P0-5). Counted before validation so malformed
        // spam is bounded too.
        const sendBudget = await services.messageSendLimiter.hit(userId);
        if (!sendBudget.allowed) {
          log.warn({ from: userId, count: sendBudget.count }, "[socket] message:send rate limited");
          metrics.messagesRejected.inc({ reason: 'rate_limited' });
          return ack?.({
            ok: false,
            code: "RATE_LIMITED",
            error: "Too many messages. Please slow down.",
            retryAfterSeconds: sendBudget.retryAfterSeconds,
          });
        }


        if (!dto?.toUserId || !isValidObjectIdString(dto.toUserId)) {
          log.warn({ from: userId }, "[socket] reject message: invalid toUserId");
          metrics.messagesRejected.inc({ reason: 'invalid_recipient' });
          return ack?.({ ok: false, code: "BAD_ID", error: "Invalid toUserId" });
        }
        // Authorization: sender is always socket.data.userId; the recipient must
        // be another existing account (self-send passed the 2-member validator
        // with a duplicated id and double-emitted).
        if (dto.toUserId === userId) {
          return ack?.({ ok: false, code: "SELF_SEND", error: "Cannot message yourself" });
        }
        if (!(await UserModel.exists({ _id: dto.toUserId }))) {
          return ack?.({ ok: false, code: "NOT_FOUND", error: "Recipient not found" });
        }
        if (!isNonEmptyString(dto.clientMessageId, 3)) {
          log.warn({ from: userId }, "[socket] reject message: invalid clientMessageId");
          metrics.messagesRejected.inc({ reason: 'invalid_client_id' });
          return ack?.({ ok: false, error: "Invalid clientMessageId" });
        }
        if (typeof dto.createdAt !== "number") {
          log.warn({ from: userId }, "[socket] reject message: invalid createdAt");
          metrics.messagesRejected.inc({ reason: 'invalid_created_at' });
          return ack?.({ ok: false, error: "Invalid createdAt" });
        }

        const protoVersion = dto?.protoVersion ?? 0;
        if (protoVersion !== 4) {
          log.warn({
            protoVersion: dto?.protoVersion,
            from: userId,
          }, "[socket] reject message: unsupported protoVersion");
          metrics.messagesRejected.inc({ reason: 'unsupported_version' });
          return ack?.({
            ok: false,
            code: "UNSUPPORTED_PROTO_VERSION",
            error: "Only protoVersion 4 is supported",
          });
        }

        const v4 = dto.v4;
        if (
          !v4 ||
          !isNonEmptyString(v4.encHeader, 8) ||
          !isEncryptedHeader(v4.encHeader) ||
          !isNonEmptyString(v4.ciphertext, 8) ||
          !isNonEmptyString(v4.mac, 8)
        ) {
          log.warn({
            hasV4: !!dto.v4,
            encHeaderLen: dto.v4?.encHeader?.length,
            cipherLen: dto.v4?.ciphertext?.length,
            macLen: dto.v4?.mac?.length,
          }, "[socket] reject message: invalid v4 payload");
          metrics.messagesRejected.inc({ reason: 'invalid_payload' });
          return ack?.({ ok: false, error: "Invalid v4 payload" });
        }

        if (v4.ciphertext.length > MAX_CIPHERTEXT_B64_LENGTH) {
          log.warn({
            from: userId,
            cipherLen: v4.ciphertext.length,
          }, "[socket] reject message: ciphertext too large");
          metrics.messagesRejected.inc({ reason: 'too_large' });
          return ack?.({
            ok: false,
            code: "PAYLOAD_TOO_LARGE",
            error: `Message too large (max ${MAX_CIPHERTEXT_BYTES / 1024} KiB)`,
          });
        }

        const existingMessage = await MessageModel.findOne({
          fromUserId: userId,
          clientMessageId: dto.clientMessageId,
        });

        if (existingMessage) {
          log.info({
            from: userId,
            clientMessageId: dto.clientMessageId,
            serverMessageId: String(existingMessage._id),
          }, '[socket] duplicate clientMessageId, returning existing message');

          return ack?.({
            ok: true,
            serverMessageId: String(existingMessage._id),
            seq: (existingMessage as any).seq ?? null,
          });
        }

        // T3.2: the conversation hands out the sequence number atomically, before the
        // message exists, so ordering never depends on the sender's clock (P2-6, P2-9).
        // lastMessageAt is server time for the same reason.
        const conversationId = makeConversationId(userId, dto.toUserId);
        const updatedConv = await ConversationModel.findOneAndUpdate(
          { conversationId },
          {
            $set: {
              members: [userId, dto.toUserId].sort(),
              lastMessageAt: Date.now(),
              lastProtoVersion: protoVersion,
              lastMessagePreview: '(Encrypted message)',
            },
            $inc: {
              lastSeq: 1,
              [`unreadCounts.${dto.toUserId}`]: 1,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const seq = Number(updatedConv?.lastSeq ?? 0);

        const doc = await MessageModel.create({
          conversationId,
          fromUserId: userId,
          toUserId: dto.toUserId,
          protoVersion,
          v4,
          replyTo: dto.replyTo ?? null,
          initPacket: dto.initPacket ?? null,
          clientMessageId: dto.clientMessageId,
          createdAtClient: dto.createdAt,
          seq,
          expiresAt: messageExpiry(), // T3.1: undelivered ciphertext expires
        });

        const room = io.sockets.adapter.rooms.get(String(dto.toUserId));
        
        // Extract unreadCount for receiver (dto.toUserId) from Mongoose Map
        let unreadCount = 0;
        if (updatedConv?.unreadCounts) {
          const counts = updatedConv.unreadCounts;
          if (counts instanceof Map) {
            unreadCount = counts.get(String(dto.toUserId)) ?? 0;
          } else if (typeof counts === 'object') {
            unreadCount = counts[String(dto.toUserId)] ?? 0;
          }
        }

        // Extract unreadCount for sender (userId) - their own unread count
        let senderUnreadCount = 0;
        if (updatedConv?.unreadCounts) {
          const counts = updatedConv.unreadCounts;
          if (counts instanceof Map) {
            senderUnreadCount = counts.get(String(userId)) ?? 0;
          } else if (typeof counts === 'object') {
            senderUnreadCount = counts[String(userId)] ?? 0;
          }
        }
        

        // T2.13: a message carries only its own initPacket. The server no
        // longer attaches the sender's first initPacket to later messages: that
        // was a server-controlled session-injection point (P0-9). A receiver
        // without a session bootstraps from the first stored message (history
        // path) or from the live initPacket of the session-creating message.
        const initPacketToSend = (doc as any).initPacket ?? null;

        io.to(dto.toUserId).emit("message:new", {
          serverMessageId: String(doc._id),
          conversationId: (doc as any).conversationId,
          fromUserId: String(userId),
          toUserId: String(dto.toUserId),
          protoVersion,
          v4: doc.v4,
          replyTo: (doc as any).replyTo ?? null,
          initPacket: initPacketToSend,
          clientMessageId: dto.clientMessageId,
          createdAt: dto.createdAt,
          seq,
          status: doc.status ?? 'sent',
          deliveredAt: (doc as any).deliveredAt ?? null,
          readAt: (doc as any).readAt ?? null,
          unreadCount,
        });


        // Also notify sender about the message for their ChatListScreen lastMessagePreview
        io.to(userId).emit("message:new", {
          serverMessageId: String(doc._id),
          conversationId: (doc as any).conversationId,
          fromUserId: String(userId),
          toUserId: String(dto.toUserId),
          protoVersion,
          v4: doc.v4,
          replyTo: (doc as any).replyTo ?? null,
          initPacket: initPacketToSend,
          clientMessageId: dto.clientMessageId,
          createdAt: dto.createdAt,
          seq,
          status: doc.status ?? 'sent',
          deliveredAt: (doc as any).deliveredAt ?? null,
          readAt: (doc as any).readAt ?? null,
          unreadCount: senderUnreadCount, // Sender's actual unread count from peer
        });

        if (!(await services.presence.isOnline(String(dto.toUserId)))) {
          // T3.3: a data-only wake-up naming the message; the device fetches and decrypts it.
          await sendMessagePushToUser({
            toUserId: String(dto.toUserId),
            serverMessageId: String(doc._id),
          });
        }

        metrics.messagesSent.inc({ bootstrap: dto.initPacket ? 'true' : 'false' });
        return ack?.({ ok: true, serverMessageId: String(doc._id), seq });
      } catch (e: any) {
        if (e?.code === 11000) {
          try {
            const existingMessage = await MessageModel.findOne({
              fromUserId: userId,
              clientMessageId: dto.clientMessageId,
            });

            if (existingMessage) {
              log.warn({
                from: userId,
                clientMessageId: dto.clientMessageId,
                serverMessageId: String(existingMessage._id),
              }, '[socket] duplicate key hit, returning existing message');

              return ack?.({
                ok: true,
                serverMessageId: String(existingMessage._id),
                seq: (existingMessage as any).seq ?? null,
              });
            }
          } catch (lookupError) {
            log.error({ err: lookupError }, '[socket] duplicate recovery lookup failed');
          }
        }

        log.error({ err: (e as Error)?.message ?? e }, "[socket] message:send failed");
        return ack?.({ ok: false, code: "INTERNAL", error: "Internal error" });
      }
    });

    /**
     * group:send (T6.3): one ciphertext per group message, stored once per recipient so
     * delete-on-delivery, receipts, seq and TTL work exactly as for 1:1. The server checks
     * membership and shape only; the payload (sender-key ciphertext + per-sender signature)
     * is opaque to it.
     */
    socket.on("group:send", async (dto: GroupSendDTO, ack?: (r: any) => void) => {
      try {
        const sendBudget = await services.messageSendLimiter.hit(userId);
        if (!sendBudget.allowed) {
          metrics.messagesRejected.inc({ reason: 'rate_limited' });
          return ack?.({ ok: false, code: "RATE_LIMITED", error: "Too many messages. Please slow down.", retryAfterSeconds: sendBudget.retryAfterSeconds });
        }
        if (!isValidObjectIdString(dto?.groupId)) return ack?.({ ok: false, code: "BAD_ID", error: "Invalid groupId" });
        if (!isNonEmptyString(dto.clientMessageId, 3)) return ack?.({ ok: false, error: "Invalid clientMessageId" });
        if (typeof dto.createdAt !== "number") return ack?.({ ok: false, error: "Invalid createdAt" });
        const g1 = dto.g1;
        if (
          !g1 || g1.v !== 1 ||
          !Number.isInteger(g1.keyId) || g1.keyId < 0 || g1.keyId > 0xffffffff ||
          !Number.isInteger(g1.iteration) || g1.iteration < 0 || g1.iteration >= 2 ** 24 ||
          !isNonEmptyString(g1.ciphertext, 8) || !isNonEmptyString(g1.signature, 8) ||
          Buffer.from(g1.signature, "base64").length !== 64
        ) {
          metrics.messagesRejected.inc({ reason: 'invalid_payload' });
          return ack?.({ ok: false, error: "Invalid g1 payload" });
        }
        if (g1.ciphertext.length > MAX_CIPHERTEXT_B64_LENGTH) {
          metrics.messagesRejected.inc({ reason: 'too_large' });
          return ack?.({ ok: false, code: "PAYLOAD_TOO_LARGE", error: `Message too large (max ${MAX_CIPHERTEXT_BYTES / 1024} KiB)` });
        }

        const group = await GroupModel.findById(dto.groupId);
        if (!group || !isGroupMember(group, userId)) {
          log.warn({ from: userId, groupId: dto.groupId }, "[socket] group:send refused (not a member)");
          return ack?.({ ok: false, code: "FORBIDDEN", error: "Not a member of this group" });
        }
        if (typeof dto.epoch === 'number' && dto.epoch !== group.epoch) {
          // The sender's membership view is stale: its sender key predates a change. Refuse; the client re-syncs (T6.5).
          return ack?.({ ok: false, code: "STALE_EPOCH", error: "Group membership changed", epoch: group.epoch });
        }

        const recipients = group.members.map((m) => String(m.userId)).filter((id) => id !== userId);
        const existing = await MessageModel.findOne({ fromUserId: userId, clientMessageId: dto.clientMessageId }).select('_id seq');
        if (existing) return ack?.({ ok: true, serverMessageId: String(existing._id), seq: (existing as any).seq ?? null, epoch: group.epoch });

        const updated = await GroupModel.findOneAndUpdate({ _id: group._id }, { $inc: { lastSeq: 1 }, $set: { lastMessageAt: Date.now() } }, { new: true });
        const seq = Number(updated?.lastSeq ?? 0);
        const conversationId = groupConversationId(String(group._id));
        const base = {
          conversationId,
          fromUserId: userId,
          protoVersion: 4,
          g1,
          groupId: group._id,
          epoch: group.epoch,
          clientMessageId: dto.clientMessageId,
          createdAtClient: dto.createdAt,
          seq,
          expiresAt: messageExpiry(),
        };
        const docs = recipients.length ? await MessageModel.insertMany(recipients.map((toUserId) => ({ ...base, toUserId }))) : [];

        const payload = (doc: (typeof docs)[number]) => ({
          serverMessageId: String(doc._id),
          conversationId,
          groupId: String(group._id),
          epoch: group.epoch,
          fromUserId: String(userId),
          toUserId: String(doc.toUserId),
          protoVersion: 4,
          g1,
          clientMessageId: dto.clientMessageId,
          createdAt: dto.createdAt,
          seq,
          status: 'sent',
        });
        for (const doc of docs) {
          io.to(String(doc.toUserId)).emit("message:new", payload(doc));
          if (!(await services.presence.isOnline(String(doc.toUserId)))) {
            await sendMessagePushToUser({ toUserId: String(doc.toUserId), serverMessageId: String(doc._id) });
          }
        }
        metrics.messagesSent.inc({ bootstrap: 'false' });
        // The sender's own row is the first recipient's id (there is no self copy); clients key group messages by clientMessageId.
        return ack?.({ ok: true, serverMessageId: docs[0] ? String(docs[0]._id) : null, seq, epoch: group.epoch, recipients: recipients.length });
      } catch (e) {
        log.error({ err: (e as Error)?.message ?? e }, "[socket] group:send failed");
        return ack?.({ ok: false, code: "INTERNAL", error: "Internal error" });
      }
    });

    // Listen for message:delivered notifications
    // Authorization: only the message's recipient may mark it delivered. The
    // conversationId comes from the stored document, never from the client,
    // and a message already read is never regressed to delivered.
    socket.on('message:delivered', async (dto: { serverMessageId?: string }, ack?: (r: any) => void) => {
      try {
        // T3.1: the ack deletes the ciphertext; lib/delivery.ts owns the rule.
        const r = await markDelivered({ recipientId: userId, serverMessageId: String(dto?.serverMessageId ?? '') });
        if (!r.ok) {
          if (r.code === 'FORBIDDEN') log.warn({ userId, serverMessageId: dto?.serverMessageId }, '[socket] message:delivered refused (not the recipient)');
          const error = r.code === 'BAD_ID' ? 'Invalid serverMessageId' : r.code === 'NOT_FOUND' ? 'Message not found' : 'Forbidden';
          return ack?.({ ok: false, code: r.code, error });
        }
        return ack?.({ ok: true, status: r.status });
      } catch (e) {
        log.error({ err: (e as Error)?.message ?? e }, '[socket] message:delivered failed');
        return ack?.({ ok: false, code: 'INTERNAL', error: 'Internal error' });
      }
    });

    // Authorization: the DTO names the peer; the conversationId is derived
    // server-side from (caller, peer). A legacy conversationId is accepted only
    // if it is exactly the one the server would derive for its two members.
    // The caller must share a conversation with the peer, so a stranger cannot
    // push a forged read receipt at an arbitrary user.
    socket.on('message:read', async (dto: { peerUserId?: string; conversationId?: string }, ack?: (r: any) => void) => {
      try {
        let peerUserId = String(dto?.peerUserId ?? '');
        if (!peerUserId && typeof dto?.conversationId === 'string') {
          const parts = dto.conversationId.split(':');
          peerUserId = parts.find((p) => p !== userId) ?? '';
          if (parts.length !== 2 || makeConversationId(userId, peerUserId) !== dto.conversationId) {
            return ack?.({ ok: false, code: 'FORBIDDEN', error: 'Forbidden' });
          }
        }
        if (!isValidObjectIdString(peerUserId) || peerUserId === userId) {
          return ack?.({ ok: false, code: 'BAD_ID', error: 'Invalid peerUserId' });
        }
        if (!(await haveConversation(userId, peerUserId))) {
          log.warn({ userId, peerUserId }, '[socket] message:read refused (no conversation)');
          return ack?.({ ok: false, code: 'FORBIDDEN', error: 'Forbidden' });
        }

        const conversationId = makeConversationId(userId, peerUserId);
        const readAt = Date.now();

        const result = await MessageModel.updateMany(
          { conversationId, toUserId: userId, status: { $ne: 'read' } },
          { $set: { status: 'read', readAt } },
        );

        await ConversationModel.updateOne(
          { conversationId },
          { $set: { [`unreadCounts.${userId}`]: 0 } },
        );

        if (result.modifiedCount > 0) {
          io.to(peerUserId).emit('message:status-changed', {
            conversationId,
            status: 'read',
            readAt,
            readerUserId: userId,
          });
        }

        return ack?.({ ok: true, modified: result.modifiedCount });
      } catch (e) {
        log.error({ err: (e as Error)?.message ?? e }, '[socket] message:read failed');
        return ack?.({ ok: false, code: 'INTERNAL', error: 'Internal error' });
      }
    });

    socket.on("disconnect", () => {
      clearInterval(heartbeat);
      metrics.socketConnections.dec();
      services.presence
        .disconnected(userId, socket.id)
        .then(() => emitPresence(io, userId))
        .catch((e) => log.warn({ err: (e as Error)?.message ?? e }, '[socket] presence disconnect failed'));
    });
  });
}

