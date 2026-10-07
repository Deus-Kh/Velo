/**
 * The decisions of the photo viewer's drag (ImageViewer), as worklets so
 * they run on the UI thread, and plain functions so they can be tested.
 */
export type SwipeAxis = 'horizontal' | 'vertical';
export type SwipeOutcome = 'next' | 'previous' | 'dismiss' | 'stay';

/** How far the finger must move before the drag picks its direction. */
export const AXIS_LOCK_DISTANCE = 10;

/**
 * The first clear movement decides the direction of the whole drag; until
 * the finger has moved AXIS_LOCK_DISTANCE nothing is decided (null). The
 * gesture's first update can carry almost no movement, and deciding on that
 * locked sideways swipes as vertical.
 */
export function lockAxis(dx: number, dy: number): SwipeAxis | null {
  'worklet';
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_DISTANCE) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/**
 * What a released drag does. Sideways: a page change after a fifth of the
 * width (at least 72 dp) or a quick flick of 36 dp. Up or down: closing
 * after an eighth of the height (at least 100 dp) or a quick flick of 30 dp.
 */
export function classifySwipe(p: { axis: SwipeAxis; dx: number; dy: number; vx: number; vy: number; width: number; height: number }): SwipeOutcome {
  'worklet';
  if (p.axis === 'horizontal') {
    const far = Math.abs(p.dx) > Math.max(72, p.width * 0.18);
    const flick = Math.abs(p.vx) > 650 && Math.abs(p.dx) > 36 && Math.sign(p.vx) === Math.sign(p.dx);
    if (!far && !flick) return 'stay';
    return p.dx < 0 ? 'next' : 'previous';
  }
  const far = Math.abs(p.dy) > Math.max(100, p.height * 0.12);
  const flick = Math.abs(p.vy) > 900 && Math.abs(p.dy) > 30 && Math.sign(p.vy) === Math.sign(p.dy);
  return far || flick ? 'dismiss' : 'stay';
}

/** The photo shown after a sideways swipe; the ends do not wrap around. */
export function pageAfterSwipe(current: number, count: number, outcome: SwipeOutcome): number {
  'worklet';
  if (outcome === 'next') return Math.min(current + 1, count - 1);
  if (outcome === 'previous') return Math.max(current - 1, 0);
  return current;
}
