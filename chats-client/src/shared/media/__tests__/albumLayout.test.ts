import { ALBUM_GAP, albumLayout } from '../albumLayout';

const PORTRAIT = { width: 1200, height: 1600 };
const LANDSCAPE = { width: 1600, height: 1200 };
const W = 295;

/** Every row of tiles spans the full width exactly, with one gap between neighbours, and rows do not overlap. */
function expectFilledRows(tiles: ReturnType<typeof albumLayout>['tiles'], width: number) {
  const rows = new Map<number, typeof tiles>();
  for (const t of tiles) rows.set(t.y, [...(rows.get(t.y) ?? []), t]);
  for (const row of rows.values()) {
    expect(row[0]!.x).toBe(0);
    for (let i = 1; i < row.length; i += 1) expect(row[i]!.x).toBe(row[i - 1]!.x + row[i - 1]!.width + ALBUM_GAP);
    const last = row[row.length - 1]!;
    expect(last.x + last.width).toBe(width);
  }
}

describe('albumLayout', () => {
  it('two portraits sit side by side at one height', () => {
    const { tiles, height } = albumLayout([PORTRAIT, PORTRAIT], W);
    expect(tiles).toEqual([
      { x: 0, y: 0, width: 147, height: 195 },
      { x: 149, y: 0, width: 146, height: 195 },
    ]);
    expect(height).toBe(195);
  });

  it('three photos: one across the top, two below', () => {
    const { tiles, height } = albumLayout([LANDSCAPE, PORTRAIT, PORTRAIT], W);
    expect(tiles[0]).toEqual({ x: 0, y: 0, width: 295, height: 221 });
    expect(tiles[1]!.y).toBe(221 + ALBUM_GAP);
    expect(height).toBe(tiles[2]!.y + tiles[2]!.height);
    expectFilledRows(tiles, W);
  });

  it('a tall photo alone on a row is capped at 3/4 of the width', () => {
    const { tiles } = albumLayout([PORTRAIT, LANDSCAPE, LANDSCAPE], W);
    expect(tiles[0]!.height).toBe(Math.round(W * 0.75));
    expect(tiles[0]!.width).toBe(W);
  });

  it('every size from 2 to 10 fills each row exactly, in order, without overlap', () => {
    for (let n = 2; n <= 10; n += 1) {
      const sizes = Array.from({ length: n }, (_, i) => (i % 2 ? PORTRAIT : LANDSCAPE));
      const { tiles, height } = albumLayout(sizes, W);
      expect(tiles).toHaveLength(n);
      expectFilledRows(tiles, W);
      const bottom = Math.max(...tiles.map((t) => t.y + t.height));
      expect(height).toBe(bottom);
    }
  });

  it('a panorama does not squeeze its neighbour into a sliver; unknown sizes count as 4:3', () => {
    const { tiles } = albumLayout([{ width: 6000, height: 500 }, PORTRAIT], W);
    expect(tiles[1]!.width).toBeGreaterThanOrEqual(80); // unclamped it would be ~27 px
    expect(albumLayout([{}, {}], W).tiles[0]!.height).toBe(albumLayout([LANDSCAPE, LANDSCAPE], W).tiles[0]!.height);
    expect(albumLayout([], W)).toEqual({ tiles: [], height: 0 });
  });
});
