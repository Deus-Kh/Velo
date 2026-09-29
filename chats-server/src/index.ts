import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import mongoose from 'mongoose';
import { config, ENV_FILE } from './config';
import { initRedis, closeRedis } from './redis';
import { configureServices } from './lib/services';
import { configureRateLimiters } from './middleware/rateLimit';
import { createApp } from './app';
import { setupSocket } from './socket/setupSocket';
import { setRealtimeServer } from './lib/realtime';
import { corsOriginCheck, parseOrigins } from './lib/corsPolicy';
import { createLifecycle } from './lib/lifecycle';
import { startAttachmentSweep } from './lib/attachmentSweep';
import { log } from './lib/logger';

/** Upper bound for any socket.io packet; the per-message ciphertext cap is enforced separately. */
const SOCKET_MAX_HTTP_BUFFER_SIZE = 256 * 1024;

async function main() {
  log.info({ envFile: ENV_FILE ?? '(process environment only)', nodeEnv: config.NODE_ENV }, '[server] environment');
  if (!config.IS_PRODUCTION) {
    // T4.1: `npm start` runs the compiled build; the process manager sets NODE_ENV (T4.2).
    log.warn('[server] NODE_ENV is not "production" (' + config.NODE_ENV + '): development settings are in effect');
  }
  await mongoose.connect(config.MONGO_URI);

  // Rate limits and login backoff need their backing store before any route is served.
  const redis = await initRedis();
  configureServices(redis);
  configureRateLimiters(redis);

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: corsOriginCheck(parseOrigins(config.CORS_ORIGINS)), credentials: true }, // T4.4
    maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  });

  // T4.3 (P2-4): with Redis, rooms and emits are shared across processes (io.to(userId),
  // presence rooms, emitToUser from HTTP routes). Without Redis (development) one process is enough.
  const pubSub = redis ? { pub: redis.duplicate(), sub: redis.duplicate() } : null;
  if (pubSub) io.adapter(createAdapter(pubSub.pub, pubSub.sub));

  setupSocket(io);
  setRealtimeServer(io);
  const stopSweep = startAttachmentSweep(); // T8.2: expired blobs go with their documents

  server.listen(config.PORT, () => {
    log.info(`Server running on http://localhost:${config.PORT}`);
  });

  // T4.2: one shutdown path for signals and crashes; the process manager restarts on a non-zero exit.
  const lifecycle = createLifecycle({
    stopAccepting: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    closeSockets: async () => {
      stopSweep();
      io.close();
      if (pubSub) await Promise.all([pubSub.pub.quit(), pubSub.sub.quit()]);
    },
    closeRedis,
    disconnectDb: () => mongoose.disconnect(),
    exit: (code) => process.exit(code),
    log: (m) => log.info(m),
  });
  lifecycle.install(process);
}

main().catch((e) => {
  log.error({ err: e }, '[server] startup failed');
  process.exit(1);
});
