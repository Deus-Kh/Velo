import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { config } from './config';
import { corsOriginCheck, parseOrigins } from './lib/corsPolicy';
import { requestLogger } from './lib/logger';
import { httpMetrics, metricsHandler } from './lib/metrics';
import { telemetryRouter } from './routes/telemetry.routes';

import { authRouter } from './routes/auth.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { usersRouter } from './routes/users.routes';
import { messagesRouter } from './routes/messages.routes';
import { keysRouter } from './routes/keys.routes';
import { groupsRouter } from './routes/groups.routes';
import { reportsRouter } from './routes/reports.routes';

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

  app.use(requestLogger()); // T4.5: correlation id + one access line per request
  app.use(httpMetrics()); // T4.6: requests and latency by matched route
  app.use(helmet());
  // T4.4 (P2-7): browser origins come from CORS_ORIGINS only; the native apps send no Origin header.
  app.use(cors({ origin: corsOriginCheck(parseOrigins(config.CORS_ORIGINS)), credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(globalLimiter);

  // routes WITHOUT /api
  app.use('/auth', authRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/users', usersRouter);
  app.use('/keys', keysRouter);
  app.use('/messages', messagesRouter);
  app.use('/telemetry', telemetryRouter);
  app.use('/groups', groupsRouter); // T6.3
  app.use('/reports', reportsRouter); // T7.5

  // T4.6: Prometheus scrape, bearer-protected; 404 when METRICS_TOKEN is unset.
  app.get('/metrics', metricsHandler());

  // Health for the reverse proxy and the process manager (T4.2): 503 until MongoDB is connected.
  app.get('/health', (_req, res) => {
    const mongo = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.status(mongo === 'connected' ? 200 : 503).json({ ok: mongo === 'connected', uptime: Math.round(process.uptime()), mongo });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
