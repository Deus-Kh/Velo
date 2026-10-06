import nacl from 'tweetnacl';
import { MAX_ALBUM_SIZE, type AttachmentAlbum } from '@velo/protocol';

function randomAlbumId(): string {
  return Array.from(nacl.randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The album tag for each of `count` photos picked together: albums of at
 * most MAX_ALBUM_SIZE, in order; a single photo (alone, or left over after
 * full albums) is sent without one.
 */
export function albumPlan(count: number, newId: () => string = randomAlbumId): Array<AttachmentAlbum | undefined> {
  const out: Array<AttachmentAlbum | undefined> = [];
  for (let start = 0; start < count; start += MAX_ALBUM_SIZE) {
    const size = Math.min(MAX_ALBUM_SIZE, count - start);
    if (size < 2) {
      out.push(undefined);
      continue;
    }
    const id = newId();
    for (let index = 0; index < size; index += 1) out.push({ id, index, count: size });
  }
  return out;
}

/**
 * Splits a chronological list into single items and album runs: neighbours
 * with the same non-null key (sender + album id) form one run of two or
 * more, ordered by their album index. Anything between two photos of an
 * album ends the run, so a reply in the middle shows the album in two parts.
 */
export function groupAlbumRuns<T>(items: T[], keyOf: (item: T) => string | null, indexOf: (item: T) => number): Array<T | T[]> {
  const out: Array<T | T[]> = [];
  let run: T[] = [];
  let runKey: string | null = null;
  const flush = () => {
    if (run.length >= 2) out.push([...run].sort((a, b) => indexOf(a) - indexOf(b)));
    else if (run.length === 1) out.push(run[0]!);
    run = [];
    runKey = null;
  };
  for (const item of items) {
    const key = keyOf(item);
    if (key !== null && key === runKey) {
      run.push(item);
      continue;
    }
    flush();
    if (key !== null) {
      run = [item];
      runKey = key;
    } else {
      out.push(item);
    }
  }
  flush();
  return out;
}

type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | undefined;
const DELIVERY_RANK: Record<'sent' | 'delivered' | 'read', number> = { sent: 0, delivered: 1, read: 2 };

/** One status for an album: failed if any photo failed, sending while any is in flight, else the least advanced. */
export function albumStatus(statuses: DeliveryStatus[]): DeliveryStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('sending')) return 'sending';
  const known = statuses.filter((s): s is 'sent' | 'delivered' | 'read' => s === 'sent' || s === 'delivered' || s === 'read');
  if (known.length === 0) return undefined;
  return known.reduce((low, s) => (DELIVERY_RANK[s] < DELIVERY_RANK[low] ? s : low));
}

/** The reactions on all photos of an album, counted together per emoji. */
export function mergeReactionSummaries(lists: Array<Array<{ emoji: string; count: number; mine: boolean }>>): Array<{ emoji: string; count: number; mine: boolean }> {
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const list of lists) {
    for (const r of list) {
      const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += r.count;
      cur.mine = cur.mine || r.mine;
      byEmoji.set(r.emoji, cur);
    }
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}

/**
 * The run key of a message for groupAlbumRuns: a photo that is part of an
 * album, not deleted, keyed by its sender and album id; anything else null.
 */
export function albumKeyOf(message: {
  mine: boolean;
  senderKey?: string | null;
  system?: boolean;
  deletedAt?: number | null;
  attachment?: { contentType: string; album?: { id: string } } | null;
}): string | null {
  const a = message.attachment;
  if (!a?.album || message.system || message.deletedAt || !/^image\//.test(a.contentType)) return null;
  return `${message.mine ? 'me' : (message.senderKey ?? 'peer')}:${a.album.id}`;
}
