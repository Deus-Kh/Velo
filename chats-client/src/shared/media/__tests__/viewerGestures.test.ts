import { classifySwipe, lockAxis, pageAfterSwipe } from '../viewerGestures';

const screen = { width: 411, height: 915 };

describe('viewer gestures', () => {
  it('nothing is decided before the finger has moved a little (the first update can be empty)', () => {
    expect(lockAxis(0, 0)).toBeNull();
    expect(lockAxis(-6, 2)).toBeNull();
    expect(lockAxis(-12, 2)).toBe('horizontal');
  });

  it('the first clear movement locks the direction', () => {
    expect(lockAxis(20, 5)).toBe('horizontal');
    expect(lockAxis(-20, 5)).toBe('horizontal');
    expect(lockAxis(5, 20)).toBe('vertical');
    expect(lockAxis(4, -30)).toBe('vertical');
  });

  it('sideways: far enough or a quick flick changes the photo; a short slow drag stays', () => {
    const h = { axis: 'horizontal' as const, dy: 0, vy: 0, ...screen };
    expect(classifySwipe({ ...h, dx: -100, vx: 0 })).toBe('next');
    expect(classifySwipe({ ...h, dx: 100, vx: 0 })).toBe('previous');
    expect(classifySwipe({ ...h, dx: -40, vx: -900 })).toBe('next');
    expect(classifySwipe({ ...h, dx: -40, vx: 0 })).toBe('stay');
    expect(classifySwipe({ ...h, dx: -40, vx: 900 })).toBe('stay'); // flicked back against the drag
  });

  it('up or down: far enough or a quick flick closes; a small move springs back', () => {
    const v = { axis: 'vertical' as const, dx: 0, vx: 0, ...screen };
    expect(classifySwipe({ ...v, dy: 140, vy: 0 })).toBe('dismiss');
    expect(classifySwipe({ ...v, dy: -140, vy: 0 })).toBe('dismiss');
    expect(classifySwipe({ ...v, dy: 40, vy: 1200 })).toBe('dismiss');
    expect(classifySwipe({ ...v, dy: 60, vy: 0 })).toBe('stay');
  });

  it('pages stop at both ends', () => {
    expect(pageAfterSwipe(0, 3, 'next')).toBe(1);
    expect(pageAfterSwipe(2, 3, 'next')).toBe(2);
    expect(pageAfterSwipe(0, 3, 'previous')).toBe(0);
    expect(pageAfterSwipe(1, 3, 'stay')).toBe(1);
  });
});
