/**
 * Property (T2.0 acceptance): every direction change performs exactly one
 * ratchet step, and nothing else does. A client's DHs and root key change
 * exactly on the receive events whose header carries a ratchet key it has
 * not seen, and never on sends or on receives within the current epoch.
 *
 * Budget: a fresh bootstrap costs ~26 ms in pure-JS X25519, so the 1000
 * random conversations are 100 fresh sessions × 10 random segments of six
 * messages each (in-order delivery; reorders are the interleavings test).
 */
import { describe, expect, it } from 'vitest';
import { makeWorld, rng } from '../harness';

const SESSIONS = 100;
const SEGMENTS_PER_SESSION = 10;
const STEPS = 6;

describe('property: one ratchet step per direction change', () => {
  it('DHs and root key change exactly on new-epoch receives (1000 random conversation segments)', () => {
    const worlds = Array.from({ length: 10 }, () => makeWorld(['A', 'B'], { oneTimePreKeys: 12 }));
    let checkedReceives = 0;
    let ratchetSteps = 0;

    for (let s = 0; s < SESSIONS; s += 1) {
      const world = worlds[s % worlds.length]!;
      const { network, clients } = world;
      const { A, B } = clients;
      A!.resetSession('B');
      B!.resetSession('A');
      A!.send('B', 'bootstrap');

      for (let seg = 0; seg < SEGMENTS_PER_SESSION; seg += 1) {
        const seed = 50_000 + s * SEGMENTS_PER_SESSION + seg;
        const rand = rng(seed);

        for (let i = 0; i < STEPS; i += 1) {
          const from: 'A' | 'B' = rand() < 0.5 ? 'A' : 'B';
          const sender = from === 'A' ? A! : B!;
          const receiver = from === 'A' ? B! : A!;
          const senderPeer = from === 'A' ? 'B' : 'A';

          const senderBefore = sender.sessionState(senderPeer)!;
          const receiverBefore = receiver.sessionState(from)!;

          network.hold(receiver.userId);
          const dto = sender.send(receiver.userId, from + String(i));
          const senderAfter = sender.sessionState(senderPeer)!;
          expect(senderAfter.DHsPublicKey, 'seed ' + String(seed) + ': a send must never ratchet').toBe(senderBefore.DHsPublicKey);
          expect(senderAfter.rootKey, 'seed ' + String(seed) + ': a send must never change the root key').toBe(senderBefore.rootKey);

          const sentDhPub = sender.sentHeader(dto.clientMessageId).dhPub; // T3.6: the wire header is encrypted
          const newEpoch = receiverBefore.DHrPublicKey !== sentDhPub;
          const [r] = network.release(receiver.userId);
          expect(r!.ok, 'seed ' + String(seed) + ' ' + String(r!.ok ? '' : r!.code)).toBe(true);
          const receiverAfter = receiver.sessionState(from)!;
          checkedReceives += 1;

          if (newEpoch) {
            ratchetSteps += 1;
            expect(receiverAfter.DHsPublicKey, 'seed ' + String(seed) + ': new epoch must rotate DHs').not.toBe(receiverBefore.DHsPublicKey);
            expect(receiverAfter.rootKey, 'seed ' + String(seed) + ': new epoch must re-derive the root key').not.toBe(receiverBefore.rootKey);
            expect(receiverAfter.DHrPublicKey).toBe(sentDhPub);
            expect(receiverAfter.Nr).toBe(1);
            expect(receiverAfter.PN).toBe(receiverBefore.Ns);
          } else {
            expect(receiverAfter.DHsPublicKey, 'seed ' + String(seed) + ': same epoch must not ratchet').toBe(receiverBefore.DHsPublicKey);
            expect(receiverAfter.rootKey, 'seed ' + String(seed) + ': same epoch must keep the root key').toBe(receiverBefore.rootKey);
            expect(receiverAfter.Nr).toBe(receiverBefore.Nr + 1);
          }
        }
      }
    }

    expect(checkedReceives).toBe(SESSIONS * SEGMENTS_PER_SESSION * STEPS);
    // Roughly half of random sends change direction; make sure the property was exercised.
    expect(ratchetSteps).toBeGreaterThan(checkedReceives / 4);
  }, 60_000);
});
