import { runLimited } from '../limited';

describe('runLimited', () => {
  it('never runs more than the limit at once, starts in order, keeps result order', async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const release: Array<() => void> = [];
    const results = runLimited([0, 1, 2, 3, 4], 2, (n) => {
      started.push(n);
      running += 1;
      peak = Math.max(peak, running);
      return new Promise<number>((resolve) => {
        release[n] = () => {
          running -= 1;
          resolve(n * 10);
        };
      });
    });
    expect(started).toEqual([0, 1]);
    release[1]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    release[0]!();
    release[2]!();
    await new Promise((r) => setTimeout(r, 0));
    release[3]!();
    release[4]!();
    expect(await Promise.all(results)).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('a failure rejects only its own promise and the queue goes on', async () => {
    const results = runLimited([1, 2, 3], 1, async (n) => {
      if (n === 2) throw new Error('two');
      return n;
    });
    await expect(results[0]).resolves.toBe(1);
    await expect(results[1]).rejects.toThrow('two');
    await expect(results[2]).resolves.toBe(3);
  });
});
