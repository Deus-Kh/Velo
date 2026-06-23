export function normalizeB64(b64: string): string {
  // 1) undo '+' -> ' ' corruption
  let s = b64.replace(/ /g, '+').trim();

  // 2) url-safe -> standard
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  // 3) pad to length multiple of 4
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);

  return s;
}
