/** Online (Google Vision) OCR text -> the same `OcrRawResult` shape the tesseract path returns. Pure (no DOM). */
import { joinSpacedOcrText } from "@/lib/ocr/devanagariJoin";
import type { OcrRawResult } from "../types";

export type OcrEngineName = "google" | "tesseract";

export function rawFromCloudText(text: string, opts: { engine: OcrEngineName; note?: string; pageWidth?: number; pageHeight?: number }): OcrRawResult {
  const j = joinSpacedOcrText(String(text ?? ""));
  const lines = j.text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const h = opts.pageHeight && opts.pageHeight > 0 ? opts.pageHeight : 40 + 30 * Math.max(20, lines.length);
  const step = (h - 40) / Math.max(20, lines.length);
  return {
    text: j.text,
    lines: lines.map((t, i) => ({ text: t, confidence: 92, y: 40 + i * step })),
    meanConfidence: 92,
    pageHeight: h,
    pageWidth: opts.pageWidth,
    altText: "",
    preprocess: `online (${opts.engine})${j.joined ? ", spaced characters re-joined" : ""}`,
    engine: opts.engine,
    engineNote: opts.note,
  };
}
