import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { config } from './config';
import { initRedis, closeRedis } from './redis';
import { configureServices } from './lib/services';
import { configureRateLimiters, globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import { authRouter } from './routes/auth.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { usersRouter } from './routes/users.routes';
import { setupSocket } from './socket/setupSocket';
import { messagesRouter } from './routes/messages.routes';
import { keysRouter } from './routes/keys.routes';

/** Upper bound for any socket.io packet; the per-message ciphertext cap is enforced separately. */
const SOCKET_MAX_HTTP_BUFFER_SIZE = 256 * 1024;

async function main() {
  await mongoose.connect(config.MONGO_URI);

  // Rate limits and login backoff need their backing store before any route is served.
  const redis = await initRedis();
  configureServices(redis);
  configureRateLimiters(redis);

  const app = express();

  // Caddy terminates TLS in front of the server; without this every request
  // would appear to come from 127.0.0.1 and IP-based limits would be a no-op.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true })); // pinned in T4.4
  app.use(express.json({ limit: '256kb' }));
  app.use(globalLimiter);

  // routes WITHOUT /api
  app.use('/auth', authRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/users', usersRouter);
  app.use('/keys', keysRouter);
  app.use('/messages', messagesRouter);

  // health
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  });

  setupSocket(io);

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
