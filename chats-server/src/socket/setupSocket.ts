// // server/src/socket/setupSocket.ts
// import type { Server } from "socket.io";
// import jwt from "jsonwebtoken";
// import { config } from "../config";
// import { ConversationModel } from "../models/Conversation";
// import { MessageModel } from "../models/Message";
// import { makeConversationId } from "../utils/conversation";

// type V2Header = {
//   n: number;
//   pn: number;
//   dhPub: string; // base64 X25519 public key
// };

// type V2Payload = {
//   header: V2Header;
//   nonce: string;
//   ciphertext: string;
// };

// type SendMessageDTO = {
//   toUserId: string;
//   clientMessageId: string;
//   createdAt: number;
//   protoVersion?: 2;
//   v2?: V2Payload | null; // v2
//   initPacket?: {
//     peerUserId: string;
//     ephPublicKey: string;
//     signedPreKeyId: number;
//     oneTimePreKeyId: number | null;
//     initiatorIdentityDhPublicKey: string;
//   } | null;
// };

// function isNonEmptyString(v: unknown, minLen = 1): v is string {
//   return typeof v === "string" && v.length >= minLen;
// }

// function isValidObjectIdString(v: unknown): v is string {
//   return typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);
// }

// export function setupSocket(io: Server) {
//   io.use((socket, next) => {
//     try {
//       const token = socket.handshake.auth?.token;
//       if (!token) return next(new Error("Unauthorized"));

//       const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };
//       socket.data.userId = decoded.userId;
//       next();
//     } catch {
//       next(new Error("Unauthorized"));
//     }
//   });

//   io.on("connection", (socket) => {
//     const userId = String(socket.data.userId);
//     socket.join(userId); // room per userId
//     console.log('[socket] join room', userId, 'socket', socket.id);

//     socket.on("message:send", async (dto: SendMessageDTO, ack?: (r: any) => void) => {
//       try {
//         if (!dto?.toUserId || !isValidObjectIdString(dto.toUserId)) {
//           console.warn("[socket] reject message: invalid toUserId", { dto });
//           return ack?.({ ok: false, error: "Invalid toUserId" });
//         }
//         if (!isNonEmptyString(dto.clientMessageId, 3)) {
//           console.warn("[socket] reject message: invalid clientMessageId", { dto });
//           return ack?.({ ok: false, error: "Invalid clientMessageId" });
//         }
//         if (typeof dto.createdAt !== "number") {
//           console.warn("[socket] reject message: invalid createdAt", { dto });
//           return ack?.({ ok: false, error: "Invalid createdAt" });
//         }

//         const protoVersion = dto?.protoVersion ?? 2;
//         if (protoVersion !== 2) {
//           console.warn("[socket] reject message: unsupported protoVersion", {
//             protoVersion: dto?.protoVersion,
//             dto,
//           });
//           return ack?.({
//             ok: false,
//             error: "Only protoVersion 2 is supported in the current development mode",
//           });
//         }

//         const v2 = dto.v2;
//         if (
//           !v2 ||
//           !v2.header ||
//           typeof v2.header.n !== "number" ||
//           typeof v2.header.pn !== "number" ||
//           v2.header.n < 0 ||
//           v2.header.pn < 0 ||
//           !isNonEmptyString(v2.header.dhPub, 20) ||
//           !isNonEmptyString(v2.nonce, 8) ||
//           !isNonEmptyString(v2.ciphertext, 8)
//         ) {
//           console.warn("[socket] reject message: invalid v2 payload", {
//             hasV2: !!dto.v2,
//             header: dto.v2?.header,
//             nonceLen: dto.v2?.nonce?.length,
//             cipherLen: dto.v2?.ciphertext?.length,
//           });
//           return ack?.({ ok: false, error: "Invalid v2 payload" });
//         }

//         const doc = await MessageModel.create({
//           conversationId: makeConversationId(userId, dto.toUserId),
//           fromUserId: userId,
//           toUserId: dto.toUserId,
//           protoVersion,
//           v2,
//           initPacket: dto.initPacket ?? null,
//           clientMessageId: dto.clientMessageId,
//           createdAtClient: dto.createdAt,
//         });

//         const updatedConv = await ConversationModel.findOneAndUpdate(
//           { conversationId: (doc as any).conversationId },
//           {
//             $set: {
//               members: [userId, dto.toUserId].sort(),
//               lastMessageAt: dto.createdAt,
//               lastProtoVersion: protoVersion,
//               lastMessagePreview: `${v2.header.n ? '' : ''}(Encrypted message)`,
//             },
//             $inc: {
//               [`unreadCounts.${dto.toUserId}`]: 1,
//             },
//           },
//           { upsert: true, new: true, setDefaultsOnInsert: true }
//         );

//         const room = io.sockets.adapter.rooms.get(String(dto.toUserId));

           
//         // Extract unreadCount from Mongoose Map
//         let unreadCount = 0;
//         if (updatedConv?.unreadCounts) {
//           const counts = updatedConv.unreadCounts;
//           if (counts instanceof Map) {
//             unreadCount = counts.get(String(dto.toUserId)) ?? 0;
//           } else if (typeof counts === 'object') {
//             unreadCount = counts[String(dto.toUserId)] ?? 0;
//           }
//         }
        
//         console.log('[socket] send', {
//           from: userId,
//           to: dto.toUserId,
//           pv: protoVersion,
//           roomSize: room ? room.size : 0,
//           n: dto.v2?.header.n,
//         });

        
//         // If current message doesn't have initPacket, try to find the first one in this pair
//         let initPacketToSend = (doc as any).initPacket ?? null;
//         if (!initPacketToSend) {
//           console.log('[socket] current message has no initPacket, searching for first in pair...');
//           const firstWithInitPacket = await MessageModel.findOne({
//             conversationId: (doc as any).conversationId,
//             fromUserId: userId,
//             initPacket: { $ne: null },
//           }).sort({ createdAt: 1 });
          
//           if (firstWithInitPacket) {
//             initPacketToSend = (firstWithInitPacket as any).initPacket;
//             console.log('[socket] ✓ found initPacket from first message in pair');
//           } else {
//             console.log('[socket] ✗ no initPacket found in any message from this sender in this pair');
//           }
//         }

//         io.to(dto.toUserId).emit("message:new", {
//           serverMessageId: String(doc._id),
//           conversationId: (doc as any).conversationId,
//           fromUserId: String(userId),
//           toUserId: String(dto.toUserId),
//           protoVersion,
//           v2: doc.v2,
//           initPacket: (doc as any).initPacket ?? null,
//           clientMessageId: dto.clientMessageId,
//           createdAt: dto.createdAt,
//           status: doc.status ?? 'sent',
//           deliveredAt: (doc as any).deliveredAt ?? null,
//           readAt: (doc as any).readAt ?? null,
//           unreadCount,
//         });

//         return ack?.({ ok: true, serverMessageId: String(doc._id) });
//       } catch (e: any) {
//         console.error("message:send failed:", e);
//         return ack?.({ ok: false, error: e?.message || "Server error" });
//       }
//     });
//   });
// }

// server/src/socket/setupSocket.ts
import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { ConversationModel } from "../models/Conversation";
import { MessageModel } from "../models/Message";
import { sendMessagePushToUser } from "../push/firebase";
import { makeConversationId } from "../utils/conversation";
import { services } from "../lib/services";
import { haveConversation } from "../lib/socketAuthz";
import { UserModel } from "../models/User";

/** Maximum encrypted message body accepted over the socket (P0-5 storage-flood control). */
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
/** Same bound expressed as base64 characters (4 chars per 3 bytes, padded). */
const MAX_CIPHERTEXT_B64_LENGTH = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4;

type V2Header = {
  n: number;
  pn: number;
  dhPub: string; // base64 X25519 public key
};

type V2Payload = {
  header: V2Header;
  nonce: string;
  ciphertext: string;
};

type SendMessageDTO = {
  toUserId: string;
  clientMessageId: string;
  createdAt: number;
  protoVersion?: 2;
  v2?: V2Payload | null; // v2
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
    console.log('[socket] join room', userId, 'socket', socket.id);

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

        console.log('[socket] message:send received', {
          from: userId,
          to: dto.toUserId,
          hasInitPacket: !!dto.initPacket,
          protoVersion: dto.protoVersion,
        });

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
          console.warn("[socket] reject message: invalid clientMessageId", { dto });
          return ack?.({ ok: false, error: "Invalid clientMessageId" });
        }
        if (typeof dto.createdAt !== "number") {
          console.warn("[socket] reject message: invalid createdAt", { dto });
          return ack?.({ ok: false, error: "Invalid createdAt" });
        }

        const protoVersion = dto?.protoVersion ?? 2;
        if (protoVersion !== 2) {
          console.warn("[socket] reject message: unsupported protoVersion", {
            protoVersion: dto?.protoVersion,
            dto,
          });
          return ack?.({
            ok: false,
            error: "Only protoVersion 2 is supported in the current development mode",
          });
        }

        const v2 = dto.v2;
        if (
          !v2 ||
          !v2.header ||
          typeof v2.header.n !== "number" ||
          typeof v2.header.pn !== "number" ||
          v2.header.n < 0 ||
          v2.header.pn < 0 ||
          !isNonEmptyString(v2.header.dhPub, 20) ||
          !isNonEmptyString(v2.nonce, 8) ||
          !isNonEmptyString(v2.ciphertext, 8)
        ) {
          console.warn("[socket] reject message: invalid v2 payload", {
            hasV2: !!dto.v2,
            header: dto.v2?.header,
            nonceLen: dto.v2?.nonce?.length,
            cipherLen: dto.v2?.ciphertext?.length,
          });
          return ack?.({ ok: false, error: "Invalid v2 payload" });
        }

        if (v2.ciphertext.length > MAX_CIPHERTEXT_B64_LENGTH) {
          console.warn("[socket] reject message: ciphertext too large", {
            from: userId,
            cipherLen: v2.ciphertext.length,
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
          });
        }

        const doc = await MessageModel.create({
          conversationId: makeConversationId(userId, dto.toUserId),
          fromUserId: userId,
          toUserId: dto.toUserId,
          protoVersion,
          v2,
          replyTo: dto.replyTo ?? null,
          initPacket: dto.initPacket ?? null,
          clientMessageId: dto.clientMessageId,
          createdAtClient: dto.createdAt,
        });

        console.log('[socket] message saved', {
          messageId: String(doc._id),
          from: userId,
          to: dto.toUserId,
          clientInitPacket: !!dto.initPacket,
          dtoInitPacket: dto.initPacket ? JSON.stringify(dto.initPacket).slice(0, 50) : null,
          savedInitPacket: !!(doc as any).initPacket,
          savedInitPacketValue: JSON.stringify((doc as any).initPacket),
        });

        const updatedConv = await ConversationModel.findOneAndUpdate(
          { conversationId: (doc as any).conversationId },
          {
            $set: {
              members: [userId, dto.toUserId].sort(),
              lastMessageAt: dto.createdAt,
              lastProtoVersion: protoVersion,
              lastMessagePreview: `${v2.header.n ? '' : ''}(Encrypted message)`,
            },
            $inc: {
              [`unreadCounts.${dto.toUserId}`]: 1,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

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
        
        console.log("[socket] unreadCount snapshot:", {
          from: userId,
          to: dto.toUserId,
          receiverUnreadCount: unreadCount,
          senderUnreadCount: senderUnreadCount,
          timestamp: Date.now(),
        });

        // If current message doesn't have initPacket, try to find the first one in this pair
        let initPacketToSend = (doc as any).initPacket ?? null;
        if (!initPacketToSend) {
          console.log('[socket] current message has no initPacket, searching for first in pair...');
          const firstWithInitPacket = await MessageModel.findOne({
            conversationId: (doc as any).conversationId,
            fromUserId: userId,
            initPacket: { $ne: null },
          }).sort({ createdAt: 1 });
          
          if (firstWithInitPacket) {
            initPacketToSend = (firstWithInitPacket as any).initPacket;
            console.log('[socket] ✓ found initPacket from first message in pair');
          } else {
            console.log('[socket] ✗ no initPacket found in any message from this sender in this pair');
          }
        }

        io.to(dto.toUserId).emit("message:new", {
          serverMessageId: String(doc._id),
          conversationId: (doc as any).conversationId,
          fromUserId: String(userId),
          toUserId: String(dto.toUserId),
          protoVersion,
          v2: doc.v2,
          replyTo: (doc as any).replyTo ?? null,
          initPacket: initPacketToSend,
          clientMessageId: dto.clientMessageId,
          createdAt: dto.createdAt,
          status: doc.status ?? 'sent',
          deliveredAt: (doc as any).deliveredAt ?? null,
          readAt: (doc as any).readAt ?? null,
          unreadCount,
        });

        console.log('[socket] message:new event sent to receiver', {
          to: dto.toUserId,
          messageId: String(doc._id),
          hasInitPacket: !!initPacketToSend,
        });

        // Also notify sender about the message for their ChatListScreen lastMessagePreview
        io.to(userId).emit("message:new", {
          serverMessageId: String(doc._id),
          conversationId: (doc as any).conversationId,
          fromUserId: String(userId),
          toUserId: String(dto.toUserId),
          protoVersion,
          v2: doc.v2,
          replyTo: (doc as any).replyTo ?? null,
          initPacket: initPacketToSend,
          clientMessageId: dto.clientMessageId,
          createdAt: dto.createdAt,
          status: doc.status ?? 'sent',
          deliveredAt: (doc as any).deliveredAt ?? null,
          readAt: (doc as any).readAt ?? null,
          unreadCount: senderUnreadCount, // Sender's actual unread count from peer
        });

        if (!isUserOnline(String(dto.toUserId))) {
          await sendMessagePushToUser({
            toUserId: String(dto.toUserId),
            fromUserId: String(userId),
            conversationId: String((doc as any).conversationId),
            serverMessageId: String(doc._id),
          });
        }

        return ack?.({ ok: true, serverMessageId: String(doc._id) });
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
        const serverMessageId = String(dto?.serverMessageId ?? '');
        if (!isValidObjectIdString(serverMessageId)) {
          return ack?.({ ok: false, code: 'BAD_ID', error: 'Invalid serverMessageId' });
        }

        const doc = await MessageModel.findById(serverMessageId);
        if (!doc) {
          return ack?.({ ok: false, code: 'NOT_FOUND', error: 'Message not found' });
        }
        if (String(doc.toUserId) !== userId) {
          console.warn('[socket] message:delivered refused (not the recipient)', { userId, serverMessageId });
          return ack?.({ ok: false, code: 'FORBIDDEN', error: 'Forbidden' });
        }
        if (doc.status === 'read') {
          return ack?.({ ok: true, status: 'read' });
        }

        const deliveredAt = Date.now();
        await MessageModel.updateOne(
          { _id: doc._id, status: { $ne: 'read' } },
          { $set: { status: 'delivered', deliveredAt } },
        );

        io.to(String(doc.fromUserId)).emit('message:status-changed', {
          conversationId: doc.conversationId,
          status: 'delivered',
          serverMessageId,
          deliveredAt,
          deliveredByUserId: userId,
        });

        return ack?.({ ok: true, status: 'delivered' });
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

