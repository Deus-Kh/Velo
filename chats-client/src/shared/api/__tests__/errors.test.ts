import { AxiosError, AxiosHeaders } from 'axios';
import { toApiError } from '../errors';

function makeAxiosError(status: number | null, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as AxiosError['config'];
  if (status === null) {
    return new AxiosError('Network Error', 'ERR_NETWORK', config);
  }
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config: config!,
    data,
  });
}

describe('toApiError', () => {
  it('maps a 401 without a body to a friendly credentials message', () => {
    const err = toApiError(makeAxiosError(401));
    expect(err.status).toBe(401);
    expect(err.message).toBe('Incorrect email or password.');
    expect(err.isNetwork).toBe(false);
    expect(err.fields).toEqual({});
  });

  it('prefers the server-provided error string when present', () => {
    const err = toApiError(makeAxiosError(409, { error: 'Email already in use' }));
    expect(err.message).toBe('Email already in use');
  });

  it('copies string field errors and drops non-string ones', () => {
    const err = toApiError(
      makeAxiosError(400, {
        error: 'Validation failed',
        fields: { password: 'Too short', email: 42, nested: { x: 1 } },
      }),
    );
    expect(err.fields).toEqual({ password: 'Too short' });
  });

  it('flags network failures', () => {
    const err = toApiError(makeAxiosError(null));
    expect(err.isNetwork).toBe(true);
    expect(err.status).toBeNull();
    expect(err.message).toMatch(/Could not reach the server/);
  });

  it('maps 429 and 5xx to actionable messages', () => {
    expect(toApiError(makeAxiosError(429)).message).toMatch(/Too many attempts/);
    expect(toApiError(makeAxiosError(503)).message).toMatch(/server had a problem/);
  });

  it('handles plain errors and unknown values', () => {
    expect(toApiError(new Error('boom')).message).toBe('boom');
    expect(toApiError('weird').message).toBe('Something went wrong.');
    expect(toApiError(undefined).message).toBe('Something went wrong.');
  });
});
