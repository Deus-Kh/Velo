import { http } from './http';
import { API_ENDPOINTS } from './endpoints';

/**
 * T4.6: the one thing a device tells the server about a decrypt failure is
 * the protocol error code. No message id, no peer, no text. Fire-and-forget.
 */
export function reportDecryptFailure(code: string | null | undefined): void {
  if (!code) return;
  http.post(API_ENDPOINTS.TELEMETRY.DECRYPT_FAILURE, { code }).catch(() => {
    /* telemetry never affects the user */
  });
}
