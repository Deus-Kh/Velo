/**
 * Ratchet resource bounds (spec T2.6, DEVIATION-4).
 *
 * A forged header must not be able to make a receiver derive millions of
 * keys (S12) or retain them without bound. The bounds are checked before
 * any derivation and are part of the protocol's behaviour, not tuning.
 */

/** Largest gap a single message may open on one chain (n − Nr, or pn − Nr when draining). */
export const MAX_SKIP_PER_STEP = 100;

/** Largest number of skipped message keys retained in a session, all epochs together. */
export const MAX_SKIP_TOTAL = 1000;

/** Skipped keys are kept for at most this many most recent peer epochs. */
export const MAX_SKIP_EPOCHS = 5;

/** Message counters are u32 on the wire but bounded far lower to stop counter abuse. */
export const MAX_MESSAGE_NUMBER = 2 ** 24;

/** Peer ratchet keys remembered to tell an evicted epoch from an unknown one. */
export const PEER_EPOCH_HISTORY = 16;
