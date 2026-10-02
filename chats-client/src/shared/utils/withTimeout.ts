/** Rejects with `message` when `promise` has not settled within `ms`; the original promise keeps running. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timed out'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
