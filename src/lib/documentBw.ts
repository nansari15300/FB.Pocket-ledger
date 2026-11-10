/**
 * Scanner-like black-and-white for photographed documents (plain canvas JS).
 *
 * Why not a global cutoff: a fixed "gray > 150" after a contrast stretch turns
 * mid-tone colored paper (pink, yellow) almost solid black. Those hues have
 * modest luminance even when they look like paper, especially in shadow.
 *
 * Pipeline (fast enough for ~2400px in plain JS):
 *   1. Paper-aware gray = max(R, G, B) so saturated colors like pink stay bright.
 *   2. Background normalize: divide by a large-scale background (downsample +
 *      blur, bilinear upsample) so uneven lighting flattens to ~255.
 *   3. Sauvola-style adaptive threshold via integral images (local mean + std)
 *      with a floor/ceiling so solid ink stays black and paper stays white.
 * Polarity: dark ink = 0, background = 255.
 */

export type DocumentBwOpts = {
  /** 0..100, 50 = default. Higher -> more white (paper). */
  brightness?: number;
  /** 0..100, 50 = default. Higher -> stronger ink/paper split. */
  contrast?: number;
};

/** Inclusive rectangle sum on a (w+1) * (h+1) integral image. */
function rectSum(ii: Float64Array, iw: number, x0: number, y0: number, x1: number, y1: number): number {
  return (
    ii[(y1 + 1) * iw + (x1 + 1)] -
    ii[y0 * iw + (x1 + 1)] -
    ii[(y1 + 1) * iw + x0] +
    ii[y0 * iw + x0]
  );
}

function buildIntegrals(gray: Float64Array, w: number, h: number): { sum: Float64Array; sq: Float64Array; iw: number } {
  const iw = w + 1;
  const sum = new Float64Array(iw * (h + 1));
  const sq = new Float64Array(iw * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rs = 0;
    let rq = 0;
    const row = (y - 1) * w;
    for (let x = 1; x <= w; x++) {
      const v = gray[row + (x - 1)];
      rs += v;
      rq += v * v;
      const i = y * iw + x;
      sum[i] = sum[(y - 1) * iw + x] + rs;
      sq[i] = sq[(y - 1) * iw + x] + rq;
    }
  }
  return { sum, sq, iw };
}

/** Large-scale background: box-average onto a small grid, then bilinear upsample. */
function estimateBackground(gray: Float64Array, w: number, h: number): Float64Array {
  const target = 160;
  const scale = Math.max(1, Math.ceil(Math.max(w, h) / target));
  const sw = Math.max(1, Math.ceil(w / scale));
  const sh = Math.max(1, Math.ceil(h / scale));
  const small = new Float64Array(sw * sh);
  const counts = new Uint16Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    const row = y * w;
    const srow = sy * sw;
    for (let x = 0; x < w; x++) {
      const sx = (x / scale) | 0;
      const i = srow + sx;
      small[i] += gray[row + x];
      counts[i]++;
    }
  }
  for (let i = 0; i < small.length; i++) {
    small[i] = counts[i] ? small[i] / counts[i] : 0;
  }
  // One 3x3 average pass so the coarse grid is smooth.
  const blur = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y + 1 < sh ? y + 1 : sh - 1;
    for (let x = 0; x < sw; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x + 1 < sw ? x + 1 : sw - 1;
      let s = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const rr = yy * sw;
        for (let xx = x0; xx <= x1; xx++) {
          s += small[rr + xx];
          n++;
        }
      }
      blur[y * sw + x] = s / n;
    }
  }
  const bg = new Float64Array(w * h);
  const maxSx = sw - 1;
  const maxSy = sh - 1;
  for (let y = 0; y < h; y++) {
    const fy = y / scale;
    const sy = fy < maxSy ? fy : maxSy;
    const y0 = sy | 0;
    const y1 = y0 < maxSy ? y0 + 1 : maxSy;
    const ty = sy - y0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const fx = x / scale;
      const sx = fx < maxSx ? fx : maxSx;
      const x0 = sx | 0;
      const x1 = x0 < maxSx ? x0 + 1 : maxSx;
      const tx = sx - x0;
      const v00 = blur[y0 * sw + x0];
      const v10 = blur[y0 * sw + x1];
      const v01 = blur[y1 * sw + x0];
      const v11 = blur[y1 * sw + x1];
      const v0 = v00 + (v10 - v00) * tx;
      const v1 = v01 + (v11 - v01) * tx;
      bg[row + x] = v0 + (v1 - v0) * ty;
    }
  }
  return bg;
}

/**
 * In-place B&W on an RGBA buffer (length w*h*4). Returns the same buffer.
 */
export function applyDocumentBwRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  opts: DocumentBwOpts = {}
): Uint8ClampedArray {
  if (!w || !h) return data;
  const n = w * h;
  const gray = new Float64Array(n);

  // 1) max-channel gray: pink / yellow paper stays bright; dark ink stays dark.
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    gray[i] = r > g ? (r > b ? r : b) : g > b ? g : b;
  }

  // 2) Background normalize so uneven lighting / colored paper lands near 255.
  const bg = estimateBackground(gray, w, h);
  const norm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const denom = bg[i] > 8 ? bg[i] : 8;
    let v = (gray[i] / denom) * 255;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    norm[i] = v;
  }

  // 3) Sauvola on the normalized page. Brightness/contrast tweak k and a T bias.
  const bSigned = ((opts.brightness ?? 50) - 50) / 50;
  const cSigned = ((opts.contrast ?? 50) - 50) / 50;
  const k = 0.22 + cSigned * 0.14; // ~0.08 .. 0.36
  const tBias = -bSigned * 22; // brighter slider -> lower T -> more paper (white)
  const winR = Math.max(8, Math.round(Math.min(w, h) / 40));
  const { sum, sq, iw } = buildIntegrals(norm, w, h);

  let black = 0;
  const bin = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = y - winR < 0 ? 0 : y - winR;
    const y1 = y + winR > h - 1 ? h - 1 : y + winR;
    for (let x = 0; x < w; x++) {
      const x0 = x - winR < 0 ? 0 : x - winR;
      const x1 = x + winR > w - 1 ? w - 1 : x + winR;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = rectSum(sum, iw, x0, y0, x1, y1);
      const q = rectSum(sq, iw, x0, y0, x1, y1);
      const mean = s / count;
      const var_ = q / count - mean * mean;
      const std = var_ > 0 ? Math.sqrt(var_) : 0;
      let T = mean * (1 + k * (std / 128 - 1)) + tBias;
      if (T < 175) T = 175;
      if (T > 232) T = 232;
      const i = y * w + x;
      const isInk = norm[i] < T;
      bin[i] = isInk ? 0 : 255;
      if (isInk) black++;
    }
  }

  // If something still produced a nearly-black page, flip polarity.
  if (black > n * 0.7) {
    for (let i = 0; i < n; i++) bin[i] = bin[i] ? 0 : 255;
  }

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = bin[i];
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
  }
  return data;
}

/** Apply B&W in place on a 2D canvas context. */
export function applyDocumentBwInPlace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: DocumentBwOpts = {}
): void {
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  applyDocumentBwRgba(img.data, w, h, opts);
  ctx.putImageData(img, 0, 0);
}
