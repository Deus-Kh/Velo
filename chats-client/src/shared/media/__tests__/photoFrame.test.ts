import { photoFrame } from '../photoFrame';

/** A typical Android phone window: 411 x 915 dp. */
const W = 411;
const H = 915;

describe('photoFrame', () => {
  it('a portrait 3:4 photo fills the width cap and keeps its shape', () => {
    expect(photoFrame({ width: 1200, height: 1600 }, W, H)).toEqual({ width: 295, height: 393 });
  });

  it('a tall 9:16 photo is bounded by the height cap', () => {
    expect(photoFrame({ width: 900, height: 1600 }, W, H)).toEqual({ width: 225, height: 400 });
  });

  it('a landscape 4:3 photo takes the full width', () => {
    expect(photoFrame({ width: 1600, height: 1200 }, W, H)).toEqual({ width: 295, height: 221 });
  });

  it('a panorama stops at the minimum height and is cropped, not a sliver', () => {
    expect(photoFrame({ width: 4000, height: 500 }, W, H)).toEqual({ width: 295, height: 100 });
  });

  it('a very tall strip stops at the minimum width', () => {
    expect(photoFrame({ width: 200, height: 4000 }, W, H).width).toBe(150);
  });

  it('wide windows (tablets) are capped; unknown sizes fall back to 4:3', () => {
    expect(photoFrame({ width: 1600, height: 1200 }, 1280, 800)).toEqual({ width: 320, height: 240 });
    expect(photoFrame({}, W, H)).toEqual({ width: 295, height: 221 });
  });
});
