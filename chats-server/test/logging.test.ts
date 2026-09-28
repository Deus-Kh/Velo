import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Writable } from 'stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('DOTENV_CONFIG_PATH', './definitely-missing.env');
vi.stubEnv('MONGO_URI', 'mongodb://127.0.0.1:1/unused');
vi.stubEnv('JWT_SECRET', 't'.repeat(48));
vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_PATH', './missing.json');

const { createLogger, REDACTED, REDACT_PATHS, requestLogger, shortKey } = await import('../src/lib/logger');

/**
 * T4.5 — structured logs, redaction, correlation ids (R3: never log key material).
 */
function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, logger: createLogger({ level: 'trace', destination }) };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('T4.5 logging', () => {
  it('no console call remains in src/ outside the logger', () => {
    const src = join(__dirname, '..', 'src');
    const offenders = walk(src)
      .filter((p) => !p.endsWith(join('lib', 'logger.ts')))
      .filter((p) => /console\.(log|warn|error|info|debug)\(/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('redacts every secret field at any depth, and the whole envelope and packet', () => {
    const { lines, logger } = capture();
    logger.warn(
      {
        userId: 'u1',
        session: { rootKey: 'S-ROOT', chainKeySend: 'S-CKS', headerKeyRecv: 'S-HKR', DHsPrivateKey: 'S-DHS', skippedKeys: { a: 'S-SKIPPED' } },
        dto: { v4: { encHeader: 'S-HDR', ciphertext: 'S-CT', mac: 'S-MAC' }, initPacket: { ephPublicKey: 'S-EPH' } },
        auth: { password: 'S-PW', refreshToken: 'S-RT', accessToken: 'S-AT', tokenHash: 'S-TH' },
        nested: { deeper: { deepest: { messageKey: 'S-MK', privateKey: 'S-PK', secretKey: 'S-SK' } } },
        pub: shortKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
      },
      'event',
    );
    const line = JSON.stringify(lines[0]);
    for (const secret of ['S-ROOT', 'S-CKS', 'S-HKR', 'S-DHS', 'S-SKIPPED', 'S-HDR', 'S-CT', 'S-MAC', 'S-EPH', 'S-PW', 'S-RT', 'S-AT', 'S-TH', 'S-MK', 'S-PK', 'S-SK']) {
      expect(line, secret).not.toContain(secret);
    }
    expect(line).toContain(REDACTED);
    expect((lines[0]!.session as Record<string, unknown>).rootKey).toBe(REDACTED);
    expect((lines[0]!.dto as Record<string, unknown>).v4).toBe(REDACTED);
    expect(lines[0]!.pub).toBe('AAAAAAAA…');
    expect(lines[0]!.userId).toBe('u1');
    expect(lines[0]!.service).toBe('velo-server');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('gives every request a correlation id, echoes it, and writes one access line without body or query', async () => {
    const { lines, logger } = capture();
    const app = express();
    app.use(express.json());
    app.use(requestLogger(logger));
    app.post('/echo', (req, res) => {
      (req as express.Request & { log?: { info: (o: unknown, m: string) => void } }).log?.info({ note: 'inside' }, 'handler');
      res.status(201).json({ ok: true });
    });
    app.get('/boom', (_req, res) => res.status(500).json({ error: 'x' }));

    const minted = await request(app).post('/echo?password=leak').send({ password: 'secret-body', token: 'tok' });
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const given = await request(app).get('/boom').set('X-Request-Id', 'proxy-abc-123');
    expect(given.headers['x-request-id']).toBe('proxy-abc-123');
    const bad = await request(app).get('/boom').set('X-Request-Id', 'no spaces allowed!!');
    expect(bad.headers['x-request-id']).not.toBe('no spaces allowed!!');

    const access = lines.filter((l) => l.msg === 'request');
    expect(access).toHaveLength(3);
    expect(access[0]).toMatchObject({ method: 'POST', path: '/echo', status: 201, reqId: minted.headers['x-request-id'] });
    expect(access[1]).toMatchObject({ method: 'GET', path: '/boom', status: 500, reqId: 'proxy-abc-123', level: 50 });
    const all = JSON.stringify(lines);
    expect(all).not.toContain('secret-body');
    expect(all).not.toContain('leak');
    expect(all).not.toContain('tok');
    const inside = lines.find((l) => l.msg === 'handler');
    expect(inside?.reqId).toBe(minted.headers['x-request-id']);
  });
});
