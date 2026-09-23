import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { Express } from 'express';

/**
 * Starts the real socket layer on an ephemeral port over the test app and
 * returns helpers to connect authenticated clients. Import only after
 * startTestApp() has stubbed the environment.
 */
export async function startTestSocketServer(app: Express) {
  const { setupSocket } = await import('../../src/socket/setupSocket');

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: true } });
  setupSocket(io);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const clients: Socket[] = [];

  const connect = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = ioClient(url, { transports: ['websocket'], auth: { token }, reconnection: false });
      clients.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => reject(err));
    });

  const stop = async () => {
    for (const c of clients) c.close();
    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, connect, stop };
}

/** Emits with an ack and resolves with the ack payload (or rejects on timeout). */
export function emitAck<T = unknown>(socket: Socket, event: string, payload: unknown, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/** Resolves with the next `event` payload, or `null` if none arrives within `windowMs`. */
export function nextEvent<T = unknown>(socket: Socket, event: string, windowMs = 400): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, windowMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}
