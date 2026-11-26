/**
 * Where to scroll so a target is fully visible, or null when it already is.
 * The target's bottom ends up `margin` above the visible bottom, but the scroll
 * never goes past the target's top (minus margin) and never below 0.
 */
export function scrollTargetY({
  targetY,
  targetHeight,
  viewportHeight,
  currentY,
  margin,
}: {
  targetY: number;
  targetHeight: number;
  viewportHeight: number;
  currentY: number;
  margin: number;
}): number | null {
  const targetBottom = targetY + targetHeight;
  const topAlign = Math.max(0, targetY - margin);
  const visibleBottom = currentY + viewportHeight;

  if (targetY < currentY) return topAlign;
  if (targetBottom + margin <= visibleBottom) return null;
  return Math.min(Math.max(0, targetBottom + margin - viewportHeight), topAlign);
}
