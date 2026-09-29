import { describe, expect, it, vi } from 'vitest';

// firebase.ts loads config.ts, which validates the environment at import
// time; stub it so the test never depends on a developer's env file.
vi.stubEnv('DOTENV_CONFIG_PATH', './definitely-missing.env');
vi.stubEnv('MONGO_URI', 'mongodb://127.0.0.1:1/unused');
vi.stubEnv('JWT_SECRET', 't'.repeat(48));
vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_PATH', './missing.json');

const { buildMessagePush, tokensToPrune } = await import('../src/push/firebase');

/**
 * T3.3 — push done right (P1-9, server side).
 * The push is a data-only wake-up that leaks nothing, and a token is
 * pruned only when FCM says it is dead.
 */
describe('T3.3 push payload', () => {
  it('is data-only and names the message, never the sender, the pair or any text', () => {
    const payload = buildMessagePush('65f000000000000000000abc');
    expect(payload.data).toEqual({ type: 'msg', serverMessageId: '65f000000000000000000abc' });
    expect((payload as any).notification).toBeUndefined();
    expect((payload.android as any).notification).toBeUndefined();
    const flat = JSON.stringify(payload);
    expect(flat).not.toMatch(/username|conversationId|fromUserId|title|body/);
    expect(payload.android.priority).toBe('high');
    expect(payload.apns.payload.aps['content-available']).toBe(1);
  });

  it('prunes a token only on the FCM codes that mean it is dead', () => {
    const tokens = ['t-dead', 't-bad', 't-quota', 't-ok', 't-internal', 't-invalid'];
    const responses = [
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/invalid-argument' } },
      { success: false, error: { code: 'messaging/message-rate-exceeded' } },
      { success: true },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ];
    expect(tokensToPrune(tokens, responses)).toEqual(['t-dead', 't-bad', 't-invalid']);
    // A failure without a code (network, unknown) keeps the token.
    expect(tokensToPrune(['t'], [{ success: false }])).toEqual([]);
    expect(tokensToPrune(['t'], [{ success: false, error: null }])).toEqual([]);
  });
});
