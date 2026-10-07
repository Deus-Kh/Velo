/**
 * The grid of a photo album (Telegram-style): photos in justified rows of
 * one to three that exactly fill the album width, with thin gaps. Each row
 * gets one height from its photos' aspect ratios (clamped, so a panorama or
 * a thin strip cannot squeeze its neighbours), capped so one row never gets
 * taller than 3/4 of the width; tiles crop with `cover`.
 */
export type AlbumTile = { x: number; y: number; width: number; height: number };

export const ALBUM_GAP = 2;
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 2;

/** Photos per row, top to bottom, for 2..10 photos. */
const ROWS: Record<number, number[]> = {
  2: [2],
  3: [1, 2],
  4: [2, 2],
  5: [2, 3],
  6: [3, 3],
  7: [1, 3, 3],
  8: [2, 3, 3],
  9: [3, 3, 3],
  10: [1, 3, 3, 3],
};

function rowsFor(count: number): number[] {
  if (ROWS[count]) return ROWS[count]!;
  const rows: number[] = [];
  for (let left = count; left > 0; left -= 3) rows.push(Math.min(3, left));
  return rows;
}

function aspect(size: { width?: number; height?: number }): number {
  const w = size.width && size.width > 0 ? size.width : 4;
  const h = size.height && size.height > 0 ? size.height : 3;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}

export function albumLayout(sizes: Array<{ width?: number; height?: number }>, width: number): { tiles: AlbumTile[]; height: number } {
  if (sizes.length === 0) return { tiles: [], height: 0 };
  const tiles: AlbumTile[] = [];
  const maxRowHeight = Math.round(width * 0.75);
  let y = 0;
  let next = 0;
  for (const perRow of rowsFor(sizes.length)) {
    const row = sizes.slice(next, next + perRow);
    next += perRow;
    const ratios = row.map(aspect);
    const sum = ratios.reduce((a, b) => a + b, 0);
    const free = width - ALBUM_GAP * (row.length - 1);
    const height = Math.min(maxRowHeight, Math.round(free / sum));
    let used = 0;
    ratios.forEach((ratio, i) => {
      const start = Math.round(used);
      used += (free * ratio) / sum;
      const end = Math.round(used);
      tiles.push({ x: start + i * ALBUM_GAP, y, width: end - start, height });
    });
    y += height + ALBUM_GAP;
  }
  return { tiles, height: y - ALBUM_GAP };
}
