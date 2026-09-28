/**
 * S26 — Delete-on-delivery (T3.1, P1-10 server side).
 * Checklist: §9 (storage), roadmap §2.1 "Delete-on-delivery server".
 * The server holds ciphertext only until the recipient's device has
 * decrypted it. The ack is sent after the message decrypted and was stored,
 * so a message that cannot be decrypted stays on the server for a retry;
 * a receipt (no ciphertext) remains so the sender learns the state.
 * Expected: green from the start (written with T3.1).
 */
import { describe, expect, it } from 'vitest';
import { flipEncHeader, makeWorld } from '../harness';

describe('S26 delete-on-delivery', () => {
  it('the server holds no ciphertext once the recipient has decrypted; receipts remain', () => {
    const { server, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'a1');
    A!.send('B', 'a2');
    B!.send('A', 'b1');

    expect(server.heldCiphertextCount('A:B')).toBe(0);
    expect(server.undelivered('B')).toEqual([]);
    expect(server.receipts.map((r) => [r.fromUserId, r.status])).toEqual([['A', 'delivered'], ['A', 'delivered'], ['B', 'delivered']]);
    expect(B!.storedMessages('A').map((m) => m.text)).toEqual(['a1', 'a2', 'b1']);
  });

  it('undelivered ciphertext waits for the device, is pulled on open, and is then deleted', () => {
    const { server, network, clients, restart } = makeWorld();
    const { A } = clients;
    network.hold('B');
    A!.send('B', 'while you were away 1');
    A!.send('B', 'while you were away 2');
    expect(server.undelivered('B', 'A').map((m) => m.serverMessageId)).toHaveLength(2);

    // Nothing was delivered live; B relaunches and opens the chat (history load = store + undelivered).
    network.release('B'); // the held live copies arrive first, as after a reconnect
    const B2 = restart('B');
    expect(B2.loadHistory('A').map((m) => m.text)).toEqual(['while you were away 1', 'while you were away 2']);
    expect(server.heldCiphertextCount('A:B')).toBe(0);
    expect(B2.loadHistory('A')).toHaveLength(2); // idempotent: nothing is fetched twice
  });

  it('a message that fails to decrypt is not acked and stays on the server', () => {
    const { server, network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'ok');
    const stop = network.tamper(flipEncHeader); // T3.6: the header is encrypted; a flipped byte is all an on-path attacker can do
    A!.send('B', 'tampered on the wire');
    stop();

    expect(B!.inbox.map((m) => m.text)).toEqual(['ok']);
    expect(server.undelivered('B', 'A')).toHaveLength(1);
    // The genuine copy is still there: the device pulls and acks it on the next open.
    expect(B!.loadHistory('A').map((m) => m.text)).toEqual(['ok', 'tampered on the wire']);
    expect(server.heldCiphertextCount('A:B')).toBe(0);
  });

  it('only the recipient can ack; a stranger or the sender leaves the ciphertext in place', () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'C']);
    const { A } = clients;
    network.hold('B');
    const m = A!.send('B', 'private');
    expect(server.ackDelivered('C', m.serverMessageId)).toBe('FORBIDDEN');
    expect(server.ackDelivered('A', m.serverMessageId)).toBe('FORBIDDEN');
    expect(server.ackDelivered('B', 'srv-nope')).toBe('NOT_FOUND');
    expect(server.undelivered('B')).toHaveLength(1);
    expect(server.ackDelivered('B', m.serverMessageId)).toBe('delivered');
    expect(server.undelivered('B')).toHaveLength(0);
  });
});
