import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { createLifecycle, DEFAULT_SHUTDOWN_TIMEOUT_MS } from '../src/lib/lifecycle';

/**
 * T4.2 — graceful shutdown under a restarting process manager.
 */
function harness(overrides: Partial<Parameters<typeof createLifecycle>[0]> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const lifecycle = createLifecycle({
    stopAccepting: async () => void calls.push('stopAccepting'),
    closeSockets: () => void calls.push('closeSockets'),
    closeRedis: async () => void calls.push('closeRedis'),
    disconnectDb: async () => void calls.push('disconnectDb'),
    exit: (code) => void exits.push(code),
    log: (m) => void logs.push(m),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    ...overrides,
  });
  return { lifecycle, calls, logs, exits, timers };
}

describe('T4.2 lifecycle', () => {
  it('shuts down in order and exits 0 on a signal', async () => {
    const h = harness();
    await h.lifecycle.shutdown('SIGTERM', 0);
    expect(h.calls).toEqual(['stopAccepting', 'closeSockets', 'closeRedis', 'disconnectDb']);
    expect(h.exits).toEqual([0]);
    expect(h.timers[0]!.ms).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    expect(h.timers[0]!.cleared).toBe(true);
  });

  it('a second signal during shutdown is ignored', async () => {
    const h = harness();
    const first = h.lifecycle.shutdown('SIGTERM', 0);
    await h.lifecycle.shutdown('SIGINT', 0);
    await first;
    expect(h.calls.filter((c) => c === 'stopAccepting')).toHaveLength(1);
    expect(h.exits).toEqual([0]);
    expect(h.logs.some((l) => l.includes('already in progress'))).toBe(true);
  });

  it('a failing step is logged, the rest still runs, and the exit code becomes 1', async () => {
    const h = harness({
      closeRedis: async () => {
        throw new Error('redis wedged');
      },
    });
    await h.lifecycle.shutdown('SIGTERM', 0);
    expect(h.calls).toEqual(['stopAccepting', 'closeSockets', 'disconnectDb']);
    expect(h.exits).toEqual([1]);
    expect(h.logs.some((l) => l.includes('closeRedis') && l.includes('redis wedged'))).toBe(true);
  });

  it('a hanging step is cut by the force-exit timer', async () => {
    const h = harness({ disconnectDb: () => new Promise(() => {}), timeoutMs: 50 });
    void h.lifecycle.shutdown('SIGTERM', 0);
    await new Promise((r) => setImmediate(r));
    expect(h.timers[0]!.ms).toBe(50);
    h.timers[0]!.fn(); // the deadline passes
    expect(h.exits).toEqual([1]);
  });

  it('a crash exits non-zero so the process manager restarts, a signal exits zero', async () => {
    const h = harness();
    const proc = new EventEmitter();
    h.lifecycle.install(proc);
    proc.emit('uncaughtException', new Error('boom'));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(h.exits).toEqual([1]);
    expect(h.logs.some((l) => l.includes('uncaught exception') && l.includes('boom'))).toBe(true);

    const h2 = harness();
    const proc2 = new EventEmitter();
    h2.lifecycle.install(proc2);
    proc2.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(h2.exits).toEqual([0]);
  });
});
