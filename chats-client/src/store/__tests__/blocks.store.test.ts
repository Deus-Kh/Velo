import { EMPTY_BLOCKED, selectBlockedIds, useBlocksStore } from '../blocks.store';

/**
 * Regression: ChatListScreen selected `blockedByUser[me] ?? []`, and the fresh
 * `[]` on every call made zustand v5 (useSyncExternalStore) re-render forever
 * ("Maximum update depth exceeded") for any user without a blocks entry.
 */
describe('selectBlockedIds', () => {
  beforeEach(() => useBlocksStore.setState({ blockedByUser: {} }));

  it('returns the same reference on every call when the user has no entry', () => {
    const state = useBlocksStore.getState();
    expect(selectBlockedIds('me')(state)).toBe(selectBlockedIds('me')(state));
    expect(selectBlockedIds('me')(state)).toBe(EMPTY_BLOCKED);
    expect(selectBlockedIds(null)(state)).toBe(EMPTY_BLOCKED);
    expect(Object.isFrozen(EMPTY_BLOCKED)).toBe(true);
  });

  it('returns the stored list itself once one exists', () => {
    useBlocksStore.getState().setBlocked('me', ['a', 'b', 'a']);
    const state = useBlocksStore.getState();
    expect(selectBlockedIds('me')(state)).toBe(state.blockedByUser.me);
    expect(selectBlockedIds('me')(state)).toEqual(['a', 'b']);
    expect(selectBlockedIds('other')(state)).toBe(EMPTY_BLOCKED);
  });
});
