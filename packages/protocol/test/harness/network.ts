import { isProtocolError, type ProtocolErrorCode } from '../../src/errors';
import type { FakeServer, NewMessageDTO, SendMessageDTO } from './fakeServer';
import type { VirtualClient } from './virtualClient';

export type DeliveryResult =
  | { ok: true; to: string; dto: NewMessageDTO; text: string }
  | { ok: false; to: string; dto: NewMessageDTO; error: unknown; code: ProtocolErrorCode | null };

export type Tamperer = (dto: NewMessageDTO) => NewMessageDTO | null;

/**
 * The wire between clients and the server. Delivery is immediate unless the
 * recipient is held or partitioned, in which case messages queue and the
 * scenario decides the order, duplicates, drops and tampering.
 */
export class Network {
  private clients = new Map<string, VirtualClient>();
  private queues = new Map<string, NewMessageDTO[]>();
  private held = new Set<string>();
  private partitioned = new Set<string>();
  private tamperers: Tamperer[] = [];
  readonly log: DeliveryResult[] = [];

  constructor(readonly server: FakeServer) {}

  attach(client: VirtualClient): void {
    this.clients.set(client.userId, client);
    client.network = this;
  }

  client(userId: string): VirtualClient {
    const c = this.clients.get(userId);
    if (!c) throw new Error('no client ' + userId);
    return c;
  }

  private queue(userId: string): NewMessageDTO[] {
    let q = this.queues.get(userId);
    if (!q) {
      q = [];
      this.queues.set(userId, q);
    }
    return q;
  }

  /** message:send from a client. Returns what the server stored/emitted. */
  send(fromUserId: string, dto: SendMessageDTO): NewMessageDTO {
    const emitted = this.server.storeMessage(fromUserId, dto);
    let out: NewMessageDTO | null = emitted;
    for (const t of this.tamperers) {
      if (!out) break;
      out = t(out);
    }
    if (!out) return emitted; // dropped on the wire

    const to = out.toUserId;
    if (this.held.has(to) || this.partitioned.has(to)) {
      this.queue(to).push(out);
    } else {
      this.deliverNow(to, out);
    }
    return emitted;
  }

  /** Deliver one message to a client, recording the outcome instead of throwing. */
  deliverNow(to: string, dto: NewMessageDTO): DeliveryResult {
    let result: DeliveryResult;
    try {
      const text = this.client(to).receive(dto);
      result = { ok: true, to, dto, text };
    } catch (error) {
      result = { ok: false, to, dto, error, code: isProtocolError(error) ? error.code : null };
    }
    this.log.push(result);
    return result;
  }

  /** Deliver and throw on failure (for scenarios asserting an error). */
  deliverOrThrow(to: string, dto: NewMessageDTO): string {
    const r = this.deliverNow(to, dto);
    if (!r.ok) throw r.error;
    return r.text;
  }

  hold(userId: string): void {
    this.held.add(userId);
  }

  pending(userId: string): NewMessageDTO[] {
    return [...this.queue(userId)];
  }

  /** Deliver everything queued for a client, in queue order, and stop holding. */
  release(userId: string): DeliveryResult[] {
    this.held.delete(userId);
    const q = this.queue(userId);
    const results: DeliveryResult[] = [];
    while (q.length) results.push(this.deliverNow(userId, q.shift()!));
    return results;
  }

  /** Deliver a single queued message (by index) while still holding the rest. */
  releaseOne(userId: string, index = 0): DeliveryResult | null {
    const q = this.queue(userId);
    if (!q.length) return null;
    const [dto] = q.splice(Math.min(index, q.length - 1), 1);
    return this.deliverNow(userId, dto!);
  }

  reorder(userId: string, order: 'reverse' | number[] | ((q: NewMessageDTO[]) => NewMessageDTO[])): void {
    const q = this.queue(userId);
    let next: NewMessageDTO[];
    if (order === 'reverse') next = [...q].reverse();
    else if (typeof order === 'function') next = order([...q]);
    else next = order.map((i) => q[i]!);
    q.splice(0, q.length, ...next);
  }

  duplicate(userId: string, index = 0): void {
    const q = this.queue(userId);
    const dto = q[index];
    if (dto) q.push({ ...dto, v2: { ...dto.v2, header: { ...dto.v2.header } } });
  }

  drop(userId: string, index = 0): NewMessageDTO | null {
    const q = this.queue(userId);
    const [dto] = q.splice(index, 1);
    return dto ?? null;
  }

  discard(userId: string): void {
    this.queue(userId).length = 0;
  }

  /** Install an on-path modifier; returns a remover. Return null to drop. */
  tamper(fn: Tamperer): () => void {
    this.tamperers.push(fn);
    return () => {
      this.tamperers = this.tamperers.filter((t) => t !== fn);
    };
  }

  partition(userId: string): void {
    this.partitioned.add(userId);
  }

  heal(userId: string): DeliveryResult[] {
    this.partitioned.delete(userId);
    return this.release(userId);
  }
}
