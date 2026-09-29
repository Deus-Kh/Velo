import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { config } from '../config';

/**
 * Prometheus metrics (T4.6). What the server can observe about an
 * end-to-end encrypted service, and nothing that identifies a user: no
 * user ids, no conversation ids, no per-user series (cardinality and
 * privacy). The names below are the dashboard's contract
 * (deploy/grafana/velo-dashboard.json).
 *
 * Not observable by design since T3.6 (encrypted headers): ratchet steps
 * and counters. The nearest server-side proxy is `sessions_bootstrapped`
 * (messages that carry an initPacket). Decrypt failures happen on devices;
 * clients report only the error code (POST /telemetry/decrypt-failure).
 */
export const registry = new Registry();
registry.setDefaultLabels({ service: 'velo-server' });
collectDefaultMetrics({ register: registry, prefix: 'velo_node_' });

export const metrics = {
  httpRequests: new Counter({
    name: 'velo_http_requests_total',
    help: 'HTTP requests by method, matched route and status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  }),
  httpDuration: new Histogram({
    name: 'velo_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),
  socketConnections: new Gauge({
    name: 'velo_socket_connections',
    help: 'Open socket.io connections on this process',
    registers: [registry],
  }),
  messagesSent: new Counter({
    name: 'velo_messages_sent_total',
    help: 'Messages accepted by message:send',
    labelNames: ['bootstrap'] as const, // "true" when the message carried an initPacket
    registers: [registry],
  }),
  messagesRejected: new Counter({
    name: 'velo_messages_rejected_total',
    help: 'message:send refusals by reason',
    labelNames: ['reason'] as const,
    registers: [registry],
  }),
  messagesDelivered: new Counter({
    name: 'velo_messages_delivered_total',
    help: 'Delivered acks that deleted a ciphertext',
    registers: [registry],
  }),
  deliveryLatency: new Histogram({
    name: 'velo_delivery_latency_seconds',
    help: 'Seconds from server receipt to the recipient device ack',
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300, 900, 3600, 21600, 86400],
    registers: [registry],
  }),
  pushSent: new Counter({
    name: 'velo_push_sent_total',
    help: 'Push wake-ups by result',
    labelNames: ['result'] as const, // ok | failed | no_token | disabled
    registers: [registry],
  }),
  pushTokensPruned: new Counter({
    name: 'velo_push_tokens_pruned_total',
    help: 'FCM tokens removed after a terminal delivery error',
    registers: [registry],
  }),
  bundlesIssued: new Counter({
    name: 'velo_prekey_bundles_issued_total',
    help: 'Prekey bundles served',
    labelNames: ['with_one_time_key'] as const,
    registers: [registry],
  }),
  prekeyPoolLow: new Counter({
    name: 'velo_prekey_pool_low_total',
    help: 'Bundle issues that left a user below the one-time prekey low watermark',
    registers: [registry],
  }),
  prekeyPoolExhausted: new Counter({
    name: 'velo_prekey_pool_exhausted_total',
    help: 'Bundle issues that found a user with no one-time prekey left',
    registers: [registry],
  }),
  // T8.2
  attachmentsReserved: new Counter({ name: 'velo_attachments_reserved_total', help: 'Attachment reservations', registers: [registry] }),
  attachmentsUploaded: new Counter({ name: 'velo_attachments_uploaded_total', help: 'Attachments completed', registers: [registry] }),
  attachmentBytes: new Counter({ name: 'velo_attachment_bytes_total', help: 'Ciphertext bytes accepted', registers: [registry] }),
  clientDecryptFailures: new Counter({
    name: 'velo_client_decrypt_failures_total',
    help: 'Decrypt failures reported by devices, by protocol error code',
    labelNames: ['code'] as const,
    registers: [registry],
  }),
};

/** Codes a device may report; anything else is counted as "other" to keep the label set closed. */
export const REPORTABLE_DECRYPT_CODES = new Set([
  'DECRYPT_FAILED',
  'HEADER_TAMPERED',
  'IDENTITY_MISMATCH',
  'MISSING_BOOTSTRAP',
  'SESSION_RESET_REQUIRED',
  'TOO_MANY_SKIPPED',
  'UNKNOWN_OLD_MESSAGE',
  'REPLAY_DETECTED',
  'STORAGE_CORRUPTION',
]);

export function recordClientDecryptFailure(code: unknown): string {
  const label = typeof code === 'string' && REPORTABLE_DECRYPT_CODES.has(code) ? code : 'other';
  metrics.clientDecryptFailures.inc({ code: label });
  return label;
}

/** Route label without user-supplied parts: the matched Express route pattern, else "unmatched". */
function routeLabel(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (!route) return 'unmatched';
  return (req.baseUrl ?? '') + route;
}

export function httpMetrics() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/metrics') return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = routeLabel(req);
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
      metrics.httpDuration.observe({ method: req.method, route }, seconds);
    });
    next();
  };
}

/**
 * GET /metrics: enabled only when METRICS_TOKEN is configured, and then only
 * with `Authorization: Bearer <token>` (Prometheus `bearer_token`). Disabled
 * means 404, so the endpoint is invisible rather than merely refused.
 */
export function metricsHandler(getToken: () => string = () => config.METRICS_TOKEN) {
  return async (req: Request, res: Response): Promise<void> => {
    const token = getToken();
    if (!token) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    const header = req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (presented.length !== token.length || !timingSafeEqualString(presented, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  };
}

function timingSafeEqualString(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
