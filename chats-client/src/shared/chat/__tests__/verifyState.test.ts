import { resolveVerifyView } from '../verifyState';

/**
 * Roadmap §8.1 A10 — the safety number comes from the local pin at once;
 * the server copy confirms it, reveals a change, or is simply not there.
 */
const SIGN_A = 'A'.repeat(43) + '=';
const DH_A = 'B'.repeat(43) + '=';
const SIGN_B = 'C'.repeat(43) + '=';
const DH_B = 'D'.repeat(43) + '=';
const pinA = { identitySignPublicKey: SIGN_A, identityDhPublicKey: DH_A };
const serverA = { identitySignPublicKey: SIGN_A, identityDhPublicKey: DH_A };
const serverB = { identitySignPublicKey: SIGN_B, identityDhPublicKey: DH_B };

describe('resolveVerifyView', () => {
  it('a pinned contact shows its number immediately while the server is pending, unconfirmed', () => {
    const view = resolveVerifyView(pinA, { kind: 'pending' });
    expect(view.identity).toEqual(serverA);
    expect(view.status).toBe('verified');
    expect(view.confirmed).toBe(false);
    expect(view.note).toMatch(/saved on this phone/);
  });

  it('the server confirming the pin leaves it verified and confirmed; a different key means "changed"', () => {
    expect(resolveVerifyView(pinA, { kind: 'ok', identity: serverA })).toEqual({ identity: serverA, status: 'verified', confirmed: true, note: null });
    const changed = resolveVerifyView(pinA, { kind: 'ok', identity: serverB });
    expect(changed.status).toBe('changed');
    expect(changed.identity).toEqual(serverB);
    expect(changed.confirmed).toBe(true);
  });

  it('a server failure keeps the pinned number on screen with a note; without a pin there is nothing to show', () => {
    const view = resolveVerifyView(pinA, { kind: 'failed', message: 'Timed out' });
    expect(view.identity).toEqual(serverA);
    expect(view.status).toBe('verified');
    expect(view.note).toMatch(/Timed out/);
    const none = resolveVerifyView(null, { kind: 'failed', message: 'Timed out' });
    expect(none).toEqual({ identity: null, status: 'unknown', confirmed: false, note: 'Timed out' });
    expect(resolveVerifyView(null, { kind: 'pending' })).toEqual({ identity: null, status: 'unknown', confirmed: false, note: null });
  });

  it('a first contact is "untrusted" once the server answers; an old pin without a DH key cannot be shown early', () => {
    expect(resolveVerifyView(null, { kind: 'ok', identity: serverA }).status).toBe('untrusted');
    const oldPin = { identitySignPublicKey: SIGN_A, identityDhPublicKey: null };
    expect(resolveVerifyView(oldPin, { kind: 'pending' }).identity).toBeNull();
    expect(resolveVerifyView(oldPin, { kind: 'ok', identity: serverA }).status).toBe('verified');
  });
});
