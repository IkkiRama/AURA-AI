export const MANUAL_SCROLL_COOLDOWN_MS = 4_000;
export const AUTO_FOLLOW_INTERVAL_MS = 320;
export const AUTO_FOLLOW_CONFIDENCE = 0.72;

interface FollowGeometry {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  activeTop: number;
  activeBottom: number;
}

export function followTarget(geometry: FollowGeometry, sensitivity = 0.5): number | null {
  const { scrollTop, viewportHeight, contentHeight, activeTop, activeBottom } = geometry;
  const maximum = contentHeight - viewportHeight;
  if (viewportHeight <= 0 || maximum <= 1) return null;

  const trigger = 0.72 - Math.min(1, Math.max(0, sensitivity)) * 0.14;
  const belowComfort = activeBottom / viewportHeight > trigger + Number.EPSILON;
  const aboveViewport = activeBottom < viewportHeight * 0.22;
  if (!belowComfort && !aboveViewport) return null;

  const activeMiddle = (activeTop + activeBottom) / 2;
  const target = Math.min(maximum, Math.max(0, scrollTop + activeMiddle - viewportHeight * 0.5));
  return Math.abs(target - scrollTop) >= 2 ? target : null;
}

export function manualScrollWait(lastInteraction: number | null, now: number): number {
  return lastInteraction === null ? 0 : Math.max(0, lastInteraction + MANUAL_SCROLL_COOLDOWN_MS - now);
}

export function followDuration(smoothness: number, distance: number): number {
  const preference = Math.min(1, Math.max(0, smoothness));
  return 125 + preference * 170 + Math.min(160, Math.abs(distance) * 0.32);
}
