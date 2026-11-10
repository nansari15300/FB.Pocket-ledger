import { normalizeName } from "./normalize";

/** Jaro-Winkler + token-set ratio (spec §5). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const md = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(b.length, i + md + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let p = 0;
  while (p < 4 && a[p] && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return (2 * inter) / (ta.size + tb.size);
}

/** Name + optional alias names (Alias Name master field), normalised by the caller. */
export function namesOf(t: { name: string; aliasName?: string; aliases?: readonly string[] }): string[] {
  return [t.name, t.aliasName ?? "", ...(t.aliases ?? [])].filter((x) => !!x && x.trim().length > 0);
}

export function nameScore(a: string, b: string): number {
  return Math.max(jaroWinkler(a, b), tokenSetRatio(a, b));
}

/** Best unique match: score ≥ min and gap to second ≥ gap. */
export function bestUniqueMatch<T>(
  query: string,
  pool: readonly T[],
  key: (t: T) => string | readonly string[],
  min: number,
  gap: number
): { item: T; score: number } | null {
  if (!query) return null;
  let best: { item: T; score: number } | null = null;
  let second = 0;
  for (const it of pool) {
    const k = key(it);
    const s = Math.max(0, ...(typeof k === "string" ? [k] : k).filter(Boolean).map((x) => nameScore(query, x)));
    if (!best || s > best.score) {
      if (best) second = Math.max(second, best.score);
      best = { item: it, score: s };
    } else second = Math.max(second, s);
  }
  if (!best || best.score < min || best.score - second < gap) return null;
  return best;
}

const SUGGEST = 0.6;

/** Token coverage: extra trailing master words allowed; shared prefix only is suggestion-level. */
export function tokenCoverageScore(query: string, candidate: string): number {
  const q = normalizeName(query).split(" ").filter(Boolean);
  const c = normalizeName(candidate).split(" ").filter(Boolean);
  if (!q.length || !c.length) return 0;
  let shared = 0;
  const n = Math.min(q.length, c.length);
  while (shared < n && q[shared] === c[shared]) shared++;
  if (shared === 0) return 0;
  // Bill fully covered; master may have a trailing suffix.
  if (shared === q.length && q.length <= c.length) {
    const cover = q.length / c.length;
    const enough = q.length === c.length || (q.length >= 3 && cover >= 0.7);
    return enough ? 1 : SUGGEST;
  }
  // Shared leading tokens but the bill has leftover words, or they diverge.
  return SUGGEST;
}
