/**
 * Pure pixel operations for OCR preprocessing (ACR). No DOM: the browser engine (preprocess.ts) and the node
 * selftests share them. All work on a single-channel gray image (Uint8ClampedArray, row-major, width x height).
 *
 * Why: an over-lit / glare photo of a pink bill ("jada light") has a bright, uneven background and faded ink.
 * A global 1-99 % stretch (standard pass) keeps the glare gradient, so tesseract's binarization loses the
 * faded parts (PAN 619727215 -> 818727218, Bill No / Date / Total gone). Flat-field (divide by the estimated
 * paper background) evens the lighting, then a stretch restores ink contrast; deskew fixes the tilt that
 * merges two-column header lines in PSM 6.
 */

export type Gray = { data: Uint8ClampedArray; width: number; height: number };

/** RGBA (canvas ImageData / sharp raw) -> luma gray. `channels` = 3 or 4. */
export function rgbToGray(rgba: ArrayLike<number>, width: number, height: number, channels = 4): Gray {
  const n = width * height;
  const out = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += channels) out[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { data: out, width, height };
}

/** Percentile contrast stretch (in place). */
export function stretchGray(g: Gray, loPct = 1, hiPct = 99): Gray {
  const d = g.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  const n = d.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= (n * loPct) / 100) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= (n * (100 - hiPct)) / 100) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) d[i] = ((d[i] - lo) * 255) / span;
  return g;
}

/**
 * Paper background estimate: downscale (block MAX keeps the paper, drops thin dark ink), dilate, box blur,
 * then bilinear upsample. Returns a full-size background map.
 */
export function estimateBackground(g: Gray, cell = 0): Uint8ClampedArray {
  const { width: W, height: H, data } = g;
  const c = cell || Math.max(4, Math.round(Math.max(W, H) / 160));
  const sw = Math.max(1, Math.ceil(W / c)), sh = Math.max(1, Math.ceil(H / c));
  let s = new Float32Array(sw * sh);
  for (let by = 0; by < sh; by++) {
    for (let bx = 0; bx < sw; bx++) {
      let m = 0;
      const y1 = Math.min(H, (by + 1) * c), x1 = Math.min(W, (bx + 1) * c);
      for (let y = by * c; y < y1; y++) for (let x = bx * c, k = y * W + x; x < x1; x++, k++) if (data[k] > m) m = data[k];
      s[by * sw + bx] = m;
    }
  }
  // dilate (max 3x3) twice: bold text / table lines wider than one cell vanish
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(s.length);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.min(sh - 1, Math.max(0, y + dy)), xx = Math.min(sw - 1, Math.max(0, x + dx));
            if (s[yy * sw + xx] > m) m = s[yy * sw + xx];
          }
        t[y * sw + x] = m;
      }
    s = t;
  }
  // box blur radius 2 (separable)
  const r = 2;
  const blur = (src: Float32Array, horiz: boolean) => {
    const t = new Float32Array(src.length);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let a = 0, n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
          a += src[yy * sw + xx]; n++;
        }
        t[y * sw + x] = a / n;
      }
    return t;
  };
  s = blur(blur(s, true), false);
  const bg = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / c - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / c - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      const top = s[y0 * sw + x0] * (1 - wx) + s[y0 * sw + x1] * wx;
      const bot = s[y1 * sw + x0] * (1 - wx) + s[y1 * sw + x1] * wx;
      bg[y * W + x] = top * (1 - wy) + bot * wy;
    }
  }
  return bg;
}

/** Flat-field: gray / background * 255 (in place). Evens glare and shadows; faded ink regains contrast. */
export function flatField(g: Gray): Gray {
  const bg = estimateBackground(g);
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = (d[i] * 255) / Math.max(16, bg[i]);
  return g;
}

/**
 * Skew angle in degrees (rotate the image by +angle, canvas convention: clockwise positive) that makes text
 * lines horizontal. Projection-profile search on dark pixels of a downscaled copy, +-maxDeg in 0.25 steps.
 * Returns 0 when the best angle is within +-0.3 deg or the page has too little ink.
 */
export function estimateSkewDeg(g: Gray, maxDeg = 6): number {
  const { width: W, height: H, data } = g;
  const sc = Math.min(1, 900 / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * sc)), sh = Math.max(1, Math.round(H * sc));
  const small = new Uint8ClampedArray(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) small[y * sw + x] = data[Math.min(H - 1, Math.floor(y / sc)) * W + Math.min(W - 1, Math.floor(x / sc))];
  const hist = new Uint32Array(256);
  for (const v of small) hist[v]++;
  let acc = 0, thr = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= small.length * 0.12) { thr = v; break; } }
  thr = Math.min(thr, 160);
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (small[y * sw + x] <= thr) { xs.push(x - sw / 2); ys.push(y - sh / 2); }
  if (xs.length < 200) return 0;
  const diag = Math.ceil(Math.hypot(sw, sh)) + 2;
  let best = 0, bestScore = -1;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.25) {
    const t = (a * Math.PI) / 180, sin = Math.sin(t), cos = Math.cos(t);
    const prof = new Float64Array(diag);
    for (let i = 0; i < xs.length; i++) {
      // y after rotating the point by +a (clockwise on screen)
      const yr = Math.round(xs[i] * sin + ys[i] * cos + diag / 2);
      if (yr >= 0 && yr < diag) prof[yr]++;
    }
    let s = 0;
    for (let i = 1; i < diag; i++) { const d = prof[i] - prof[i - 1]; s += d * d; }
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return Math.abs(best) <= 0.3 ? 0 : best;
}

/** Enhanced gray for the retry pass: flat-field + 0.5-99.5 % stretch. Deskew angle returned separately. */
export function enhanceForOcr(g: Gray): { gray: Gray; skewDeg: number } {
  flatField(g);
  stretchGray(g, 0.5, 99.5);
  return { gray: g, skewDeg: estimateSkewDeg(g) };
}
