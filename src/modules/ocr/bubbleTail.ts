/** Pure helpers for OCR field-bubble tails (no DOM). */

export const MIN_VISIBLE_OCR_TAIL_PX = 16;

/** Keep a visible tail when the bubble sits very close to its field (do not drop short tails). */
export function stretchOcrTailTip(
  attach: { x: number; y: number },
  tip: { x: number; y: number },
  fallbackDir: { x: number; y: number },
  minLen = MIN_VISIBLE_OCR_TAIL_PX,
): { tip: { x: number; y: number }; length: number } {
  const dx0 = tip.x - attach.x;
  const dy0 = tip.y - attach.y;
  let length = Math.hypot(dx0, dy0);
  if (length >= minLen) return { tip, length };
  let dx = dx0;
  let dy = dy0;
  if (length < 0.5) {
    dx = fallbackDir.x;
    dy = fallbackDir.y;
    length = Math.hypot(dx, dy);
  }
  const L = length || 1;
  return {
    tip: { x: attach.x + (dx / L) * minLen, y: attach.y + (dy / L) * minLen },
    length: minLen,
  };
}

/** Tails only when the target field itself is on screen (not the OCR-bar fallback). */
export function shouldDrawOcrBubbleTail(fieldFoundOnScreen: boolean): boolean {
  return fieldFoundOnScreen;
}
