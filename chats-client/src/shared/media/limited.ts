/**
 * Runs `fn` over `items` with at most `limit` running at once, starting
 * them in order; returns one promise per item, in the same order.
 */
export function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Array<Promise<R>> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (!run) return;
    active += 1;
    run();
  };
  return items.map(
    (item) =>
      new Promise<R>((resolve, reject) => {
        queue.push(() => {
          fn(item)
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              next();
            });
        });
        next();
      }),
  );
}
