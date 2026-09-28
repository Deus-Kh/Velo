import { isProtocolError, type ProtocolErrorCode } from '../../src/errors';
import { FakeServer } from './fakeServer';
import { Network } from './network';
import { VirtualClient } from './virtualClient';

export { FakeServer } from './fakeServer';
export type { GroupCopyDTO, GroupSendDTO, GroupSendResult, NewMessageDTO, SendMessageDTO, ServerIdentity } from './fakeServer';
export { MemoryStore } from './memoryStore';
export { Network } from './network';
export type { DeliveryResult, WireDTO } from './network';
export { isGroupCopy } from './network';
export { flipEncHeader, resealHeader, alienHeader } from './tamper';
export { VirtualClient } from './virtualClient';

export type Clock = { now: () => number; advance: (ms: number) => void };

export type World = {
  server: FakeServer;
  network: Network;
  clients: Record<string, VirtualClient>;
  /** Shared fake clock (signed-prekey rotation and expiry). */
  clock: Clock;
  /** Restart a client: serialize its store and attach a fresh process over it. */
  restart: (userId: string) => VirtualClient;
};

export function makeWorld(userIds: string[] = ['A', 'B'], opts: { oneTimePreKeys?: number } = {}): World {
  const server = new FakeServer();
  const network = new Network(server);
  const clients: Record<string, VirtualClient> = {};
  let t = Date.UTC(2026, 8, 28);
  const clock: Clock = { now: () => t, advance: (ms) => { t += ms; } };
  for (const id of userIds) {
    const c = new VirtualClient(id, server, undefined, clock.now);
    network.attach(c);
    c.register({ oneTimePreKeys: opts.oneTimePreKeys ?? 10 });
    clients[id] = c;
  }
  const restart = (userId: string): VirtualClient => {
    const old = clients[userId];
    if (!old) throw new Error('no client ' + userId);
    const fresh = VirtualClient.restore(userId, server, old.serialize(), clock.now);
    network.attach(fresh);
    clients[userId] = fresh;
    return fresh;
  };
  return { server, network, clients, restart, clock };
}

/** The ProtocolError code a call throws, 'NOT_PROTOCOL_ERROR' for other throws, null if it returns. */
export function codeOf(fn: () => unknown): ProtocolErrorCode | 'NOT_PROTOCOL_ERROR' | null {
  try {
    fn();
    return null;
  } catch (e) {
    return isProtocolError(e) ? e.code : 'NOT_PROTOCOL_ERROR';
  }
}

/** Deterministic PRNG for property tests (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
