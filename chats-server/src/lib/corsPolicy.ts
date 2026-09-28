/**
 * CORS policy (T4.4, P2-7). The native apps send no Origin header and are
 * unaffected by CORS; the allow-list exists for browser clients (a future
 * web build, admin tools) and must never be `*` with credentials.
 *
 *   CORS_ORIGINS=https://app.example.com,https://admin.example.com
 *
 * Empty (the default): no browser origin is allowed; requests without an
 * Origin header still work. `origin: true` (reflect any origin) is gone.
 */
export function parseOrigins(raw: string | readonly string[] | undefined | null): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/\/+$/, '').toLowerCase());
}

export type OriginDecision = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;

/** The `origin` option for the `cors` middleware and socket.io: allow-list or no-Origin only. */
export function corsOriginCheck(allowedOrigins: string[]): OriginDecision {
  const allowed = new Set(allowedOrigins.map((o) => o.toLowerCase()));
  return (origin, callback) => {
    // No Origin header: not a browser cross-origin request (native app, curl, same-origin). Let it through
    // without CORS headers.
    if (!origin) return callback(null, true);
    callback(null, allowed.has(origin.replace(/\/+$/, '').toLowerCase()));
  };
}

export function isOriginAllowed(allowedOrigins: string[], origin: string | undefined): boolean {
  let result = false;
  corsOriginCheck(allowedOrigins)(origin, (_err, allow) => {
    result = Boolean(allow);
  });
  return result;
}
