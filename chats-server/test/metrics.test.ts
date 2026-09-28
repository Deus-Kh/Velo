import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, startTestApp, tokenFor } from './helpers/testApp';

/**
 * T4.6 — Prometheus metrics: protected endpoint, HTTP and delivery
 * instrumentation, device-reported decrypt failures, no user identifiers.
 */
let harness: Awaited<ReturnType<typeof startTestApp>>;
const METRICS_TOKEN = 'm'.repeat(40);

beforeAll(async () => {
  vi.stubEnv('METRICS_TOKEN', METRICS_TOKEN);
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(() => {
  harness.resetLimits();
});

const scrape = () => request(harness.app).get('/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`);

describe('T4.6 metrics', () => {
  it('/metrics needs the bearer token', async () => {
    expect((await request(harness.app).get('/metrics')).status).toBe(401);
    expect((await request(harness.app).get('/metrics').set('Authorization', 'Bearer nope')).status).toBe(401);
    const ok = await scrape();
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/plain');
    expect(ok.text).toContain('velo_node_process_cpu_user_seconds_total');
  });

  it('counts HTTP requests by matched route and status, never by user-supplied path parts', async () => {
    const a = await createUser();
    await request(harness.app).get(`/users/me`).set('Authorization', `Bearer ${a.token}`);
    await request(harness.app).get('/definitely-not-a-route');
    const text = (await scrape()).text;
    expect(text).toMatch(/velo_http_requests_total\{[^}]*route="\/users\/me"[^}]*status="200"/);
    expect(text).toMatch(/velo_http_requests_total\{[^}]*route="unmatched"[^}]*status="404"/);
    expect(text).not.toContain(a.userId);
    expect(text).toContain('velo_http_request_duration_seconds_bucket');
  });

  it('a delivered ack counts a delivery and observes the latency', async () => {
    const a = await createUser();
    const b = await createUser();
    const { MessageModel } = await import('../src/models/Message');
    const { makeConversationId } = await import('../src/utils/conversation');
    const { messageExpiry } = await import('../src/lib/delivery');
    const doc = await MessageModel.create({
      conversationId: makeConversationId(a.userId, b.userId),
      fromUserId: new Types.ObjectId(a.userId),
      toUserId: new Types.ObjectId(b.userId),
      protoVersion: 4,
      v4: { encHeader: Buffer.alloc(85, 1).toString('base64'), ciphertext: 'C'.repeat(64), mac: 'M'.repeat(24) },
      clientMessageId: 'metrics-1',
      createdAtClient: Date.now(),
      seq: 1,
      expiresAt: messageExpiry(),
    });
    const before = (await scrape()).text;
    const countBefore = Number(/velo_messages_delivered_total(?:\{[^}]*\})? (\d+)/.exec(before)?.[1] ?? 0);
    await request(harness.app).post('/messages/delivered').set('Authorization', `Bearer ${tokenFor(b.userId)}`).send({ serverMessageIds: [String(doc._id)] });
    const after = (await scrape()).text;
    const countAfter = Number(/velo_messages_delivered_total(?:\{[^}]*\})? (\d+)/.exec(after)?.[1] ?? 0);
    expect(countAfter).toBe(countBefore + 1);
    expect(after).toMatch(/velo_delivery_latency_seconds_count(?:\{[^}]*\})? [1-9]\d*/);
    expect(after).not.toContain(String(doc._id));
  });

  it('devices report decrypt failures by code only; unknown codes fold into "other"', async () => {
    const a = await createUser();
    const post = (code: unknown) => request(harness.app).post('/telemetry/decrypt-failure').set('Authorization', `Bearer ${a.token}`).send({ code });
    expect((await post('HEADER_TAMPERED')).status).toBe(204);
    expect((await post('HEADER_TAMPERED')).status).toBe(204);
    expect((await post('made-up; not a code')).status).toBe(204);
    expect((await request(harness.app).post('/telemetry/decrypt-failure').send({ code: 'DECRYPT_FAILED' })).status).toBe(401);
    const text = (await scrape()).text;
    expect(text).toMatch(/velo_client_decrypt_failures_total\{[^}]*code="HEADER_TAMPERED"[^}]*\} [2-9]\d*/);
    expect(text).toMatch(/velo_client_decrypt_failures_total\{[^}]*code="other"/);
    expect(text).not.toContain('made-up');
    expect(text).not.toContain(a.userId);
  });
});

describe('T4.6 metrics disabled', () => {
  it('without METRICS_TOKEN the endpoint does not exist (404, not 401)', async () => {
    const express = (await import('express')).default;
    const { metricsHandler } = await import('../src/lib/metrics');
    const app = express();
    app.get('/metrics', metricsHandler(() => ''));
    const res = await request(app).get('/metrics').set('Authorization', `Bearer ${METRICS_TOKEN}`);
    expect(res.status).toBe(404);
  });
});
