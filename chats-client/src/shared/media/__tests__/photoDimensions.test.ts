import { displayDimensions } from '../photoDimensions';

/**
 * A camera photo stored as 1600 x 1200 pixels with an orientation tag.
 * The picker reports 1200 x 1600 (upright) for 6 and 8 and the raw
 * 1600 x 1200 otherwise; every orientation from 5 to 8 is shown portrait.
 */
const RAW = { width: 1600, height: 1200 };
const pickerReports = (orientation: number) =>
  orientation === 6 || orientation === 8 ? { width: RAW.height, height: RAW.width } : { ...RAW };

describe('displayDimensions', () => {
  it.each([1, 2, 3, 4])('orientation %i keeps the stored landscape size', (orientation) => {
    const p = pickerReports(orientation);
    expect(displayDimensions(p.width, p.height, orientation)).toEqual({ width: 1600, height: 1200 });
  });

  it.each([5, 6, 7, 8])('orientation %i is shown portrait, without swapping twice', (orientation) => {
    const p = pickerReports(orientation);
    expect(displayDimensions(p.width, p.height, orientation)).toEqual({ width: 1200, height: 1600 });
  });

  it('passes missing sizes through', () => {
    expect(displayDimensions(undefined, undefined, 6)).toEqual({ width: undefined, height: undefined });
  });
});
