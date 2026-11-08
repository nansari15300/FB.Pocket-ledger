import fs from "node:fs";
import zlib from "node:zlib";

function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, colorType, bitDepth, data: out, channels };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    chunks.push(len, body, crcBuf);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat(chunks);
}

const src = decodePng(fs.readFileSync("public/icons/camera-lens.png"));
const { width: SW, height: SH, channels: SC, data: SD } = src;
const at = (x, y) => {
  const i = (y * SW + x) * SC;
  return [SD[i], SD[i + 1], SD[i + 2], SC === 4 ? SD[i + 3] : 255];
};

// Lens dark-ring bbox measured from the source art.
const BOX = { minX: 20, minY: 18, maxX: 76, maxY: 73 };
const cx = (BOX.minX + BOX.maxX + 1) / 2;
const cy = (BOX.minY + BOX.maxY + 1) / 2;
const radius = Math.max(BOX.maxX - BOX.minX + 1, BOX.maxY - BOX.minY + 1) / 2;

// Output: lens circle + a hairline rim, centred, transparent outside.
const OUT = 128;
const PAD = 6; // rim breathing room
const outR = OUT / 2 - PAD;
const scale = outR / (radius + 1.5);

const rgba = Buffer.alloc(OUT * OUT * 4);
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const dx = x + 0.5 - OUT / 2;
    const dy = y + 0.5 - OUT / 2;
    const d = Math.hypot(dx, dy);
    const o = (y * OUT + x) * 4;
    const coverage = Math.max(0, Math.min(1, outR - d + 0.5));
    if (coverage <= 0) continue;

    // map back to source pixels (bilinear)
    const sx = cx + dx / scale;
    const sy = cy + dy / scale;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = sx - x0, fy = sy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [ox, oy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const px = Math.max(0, Math.min(SW - 1, x0 + ox));
      const py = Math.max(0, Math.min(SH - 1, y0 + oy));
      const p = at(px, py);
      r += p[0] * w;
      g += p[1] * w;
      b += p[2] * w;
      a += p[3] * w;
    }

    const l = lum(r, g, b);
    let alpha = coverage;
    // bleached white camera body around the lens -> transparent
    const whiteish = l > 228 && a > 200 && Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) < 22;
    if (whiteish) alpha = 0;
    else if (l > 205) alpha = coverage * Math.max(0, (228 - l) / 23); // soften the rim anti-aliasing

    rgba[o] = Math.round(r);
    rgba[o + 1] = Math.round(g);
    rgba[o + 2] = Math.round(b);
    rgba[o + 3] = Math.round(255 * alpha);
  }
}

fs.writeFileSync("public/icons/camera-lens.png", encodePng(OUT, OUT, rgba));
console.log("wrote public/icons/camera-lens.png", OUT + "x" + OUT);
