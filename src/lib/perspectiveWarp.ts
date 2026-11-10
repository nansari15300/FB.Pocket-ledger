/**
 * Tiny canvas-based perspective warp (no OpenCV).
 *
 * Quad points are normalized 0..1 relative to the source canvas, ordered
 * TL, TR, BR, BL. `warpQuadToCanvas` maps that free quadrilateral onto an upright
 * rectangle using a 3x3 homography + bilinear sampling.
 */

export type QuadPoint = { x: number; y: number };
/** TL, TR, BR, BL — normalized 0..1. */
export type Quad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];

export function rectToQuad(r: { x: number; y: number; w: number; h: number }): Quad {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function quadsEqual(a: Quad, b: Quad, eps = 1e-6): boolean {
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i].x - b[i].x) > eps || Math.abs(a[i].y - b[i].y) > eps) return false;
  }
  return true;
}

/** True when the quad is strictly convex and keeps TL,TR,BR,BL winding (no self-crossing). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Axis-aligned when the quad is (within eps) a plain rectangle — fast path, no warp needed. */
export function quadIsAxisRect(q: Quad, eps = 1e-6): boolean {
  return (
    Math.abs(q[0].y - q[1].y) < eps &&
    Math.abs(q[3].y - q[2].y) < eps &&
    Math.abs(q[0].x - q[3].x) < eps &&
    Math.abs(q[1].x - q[2].x) < eps
  );
}

/** Solve an 8x8 linear system (Gaussian elimination with partial pivoting). */
function solve8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography H (row-major, h33 = 1) such that H * src_i ~ dst_i for 4 point pairs. */
export function computeHomography(src: QuadPoint[], dst: QuadPoint[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  return h ? [...h, 1] : null;
}

/** Output size in source pixels: longest opposite edges, so nothing is downsampled. */
export function quadOutputSize(q: Quad, srcW: number, srcH: number, maxEdge = 2400): { w: number; h: number } {
  const d = (a: QuadPoint, b: QuadPoint) => Math.hypot((a.x - b.x) * srcW, (a.y - b.y) * srcH);
  let w = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  let h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const s = Math.min(1, maxEdge / Math.max(w, h, 1));
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));
  return { w, h };
}

/**
 * Warp the quad region of `src` into `dst` (resized to the output rectangle).
 * Uses inverse mapping (dst pixel -> src point) with bilinear interpolation.
 */
export function warpQuadToCanvas(
  src: HTMLCanvasElement,
  quad: Quad,
  dst: HTMLCanvasElement,
  size?: { w: number; h: number }
): { w: number; h: number } {
  const sw = src.width;
  const sh = src.height;
  const { w, h } = size ?? quadOutputSize(quad, sw, sh);
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext("2d");
  const sctx = src.getContext("2d");
  if (!dctx || !sctx) throw new Error("canvas_unavailable");

  // Fast path: upright rectangle with normal winding -> drawImage crop.
  if (
    quadIsAxisRect(quad) &&
    quad[1].x - quad[0].x > 1e-6 &&
    quad[3].y - quad[0].y > 1e-6
  ) {
    const sx = quad[0].x * sw;
    const sy = quad[0].y * sh;
    const rw = Math.max(1, (quad[1].x - quad[0].x) * sw);
    const rh = Math.max(1, (quad[3].y - quad[0].y) * sh);
    dctx.drawImage(src, sx, sy, rw, rh, 0, 0, w, h);
    return { w, h };
  }

  const srcPts = quad.map((p) => ({ x: p.x * sw, y: p.y * sh }));
  const dstPts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // Inverse map: dst -> src.
  const H = computeHomography(dstPts, srcPts);
  if (!H) {
    dctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
    return { w, h };
  }
  const sData = sctx.getImageData(0, 0, sw, sh).data;
  const out = dctx.createImageData(w, h);
  const o = out.data;
  const [a, b, c, d, e, f, g, hh] = H;
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < w; x++) {
      const xc = x + 0.5;
      const den = g * xc + hh * yc + 1;
      let px = (a * xc + b * yc + c) / den - 0.5;
      let py = (d * xc + e * yc + f) / den - 0.5;
      if (px < 0) px = 0; else if (px > sw - 1) px = sw - 1;
      if (py < 0) py = 0; else if (py > sh - 1) py = sh - 1;
      const x0 = px | 0;
      const y0 = py | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0;
      const y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = px - x0;
      const fy = py - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const oi = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = sData[i00 + k] + (sData[i10 + k] - sData[i00 + k]) * fx;
        const bot = sData[i01 + k] + (sData[i11 + k] - sData[i01 + k]) * fx;
        o[oi + k] = top + (bot - top) * fy;
      }
    }
  }
  dctx.putImageData(out, 0, 0);
  return { w, h };
}

export type CropCorner = "nw" | "ne" | "se" | "sw";
export type CropEdge = "n" | "e" | "s" | "w";
export type CropHandle = CropCorner | CropEdge | "move";

/** Named-corner crop quad, same winding as Quad (nw, ne, se, sw). */
export type CropQuad = Record<CropCorner, QuadPoint>;

export const DEFAULT_CROP_QUAD: CropQuad = {
  nw: { x: 0, y: 0 },
  ne: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  sw: { x: 0, y: 1 },
};

export const CROP_CORNERS: CropCorner[] = ["nw", "ne", "se", "sw"];
export const CROP_EDGES: CropEdge[] = ["n", "e", "s", "w"];

export function cropQuadToTuple(q: CropQuad): Quad {
  return [q.nw, q.ne, q.se, q.sw];
}

export function rectToCropQuad(r: { x: number; y: number; w: number; h: number }): CropQuad {
  const t = rectToQuad(r);
  return { nw: t[0], ne: t[1], se: t[2], sw: t[3] };
}

export function cloneCropQuad(q: CropQuad): CropQuad {
  return {
    nw: { x: q.nw.x, y: q.nw.y },
    ne: { x: q.ne.x, y: q.ne.y },
    se: { x: q.se.x, y: q.se.y },
    sw: { x: q.sw.x, y: q.sw.y },
  };
}

export function cropQuadsEqual(a: CropQuad, b: CropQuad, eps = 1e-6): boolean {
  return quadsEqual(cropQuadToTuple(a), cropQuadToTuple(b), eps);
}

export function isFullCropQuad(q: CropQuad, eps = 1e-6): boolean {
  return cropQuadsEqual(q, DEFAULT_CROP_QUAD, eps);
}

export function midPoint(a: QuadPoint, b: QuadPoint): QuadPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function edgeCorners(edge: CropEdge): [CropCorner, CropCorner] {
  switch (edge) {
    case "n":
      return ["nw", "ne"];
    case "e":
      return ["ne", "se"];
    case "s":
      return ["sw", "se"];
    case "w":
      return ["nw", "sw"];
  }
}

export function edgeMidpoint(q: CropQuad, edge: CropEdge): QuadPoint {
  const [a, b] = edgeCorners(edge);
  return midPoint(q[a], q[b]);
}

function hypot(dx: number, dy: number): number {
  return Math.hypot(dx, dy) || 1;
}

/** Unit normal of an edge (direction does not matter; used to project a drag). */
export function edgeNormal(q: CropQuad, edge: CropEdge): QuadPoint {
  const [a, b] = edgeCorners(edge);
  const dx = q[b].x - q[a].x;
  const dy = q[b].y - q[a].y;
  const len = hypot(dx, dy);
  return { x: -dy / len, y: dx / len };
}

/**
 * Angle (screen space, y down, radians) of the two-headed arrow on a corner handle:
 * bisector of the two edges that meet at that corner.
 */
export function cornerArrowAngle(q: CropQuad, corner: CropCorner): number {
  const adj: Record<CropCorner, [CropCorner, CropCorner]> = {
    nw: ["ne", "sw"],
    ne: ["nw", "se"],
    se: ["ne", "sw"],
    sw: ["nw", "se"],
  };
  const [p, r] = adj[corner];
  const la = hypot(q[p].x - q[corner].x, q[p].y - q[corner].y);
  const lb = hypot(q[r].x - q[corner].x, q[r].y - q[corner].y);
  const sx = (q[p].x - q[corner].x) / la + (q[r].x - q[corner].x) / lb;
  const sy = (q[p].y - q[corner].y) / la + (q[r].y - q[corner].y) / lb;
  return Math.atan2(sy, sx);
}

/** Angle of a side-handle arrow: perpendicular to that edge. */
export function edgeArrowAngle(q: CropQuad, edge: CropEdge): number {
  const n = edgeNormal(q, edge);
  return Math.atan2(n.y, n.x);
}

/** Map an arrow angle to the closest CSS resize cursor (180° symmetric). */
export function resizeCursorForAngle(rad: number): string {
  let a = rad % Math.PI;
  if (a < 0) a += Math.PI;
  const slice = Math.PI / 8;
  if (a < slice || a >= 7 * slice) return "ew-resize";
  if (a < 3 * slice) return "nwse-resize";
  if (a < 5 * slice) return "ns-resize";
  return "nesw-resize";
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clampPt(p: QuadPoint): QuadPoint {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

/** Shrink a translation so every listed point stays inside the unit square. */
export function maxTranslationScale(pts: QuadPoint[], tx: number, ty: number): number {
  let s = 1;
  for (const p of pts) {
    if (tx > 1e-12) s = Math.min(s, (1 - p.x) / tx);
    else if (tx < -1e-12) s = Math.min(s, (0 - p.x) / tx);
    if (ty > 1e-12) s = Math.min(s, (1 - p.y) / ty);
    else if (ty < -1e-12) s = Math.min(s, (0 - p.y) / ty);
  }
  return s < 0 ? 0 : s;
}

const MIN_QUAD_AREA = 0.0025;

export function isValidCropQuad(q: CropQuad): boolean {
  const pts = cropQuadToTuple(q);
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (p.x < -1e-6 || p.x > 1 + 1e-6 || p.y < -1e-6 || p.y > 1 + 1e-6) return false;
  }
  if (!isConvexQuad(pts)) return false;
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2 >= MIN_QUAD_AREA;
}

/**
 * Apply one pointer-delta (normalized image space) to a crop quad.
 * Corners move freely (clamped). Side handles slide their edge along its normal.
 * Move translates all four corners together, clamped to the image.
 * Invalid (crossed / tiny) results are rejected and `start` is returned.
 */
export function applyCropDrag(start: CropQuad, handle: CropHandle, dx: number, dy: number): CropQuad {
  const next = cloneCropQuad(start);
  if (handle === "move") {
    const scale = maxTranslationScale([start.nw, start.ne, start.se, start.sw], dx, dy);
    const tx = dx * scale;
    const ty = dy * scale;
    for (const k of CROP_CORNERS) {
      next[k] = { x: start[k].x + tx, y: start[k].y + ty };
    }
    return isValidCropQuad(next) ? next : start;
  }
  if (handle === "n" || handle === "e" || handle === "s" || handle === "w") {
    const n = edgeNormal(start, handle);
    const proj = dx * n.x + dy * n.y;
    let tx = n.x * proj;
    let ty = n.y * proj;
    const [a, b] = edgeCorners(handle);
    const scale = maxTranslationScale([start[a], start[b]], tx, ty);
    tx *= scale;
    ty *= scale;
    next[a] = { x: start[a].x + tx, y: start[a].y + ty };
    next[b] = { x: start[b].x + tx, y: start[b].y + ty };
    return isValidCropQuad(next) ? next : start;
  }
  next[handle] = clampPt({ x: start[handle].x + dx, y: start[handle].y + dy });
  return isValidCropQuad(next) ? next : start;
}

/** Warp a named crop quad onto a new (or provided) canvas. */
export function warpCropQuadToCanvas(
  src: HTMLCanvasElement,
  crop: CropQuad,
  dst?: HTMLCanvasElement,
  size?: { w: number; h: number }
): HTMLCanvasElement {
  const out = dst ?? document.createElement("canvas");
  warpQuadToCanvas(src, cropQuadToTuple(crop), out, size);
  return out;
}
