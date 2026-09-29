import { UserModel } from '../models/User';

/**
 * Privacy toggles (T7.4, P2-10). The defaults are the product promise: no
 * presence broadcast unless the user opts in; read receipts and typing on.
 * Enforced where the server would otherwise tell a peer something:
 *  - `message:read` tells the sender only if the reader allows it;
 *  - typing events are forwarded only if the typer allows it;
 *  - the presence payload of a user hides online/last-seen unless allowed.
 */
export type PrivacySettings = {
  /** Peers learn when this user has read their messages. */
  readReceipts: boolean;
  /** Peers see "typing…" while this user types. */
  typing: boolean;
  /** Peers see when this user was last online. */
  lastSeen: boolean;
  /** Peers see this user as online while connected. */
  online: boolean;
};

export const DEFAULT_PRIVACY: PrivacySettings = { readReceipts: true, typing: true, lastSeen: false, online: false };
export const PRIVACY_KEYS = ['readReceipts', 'typing', 'lastSeen', 'online'] as const;

export function normalizePrivacy(raw: unknown): PrivacySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    readReceipts: typeof r.readReceipts === 'boolean' ? r.readReceipts : DEFAULT_PRIVACY.readReceipts,
    typing: typeof r.typing === 'boolean' ? r.typing : DEFAULT_PRIVACY.typing,
    lastSeen: typeof r.lastSeen === 'boolean' ? r.lastSeen : DEFAULT_PRIVACY.lastSeen,
    online: typeof r.online === 'boolean' ? r.online : DEFAULT_PRIVACY.online,
  };
}

/** The user's settings, defaults for an unknown user (nothing is revealed for them anyway). */
export async function loadPrivacy(userId: string): Promise<PrivacySettings> {
  const user = await UserModel.findById(userId).select('privacy').lean();
  return normalizePrivacy(user?.privacy);
}

export async function updatePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings | null> {
  const $set: Record<string, boolean> = {};
  for (const k of PRIVACY_KEYS) if (typeof patch[k] === 'boolean') $set['privacy.' + k] = patch[k] as boolean;
  const user = await UserModel.findByIdAndUpdate(userId, Object.keys($set).length ? { $set } : {}, { new: true }).select('privacy').lean();
  return user ? normalizePrivacy(user.privacy) : null;
}

/** What a peer may see of this user's presence. */
export function maskPresence(payload: { userId: string; online: boolean; lastSeenAt: number | null }, privacy: PrivacySettings): { userId: string; online: boolean; lastSeenAt: number | null } {
  return {
    userId: payload.userId,
    online: privacy.online ? payload.online : false,
    lastSeenAt: privacy.lastSeen ? payload.lastSeenAt : null,
  };
}
