const cache = new Map<string, string>();

export const sharedSecretCache = {
  get: (userId: string) => cache.get(userId),
  set: (userId: string, secret: string) => cache.set(userId, secret),
  clear: () => cache.clear(),
};
