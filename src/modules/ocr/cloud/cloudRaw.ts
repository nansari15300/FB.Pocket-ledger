/** Online (Google Vision / Azure Read) OCR text -> the same `OcrRawResult` shape the tesseract path returns. Pure (no DOM).
 * When `pages` carries Google-like blocks/paragraphs/words with bounding boxes (or Azure polygons mapped to that shape),
 * words are grouped into visual rows so table cells that arrived as separate lines can be parsed as one item row.
 */
import { joinSpacedOcrText } from "@/lib/ocr/devanagariJoin";
import type { OcrRawLine, OcrRawResult, OcrWord } from "../types";

export type OcrEngineName = "google" | "azure" | "tesseract" | "gemini";

export type RawFromCloudOpts = {
  engine: OcrEngineName;
  note?: string;
  pageWidth?: number;
  pageHeight?: number;
  /** Vision / Azure hook payload: `{ text, width?, height?, blocks? }`. Extra fields are ignored if absent. */
  pages?: unknown;
};

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function vertsFrom(raw: unknown): { x: number; y: number }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    if (typeof raw[0] === "number") {
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) out.push({ x: asNum(raw[i]), y: asNum(raw[i + 1]) });
      return out;
    }
    return raw.map((p) => {
      if (!p || typeof p !== "object") return { x: 0, y: 0 };
      const o = p as { x?: unknown; y?: unknown };
      return { x: asNum(o.x), y: asNum(o.y) };
    });
  }
  if (typeof raw === "object") {
    const o = raw as { vertices?: unknown };
    if (Array.isArray(o.vertices)) return vertsFrom(o.vertices);
  }
  return [];
}

function boxOf(verts: { x: number; y: number }[]): { x0: number; x1: number; y0: number; y1: number } | null {
  if (!verts.length) return null;
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (!(x1 > x0 || y1 > y0)) return null;
  return { x0, x1, y0, y1 };
}

function wordText(w: { text?: unknown; symbols?: Array<{ text?: unknown }> } | null | undefined): string {
  if (w && typeof w.text === "string" && w.text.trim()) return w.text;
  const syms = Array.isArray(w?.symbols) ? w!.symbols! : [];
  return syms.map((s) => String(s?.text ?? "")).join("");
}

function wordVerts(w: unknown, pageW: number, pageH: number): { x: number; y: number }[] {
  const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
  const box = o.boundingBox ?? o.bounding_box;
  let v = vertsFrom(o.boundingPolygon ?? o.bounding_polygon ?? box);
  if (!v.length && box && typeof box === "object") {
    const nv = (box as { normalizedVertices?: unknown }).normalizedVertices;
    if (Array.isArray(nv) && nv.length && pageW && pageH) {
      v = vertsFrom(nv).map((p) => ({ x: p.x * pageW, y: p.y * pageH }));
    }
  }
  return v;
}

function conf100(v: unknown): number {
  const n = asNum(v);
  if (n <= 0) return 92;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

/** Pull word boxes from Google-like (or Azure-mapped) `pages`. Words without a usable box are skipped. */
export function wordsFromCloudPages(pages: unknown, fallbackW = 0, fallbackH = 0): { words: OcrWord[]; width: number; height: number } {
  const list = Array.isArray(pages) ? pages : [];
  let width = 0;
  let height = 0;
  const words: OcrWord[] = [];
  for (const page of list) {
    if (!page || typeof page !== "object") continue;
    const p = page as Record<string, unknown>;
    width = Math.max(width, asNum(p.width) || asNum(p.Width));
    height = Math.max(height, asNum(p.height) || asNum(p.Height));
    const W = width || fallbackW;
    const H = height || fallbackH;
    const paragraphs: unknown[] = [];
    const blocks = Array.isArray(p.blocks) ? p.blocks : [];
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      const blk = b as Record<string, unknown>;
      if (Array.isArray(blk.paragraphs) && blk.paragraphs.length) paragraphs.push(...blk.paragraphs);
      else if (Array.isArray(blk.lines) && blk.lines.length) paragraphs.push(...blk.lines);
      else paragraphs.push(b);
    }
    if (Array.isArray(p.lines)) paragraphs.push(...p.lines);
    for (const para of paragraphs) {
      if (!para || typeof para !== "object") continue;
      const pr = para as Record<string, unknown>;
      const pBox = boxOf(wordVerts(para, W, H));
      const rawWords = Array.isArray(pr.words) && pr.words.length
        ? pr.words
        : (typeof pr.text === "string" && pr.text.trim()
          ? [{ text: pr.text, boundingBox: pr.boundingBox ?? pr.boundingPolygon, confidence: pr.confidence }]
          : []);
      for (const w of rawWords) {
        const t = wordText(w as { text?: unknown; symbols?: Array<{ text?: unknown }> }).replace(/\s+/g, " ").trim();
        if (!t) continue;
        const b = boxOf(wordVerts(w, W, H)) || pBox;
        if (!b) continue;
        const conf = conf100((w as { confidence?: unknown })?.confidence);
        words.push({ text: t, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, conf });
      }
    }
  }
  if (!width && words.length) width = Math.max(fallbackW, ...words.map((w) => w.x1));
  if (!height && words.length) height = Math.max(fallbackH, ...words.map((w) => w.y1));
  return { words, width: width || fallbackW, height: height || fallbackH };
}

/** Cluster words that share a visual row (table cells Azure often returns as separate lines). */
export function groupOcrWordsIntoLines(words: OcrWord[]): OcrRawLine[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const heights = sorted.map((w) => Math.max(4, w.y1 - w.y0)).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 16;
  const thresh = Math.max(8, medH * 0.6);
  const rows: { words: OcrWord[]; cy: number }[] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(cy - last.cy) <= thresh) {
      last.words.push(w);
      last.cy = last.words.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / last.words.length;
    } else {
      rows.push({ words: [w], cy });
    }
  }
  return rows.map((r) => {
    const ws = [...r.words].sort((a, b) => a.x0 - b.x0);
    const conf = ws.reduce((a, w) => a + w.conf, 0) / ws.length;
    return { text: ws.map((w) => w.text).join(" "), confidence: conf, y: r.cy, words: ws };
  });
}

export function rawFromCloudText(text: string, opts: RawFromCloudOpts): OcrRawResult {
  const j = joinSpacedOcrText(String(text ?? ""));
  const fbW = opts.pageWidth && opts.pageWidth > 0 ? opts.pageWidth : 0;
  const fbH = opts.pageHeight && opts.pageHeight > 0 ? opts.pageHeight : 0;
  const extracted = opts.pages != null ? wordsFromCloudPages(opts.pages, fbW, fbH) : { words: [] as OcrWord[], width: fbW, height: fbH };
  const grouped = groupOcrWordsIntoLines(extracted.words).filter((l) => l.text.trim());
  // Geometry must carry the text: words without text / boxes (or a pages shape we do not know) would give empty rows.
  // Use it only when its rows hold at least half of the plain text's characters; else one line per text line.
  const chars = (s: string) => s.replace(/\s+/g, "").length;
  const geomChars = grouped.reduce((a, l) => a + chars(l.text), 0);
  const textChars = chars(j.text);
  const geometryOk = grouped.length > 0 && geomChars > 0 && (textChars === 0 || geomChars >= textChars * 0.5);
  if (geometryOk) {
    const pageWidth = extracted.width || fbW || Math.max(1, ...grouped.flatMap((l) => (l.words ?? []).map((w) => w.x1)));
    const pageHeight = extracted.height || fbH || Math.max(1, ...grouped.map((l) => l.y + 20));
    const meanConfidence = grouped.reduce((a, l) => a + l.confidence, 0) / grouped.length;
    return {
      text: j.text || grouped.map((l) => l.text).join("\n"),
      lines: grouped,
      meanConfidence,
      pageHeight,
      pageWidth,
      altText: "",
      preprocess: `online (${opts.engine})${j.joined ? ", spaced characters re-joined" : ""}`,
      engine: opts.engine,
      engineNote: opts.note,
    };
  }
  const lines = j.text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const h = fbH || 40 + 30 * Math.max(20, lines.length);
  const step = (h - 40) / Math.max(20, lines.length);
  return {
    text: j.text,
    lines: lines.map((t, i) => ({ text: t, confidence: 92, y: 40 + i * step })),
    meanConfidence: 92,
    pageHeight: h,
    pageWidth: fbW || opts.pageWidth,
    altText: "",
    preprocess: `online (${opts.engine})${j.joined ? ", spaced characters re-joined" : ""}${grouped.length ? `, word boxes ignored (${geomChars}/${textChars} chars)` : ", text lines (no word boxes)"}`,
    engine: opts.engine,
    engineNote: opts.note,
  };
}
