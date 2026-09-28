import type { NextFunction, Request, Response } from 'express';
import { RateLimitBackendUnavailableError } from './rateLimit';
import { log } from '../lib/logger';

/**
 * Terminal handlers. Clients only ever receive `{ error, code }`; stack traces
 * and internal messages stay in the server log (P2-12). T1.9 extends this.
 */

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

// Express identifies error middleware by arity: keep all four parameters.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof RateLimitBackendUnavailableError) {
    res.setHeader('Retry-After', '30');
    res.status(503).json({
      error: 'Service temporarily unavailable. Please try again shortly.',
      code: 'RATE_LIMIT_BACKEND_DOWN',
    });
    return;
  }

  const e = err as { type?: string; name?: string; status?: number; message?: string };

  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'BAD_JSON' });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  if (e?.name === 'CastError') {
    res.status(400).json({ error: 'Invalid identifier', code: 'BAD_ID' });
    return;
  }

  log.error({ detail: [e?.name ?? 'Error', e?.message ?? err] }, '[http] unhandled error');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}
