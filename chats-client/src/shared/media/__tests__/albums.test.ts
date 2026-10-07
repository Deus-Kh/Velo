import { albumPlan, groupAlbumRuns } from '../albums';

describe('albumPlan', () => {
  const ids = () => {
    let n = 0;
    return () => `album${(n += 1)}`;
  };

  it('one photo has no album; several share one, in order', () => {
    expect(albumPlan(1, ids())).toEqual([undefined]);
    expect(albumPlan(3, ids())).toEqual([
      { id: 'album1', index: 0, count: 3 },
      { id: 'album1', index: 1, count: 3 },
      { id: 'album1', index: 2, count: 3 },
    ]);
  });

  it('more than ten photos make albums of ten; a single leftover goes alone', () => {
    const plan = albumPlan(11, ids());
    expect(plan.slice(0, 10).every((a) => a?.id === 'album1' && a.count === 10)).toBe(true);
    expect(plan[10]).toBeUndefined();
    const twelve = albumPlan(12, ids());
    expect(twelve[10]).toEqual({ id: 'album2', index: 0, count: 2 });
  });

  it('the default ids are random hex', () => {
    const [a] = albumPlan(2);
    const [b] = albumPlan(2);
    expect(a!.id).toMatch(/^[0-9a-f]{16}$/);
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('groupAlbumRuns', () => {
  type M = { id: string; key: string | null; index: number };
  const m = (id: string, key: string | null, index = 0): M => ({ id, key, index });
  const group = (items: M[]) => groupAlbumRuns(items, (x) => x.key, (x) => x.index).map((x) => (Array.isArray(x) ? x.map((y) => y.id) : x.id));

  it('neighbours with one key become one run, sorted by album index', () => {
    expect(group([m('t1', null), m('p2', 'A', 1), m('p1', 'A', 0), m('p3', 'A', 2), m('t2', null)])).toEqual(['t1', ['p1', 'p2', 'p3'], 't2']);
  });

  it('a lone album photo stays single; a message in between splits the album; two albums next to each other stay apart', () => {
    expect(group([m('p1', 'A', 0)])).toEqual(['p1']);
    expect(group([m('p1', 'A', 0), m('t', null), m('p2', 'A', 1), m('p3', 'A', 2)])).toEqual(['p1', 't', ['p2', 'p3']]);
    expect(group([m('a1', 'A', 0), m('a2', 'A', 1), m('b1', 'B', 0), m('b2', 'B', 1)])).toEqual([['a1', 'a2'], ['b1', 'b2']]);
  });
});

describe('album summaries', () => {
  const { albumStatus, mergeReactionSummaries, albumKeyOf } = require('../albums') as typeof import('../albums');

  it('status: failed wins, then sending, else the least advanced', () => {
    expect(albumStatus(['read', 'failed', 'sent'])).toBe('failed');
    expect(albumStatus(['read', 'sending'])).toBe('sending');
    expect(albumStatus(['read', 'delivered', 'read'])).toBe('delivered');
    expect(albumStatus(['read', 'read'])).toBe('read');
    expect(albumStatus([undefined, undefined])).toBeUndefined();
  });

  it('reactions on different photos are counted together', () => {
    expect(
      mergeReactionSummaries([
        [{ emoji: '+', count: 1, mine: false }],
        [
          { emoji: '+', count: 2, mine: true },
          { emoji: '!', count: 1, mine: false },
        ],
      ]),
    ).toEqual([
      { emoji: '+', count: 3, mine: true },
      { emoji: '!', count: 1, mine: false },
    ]);
  });

  it('only live album photos get a key, per sender', () => {
    const photo = { contentType: 'image/jpeg', album: { id: 'A' } };
    expect(albumKeyOf({ mine: true, attachment: photo })).toBe('me:A');
    expect(albumKeyOf({ mine: false, senderKey: 'u1', attachment: photo })).toBe('u1:A');
    expect(albumKeyOf({ mine: true, attachment: photo, deletedAt: 5 })).toBeNull();
    expect(albumKeyOf({ mine: true, attachment: { contentType: 'audio/mp4', album: { id: 'A' } } })).toBeNull();
    expect(albumKeyOf({ mine: true, attachment: { contentType: 'image/jpeg' } })).toBeNull();
  });
});
