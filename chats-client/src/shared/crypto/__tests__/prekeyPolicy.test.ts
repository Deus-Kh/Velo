import {
  MAX_ONE_TIME_PREKEY_UPLOAD_BATCH,
  MIN_UNUSED_ONE_TIME_PREKEYS,
  TARGET_UNUSED_ONE_TIME_PREKEYS,
  TOP_UP_CHECK_INTERVAL_MS,
  computeTopUpCount,
  isTopUpCheckDue,
} from '../prekeyPolicy';

describe('computeTopUpCount', () => {
  it('does nothing while the pool is at or above the minimum', () => {
    expect(computeTopUpCount(MIN_UNUSED_ONE_TIME_PREKEYS)).toBe(0);
    expect(computeTopUpCount(500)).toBe(0);
  });

  it('refills up to the target below the minimum', () => {
    expect(computeTopUpCount(MIN_UNUSED_ONE_TIME_PREKEYS - 1)).toBe(
      TARGET_UNUSED_ONE_TIME_PREKEYS - (MIN_UNUSED_ONE_TIME_PREKEYS - 1),
    );
    expect(computeTopUpCount(0)).toBe(TARGET_UNUSED_ONE_TIME_PREKEYS);
  });

  it('never exceeds one upload batch', () => {
    expect(computeTopUpCount(0)).toBeLessThanOrEqual(MAX_ONE_TIME_PREKEY_UPLOAD_BATCH);
  });

  it('treats garbage as "nothing to do"', () => {
    expect(computeTopUpCount(Number.NaN)).toBe(0);
    expect(computeTopUpCount(-5)).toBe(0);
  });
});

describe('isTopUpCheckDue', () => {
  it('is due after the interval and not before', () => {
    expect(isTopUpCheckDue(0, TOP_UP_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isTopUpCheckDue(0, TOP_UP_CHECK_INTERVAL_MS)).toBe(true);
    expect(isTopUpCheckDue(1000, 1000 + TOP_UP_CHECK_INTERVAL_MS + 5)).toBe(true);
  });
});
