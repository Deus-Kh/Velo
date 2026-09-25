/**
 * Collapses concurrent calls into one in-flight promise: ten requests that
 * hit 401 at the same time trigger one refresh, not ten. The promise is
 * cleared when it settles so the next call starts a fresh one.
 */
export function singleFlight<T>(factory: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = factory().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
