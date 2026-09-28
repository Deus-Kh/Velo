import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { recordClientDecryptFailure } from '../lib/metrics';

export const telemetryRouter = Router();

/**
 * POST /telemetry/decrypt-failure  { code }
 * T4.6: devices report the protocol error code of a message they could not
 * decrypt, nothing else (no message id, no peer, no text). The server only
 * increments a counter; the response is empty. Authenticated so the signal
 * cannot be forged anonymously, but the user id is not recorded.
 */
telemetryRouter.post('/decrypt-failure', requireAuth, (req: AuthedRequest, res) => {
  recordClientDecryptFailure(req.body?.code);
  res.status(204).end();
});
