import { describe, expect, it } from 'vitest';
import { followDuration, followTarget, manualScrollWait } from '../../src/features/teleprompter/scroll';

describe('teleprompter auto-follow', () => {
  const viewport = { scrollTop: 150, viewportHeight: 200, contentHeight: 1000 };

  it('keeps the current viewport until the active phrase passes the 65% trigger', () => {
    expect(followTarget({ ...viewport, activeTop: 86, activeBottom: 130 })).toBeNull();
    expect(followTarget({ ...viewport, activeTop: 130, activeBottom: 150 })).toBe(190);
  });

  it('keeps a confidently rejoined earlier phrase within view', () => {
    expect(followTarget({ ...viewport, activeTop: -10, activeBottom: 10 })).toBe(50);
  });

  it('clamps the target when resizing reduces available space to scroll', () => {
    expect(followTarget({ ...viewport, scrollTop: 790, activeTop: 150, activeBottom: 170 })).toBe(800);
    expect(followTarget({ ...viewport, viewportHeight: 1000, activeTop: 880, activeBottom: 940 })).toBeNull();
  });

  it('adjusts the trigger without moving a phrase that is already centered', () => {
    const phrase = { ...viewport, activeTop: 103, activeBottom: 121 };
    expect(followTarget(phrase, 1)).toBe(162);
    expect(followTarget(phrase, 0)).toBeNull();
    expect(followTarget({ ...viewport, activeTop: 90, activeBottom: 110 }, 1)).toBeNull();
  });

  it('waits four seconds from the most recent manual action', () => {
    expect(manualScrollWait(null, 1000)).toBe(0);
    expect(manualScrollWait(1000, 4999)).toBe(1);
    expect(manualScrollWait(1000, 5000)).toBe(0);
    expect(manualScrollWait(4800, 5000)).toBe(3800);
  });

  it('lengthens the transition for a larger distance or smoother setting', () => {
    expect(followDuration(1, -120)).toBeGreaterThan(followDuration(0, 120));
    expect(followDuration(0.5, 250)).toBeGreaterThan(followDuration(0.5, 20));
  });
});
