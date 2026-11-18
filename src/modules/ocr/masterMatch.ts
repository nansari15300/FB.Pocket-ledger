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
 *   name >= AUTO_NAME (0.5) AND hard proof        -> auto   (name + matching PAN/phone/address)
 *   name >= AUTO_NAME (0.5) AND proof == 0       -> suggest (shown, never silently filled)
 *   2+ candidates in the same band               -> pick   (user chooses)
 *   a strong alias/name match can auto-fill; a weak alias similarity is only a suggestion
 */
import { nameScore, namesOf } from "./fuzzy";
import { devanagariDigitsToAscii, normalizeName } from "./normalize";

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

export type PartyIdentityFields = { name?: string | null; pan?: string | null; phone?: string | null; address?: string | null };

/** Compare every identity field actually read from the bill; missing master data never counts as a match. */
export function matchPartyIdentity<T extends { name?: string; aliasName?: string; pan?: string; panNo?: string; vatNo?: string; phone?: string; mobile?: string; address?: string; billingAddress?: string }>(
  printed: PartyIdentityFields,
  pool: readonly T[],
): MasterMatchResult<T> {
  const digits = (s?: string | null) => String(s ?? "").replace(/\D/g, "");
  if (!pool.length) return { decision: "none", best: null, candidates: [], reason: "no selectable party masters" };
  const billPan = digits(printed.pan);
  if (billPan.length === 9) {
    const panHits = pool.filter((item) => [item.pan, item.panNo, item.vatNo].some((value) => digits(value) === billPan));
    const panCandidates = panHits.map((item) => ({ item, name: printed.name ? bestNameScore(printed.name, item).score : 0, proof: { score: 1, reasons: [`Exact PAN ${billPan}`] }, total: 1 }));
    if (panCandidates.length === 1) return { decision: "auto", best: panCandidates[0], candidates: [], reason: `unique exact PAN ${billPan}; overrides name/address score` };
    if (panCandidates.length > 1) return { decision: "pick", best: panCandidates[0], candidates: panCandidates.slice(0, 3), reason: `PAN ${billPan} is shared by multiple parties` };
  }
  const fields = [printed.name, printed.pan, printed.phone, printed.address].filter((v) => !!String(v ?? "").trim());
  if (!fields.length) return { decision: "none", best: null, candidates: [], reason: "no comparable party identity fields" };
  const threshold = fields.length <= 2 ? 0.9 : fields.length === 3 ? 0.8 : 0.7;
  const addressScore = (a?: string | null, b?: string) => {
    if (!a?.trim() || !b?.trim()) return 0;
    const numsA = addressNumbers(a);
    const numsB = addressNumbers(b);
    if (numsA.length && numsB.length && numsA.join(".") !== numsB.join(".")) return 0;
    const aTokens = new Set(tokens(a));
    const bTokens = new Set(tokens(b));
    if (!aTokens.size || !bTokens.size) return 0;
    let overlap = 0;
    aTokens.forEach((token) => { if (bTokens.has(token)) overlap += 1; });
    return overlap / new Set([...aTokens, ...bTokens]).size;
  };
  const rows = pool.map((item) => {
    const name = printed.name ? bestNameScore(printed.name, item).score : null;
    const masterPans = [item.pan, item.panNo, item.vatNo].map((v) => digits(v)).filter((v) => v.length >= 9);
    const pan = billPan ? (masterPans.includes(billPan) ? 1 : 0) : null;
    const billPhone = digits(printed.phone);
    const masterPhones = [item.phone, item.mobile].map((v) => digits(v)).filter((v) => v.length >= 7);
    const phone = billPhone ? (masterPhones.some((v) => v.slice(-10) === billPhone.slice(-10)) ? 1 : 0) : null;
    const address = printed.address
      ? Math.max(addressScore(printed.address, item.address), addressScore(printed.address, item.billingAddress))
      : null;
    const availableFields: Array<[string, number | null]> = [["Name", name], ["PAN", pan], ["Phone", phone], ["Address", address]];
    const fieldScores = availableFields.filter((entry): entry is [string, number] => entry[1] !== null);
    const scores = fieldScores.map(([, score]) => score);
    const matched = scores.filter((score) => score >= threshold).length;
    const partial = scores.filter((score) => score >= 0.5).length;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return { item, name: name ?? 0, proof: { score: matched / scores.length, reasons: fieldScores.map(([label, score]) => `${label} ${Math.round(score * 100)}%`) }, total: average, matched, partial, count: scores.length };
  }).sort((a, b) => b.matched - a.matched || b.partial - a.partial || b.total - a.total);
  const first = rows[0];
  if (!first || first.partial === 0) return { decision: "none", best: null, candidates: [], reason: `no party had a 50%+ match on a supplied field` };
  const qualifying = rows.filter((row) => row.matched === row.count);
  if (qualifying.length > 1 && qualifying[0].total - qualifying[1].total < TIE_GAP) {
    return { decision: "pick", best: qualifying[0], candidates: qualifying.slice(0, 3), reason: `multiple parties match all ${fields.length} supplied fields` };
  }
  if (fields.length === 1) return { decision: "suggest", best: qualifying[0] ?? first, candidates: [], reason: "one identity field only; confirm the suggested party" };
  if (qualifying.length === 1) return { decision: "auto", best: qualifying[0], candidates: [], reason: `all ${fields.length} supplied fields match at least ${Math.round(threshold * 100)}%` };
  if (qualifying.length > 1) return { decision: "auto", best: qualifying[0], candidates: [], reason: `best unique party matches all ${fields.length} supplied fields at least ${Math.round(threshold * 100)}%` };
  return { decision: "suggest", best: first, candidates: [], reason: `${first.matched}/${first.count} supplied fields meet ${Math.round(threshold * 100)}% (${first.proof.reasons.join(", ")})` };
}

/** Name band: below this the printed name is not considered the same party at all. */
export const AUTO_NAME = 0.5;
/** Above this a name is already trustworthy on its own (exact / one-letter typo). */
export const STRONG_NAME = 0.9;
/** Two candidates closer than this are a tie -> let the user pick. */
const TIE_GAP = 0.05;

const digits = (s?: string) => String(s ?? "").replace(/\D/g, "");
const norm = (s?: string) => normalizeName(String(s ?? ""));
const tokens = (s?: string) => norm(s).split(" ").filter((t) => t.length >= 3);
const addressNumbers = (s?: string) => (devanagariDigitsToAscii(String(s ?? "")).match(/\d+/g) ?? []);

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
  if (billPan.length >= 9 && masterPans.length) {
    if (masterPans.includes(billPan)) { score += 0.35; reasons.push(`PAN ${billPan}`); }
    else reasons.push("PAN conflict");
  }

  const billPhones = [digits(printed.phone)].filter((d) => d.length >= 7);
  const masterPhones = [digits(master.phone), digits(master.mobile)].filter((d) => d.length >= 7);
  if (billPhones.length && masterPhones.length) {
    if (masterPhones.some((m) => billPhones.some((b) => b.slice(-10) === m.slice(-10)))) {
      score += 0.25;
      reasons.push(`phone ${billPhones[0].slice(-10)}`);
    } else reasons.push("phone conflict");
  }

  const printedAddress = printed.address;
  const masterAddresses = [master.address, master.billingAddress].filter((x): x is string => !!x?.trim());
  const printedNumbers = addressNumbers(printedAddress);
  const addressNumberSets = masterAddresses.map(addressNumbers);
  const comparableNumberSets = addressNumberSets.filter((nums) => nums.length > 0);
  const addressNumberConflict = !!printedNumbers.length && comparableNumberSets.length > 0 &&
    !comparableNumberSets.some((nums) => printedNumbers.join(".") === nums.join("."));
  const compatibleAddresses = masterAddresses.filter((_, i) =>
    !printedNumbers.length || !addressNumberSets[i].length || printedNumbers.join(".") === addressNumberSets[i].join("."),
  );
  const addr = Math.max(...compatibleAddresses.map((address) => tokenOverlap(printedAddress, address)), 0);
  if (addressNumberConflict) reasons.push("address number conflict");
  else if (addr >= 0.5) { score += 0.15; reasons.push("address"); }

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
    // An alias is another spelling of the name, not independent identity evidence. A weak
    // 50% alias similarity must never turn a suggestion into an automatic account selection.
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
