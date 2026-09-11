import axios from 'axios';

/**
 * Field-level errors as returned by the server's validation module
 * (`{ error: string, fields?: Record<string, string> }`).
 */
export interface ApiErrorShape {
  message: string;
  status: number | null;
  fields: Record<string, string>;
  isNetwork: boolean;
}

/**
 * Normalises any thrown value from an API call into something the UI can render.
 * Never includes response bodies verbatim beyond the `error` / `fields` keys, so
 * an unexpected server payload cannot leak into the interface.
 */
export function toApiError(e: unknown): ApiErrorShape {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status ?? null;
    const data = e.response?.data as { error?: unknown; fields?: unknown } | undefined;
    const message =
      typeof data?.error === 'string'
        ? data.error
        : status === 401
        ? 'Incorrect email or password.'
        : status === 409
        ? 'That email or username is already taken.'
        : status === 429
        ? 'Too many attempts. Please wait a moment and try again.'
        : status && status >= 500
        ? 'The server had a problem. Please try again.'
        : !e.response
        ? 'Could not reach the server. Check your connection.'
        : 'Request failed.';

    const fields: Record<string, string> = {};
    if (data && typeof data.fields === 'object' && data.fields !== null) {
      for (const [k, v] of Object.entries(data.fields as Record<string, unknown>)) {
        if (typeof v === 'string') fields[k] = v;
      }
    }

    return { message, status, fields, isNetwork: !e.response };
  }

  if (e instanceof Error) {
    return { message: e.message || 'Something went wrong.', status: null, fields: {}, isNetwork: false };
  }

  return { message: 'Something went wrong.', status: null, fields: {}, isNetwork: false };
}
