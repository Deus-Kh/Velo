import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import { authRouter } from './routes/auth.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { usersRouter } from './routes/users.routes';
import { messagesRouter } from './routes/messages.routes';
import { keysRouter } from './routes/keys.routes';

/**
 * Builds the Express application without binding a port or connecting to
 * anything, so route tests can drive it with supertest against an in-memory
 * MongoDB. index.ts connects the databases, configures the store-backed
 * services, then calls this.
 */
export function createApp(): express.Express {
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

  return app;
}
