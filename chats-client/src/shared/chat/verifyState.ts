import { checkIdentity, type Identity } from '@velo/protocol';
import type { IdentityTrust, TrustedIdentity } from '../storage/trustedIdentities';

/**
 * What the Verify Contact screen shows while and after the server copy of
 * the contact's identity arrives (roadmap §8.1 A10). The identity pinned
 * on this phone is enough to show the safety number at once; the server
 * copy only confirms it or reveals a change. Without a pin there is
 * nothing to show until the server answers.
 *
 * C2: "verified" means the user marked these exact keys as verified. A pin
 * the app saved silently on first contact is "untrusted" (not verified yet).
 */
export type ServerIdentityState = { kind: 'pending' } | { kind: 'failed'; message: string } | { kind: 'ok'; identity: Identity };

export type VerifyStatus = 'verified' | 'untrusted' | 'changed' | 'unknown';

export type VerifyView = {
  /** the identity the safety number is computed from, or null while nothing can be shown */
  identity: Identity | null;
  status: VerifyStatus;
  /** true once the server copy has been fetched and is what the number shows */
  confirmed: boolean;
  /** one line about the server check, or null when there is nothing to say */
  note: string | null;
};

function pinnedIdentity(pin: TrustedIdentity | null): Identity | null {
  if (!pin || !pin.identityDhPublicKey) return null;
  return { identitySignPublicKey: pin.identitySignPublicKey, identityDhPublicKey: pin.identityDhPublicKey };
}

export function resolveVerifyView(trust: IdentityTrust | null, server: ServerIdentityState): VerifyView {
  const pin = trust?.identity ?? null;
  const verified = trust?.verified ?? false;
  if (server.kind === 'ok') {
    const check = checkIdentity(pin, server.identity);
    const status: VerifyStatus = check === 'mismatch' ? 'changed' : check === 'match' && verified ? 'verified' : 'untrusted';
    return { identity: server.identity, status, confirmed: true, note: null };
  }
  const local = pinnedIdentity(pin);
  if (local) {
    return {
      identity: local,
      status: verified ? 'verified' : 'untrusted',
      confirmed: false,
      note: server.kind === 'pending' ? 'Shown from the identity saved on this phone. Confirming with the server…' : `Shown from the identity saved on this phone. Could not confirm with the server: ${server.message}`,
    };
  }
  return { identity: null, status: 'unknown', confirmed: false, note: server.kind === 'failed' ? server.message : null };
}
