import type { ProtocolErrorCode } from '@velo/protocol';
import { presentProtocolError, type ProtocolErrorAction } from './protocolErrors';
import type { SessionHealth } from './useChatE2EE';

/**
 * T4.8 (P2-8): what the chat screen shows for a session state, derived
 * from the spec §8.3 taxonomy in one place. Security warnings (a changed
 * safety number, a message modified in transit) render in the danger tone;
 * technical states (reset needed, a message that could not be decrypted)
 * in the warning tone. The composer is disabled only for the two states
 * where sending would be wrong.
 */
export type SessionHealthPresentation = {
  /** Header subtitle under the contact name. */
  subtitle: string;
  /** Header pill. */
  pillLabel: string;
  /** Banner title and body. */
  title: string;
  body: string;
  tone: 'danger' | 'warning';
  /** Why the composer is disabled, or null when sending is allowed. */
  composerDisabledReason: string | null;
  action: ProtocolErrorAction;
  securityWarning: boolean;
  code: ProtocolErrorCode | null;
};

const BODY: Partial<Record<ProtocolErrorCode, string>> = {
  DECRYPT_FAILED: 'A message from this contact could not be decrypted. It stays on the server; if this keeps happening, reset the secure session.',
  HEADER_TAMPERED: 'A message arrived with its header or identity binding modified. It was rejected. Compare safety numbers with this contact.',
  TOO_MANY_SKIPPED: 'More messages were missed than the session keeps keys for. Reset the secure session to continue.',
  UNKNOWN_OLD_MESSAGE: 'An older message arrived after its keys were gone. Nothing to do; new messages are unaffected.',
  STORAGE_CORRUPTION: 'Local encryption data for this chat is damaged. Reset the secure session.',
  INVALID_KEY_LENGTH: 'This contact sent invalid key data. Reset the secure session.',
  IDENTITY_BINDING_INVALID: 'This contact sent invalid key data. Reset the secure session.',
};

export function describeSessionHealth(health: SessionHealth, peerName = 'this contact'): SessionHealthPresentation | null {
  if (health.status === 'healthy') return null;

  if (health.status === 'identity_changed') {
    const p = presentProtocolError('IDENTITY_MISMATCH', peerName);
    return {
      subtitle: 'Safety number changed',
      pillLabel: 'Verify identity',
      title: p.userMessage ?? 'Safety number changed',
      body: "This contact's identity keys changed — a reinstall or new device, or someone interfering. Compare safety numbers before continuing. Sending is blocked until you verify or accept the new identity.",
      tone: 'danger',
      composerDisabledReason: 'Safety number changed. Verify or accept the new identity to send.',
      action: p.action,
      securityWarning: true,
      code: 'IDENTITY_MISMATCH',
    };
  }

  if (health.status === 'reset_required') {
    const code = health.code ?? 'SESSION_RESET_REQUIRED';
    const p = presentProtocolError(code, peerName);
    return {
      subtitle: 'Secure session needs reset',
      pillLabel: 'Needs attention',
      title: 'Secure session needs attention',
      body: BODY[code] ?? 'This conversation cannot decrypt reliably until the secure session is reset.',
      tone: p.securityWarning ? 'danger' : 'warning',
      composerDisabledReason: 'Reset the secure session to send new messages.',
      action: 'reset',
      securityWarning: p.securityWarning,
      code,
    };
  }

  // degraded: a message could not be decrypted, the session itself still works
  const p = presentProtocolError(health.code, peerName);
  return {
    subtitle: p.securityWarning ? 'Security warning' : 'Message problem',
    pillLabel: p.securityWarning ? 'Security warning' : 'Needs attention',
    title: p.userMessage ?? 'A message could not be decrypted',
    body: BODY[health.code] ?? 'A message from this contact could not be processed.',
    tone: p.securityWarning ? 'danger' : 'warning',
    composerDisabledReason: null,
    action: p.action,
    securityWarning: p.securityWarning,
    code: health.code,
  };
}
