/**
 * Proof-weighted master matching for OCR.
 *
 * A name alone is never enough: OCR misreads short shop names constantly, and "Ram Store" vs
 * "Ram Traders" is a ~65% string match with zero evidence they are the same party. So every
 * candidate gets two independent numbers:
 *   - name  : how close the printed name is to the master name / alias (0..1)
 *   - proof : supporting fields that cannot collide by accident (PAN, phone, address tokens,
 *             bank + branch). 0 when the master has none of them.
 *
 * Decision:
 *   name >= AUTO_NAME (0.5) AND proof > 0        -> auto   (name + something that proves it)
 *   name >= AUTO_NAME (0.5) AND proof == 0       -> suggest (shown, never silently filled)
 *   2+ candidates in the same band               -> pick   (user chooses)
 *   strong family match (alias/PAN/phone exact)  -> auto, even above the name band
 */
import { nameScore, namesOf } from "./fuzzy";
import { normalizeName } from "./normalize";

export type MasterMatchProof = {
  score: number;
  /** Human-readable evidence, shown on the field badge and in the bubble ("alias", "PAN 301234567"). */
  reasons: string[];
};

export type MasterMatchDecision = "auto" | "suggest" | "pick" | "none";

export type MasterMatchCandidate<T> = {
  item: T;
  /** 0..1 how close the printed name is. */
  name: number;
  proof: MasterMatchProof;
  /** name + capped proof bonus — ordering only, never used as "confidence" by itself. */
  total: number;
};

export type MasterMatchResult<T> = {
  decision: MasterMatchDecision;
  /** Top candidate (auto/suggest), for pick it is the first of `candidates`. */
  best: MasterMatchCandidate<T> | null;
  /** Runner-up band members — non-empty only when `decision === "pick"`. */
  candidates: MasterMatchCandidate<T>[];
  reason: string;
};

/** Name band: below this the printed name is not considered the same party at all. */
export const AUTO_NAME = 0.5;
/** Above this a name is already trustworthy on its own (exact / one-letter typo). */
export const STRONG_NAME = 0.9;
/** Two candidates closer than this are a tie -> let the user pick. */
const TIE_GAP = 0.05;

const digits = (s?: string) => String(s ?? "").replace(/\D/g, "");
const norm = (s?: string) => normalizeName(String(s ?? ""));
const tokens = (s?: string) => norm(s).split(" ").filter((t) => t.length >= 3);

/** Shared significant words between two free-text values (address / name). 0..1 of the shorter side. */
export function tokenOverlap(a?: string, b?: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((t) => { if (B.has(t)) hit += 1; });
  return hit / Math.min(A.size, B.size);
}

/** Name score across name + alias (alias wins if it is closer — OCR often prints the local name). */
export function bestNameScore(printed: string, master: { name?: string; aliasName?: string }): { score: number; by: "name" | "alias" | null } {
  if (!printed) return { score: 0, by: null };
  const q = normalizeName(printed);
  const n = master.name ? nameScore(q, normalizeName(master.name)) : 0;
  const a = master.aliasName ? nameScore(q, normalizeName(master.aliasName)) : 0;
  if (a > n) return { score: a, by: "alias" };
  return { score: n, by: n > 0 ? "name" : null };
}

/**
 * Party proof: PAN, phone, address words and the local alias.
 * PAN/phone are hard evidence (they cannot coincidentally collide), address is soft.
 */
export function partyProof(
  printed: { pan?: string | null; phone?: string | null; address?: string | null; name?: string | null },
  master: { name?: string; aliasName?: string; pan?: string; panNo?: string; vatNo?: string; phone?: string; mobile?: string; address?: string; billingAddress?: string },
): MasterMatchProof {
  let score = 0;
  const reasons: string[] = [];
  const billPan = digits(printed.pan);
  const masterPans = [digits(master.pan), digits(master.panNo), digits(master.vatNo)].filter((d) => d.length >= 9);
  if (billPan.length >= 9 && masterPans.includes(billPan)) { score += 0.35; reasons.push(`PAN ${billPan}`); }

  const billPhones = [digits(printed.phone)].filter((d) => d.length >= 7);
  const masterPhones = [digits(master.phone), digits(master.mobile)].filter((d) => d.length >= 7);
  if (billPhones.length && masterPhones.some((m) => billPhones.some((b) => b.slice(-10) === m.slice(-10)))) {
    score += 0.25;
    reasons.push(`phone ${billPhones[0].slice(-10)}`);
  }

  const addr = Math.max(tokenOverlap(printed.address, master.address), tokenOverlap(printed.address, master.billingAddress));
  if (addr >= 0.5) { score += 0.15; reasons.push("address"); }

  // The local alias is a name field, so it counts as name evidence — but it is also printed-only-on-bills
  // evidence (e.g. Nepali alias vs English master name), worth boosting next to an average name match.
  if (master.aliasName && printed.name) {
    const a = nameScore(normalizeName(printed.name), normalizeName(master.aliasName));
    if (a >= 0.85) { score += 0.3; reasons.push("alias"); }
  }
  return { score: Math.min(1, score), reasons };
}

/** Own bank/cash proof: account number (masked or full) and bank + branch. */
export function accountProof(
  printed: { accountNumber?: string | null; bankName?: string | null; branch?: string | null },
  master: { accountNumber?: string; bankName?: string; branch?: string },
): MasterMatchProof {
  let score = 0;
  const reasons: string[] = [];
  const p = digits(printed.accountNumber);
  const m = digits(master.accountNumber);
  if (p.length >= 4 && m.length >= 4 && (p === m || m.endsWith(p) || p.endsWith(m.slice(-4)))) {
    score += 0.4; reasons.push(`A/c ${printed.accountNumber}`);
  }
  const bankOk = !!printed.bankName && !!master.bankName && bankNameWords(printed.bankName) === bankNameWords(master.bankName);
  const brOk = !!printed.branch && !!master.branch && tokenOverlap(printed.branch, master.branch) >= 0.5;
  if (bankOk && brOk) { score += 0.2; reasons.push("bank + branch"); }
  else if (bankOk) { score += 0.1; reasons.push("bank"); }
  return { score: Math.min(1, score), reasons };
}

function bankNameWords(s: string): string {
  return norm(s).replace(/\b(limited|ltd|pvt|private|the)\b/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Rank a pool and decide auto / suggest / pick / none.
 * `proofOf` returns what the master can prove against the printed document (empty when it has no such fields).
 */
export function matchMasters<T>(
  printedName: string,
  pool: readonly T[],
  names: (t: T) => string | readonly string[],
  proofOf: (t: T) => MasterMatchProof,
): MasterMatchResult<T> {
  if (!printedName.trim() || !pool.length) return { decision: "none", best: null, candidates: [], reason: "no printed name" };
  const q = normalizeName(printedName);
  const scored: MasterMatchCandidate<T>[] = pool.map((item) => {
    const raw = names(item);
    const keys: readonly string[] = typeof raw === "string" ? [raw] : raw;
    let name = 0;
    let aliasHit = false;
    keys.forEach((k, i) => {
      if (!k) return;
      const s = nameScore(q, normalizeName(k));
      if (s > name) { name = s; aliasHit = i > 0; }
    });
    const proof = proofOf(item);
    if (aliasHit && proof.reasons.indexOf("alias") === -1) proof.reasons.push("alias");
    if (aliasHit && proof.score === 0) proof.score = 0.3;
    // Ordering: a 0.55 name with a PAN beats a 0.8 name with nothing.
    const total = name + Math.min(0.45, proof.score) * 0.75;
    return { item, name, proof: { ...proof, score: Math.min(1, proof.score) }, total };
  }).sort((a, b) => b.total - a.total);

  const top = scored[0];
  // Hard evidence anywhere in the pool (PAN / phone / account no.) wins outright.
  const hard = scored.find((c) => c.proof.score >= 0.3 && c.proof.reasons.some((r) => /^(PAN|phone|A\/c)/.test(r)));
  if (hard) {
    const rivals = scored.filter((c) => c !== hard && c.total >= hard.total - TIE_GAP && c.proof.score > 0);
    if (rivals.length) return { decision: "pick", best: hard, candidates: [hard, ...rivals].slice(0, 3), reason: `several masters share the evidence (${hard.proof.reasons.join(", ")})` };
    return { decision: "auto", best: hard, candidates: [], reason: `${Math.round(hard.name * 100)}% name + ${hard.proof.reasons.join(", ")}` };
  }

  // Nothing below the name band is the same party, however the ordering looks.
  const band = scored.filter((c) => c.name >= AUTO_NAME);
  if (!band.length) return { decision: "none", best: null, candidates: [], reason: `best name match only ${Math.round(top.name * 100)}%` };

  const first = band[0];
  const tied = band.filter((c) => c.total >= first.total - TIE_GAP);
  if (tied.length > 1) return { decision: "pick", best: first, candidates: tied.slice(0, 3), reason: `${tied.length} masters match ${Math.round(first.name * 100)}%+` };

  if (first.proof.score > 0 || first.name >= STRONG_NAME) {
    const why = first.proof.reasons.length ? `${Math.round(first.name * 100)}% name + ${first.proof.reasons.join(", ")}` : `${Math.round(first.name * 100)}% name (near exact)`;
    return { decision: "auto", best: first, candidates: [], reason: why };
  }
  // 50-90% on the name alone: show it, let the user confirm — never fill silently.
  return { decision: "suggest", best: first, candidates: [], reason: `${Math.round(first.name * 100)}% name match only (no PAN / phone / address / alias evidence)` };
}

/** Short badge text for a suggestion ("Low match 62%"), null for a confident auto-fill. */
export function matchBadge(r: MasterMatchResult<unknown>): string | null {
  if (r.decision !== "suggest" || !r.best) return null;
  return `Low match ${Math.round(r.best.name * 100)}%`;
}

export { namesOf };
