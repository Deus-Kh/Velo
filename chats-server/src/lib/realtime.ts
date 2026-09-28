import type { Server } from 'socket.io';

/**
 * Lets HTTP routes emit socket events without importing the socket setup.
 * Rooms are per user id (setupSocket joins each socket to its userId).
 */
let io: Server | null = null;

export function setRealtimeServer(server: Server | null): void {
  io = server;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(String(userId)).emit(event, payload);
}
