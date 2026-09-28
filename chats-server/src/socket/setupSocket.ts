import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { ConversationModel } from "../models/Conversation";
import { MessageModel } from "../models/Message";
import { sendMessagePushToUser } from "../push/firebase";
import { makeConversationId } from "../utils/conversation";
import { services } from "../lib/services";
import { haveConversation } from "../lib/socketAuthz";
import { markDelivered, messageExpiry } from "../lib/delivery";
import { setRealtimeServer } from "../lib/realtime";
import { UserModel } from "../models/User";

/** Maximum encrypted message body accepted over the socket (P0-5 storage-flood control). */
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
/** Message counters are bounded far below u32 (spec T2.6); mirrors packages/protocol MAX_MESSAGE_NUMBER. */
const MAX_MESSAGE_NUMBER = 2 ** 24;
/** Same bound expressed as base64 characters (4 chars per 3 bytes, padded). */
const MAX_CIPHERTEXT_B64_LENGTH = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4;

type V2Header = {
  n: number;
  pn: number;
  dhPub: string; // base64 X25519 public key
};

/** Wire v3 envelope (T2.5): no nonce on the wire, MAC over identities + canonical header + ciphertext. */
type V3Payload = {
  header: V2Header;
  ciphertext: string;
  mac: string;
};

type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  protoVersion?: 3;
  v3?: V3Payload | null; // v3 envelope (T2.5)
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

function isValidObjectIdString(v: unknown): v is string {
  return typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
}

const onlineConnectionCounts = new Map<string, number>();
const lastSeenByUserId = new Map<string, number>();

function isUserOnline(userId: string) {
  return (onlineConnectionCounts.get(userId) ?? 0) > 0;
}

function getPresencePayload(userId: string) {
  return {
    userId,
    online: isUserOnline(userId),
    lastSeenAt: lastSeenByUserId.get(userId) ?? null,
  };
}

function emitPresence(io: Server, userId: string) {
  io.to(`presence:${userId}`).emit("presence:update", getPresencePayload(userId));
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
    onlineConnectionCounts.set(userId, (onlineConnectionCounts.get(userId) ?? 0) + 1);
    emitPresence(io, userId);

    // Authorization: caller must share a conversation with the peer.
    socket.on("presence:subscribe", async (dto: { peerUserId?: string | null }) => {
      const peerUserId = String(dto?.peerUserId ?? "");
      if (!isValidObjectIdString(peerUserId)) return;
      if (!(await haveConversation(userId, peerUserId))) {
        console.warn("[socket] presence:subscribe refused (no conversation)", { userId, peerUserId });
        return;
      }

      socket.join(`presence:${peerUserId}`);
      socket.emit("presence:update", getPresencePayload(peerUserId));
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
          console.warn("[socket] message:send rate limited", { from: userId, count: sendBudget.count });
          return ack?.({
            ok: false,
            code: "RATE_LIMITED",
            error: "Too many messages. Please slow down.",
            retryAfterSeconds: sendBudget.retryAfterSeconds,
          });
        }


        if (!dto?.toUserId || !isValidObjectIdString(dto.toUserId)) {
          console.warn("[socket] reject message: invalid toUserId", { from: userId });
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
          console.warn("[socket] reject message: invalid clientMessageId", { from: userId });
          return ack?.({ ok: false, error: "Invalid clientMessageId" });
        }
        if (typeof dto.createdAt !== "number") {
          console.warn("[socket] reject message: invalid createdAt", { from: userId });
          return ack?.({ ok: false, error: "Invalid createdAt" });
        }

        const protoVersion = dto?.protoVersion ?? 0;
        if (protoVersion !== 3) {
          console.warn("[socket] reject message: unsupported protoVersion", {
            protoVersion: dto?.protoVersion,
            from: userId,
          });
          return ack?.({
            ok: false,
            code: "UNSUPPORTED_PROTO_VERSION",
            error: "Only protoVersion 3 is supported",
          });
        }

        const v3 = dto.v3;
        if (
          !v3 ||
          !v3.header ||
          typeof v3.header.n !== "number" ||
          typeof v3.header.pn !== "number" ||
          !Number.isInteger(v3.header.n) ||
          !Number.isInteger(v3.header.pn) ||
          v3.header.n < 0 ||
          v3.header.pn < 0 ||
          v3.header.n >= MAX_MESSAGE_NUMBER ||
          v3.header.pn >= MAX_MESSAGE_NUMBER ||
          !isNonEmptyString(v3.header.dhPub, 20) ||
          !isNonEmptyString(v3.ciphertext, 8) ||
          !isNonEmptyString(v3.mac, 8)
        ) {
          console.warn("[socket] reject message: invalid v3 payload", {
            hasV3: !!dto.v3,
            header: dto.v3?.header,
            cipherLen: dto.v3?.ciphertext?.length,
            macLen: dto.v3?.mac?.length,
          });
          return ack?.({ ok: false, error: "Invalid v3 payload" });
        }

        if (v3.ciphertext.length > MAX_CIPHERTEXT_B64_LENGTH) {
          console.warn("[socket] reject message: ciphertext too large", {
            from: userId,
            cipherLen: v3.ciphertext.length,
          });
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
          console.log('[socket] duplicate clientMessageId, returning existing message', {
            from: userId,
            clientMessageId: dto.clientMessageId,
            serverMessageId: String(existingMessage._id),
          });

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
          v3,
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
          v3: doc.v3,
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
          v3: doc.v3,
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

        if (!isUserOnline(String(dto.toUserId))) {
          // T3.3: a data-only wake-up naming the message; the device fetches and decrypts it.
          await sendMessagePushToUser({
            toUserId: String(dto.toUserId),
            serverMessageId: String(doc._id),
          });
        }

        return ack?.({ ok: true, serverMessageId: String(doc._id), seq });
      } catch (e: any) {
        if (e?.code === 11000) {
          try {
            const existingMessage = await MessageModel.findOne({
              fromUserId: userId,
              clientMessageId: dto.clientMessageId,
            });

            if (existingMessage) {
              console.warn('[socket] duplicate key hit, returning existing message', {
                from: userId,
                clientMessageId: dto.clientMessageId,
                serverMessageId: String(existingMessage._id),
              });

              return ack?.({
                ok: true,
                serverMessageId: String(existingMessage._id),
                seq: (existingMessage as any).seq ?? null,
              });
            }
          } catch (lookupError) {
            console.error('[socket] duplicate recovery lookup failed:', lookupError);
          }
        }

        console.error("[socket] message:send failed:", (e as Error)?.message ?? e);
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
          if (r.code === 'FORBIDDEN') console.warn('[socket] message:delivered refused (not the recipient)', { userId, serverMessageId: dto?.serverMessageId });
          const error = r.code === 'BAD_ID' ? 'Invalid serverMessageId' : r.code === 'NOT_FOUND' ? 'Message not found' : 'Forbidden';
          return ack?.({ ok: false, code: r.code, error });
        }
        return ack?.({ ok: true, status: r.status });
      } catch (e) {
        console.error('[socket] message:delivered failed:', (e as Error)?.message ?? e);
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
          console.warn('[socket] message:read refused (no conversation)', { userId, peerUserId });
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
        console.error('[socket] message:read failed:', (e as Error)?.message ?? e);
        return ack?.({ ok: false, code: 'INTERNAL', error: 'Internal error' });
      }
    });

    socket.on("disconnect", () => {
      const nextCount = Math.max(0, (onlineConnectionCounts.get(userId) ?? 1) - 1);

      if (nextCount === 0) {
        onlineConnectionCounts.delete(userId);
        lastSeenByUserId.set(userId, Date.now());
      } else {
        onlineConnectionCounts.set(userId, nextCount);
      }

      emitPresence(io, userId);
    });
  });
}

