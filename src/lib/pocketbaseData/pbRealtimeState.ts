/** Tiny shared flag so udoc poll can skip while SSE is up — no import cycle with pbSync. */

let live = false;

export function setPocketBaseRealtimeLive(value: boolean): void {
  live = value === true;
}

export function isPocketBaseRealtimeLive(): boolean {
  return live;
}
