import { singleFlight } from '../singleFlight';

describe('singleFlight', () => {
  it('runs the factory once for concurrent callers and again after settling', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const guarded = singleFlight(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          release = resolve;
        }),
    );

    const a = guarded();
    const b = guarded();
    const c = guarded();
    expect(calls).toBe(1);
    release('token-1');
    expect(await Promise.all([a, b, c])).toEqual(['token-1', 'token-1', 'token-1']);

    const d = guarded();
    expect(calls).toBe(2);
    release('token-2');
    expect(await d).toBe('token-2');
  });

  it('propagates a rejection to every waiter and then resets', async () => {
    let calls = 0;
    const guarded = singleFlight(async () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    });
    await expect(Promise.all([guarded(), guarded()])).rejects.toThrow('boom 1');
    await expect(guarded()).rejects.toThrow('boom 2');
  });
});
