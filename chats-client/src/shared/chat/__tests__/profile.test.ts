import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfilesStore, displayNameFor } from '../../../store/profiles.store';
import { loadOwnProfile, loadPeerProfile, loadSharedAt, profilePrefixForUser } from '../../storage/profileStore';
import { handleInboundAction } from '../actions';
import { applyInboundProfile, hydrateProfiles, reshareProfile, shareProfileWith, updateOwnProfile } from '../profile';

/**
 * T7.7 — the profile as content over the session: newest wins on receive,
 * one send per version per contact, sealed at rest, mirrored in memory.
 */
const mockSent: Array<{ to: string; content: any }> = [];
jest.mock('../../socket/messaging', () => ({
  sendContent: jest.fn(async (to: string, content: unknown) => {
    mockSent.push({ to, content });
    return { serverMessageId: 'ctl' };
  }),
  sendMessageV2: jest.fn(),
}));
jest.mock('../../crypto/sessionBootstrap', () => ({ ensureV2Session: jest.fn(async () => ({ initPacket: null })) }));
jest.mock('../groupMessaging', () => ({ sendGroupContent: jest.fn(), sendGroupMessage: jest.fn() }));
jest.mock('../../notifications/notifee', () => ({ cancelConversationNotifications: jest.fn(async () => undefined) }));

const ME = 'me';
const fox = { kind: 'emoji' as const, emoji: '\u{1F98A}', color: '#ffaa00' };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSent.length = 0;
  useProfilesStore.getState().reset();
});

describe('T7.7 profiles', () => {
  it('an inbound profile is stored sealed and mirrored; an older or equal version is ignored; our own echo is ignored', async () => {
    const first = await applyInboundProfile({ myUserId: ME, actorUserId: 'alice', content: { v: 1, kind: 'profile', name: 'Alice', avatar: fox, updatedAt: 100 } });
    expect(first).toBe(true);
    expect(await loadPeerProfile(ME, 'alice')).toEqual({ name: 'Alice', avatar: fox, updatedAt: 100 });
    expect(useProfilesStore.getState().byUser.alice?.name).toBe('Alice');
    expect(displayNameFor(useProfilesStore.getState().byUser, 'alice', 'alice-username')).toBe('Alice');
    expect(displayNameFor(useProfilesStore.getState().byUser, 'bob', 'bob-username')).toBe('bob-username');
    // Sealed at rest.
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.startsWith(profilePrefixForUser(ME) + 'peer:'))!;
    expect(await AsyncStorage.getItem(key)).not.toContain('Alice');

    expect(await applyInboundProfile({ myUserId: ME, actorUserId: 'alice', content: { v: 1, kind: 'profile', name: 'Old', avatar: null, updatedAt: 50 } })).toBe(false);
    expect(await applyInboundProfile({ myUserId: ME, actorUserId: 'alice', content: { v: 1, kind: 'profile', name: 'Same', avatar: null, updatedAt: 100 } })).toBe(false);
    expect((await loadPeerProfile(ME, 'alice'))!.name).toBe('Alice');
    // Through the shared inbound action path.
    await handleInboundAction({ myUserId: ME, peerKey: 'alice', actorUserId: 'alice', content: { v: 1, kind: 'profile', name: 'Alice B.', avatar: null, updatedAt: 200 } });
    expect((await loadPeerProfile(ME, 'alice'))!.name).toBe('Alice B.');
    expect(await applyInboundProfile({ myUserId: ME, actorUserId: ME, content: { v: 1, kind: 'profile', name: 'x', avatar: null, updatedAt: 999 } })).toBe(false);
  });

  it('our profile is shared once per version per contact, and re-shared to everyone who had it when it changes', async () => {
    expect(await shareProfileWith(ME, 'alice')).toBe(false); // nothing to share yet
    const p1 = await updateOwnProfile(ME, { name: '  Me  ', avatar: fox });
    expect(p1.name).toBe('Me');
    expect((await loadOwnProfile(ME))!.avatar).toEqual(fox);
    expect(useProfilesStore.getState().own?.name).toBe('Me');

    expect(await shareProfileWith(ME, 'alice')).toBe(true);
    expect(await shareProfileWith(ME, 'alice')).toBe(false); // already has this version
    expect(await shareProfileWith(ME, ME)).toBe(false);
    expect(mockSent).toEqual([{ to: 'alice', content: { v: 1, kind: 'profile', name: 'Me', avatar: fox, updatedAt: p1.updatedAt } }]);
    expect(await loadSharedAt(ME, 'alice')).toBe(p1.updatedAt);
    await shareProfileWith(ME, 'bob');
    expect(mockSent).toHaveLength(2);

    mockSent.length = 0;
    const p2 = await updateOwnProfile(ME, { name: 'Me 2' });
    expect(p2.updatedAt).toBeGreaterThan(p1.updatedAt);
    expect(p2.avatar).toEqual(fox); // untouched by a name-only change
    await new Promise((r) => setTimeout(r, 0)); // the reshare runs in the background
    const r = await reshareProfile(ME); // idempotent: nothing left to send
    expect(r.sentTo).toEqual([]);
    expect(mockSent.map((m) => [m.to, m.content.name]).sort()).toEqual([['alice', 'Me 2'], ['bob', 'Me 2']]);
    await expect(updateOwnProfile(ME, { name: '   ' })).rejects.toThrow();
  });

  it('hydration loads our profile and every contact into memory', async () => {
    await updateOwnProfile(ME, { name: 'Me', avatar: null });
    await applyInboundProfile({ myUserId: ME, actorUserId: 'alice', content: { v: 1, kind: 'profile', name: 'Alice', avatar: fox, updatedAt: 1 } });
    await applyInboundProfile({ myUserId: ME, actorUserId: 'bob', content: { v: 1, kind: 'profile', name: 'Bob', avatar: null, updatedAt: 1 } });
    useProfilesStore.getState().reset();
    await hydrateProfiles(ME);
    const s = useProfilesStore.getState();
    expect(s.own?.name).toBe('Me');
    expect(Object.keys(s.byUser).sort()).toEqual(['alice', 'bob']);
    expect(s.byUser.alice?.avatar).toEqual(fox);
  });
});
