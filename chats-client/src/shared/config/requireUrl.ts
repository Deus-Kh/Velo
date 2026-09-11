/**
 * Validates a base URL from the environment.
 *
 * Release builds refuse cleartext: end-to-end encryption protects message
 * bodies, but the bearer token and every prekey bundle travel in headers and
 * responses, so a plaintext transport bypasses the whole crypto stack.
 *
 * Pure and dependency-free so it can be unit-tested without the `@env` module.
 */
export function requireUrl(name: string, value: string | undefined, isDev: boolean): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and rebuild.`);
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(`${name} must start with http:// or https://. Got: ${trimmed}`);
  }
  if (!isDev && !trimmed.startsWith('https://')) {
    throw new Error(`${name} must use https:// in release builds. Got: ${trimmed}`);
  }
  return trimmed;
}
