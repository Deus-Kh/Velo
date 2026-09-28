import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import pino, { type Logger } from 'pino';
import { config } from '../config';

/**
 * Structured logging (T4.5, R3: never log key material).
 *
 * One pino logger, JSON lines to stdout (journald under systemd, T4.2).
 * Every log call is `log.<level>(fields, message)`; fields are redacted
 * before they are written. The redaction list is the whole vocabulary of
 * secrets this server ever holds in memory: tokens and passwords, private
 * and secret keys, ratchet keys, message keys, header keys, and the
 * ciphertext itself (which is not secret, but has no business in a log).
 * Public keys may be logged truncated with `shortKey`.
 */

const SECRET_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authorization',
  'cookie',
  'privateKey',
  'secretKey',
  'DHsPrivateKey',
  'identityDhSecretKey',
  'signedPreKeySecretKey',
  'oneTimePreKeySecretKey',
  'ephSecretKey',
  'rootKey',
  'chainKey',
  'chainKeySend',
  'chainKeyRecv',
  'messageKey',
  'messageKeyB64',
  'headerKey',
  'headerKeySend',
  'headerKeyRecv',
  'nextHeaderKeySend',
  'nextHeaderKeyRecv',
  'skippedKeys',
  'sharedSecret',
  'kemSharedSecret',
  'ciphertext',
  'encHeader',
  'mac',
  'v4',
  'initPacket',
  'serviceAccount',
  'JWT_SECRET',
  'MONGO_URI',
  'REDIS_URL',
];

/** pino redact paths: the field at any depth up to three levels, plus the request headers. */
export const REDACT_PATHS = [
  ...SECRET_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`, `*.*.*.${f}`]),
  'req.headers.authorization',
  'req.headers.cookie',
];

export const REDACTED = '[REDACTED]';

export function createLogger(options: { level?: string; destination?: pino.DestinationStream } = {}): Logger {
  return pino(
    {
      level: options.level ?? config.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      base: { service: 'velo-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    options.destination,
  );
}

export const log: Logger = createLogger();

/** The first 8 characters of a base64 public key: enough to correlate, never enough to matter. */
export function shortKey(b64: string | null | undefined): string | null {
  if (!b64) return null;
  return b64.slice(0, 8) + '…';
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export type RequestWithLog = Request & { id?: string; log?: Logger };

/**
 * Correlation id per request: honours a sane inbound `X-Request-Id` (from
 * the reverse proxy), otherwise mints one; echoes it in the response and
 * attaches a child logger. One access line per request at finish: method,
 * path (no query string), status, duration, user id when authenticated.
 * Never the body, never the query.
 */
export function requestLogger(logger: Logger = log) {
  return (req: RequestWithLog, res: Response, next: NextFunction): void => {
    const inbound = req.header('x-request-id');
    const id = inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
    req.id = id;
    req.log = logger.child({ reqId: id });
    res.setHeader('X-Request-Id', id);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const userId = (req as RequestWithLog & { userId?: string }).userId ?? null;
      const fields = { reqId: id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms * 10) / 10, userId };
      if (res.statusCode >= 500) req.log!.error(fields, 'request');
      else if (res.statusCode >= 400) req.log!.warn(fields, 'request');
      else req.log!.info(fields, 'request');
    });
    next();
  };
}
