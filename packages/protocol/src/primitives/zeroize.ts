/**
 * Best-effort zeroization (T3.4). JavaScript cannot guarantee that a byte
 * array has no copies (the engine may have moved it), and strings are
 * immutable, so the keys stored base64-encoded in a session cannot be wiped
 * at all (DEVIATION-8). What this does guarantee: every intermediate byte
 * array the protocol derives (DH outputs, HKDF output blocks, chain keys,
 * message keys, expanded cipher/MAC keys and nonces, decrypted plaintext
 * bytes) is overwritten with zeros as soon as the step no longer needs it,
 * including on the failure path.
 */
export function wipe(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const b of buffers) {
    if (b) b.fill(0);
  }
}
