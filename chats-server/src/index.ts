import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { config } from './config';
import { initRedis, closeRedis } from './redis';
import { configureServices } from './lib/services';
import { configureRateLimiters } from './middleware/rateLimit';
import { createApp } from './app';
import { setupSocket } from './socket/setupSocket';
import { setRealtimeServer } from './lib/realtime';

/** Upper bound for any socket.io packet; the per-message ciphertext cap is enforced separately. */
const SOCKET_MAX_HTTP_BUFFER_SIZE = 256 * 1024;

async function main() {
  if (!config.IS_PRODUCTION) {
    // T4.1: `npm start` runs the compiled build; the process manager sets NODE_ENV (T4.2).
    console.warn('[server] NODE_ENV is not "production" (' + config.NODE_ENV + '): development settings are in effect');
  }
  await mongoose.connect(config.MONGO_URI);

  // Rate limits and login backoff need their backing store before any route is served.
  const redis = await initRedis();
  configureServices(redis);
  configureRateLimiters(redis);

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  });

  setupSocket(io);
  setRealtimeServer(io);

  server.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close();
    io.close();
    await closeRedis();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
