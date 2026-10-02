import { DIRECTORY_SEARCH_MIN_LENGTH, filterLocalContacts, matchesLocalQuery } from '../searchLocal';

/**
 * Roadmap §8.1 A11 — the device's own lists match from the first character
 * by prefix; the directory threshold is the server's.
 */
describe('matchesLocalQuery', () => {
  it('matches a prefix of the username, case-insensitively, with or without the @', () => {
    expect(matchesLocalQuery('te', { peerUserId: '1', username: 'Test1' })).toBe(true);
    expect(matchesLocalQuery('TE', { peerUserId: '1', username: 'test1' })).toBe(true);
    expect(matchesLocalQuery('@te', { peerUserId: '1', username: 'Test1' })).toBe(true);
    expect(matchesLocalQuery('te', { peerUserId: '1', username: '@Test1' })).toBe(true);
    expect(matchesLocalQuery('est', { peerUserId: '1', username: 'Test1' })).toBe(false); // prefix, not substring
  });

  it('matches a prefix of the display name or of any of its words', () => {
    expect(matchesLocalQuery('te', { peerUserId: '1', username: 'zz', displayName: 'Teresa' })).toBe(true);
    expect(matchesLocalQuery('te', { peerUserId: '1', username: 'zz', displayName: 'Anna Teresa' })).toBe(true);
    expect(matchesLocalQuery('na', { peerUserId: '1', username: 'zz', displayName: 'Anna Teresa' })).toBe(false);
    expect(matchesLocalQuery('te', { peerUserId: '1', username: 'zz' })).toBe(false);
  });

  it('an empty or blank query matches nothing', () => {
    expect(matchesLocalQuery('', { peerUserId: '1', username: 'Test1' })).toBe(false);
    expect(matchesLocalQuery('   ', { peerUserId: '1', username: 'Test1' })).toBe(false);
  });
});

describe('filterLocalContacts', () => {
  const saved = { peerUserId: 'u1', username: 'Test1', source: 'saved' };
  const verified = { peerUserId: 'u1', username: 'Test1', source: 'verified' };
  const recent = { peerUserId: 'u2', username: 'Tanya', source: 'recent' };
  const other = { peerUserId: 'u3', username: 'Bob', displayName: 'Robert Tell', source: 'recent' };

  it('keeps order, lists each user once (first occurrence wins) and drops non-matches', () => {
    expect(filterLocalContacts('t', [saved, verified, recent, other]).map((c) => `${c.source}:${c.peerUserId}`)).toEqual(['saved:u1', 'recent:u2', 'recent:u3']);
    expect(filterLocalContacts('ta', [saved, verified, recent, other]).map((c) => c.peerUserId)).toEqual(['u2']);
    expect(filterLocalContacts('te', [verified, saved]).map((c) => c.source)).toEqual(['verified']);
    expect(filterLocalContacts('', [saved, recent])).toEqual([]);
  });

  it('the directory threshold is the server minimum', () => {
    expect(DIRECTORY_SEARCH_MIN_LENGTH).toBe(3);
  });
});
