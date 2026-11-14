export type GalleryQueueSequence =
  | "top-left-to-right"
  | "top-right-to-left"
  | "bottom-left-to-right"
  | "bottom-right-to-left";
export type GallerySortOrder = "newest-first" | "oldest-first";

export const GALLERY_QUEUE_SEQUENCES: Array<{ value: GalleryQueueSequence; label: string }> = [
  { value: "top-left-to-right", label: "Top left to right" },
  { value: "top-right-to-left", label: "Top right to left" },
  { value: "bottom-left-to-right", label: "Bottom left to right" },
  { value: "bottom-right-to-left", label: "Bottom right to left" },
];

export const DEFAULT_GALLERY_QUEUE_SEQUENCE: GalleryQueueSequence = "top-left-to-right";
export const DEFAULT_GALLERY_SORT_ORDER: GallerySortOrder = "newest-first";

export function normalizeGallerySortOrder(value: unknown): GallerySortOrder {
  return value === "oldest-first" ? "oldest-first" : DEFAULT_GALLERY_SORT_ORDER;
}

export function normalizeGalleryQueueSequence(value: unknown): GalleryQueueSequence {
  return GALLERY_QUEUE_SEQUENCES.some((option) => option.value === value)
    ? value as GalleryQueueSequence
    : DEFAULT_GALLERY_QUEUE_SEQUENCE;
}

function uploadedAtMs(value: unknown): number {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && typeof (value as { seconds?: unknown }).seconds === "number") {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  return 0;
}

/** Sorts files in reading order for the selected queue and the gallery's column count. */
export function orderGalleryQueue<T extends { uploadedAt?: unknown; id?: string }>(
  rows: readonly T[],
  sequence: GalleryQueueSequence,
  columns = 2,
  sortOrder: GallerySortOrder = DEFAULT_GALLERY_SORT_ORDER,
): T[] {
  const dated = [...rows].sort((a, b) => uploadedAtMs(a.uploadedAt) - uploadedAtMs(b.uploadedAt) || String(a.id || "").localeCompare(String(b.id || "")));
  const chronological = sortOrder === "oldest-first" ? dated : dated.reverse();
  const width = Math.max(1, Math.min(10, Math.round(Number(columns) || 2)));
  const topToBottom = sequence.startsWith("top-");
  const rightToLeft = sequence.endsWith("right-to-left");
  const rowsOfFiles: T[][] = [];
  for (let index = 0; index < chronological.length; index += width) rowsOfFiles.push(chronological.slice(index, index + width));
  if (!topToBottom) rowsOfFiles.reverse();
  if (rightToLeft) rowsOfFiles.forEach((row) => row.reverse());
  return rowsOfFiles.flat();
}

export function sortGalleryFiles<T extends { uploadedAt?: unknown; id?: string }>(rows: readonly T[], sortOrder: GallerySortOrder): T[] {
  const sorted = [...rows].sort((a, b) => uploadedAtMs(a.uploadedAt) - uploadedAtMs(b.uploadedAt) || String(a.id || "").localeCompare(String(b.id || "")));
  return sortOrder === "oldest-first" ? sorted : sorted.reverse();
}
