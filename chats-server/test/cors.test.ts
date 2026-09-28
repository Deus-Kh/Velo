import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { corsOriginCheck, isOriginAllowed, parseOrigins } from '../src/lib/corsPolicy';
import { startTestApp } from './helpers/testApp';

/**
 * T4.4 — CORS pinned to known origins (P2-7). `origin: true` reflected any
 * origin with credentials; now only CORS_ORIGINS are allowed, and requests
 * without an Origin header (the native apps) are unaffected.
 */
describe('T4.4 CORS policy (pure)', () => {
  it('parses a comma-separated allow-list, trimming, lower-casing and dropping trailing slashes', () => {
    expect(parseOrigins(' https://App.Example.com/ , https://admin.example.com,, ')).toEqual(['https://app.example.com', 'https://admin.example.com']);
    expect(parseOrigins('')).toEqual([]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins(['https://A.example.com/', ' https://b.example.com '])).toEqual(['https://a.example.com', 'https://b.example.com']); // config pre-splits
  });

  it('allows no-Origin requests, allow-listed origins, and nothing else', () => {
    const allowed = ['https://app.example.com'];
    expect(isOriginAllowed(allowed, undefined)).toBe(true);
    expect(isOriginAllowed(allowed, 'https://app.example.com')).toBe(true);
    expect(isOriginAllowed(allowed, 'https://APP.example.com/')).toBe(true);
    expect(isOriginAllowed(allowed, 'https://evil.example.com')).toBe(false);
    expect(isOriginAllowed(allowed, 'null')).toBe(false);
    expect(isOriginAllowed([], 'https://app.example.com')).toBe(false);
    // The callback shape the cors middleware and socket.io expect.
    corsOriginCheck(allowed)('https://app.example.com', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
    });
  });
});

describe('T4.4 CORS on the app', () => {
  let harness: Awaited<ReturnType<typeof startTestApp>>;

  beforeAll(async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
    harness = await startTestApp();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('an allow-listed browser origin gets CORS headers with credentials', async () => {
    const res = await request(harness.app).get('/health').set('Origin', 'https://app.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('an unknown origin gets no CORS headers, and a preflight from it is refused', async () => {
    const res = await request(harness.app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(harness.app)
      .options('/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a request without an Origin header (native app) is served without CORS headers', async () => {
    const res = await request(harness.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
