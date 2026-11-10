/**
 * Nepali (Devanagari-labelled) bills -> canonical English-labelled lines for the bill parser.
 *
 * Handles the common hand-filled / printed "कर बिजक" layout:
 *   कारोबार मिति / बिजक जारी मिति (BS date), बिजक नं. (bill no), करदाता दर्ता नं (seller PAN),
 *   क्रेताको नाम (buyer), क्रेताको पान नं. (buyer PAN, may continue on the next line), ठेगाना (address),
 *   item table (क्र.सं. / विवरण / परिमाण / प्रति एकाइ मुल्य / जम्मा रकम, रु. + पै. columns),
 *   जम्मा, प्रतिशले छुट, कर लाग्ने मुल्य, १३ प्रतिशत कर, कुल जम्मा, अक्षरेपी (amount in words).
 *
 * Rupee + paisa columns come out as one digit string ("4424779") or "44247 79". The scale (x1 or /100) is
 * decided by: amount in words == grand total, then the paisa (पै) column header, then the totals reconciling
 * (taxable * 13% = VAT, taxable + VAT - discount = total).
 *
 * Input lines should already be re-joined (`joinSpacedLine`) when Vision returned spaced characters.
 */
import { devanagariDigits } from "./devanagariJoin";

export type NepaliBillCanon = { lines: string[]; applied: boolean; notes: string[] };

const sq = (s: string) => s.replace(/\s+/g, "");
const NUM_ONLY = /^\d[\d,]*(?:[.\s]\d{1,2})?\.?$/;

const L = {
  dateAny: /(?:कारोबार|बिजक\s*जारी|बीजक\s*जारी|जारी|बिल)?\s*मिति\s*:?\s*/,
  date: /मिति\s*:?\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,2})/g,
  buyerPan: /क्रेता\s*को\s*(?:पान|प्यान|स्थायी\s*लेखा|भ्याट)\s*(?:नं|नम्बर)?\s*\.?\s*:?/,
  sellerPan: /(?:करदाता\s*दर्ता|स्थायी\s*लेखा|पान|प्यान|भ्याट)\s*(?:नं|नम्बर)\s*\.?\s*:?/,
  buyerName: /क्रेता\s*को\s*नाम\s*:?/,
  address: /ठेगाना\s*:?/,
  payMode: /भुक्तानी\s*को\s*तरिका\s*:?/,
  billNo: /(?:बिजक|बीजक|बिल|विजक)\s*(?:नं|नम्बर|सं)\s*\.?\s*:?/,
  words: /अक्षरे?\s*पी\s*(?:रु)?\s*\.?\s*:?|अक्षरमा\s*:?/,
  grand: /^कुल\s*जम्मा\s*(?:रकम)?/,
  discount: /(?:प्रतिशले\s*)?छु[टट]/,
  taxable: /कर\s*लाग्ने\s*मु?ू?ल्य|करयोग्य\s*(?:रकम|मूल्य)?/,
  vat: /(\d{1,2})\s*प्रतिशत\s*(?:मू\.?\s*अ\.?\s*)?कर|मू\.?\s*अ\.?\s*कर/,
  subTotal: /^जम्मा\s*(?:रकम)?\s*$|^जम्मा\s*(?=\d)/,
  sign: /सही\s*$|भू?ुल\s*चुक|^वि?क्रेता\s*को\s*$/,
  title: /^कर\s*[बव]ी?ि?जक$|^बिजक$/,
  head: /^(?:क्र\s*\.?\s*सं\s*\.?|एच\s*\.?\s*एस\s*\.?|कोड|विवरण|परिमाण|प्रति\s*एका[ईइ]|मु?ू?ल्य\s*रु|रु\s*\.?\s*पै|दर|रकम|इकाई)/,
  unit: /^(?:p[ce]s|pcs?|nos?|kgs?|ltrs?|sets?|box|bags?|पिस|थान|केजी|लिटर)\.?$/i,
};

/** Number words in an "amount in words" line (handles run-together text "Fiftythousandonly"). */
export function amountFromWords(text: string): number | null {
  const W: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const M: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, crore: 10000000 };
  const keys = [...Object.keys(W), ...Object.keys(M)].sort((a, b) => b.length - a.length);
  const s = text.toLowerCase().replace(/[^a-z]/g, "");
  let total = 0;
  let cur = 0;
  let hits = 0;
  for (let i = 0; i < s.length; ) {
    const k = keys.find((x) => s.startsWith(x, i));
    if (!k) { i++; continue; }
    hits++;
    i += k.length;
    if (k in W) cur += W[k];
    else if (M[k] === 100) cur = (cur || 1) * 100;
    else { total += (cur || 1) * M[k]; cur = 0; }
  }
  const v = total + cur;
  return hits && v > 0 ? v : null;
}

type RawNum = { raw: string; explicit: number | null; digits: number };
function rawNum(s: string): RawNum | null {
  const t = devanagariDigits(s).trim().replace(/\.$/, "");
  if (/^\d[\d,]*[.,]\d{2}$/.test(t)) return { raw: t, explicit: Number(t.replace(/,(?=\d{2}$)/, ".").replace(/,/g, "")), digits: 0 };
  if (/^\d+\s\d{2}$/.test(t)) return { raw: t, explicit: Number(t.replace(" ", ".")), digits: 0 };
  if (/^\d[\d,]*$/.test(t)) return { raw: t, explicit: null, digits: Number(t.replace(/,/g, "")) };
  return null;
}
const val = (n: RawNum | null | undefined, scale: number) => (n == null ? null : n.explicit ?? n.digits / scale);
const money = (n: number) => n.toFixed(2);

/** Canonicalize when at least 3 Nepali bill labels are present; otherwise `applied: false` and lines unchanged. */
export function canonicalizeNepaliBill(input: string[]): NepaliBillCanon {
  const lines = input.map((l) => devanagariDigits(l).replace(/\s+/g, " ").trim()).filter(Boolean);
  const notes: string[] = [];
  const labelHits = [L.buyerName, L.billNo, L.grand, L.taxable, L.vat, L.buyerPan, L.date, L.sellerPan].filter((re) => {
    re.lastIndex = 0;
    return lines.some((l) => re.test(l) || re.test(sq(l)));
  }).length;
  L.date.lastIndex = 0;
  if (labelHits < 3) return { lines: input, applied: false, notes };

  const top: string[] = [];
  let title = false;
  let billNo = "";
  let date = "";
  let sellerPan = "";
  let buyer = "";
  let address = "";
  let buyerPan = "";
  let payMode = "";
  let words = "";
  let paisaCol = false;
  let vatRate = 13;
  const tot: Partial<Record<"sub" | "disc" | "taxable" | "vat" | "grand", RawNum>> = {};
  const itemLines: string[] = [];
  let inTable = false;
  let tableDone = false;

  const nextNumber = (i: number): { n: RawNum; used: number } | null => {
    const nx = lines[i + 1];
    if (nx && NUM_ONLY.test(nx)) { const n = rawNum(nx); if (n) return { n, used: 1 }; }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const c = sq(l);
    if (/^[-–—_.]+$/.test(l)) continue;
    if (L.title.test(c)) { title = true; continue; }
    if (L.sign.test(c)) continue;

    // dates (may sit at the end of the address line)
    L.date.lastIndex = 0;
    if (/मिति/.test(l)) {
      const ds = [...l.matchAll(L.date)].map((m) => m[1].replace(/\s+/g, ""));
      if (!date && ds[0]) date = ds[0];
      const prefix = l.split(/(?:कारोबार|बिजक\s*जारी|बीजक\s*जारी|जारी|बिल)?\s*मिति/)[0].replace(/(?:कारोबार|बिजक|जारी)\s*$/, "").replace(/[\s,:;-]+$/, "").trim();
      // "...सुनसरीकारोबारमिति" (joined): strip the glued label word from the address
      const pre = prefix.replace(/(?:कारोबार|बिजकजारी|जारी)$/, "").trim();
      if (pre && !inTable) top.push(pre);
      continue;
    }
    if (L.buyerPan.test(l) || L.buyerPan.test(c)) {
      let d = l.replace(L.buyerPan, "").replace(/\D/g, "");
      let k = i;
      while (d.length < 9 && lines[k + 1] && /^\d[\d\s-]*$/.test(lines[k + 1])) { d += lines[k + 1].replace(/\D/g, ""); k++; }
      if (k > i) notes.push(`buyer PAN joined across ${k - i + 1} lines`);
      i = k;
      buyerPan = d;
      continue;
    }
    if (L.buyerName.test(l) || L.buyerName.test(c)) { buyer = l.replace(/^.*?नाम\s*:?\s*/, "").replace(/[\s.,:;-]+$/, ""); continue; }
    if (L.address.test(l)) { address = l.replace(/^.*?ठेगाना\s*:?\s*/, "").replace(/[\s.,:;-]+$/, ""); continue; }
    if (L.payMode.test(l) || L.payMode.test(c)) {
      const v = l.replace(/^.*?तरिका\s*:?\s*/, "").trim();
      // printed choices "नगद / चेक / उधारो / अन्य" (none ticked in text) carry no value
      if (v && !/\//.test(v)) payMode = v;
      continue;
    }
    if (L.billNo.test(l) || L.billNo.test(c)) {
      const v = l.replace(L.billNo, "").replace(/^[\s:.#-]+/, "").trim();
      const n = v || (lines[i + 1] && /^[A-Za-z0-9-/]{1,20}$/.test(lines[i + 1]) ? lines[++i] : "");
      billNo = n.split(/\s/)[0];
      continue;
    }
    if (!/क्रेता/.test(l) && (L.sellerPan.test(l) || L.sellerPan.test(c))) {
      const d = l.replace(/\D/g, "");
      if (d.length >= 9) sellerPan = d.slice(0, 9);
      continue;
    }
    if (L.words.test(l) || L.words.test(c)) { words = l.replace(/^.*?(?:रु\s*\.?|अक्षरमा)\s*:?\s*/, "").trim(); tableDone = true; continue; }

    // totals (value on the same line or the next numeric-only line)
    const totalKey: keyof typeof tot | null =
      L.grand.test(c) ? "grand"
      : L.vat.test(c) ? "vat"
      : L.taxable.test(c) ? "taxable"
      : L.discount.test(c) ? "disc"
      : L.subTotal.test(c) && !inTable ? "sub"
      : L.subTotal.test(c) && tableDone ? "sub"
      : L.subTotal.test(c) && itemLines.length ? "sub"
      : null;
    if (totalKey) {
      if (totalKey === "vat") { const m = L.vat.exec(c); if (m?.[1]) vatRate = Number(m[1]); }
      tableDone = true;
      inTable = false;
      const rest = (totalKey === "vat" ? c.replace(L.vat, "") : c.replace(/^\D+/, "")).replace(/[^\d.,\s]/g, "").trim();
      let n = rest && rawNum(rest);
      if (!n) { const nx = nextNumber(i); if (nx) { n = nx.n; i += nx.used; } }
      if (n) tot[totalKey] = n;
      continue;
    }
    if (!tableDone && L.head.test(c)) {
      inTable = true;
      if (/पै/.test(c)) paisaCol = true;
      continue;
    }
    if (inTable && !tableDone) { itemLines.push(l); continue; }
    if (!buyer && !inTable) top.push(l);
  }

  /* ---- item rows: description / unit / numbers between header and totals ---- */
  type Row = { desc: string[]; unit?: string; nums: RawNum[] };
  const rows: Row[] = [];
  let cur: Row | null = null;
  for (const l of itemLines) {
    if (/^\d{1,3}\s*[.)]$/.test(l)) { cur = { desc: [], nums: [] }; rows.push(cur); continue; } // S.N. "1." (Vision read "4.")
    if (!cur) { cur = { desc: [], nums: [] }; rows.push(cur); }
    if (L.unit.test(l)) { cur.unit = /^p[ce]s|pcs?|पिस|थान/i.test(l) ? "pcs" : l.replace(/\.$/, "").toLowerCase(); continue; }
    const n = NUM_ONLY.test(l) ? rawNum(l) : null;
    if (n) { cur.nums.push(n); continue; }
    if (cur.nums.length) { cur = { desc: [l], nums: [] }; rows.push(cur); continue; }
    cur.desc.push(l);
  }
  const goodRows = rows.filter((r) => r.desc.length && r.nums.length);

  /* ---- rupee / paisa scale ---- */
  const T = tot.taxable ?? tot.sub;
  const wordsVal = words ? amountFromWords(words) : null;
  const recon = (scale: number) => {
    const t = val(T, scale), v = val(tot.vat, scale), g = val(tot.grand, scale), d = val(tot.disc, scale) ?? 0;
    const tol = scale === 100 ? 0.02 : 1;
    if (t == null || v == null || g == null) return false;
    return Math.abs(t * (vatRate / 100) - v) <= tol + t * 0.0001 && Math.abs(t + v - g) <= tol + Math.abs(d) * 0 + (tot.taxable ? 0 : d);
  };
  let scale = 1;
  let why = "";
  const anyDigits = [...Object.values(tot), ...goodRows.flatMap((r) => r.nums)].some((n) => n && n.explicit == null);
  if (anyDigits) {
    const g1 = val(tot.grand, 1), g100 = val(tot.grand, 100);
    if (wordsVal != null && g100 != null && Math.abs(g100 - wordsVal) < 1 && g1 !== wordsVal) { scale = 100; why = `amount in words ${wordsVal}`; }
    else if (wordsVal != null && g1 != null && Math.abs(g1 - wordsVal) < 1) { scale = 1; why = `amount in words ${wordsVal}`; }
    else if (recon(100) && !recon(1)) { scale = 100; why = "totals reconcile only with paisa"; }
    else if (recon(1) && !recon(100)) { scale = 1; why = "totals reconcile as whole rupees"; }
    else if (paisaCol) { scale = 100; why = "rupee + paisa (रु/पै) columns"; }
    if (scale === 100 || why) notes.push(`amounts ${scale === 100 ? "rupee+paisa split (/100)" : "whole rupees"}: ${why || "default"}${recon(scale) ? `; reconciled ${money(val(T, scale)!)} + ${vatRate}% ${money(val(tot.vat, scale)!)} = ${money(val(tot.grand, scale)!)}` : ""}`);
  }

  /* ---- emit canonical lines ---- */
  const out: string[] = [];
  if (title) out.push("TAX INVOICE");
  out.push(...top);
  if (sellerPan) out.push(`PAN No: ${sellerPan}`);
  if (billNo) out.push(`Invoice No: ${billNo}`);
  if (date) out.push(`Invoice Miti: ${date}`);
  if (payMode) out.push(`Mode of Payment: ${payMode}`);
  if (buyer) out.push(`Customer: ${buyer}`);
  if (address) out.push(`Address: ${address}`);
  if (buyerPan) out.push(`Customer PAN: ${buyerPan}`);
  if (goodRows.length) {
    // fixed-width columns: the parser places synthetic word boxes by character offset (header <-> row columns)
    const row = (sn: string, desc: string, q: string, u: string, r: string, a: string) =>
      `${sn.padEnd(6)}${desc.padEnd(Math.max(36, desc.length + 6))}${q.padStart(8)}      ${u.padEnd(8)}${r.padStart(14)}${a.padStart(16)}`;
    const descW = Math.max(36, ...goodRows.map((r) => r.desc.join(" ").length + 6));
    const rowW = (sn: string, desc: string, q: string, u: string, r: string, a: string) => row(sn, desc.padEnd(descW - 6), q, u, r, a);
    out.push(rowW("S.N.", "Particulars", "Qty", "Unit", "Rate", "Amount"));
    goodRows.forEach((r, k) => {
      const nums = r.nums.map((n) => val(n, scale)!);
      let qty: number, rate: number, amount: number;
      if (nums.length >= 3) { [qty, rate, amount] = nums.slice(-3); }
      else if (nums.length === 2) {
        [rate, amount] = nums;
        const q = rate ? amount / rate : 1;
        qty = Math.abs(q - Math.round(q)) < 0.01 ? Math.max(1, Math.round(q)) : 1;
      } else { amount = rate = nums[0]; qty = 1; }
      out.push(rowW(String(k + 1), r.desc.join(" "), String(qty), r.unit ?? "pcs", money(rate), money(amount)));
    });
  }
  if (words) out.push(`Amount in words: ${words}`);
  const t = (k: keyof typeof tot) => val(tot[k], scale);
  if (t("sub") != null) out.push(`Sub Total ${money(t("sub")!)}`);
  if (t("disc") != null) out.push(`Discount ${money(t("disc")!)}`);
  if (t("taxable") != null) out.push(`Taxable Amount ${money(t("taxable")!)}`);
  if (t("vat") != null) out.push(`VAT ${vatRate}% ${money(t("vat")!)}`);
  if (t("grand") != null) out.push(`Grand Total ${money(t("grand")!)}`);
  notes.unshift(`Nepali bill labels: ${labelHits} found -> canonical lines (${goodRows.length} item row(s))`);
  return { lines: out, applied: true, notes };
}
