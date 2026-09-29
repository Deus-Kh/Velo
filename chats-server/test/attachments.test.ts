import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp } from './helpers/testApp';

/**
 * T8.2 — blob storage with the local store: reserve → PUT → complete →
 * download, every refusal, the sweep, the budget. The server never sees a
 * key; the bytes here are opaque and only their length and identity matter.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
let A: Awaited<ReturnType<typeof createUser>>;
let B: Awaited<ReturnType<typeof createUser>>;
let blobDir: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const blob = (n: number, seed = 1): Buffer => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) b[i] = (i * 31 + seed * 7) & 0xff;
  return b;
};

async function reserve(size: number, token = A.token) {
  const res = await request(harness.app).post('/attachments').set(auth(token)).send({ size });
  return res;
}

beforeAll(async () => {
  blobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'velo-blobs-'));
  vi.stubEnv('BLOB_DIR', blobDir);
  vi.stubEnv('PUBLIC_BASE_URL', '');
  harness = await startTestApp();
  [A, B] = await Promise.all([createUser(), createUser()]);
});

afterAll(async () => {
  await harness.stop();
  await fs.rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => {
  harness.resetLimits();
});

describe('T8.2 attachments (local store)', () => {
  it('reserve → upload → complete → download returns the same bytes; the reservation carries a signed, expiring URL', async () => {
    const bytes = blob(70_000);
    const r = await reserve(bytes.length);
    expect(r.status).toBe(201);
    expect(r.body.blobId).toMatch(/^[0-9a-f]{32}$/);
    expect(r.body.upload.method).toBe('PUT');
    expect(r.body.upload.url).toMatch(new RegExp(`^/blobs/${r.body.blobId}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
    expect(r.body.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

    // Nothing to download or complete before the upload.
    expect((await request(harness.app).post(`/attachments/${r.body.blobId}/complete`).set(auth(A.token))).status).toBe(404);
    expect((await request(harness.app).post(`/attachments/${r.body.blobId}/download`).set(auth(B.token))).status).toBe(404);

    const put = await request(harness.app).put(r.body.upload.url).set('Content-Type', 'application/octet-stream').send(bytes);
    expect(put.status).toBe(204);
    expect(await fs.readFile(path.join(blobDir, r.body.blobId))).toEqual(bytes); // stored as sent: opaque bytes

    // Only the owner completes; then any holder of the id downloads.
    expect((await request(harness.app).post(`/attachments/${r.body.blobId}/complete`).set(auth(B.token))).status).toBe(403);
    const done = await request(harness.app).post(`/attachments/${r.body.blobId}/complete`).set(auth(A.token));
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true, size: bytes.length });
    expect((await request(harness.app).post(`/attachments/${r.body.blobId}/complete`).set(auth(A.token))).status).toBe(200); // idempotent

    const dl = await request(harness.app).post(`/attachments/${r.body.blobId}/download`).set(auth(B.token));
    expect(dl.status).toBe(200);
    expect(dl.body.download.method).toBe('GET');
    const got = await request(harness.app).get(dl.body.download.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('application/octet-stream');
    expect(got.body).toEqual(bytes);

    // A second upload to the same id is refused; the bytes are unchanged.
    expect((await request(harness.app).put(r.body.upload.url).set('Content-Type', 'application/octet-stream').send(blob(70_000, 9))).status).toBe(409);
    expect(await fs.readFile(path.join(blobDir, r.body.blobId))).toEqual(bytes);
  });

  it('refusals: bad token, wrong operation token, expired token, size mismatch, unknown id, sign-in required, oversized reservation', async () => {
    const bytes = blob(1000);
    const r = await reserve(bytes.length);
    const url: string = r.body.upload.url;
    const [pathPart, query] = url.split('?') as [string, string];
    const params = new URLSearchParams(query);

    expect((await request(harness.app).put(`${pathPart}?exp=${params.get('exp')}&sig=${'0'.repeat(64)}`).send(bytes)).status).toBe(403);
    expect((await request(harness.app).put(`${pathPart}?exp=${Number(params.get('exp')) + 1}&sig=${params.get('sig')}`).send(bytes)).status).toBe(403);
    expect((await request(harness.app).put(`${pathPart}?exp=1&sig=${params.get('sig')}`).send(bytes)).status).toBe(403);
    expect((await request(harness.app).get(url)).status).toBe(403); // a PUT token does not download
    expect((await request(harness.app).put(url).set('Content-Type', 'application/octet-stream').send(blob(999))).status).toBe(400);
    expect(await fs.stat(path.join(blobDir, r.body.blobId)).catch(() => null)).toBeNull(); // nothing written on a refusal

    expect((await request(harness.app).post('/attachments/zzz/download').set(auth(B.token))).status).toBe(400);
    expect((await request(harness.app).post(`/attachments/${'a'.repeat(32)}/download`).set(auth(B.token))).status).toBe(404);
    expect((await request(harness.app).post('/attachments').send({ size: 10 })).status).toBe(401);
    expect((await reserve(0)).status).toBe(400);
    expect((await reserve(9 * 1024 * 1024)).status).toBe(400);
    expect((await request(harness.app).post('/attachments').set(auth(A.token)).send({ size: '10' })).status).toBe(400);
  });

  it('the sweep removes expired blobs and their documents; live ones stay', async () => {
    const { AttachmentModel } = await import('../src/models/Attachment');
    const { sweepExpiredAttachments } = await import('../src/lib/attachmentSweep');
    const keep = blob(500, 2);
    const drop = blob(600, 3);
    const rk = await reserve(keep.length);
    const rd = await reserve(drop.length);
    for (const [r, b] of [[rk, keep], [rd, drop]] as const) {
      await request(harness.app).put(r.body.upload.url).set('Content-Type', 'application/octet-stream').send(b);
      await request(harness.app).post(`/attachments/${r.body.blobId}/complete`).set(auth(A.token));
    }
    await AttachmentModel.updateOne({ blobId: rd.body.blobId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const swept = await sweepExpiredAttachments();
    expect(swept.removed).toBe(1);
    expect(await fs.stat(path.join(blobDir, rd.body.blobId)).catch(() => null)).toBeNull();
    expect(await AttachmentModel.exists({ blobId: rd.body.blobId })).toBeNull();
    expect((await request(harness.app).post(`/attachments/${rd.body.blobId}/download`).set(auth(B.token))).status).toBe(404);
    expect((await request(harness.app).post(`/attachments/${rk.body.blobId}/download`).set(auth(B.token))).status).toBe(200);
    expect(await fs.readFile(path.join(blobDir, rk.body.blobId))).toEqual(keep);
  });

  it('reservations are budgeted per user', async () => {
    const { ATTACHMENT_LIMIT } = await import('../src/lib/services');
    for (let i = 0; i < ATTACHMENT_LIMIT.limit; i += 1) expect((await reserve(10, B.token)).status).toBe(201);
    const over = await reserve(10, B.token);
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('RATE_LIMITED');
    expect((await reserve(10, A.token)).status).toBe(201); // another user's budget is untouched
  });
});
