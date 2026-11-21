// The Passport Page of a Country That Isn't There
// main.ts — draws one invented passport spread to /output/entry.png.
// Pure Node stdlib (no network, no dependencies): a tiny raster canvas,
// a 5x7 bitmap font, and a hand-rolled PNG encoder. Fully deterministic.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- PNG out
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Encode raw RGB scanlines as a PNG, choosing the smallest filter per row.
function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride);
    let best: Buffer | null = null;
    let bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      const filtered = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const v = row[x];
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev[x];
        const c = x >= 3 ? prev[x - 3] : 0;
        let p = v;
        if (f === 1) p = v - a;
        else if (f === 2) p = v - b;
        else if (f === 3) p = v - ((a + b) >> 1);
        else if (f === 4) p = v - paeth(a, b, c);
        filtered[x] = p & 0xff;
      }
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const s = filtered[x] > 127 ? filtered[x] - 256 : filtered[x];
        score += s < 0 ? -s : s;
      }
      if (score < bestScore) { bestScore = score; best = filtered; (best as any)._f = f; }
    }
    raw[y * (stride + 1)] = (best as any)._f;
    (best as Buffer).copy(raw, y * (stride + 1) + 1);
    row.copy(prev);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- Canvas
const W = 1024, H = 640;
const px = new Uint8Array(W * H * 3);
type RGB = [number, number, number];

function fill(r: number, g: number, b: number): void { for (let i = 0; i < W * H; i++) { px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b; } }

function setP(x: number, y: number, c: RGB, a = 1): void {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
  else { px[i] = Math.round(px[i] * (1 - a) + c[0] * a); px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a); px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a); }
}

function rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setP(xx, yy, c, a);
}

function hline(x0: number, x1: number, y: number, c: RGB, a = 1, t = 1): void {
  for (let k = 0; k < t; k++) for (let x = Math.round(x0); x <= Math.round(x1); x++) setP(x, Math.round(y) + k, c, a);
}

function vline(x: number, y0: number, y1: number, c: RGB, a = 1, t = 1): void {
  for (let k = 0; k < t; k++) for (let y = Math.round(y0); y <= Math.round(y1); y++) setP(Math.round(x) + k, y, c, a);
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  hline(x, x + w - 1, y, c, 1, t); hline(x, x + w - 1, y + h - t, c, 1, t);
  vline(x, y, y + h - 1, c, 1, t); vline(x + w - t, y, y + h - 1, c, 1, t);
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) setP(x0 + (dx * i) / steps, y0 + (dy * i) / steps, c, a);
}

function circle(cx: number, cy: number, r: number, c: RGB, a = 1, t = 1): void {
  for (let k = 0; k < t; k++) {
    const rr = r - k;
    for (let d = 0; d < 360; d += 0.6) {
      const rad = (d * Math.PI) / 180;
      setP(cx + rr * Math.cos(rad), cy + rr * Math.sin(rad), c, a);
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  for (let y = -r; y <= r; y++) {
    const hw = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -hw; x <= hw; x++) setP(cx + x, cy + y, c, a);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  for (let y = -ry; y <= ry; y++) {
    const hw = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    for (let x = -hw; x <= hw; x++) setP(cx + x, cy + y, c, a);
  }
}

function polyFill(pts: [number, number][], c: RGB, a = 1): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) setP(x, y, c, a);
  }
}

function polyStroke(pts: [number, number][], c: RGB, a = 1): void {
  for (let i = 0; i < pts.length; i++) line(pts[i][0], pts[i][1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1], c, a);
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows of 5 bits, '#' = on. All-caps document face.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
};

function textWidth(s: string, scale: number, gap?: number): number {
  const g = gap === undefined ? scale : gap;
  return s.length * (5 * scale + g) - g;
}

function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB, a = 1): void {
  const g = FONT[ch] || FONT["?"];
  for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) {
    if (g[r][col] === "1") rect(x + col * scale, y + r * scale, scale, scale, c, a);
  }
}

// Draw text; returns x just past the end. Angle rotates about (ox, oy).
function drawText(s: string, x: number, y: number, scale: number, c: RGB, a = 1, angle = 0, ox = 0, oy = 0): number {
  const gap = scale;
  if (angle === 0) {
    let cx = x;
    for (const ch of s) { drawGlyph(ch, cx, y, scale, c, a); cx += 5 * scale + gap; }
    return cx - gap;
  }
  const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] || FONT["?"];
    for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) {
      if (g[r][col] !== "1") continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px0 = cx + col * scale + sx, py0 = y + r * scale + sy;
        const rx = ox + (px0 - ox) * cos - (py0 - oy) * sin;
        const ry = oy + (px0 - ox) * sin + (py0 - oy) * cos;
        setP(rx, ry, c, a);
      }
    }
    cx += 5 * scale + gap;
  }
  return cx - gap;
}

function drawTextC(s: string, cx: number, y: number, scale: number, c: RGB, a = 1, angle = 0, oy = 0): void {
  drawText(s, cx - textWidth(s, scale) / 2, y, scale, c, a, angle, cx, oy);
}

// ---------------------------------------------------------------- Palette
const PAPER: RGB = [243, 238, 224];
const PAGE: RGB = [248, 244, 233];
const INK: RGB = [31, 46, 66];
const NAVY: RGB = [30, 58, 95];
const NAVY_LT: RGB = [58, 92, 138];
const RED: RGB = [158, 47, 36];
const RED_LT: RGB = [178, 74, 58];
const TEAL: RGB = [38, 96, 74];
const GOLD: RGB = [176, 141, 60];
const GREY: RGB = [96, 96, 92];
const SKIN: RGB = [224, 192, 158];
const SKIN_DK: RGB = [196, 158, 122];
const HAIR: RGB = [74, 50, 38];
const SUIT: RGB = [44, 62, 85];

// ---------------------------------------------------------------- MRZ (ICAO 9303)
function mrzVal(ch: string): number {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0;
}
function mrzCheck(s: string): string {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += mrzVal(s[i]) * w[i % 3];
  return String(sum % 10);
}
function buildMRZ(): [string, string] {
  const line1 = "P<VOSKOVAC<<ELENA<MARA<<<<<<<<<<<<<<<<<<<<<<";
  const doc = "VS0419827", nat = "VOS", dob = "870614", sex = "F", exp = "290312";
  const pers = "<<<<<<<<<<<<<<";
  const line2 =
    doc + mrzCheck(doc) + nat + dob + mrzCheck(dob) + sex + exp + mrzCheck(exp) +
    pers + mrzCheck(pers);
  const comp = mrzCheck(doc + mrzCheck(doc) + dob + mrzCheck(dob) + exp + mrzCheck(exp) + pers + mrzCheck(pers));
  return [line1, line2 + comp];
}

// ---------------------------------------------------------------- Guilloche
// Fine sine-wave security lines across a region, low contrast.
function guilloche(x0: number, y0: number, x1: number, y1: number, c: RGB, a: number, amp: number, wl: number): void {
  for (let y = y0; y <= y1; y += 4) {
    for (let x = x0; x <= x1; x++) {
      const yy = y + Math.sin((x / wl) * Math.PI * 2 + y * 0.11) * amp;
      setP(x, yy, c, a);
    }
  }
}

// Small coat of arms: shield, mountain, star, waves.
function emblem(cx: number, cy: number, s: number, c: RGB, a = 1): void {
  // shield outline
  const w = 26 * s, h = 32 * s;
  polyStroke([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h * 0.2], [cx, cy + h / 2], [cx - w / 2, cy + h * 0.2]], c, a);
  // mountain
  polyFill([[cx - w * 0.32, cy + h * 0.18], [cx - w * 0.05, cy - h * 0.18], [cx + w * 0.12, cy + h * 0.02], [cx + w * 0.3, cy - h * 0.08], [cx + w * 0.34, cy + h * 0.18]], c, a * 0.85);
  // star above
  const sx = cx, sy = cy - h * 0.34, r = 3.4 * s;
  polyFill([[sx, sy - r], [sx + r * 0.28, sy - r * 0.28], [sx + r, sy], [sx + r * 0.28, sy + r * 0.28], [sx, sy + r], [sx - r * 0.28, sy + r * 0.28], [sx - r, sy], [sx - r * 0.28, sy - r * 0.28]], c, a);
  // waves
  line(cx - w * 0.32, cy + h * 0.3, cx + w * 0.32, cy + h * 0.3, c, a);
  line(cx - w * 0.24, cy + h * 0.38, cx + w * 0.24, cy + h * 0.38, c, a);
}

// ---------------------------------------------------------------- Portrait
// Engraved-style bust: flat duotone shapes + hatch shading. Drawn inside
// the box (x, y, w, h); the face belongs to a Tarnovgrad ferry pilot.
function portrait(x: number, y: number, w: number, h: number, ghost: number): void {
  const cx = x + w / 2;
  const a = ghost;
  // backdrop: pale blue-grey with horizontal hatch
  rect(x, y, w, h, [214, 222, 226], a);
  for (let yy = y + 4; yy < y + h; yy += 5) hline(x + 3, x + w - 3, yy, [190, 200, 208], a * 0.7);
  // shoulders / suit
  polyFill([[cx - w * 0.42, y + h], [cx - w * 0.40, y + h * 0.78], [cx - w * 0.16, y + h * 0.68], [cx + w * 0.16, y + h * 0.68], [cx + w * 0.40, y + h * 0.78], [cx + w * 0.42, y + h]], SUIT, a);
  // shirt V + tie
  polyFill([[cx - w * 0.13, y + h * 0.69], [cx, y + h * 0.82], [cx + w * 0.13, y + h * 0.69], [cx + w * 0.07, y + h * 0.66], [cx - w * 0.07, y + h * 0.66]], [238, 238, 234], a);
  polyFill([[cx - w * 0.035, y + h * 0.80], [cx + w * 0.035, y + h * 0.80], [cx + w * 0.06, y + h * 0.94], [cx, y + h], [cx - w * 0.06, y + h * 0.94]], RED, a);
  // neck
  rect(cx - w * 0.075, y + h * 0.58, w * 0.15, h * 0.12, SKIN_DK, a);
  // head
  ellipse(cx, y + h * 0.36, w * 0.21, h * 0.24, SKIN, a);
  // jaw shading
  ellipse(cx, y + h * 0.47, w * 0.15, h * 0.10, SKIN_DK, a * 0.55);
  // hair: swept back, dark, covering crown
  polyFill([[cx - w * 0.21, y + h * 0.30], [cx - w * 0.22, y + h * 0.10], [cx - w * 0.12, y + h * 0.015], [cx + w * 0.10, y + h * 0.02], [cx + w * 0.22, y + h * 0.12], [cx + w * 0.21, y + h * 0.30], [cx + w * 0.15, y + h * 0.16], [cx + w * 0.05, y + h * 0.10], [cx - w * 0.06, y + h * 0.11], [cx - w * 0.15, y + h * 0.17]], HAIR, a);
  // ears
  ellipse(cx - w * 0.215, y + h * 0.38, w * 0.025, h * 0.05, SKIN, a);
  ellipse(cx + w * 0.215, y + h * 0.38, w * 0.025, h * 0.05, SKIN, a);
  // brows
  line(cx - w * 0.14, y + h * 0.315, cx - w * 0.045, y + h * 0.305, HAIR, a);
  line(cx + w * 0.045, y + h * 0.305, cx + w * 0.14, y + h * 0.315, HAIR, a);
  // eyes
  ellipse(cx - w * 0.095, y + h * 0.345, w * 0.028, h * 0.014, [40, 32, 28], a);
  ellipse(cx + w * 0.095, y + h * 0.345, w * 0.028, h * 0.014, [40, 32, 28], a);
  // nose
  line(cx, y + h * 0.35, cx - w * 0.012, y + h * 0.44, SKIN_DK, a);
  line(cx - w * 0.012, y + h * 0.44, cx + w * 0.03, y + h * 0.445, SKIN_DK, a);
  // mouth
  line(cx - w * 0.06, y + h * 0.50, cx + w * 0.06, y + h * 0.50, [122, 74, 62], a);
  // engraved hatch across the face, clipped by the head ellipse
  for (let d = -w; d < w; d += 4) {
    const x0 = cx - w * 0.21 + d, y0 = y + h * 0.14;
    const x1 = x0 + w * 0.10, y1 = y0 + h * 0.36;
    for (let i = 0; i <= 24; i++) {
      const px0 = x0 + ((x1 - x0) * i) / 24, py0 = y0 + ((y1 - y0) * i) / 24;
      const dx = (px0 - cx) / (w * 0.21), dy = (py0 - (y + h * 0.36)) / (h * 0.24);
      if (dx * dx + dy * dy <= 1) setP(px0, py0, [120, 90, 70], a * 0.16);
    }
  }
}

// Handwritten signature: flowing strokes spelling a readable signature.
function signature(x: number, y: number, s: number, c: RGB, a = 1): void {
  const pts: [number, number][] = [];
  for (let t = 0; t <= 40; t++) {
    const u = t / 40;
    pts.push([x + u * 30 * s, y + Math.sin(u * Math.PI * 2.2) * 3.2 * s - u * 2 * s]);
  }
  for (let i = 0; i + 1 < pts.length; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, a);
  line(x + 2 * s, y - 6 * s, x + 6 * s, y + 4 * s, c, a);
  line(x + 6 * s, y + 4 * s, x + 10 * s, y - 8 * s, c, a);
  const pts2: [number, number][] = [];
  for (let t = 0; t <= 30; t++) {
    const u = t / 30;
    pts2.push([x + 34 * s + u * 26 * s, y + 2 * s + Math.sin(u * Math.PI * 1.6) * 2.6 * s - u * 3 * s]);
  }
  for (let i = 0; i + 1 < pts2.length; i++) line(pts2[i][0], pts2[i][1], pts2[i + 1][0], pts2[i + 1][1], c, a);
  line(x + 60 * s, y - 7 * s, x + 64 * s, y + 3 * s, c, a);
}

// ---------------------------------------------------------------- Stamps
// Circular border stamp: country, IN/OUT dates, rotated slightly.
function roundStamp(cx: number, cy: number, r: number, country: string, inD: string, outD: string, angle: number, c: RGB): void {
  circle(cx, cy, r, c, 0.92, 2);
  circle(cx, cy, r - 5, c, 0.92, 1);
  drawTextC(country, cx, cy - r + 12, 1, c, 0.92, angle, cy);
  drawTextC("* * *", cx, cy - r + 22, 1, c, 0.85, angle, cy);
  drawTextC("IN " + inD, cx, cy - 8, 1, c, 0.95, angle, cy);
  drawTextC("OUT " + outD, cx, cy + 4, 1, c, 0.95, angle, cy);
  drawTextC("* * *", cx, cy + r - 30, 1, c, 0.85, angle, cy);
  drawTextC("VOSTRANIA", cx, cy + r - 20, 1, c, 0.92, angle, cy);
}

// Rectangular stamp, rotated about its centre.
function rectStamp(cx: number, cy: number, w: number, h: number, lines: string[], angle: number, c: RGB): void {
  const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const rot = (px: number, py: number): [number, number] => [
    cx + (px - cx) * cos - (py - cy) * sin,
    cy + (px - cx) * sin + (py - cy) * cos,
  ];
  const corners: [number, number][] = [rot(cx - w / 2, cy - h / 2), rot(cx + w / 2, cy - h / 2), rot(cx + w / 2, cy + h / 2), rot(cx - w / 2, cy + h / 2)];
  polyStroke(corners, c, 0.92);
  const inner: [number, number][] = [rot(cx - w / 2 + 4, cy - h / 2 + 4), rot(cx + w / 2 - 4, cy - h / 2 + 4), rot(cx + w / 2 - 4, cy + h / 2 - 4), rot(cx - w / 2 + 4, cy + h / 2 - 4)];
  polyStroke(inner, c, 0.85);
  const n = lines.length;
  lines.forEach((ln, i) => {
    const ly = cy - ((n - 1) * 9) / 2 + i * 11 - 3;
    const lw = textWidth(ln, 1);
    // draw centred, rotated: draw unrotated text into the rotated frame by
    // rotating each glyph pixel about (cx, cy)
    const startX = cx - lw / 2;
    drawText(ln, startX, ly, 1, c, 0.92, angle, cx, cy);
  });
}

// Small island map of Vostrania with the capital starred.
function islandMap(x: number, y: number, w: number, h: number): void {
  frame(x, y, w, h, NAVY, 1);
  drawTextC("VOSTRANIA", x + w / 2, y + 6, 1, NAVY, 0.9);
  // sea
  rect(x + 1, y + 16, w - 2, h - 17, [218, 230, 236], 0.9);
  // island coastline
  const pts: [number, number][] = [
    [x + 30, y + 78], [x + 52, y + 52], [x + 88, y + 40], [x + 128, y + 46],
    [x + 158, y + 34], [x + 196, y + 48], [x + 208, y + 74], [x + 188, y + 96],
    [x + 150, y + 104], [x + 118, y + 118], [x + 82, y + 108], [x + 52, y + 98],
  ];
  polyFill(pts, [233, 224, 196], 1);
  polyStroke(pts, NAVY, 0.9);
  // capital star + label
  const sx = x + 128, sy = y + 66;
  polyFill([[sx, sy - 7], [sx + 2, sy - 2], [sx + 7, sy], [sx + 2, sy + 2], [sx, sy + 7], [sx - 2, sy + 2], [sx - 7, sy], [sx - 2, sy - 2]], RED, 1);
  drawText("TARNOVGRAD *", sx + 10, sy - 3, 1, INK, 0.95);
  drawText("PORT DRAVEN", sx - 62, sy + 22, 1, NAVY_LT, 0.9);
  // sea label + compass
  drawText("THE VOSTRAN SEA", x + 14, y + h - 14, 1, NAVY_LT, 0.85);
  drawTextC("N", x + w - 16, y + 22, 1, INK, 0.9);
  line(x + w - 16, y + 30, x + w - 16, y + 42, INK, 0.9);
  polyFill([[x + w - 16, y + 28], [x + w - 13, y + 36], [x + w - 19, y + 36]], INK, 0.9);
}

// ---------------------------------------------------------------- Layout
function field(x: number, y: number, label: string, value: string, w: number): void {
  drawText(label, x, y, 1, GREY, 0.95);
  drawText(value, x, y + 10, 2, INK, 1);
}

function drawMRZ(line: string, x: number, y: number): void {
  let cx = x;
  for (const ch of line) { drawGlyph(ch, cx, y, 2, INK, 1); cx += 11; }
}

function anchor(x: number, y: number, s: number, c: RGB): void {
  circle(x, y - 4 * s, 3 * s, c, 1, 1);
  line(x, y - 4 * s, x, y + 8 * s, c, 1);
  line(x - 6 * s, y - 1 * s, x + 6 * s, y - 1 * s, c, 1);
  line(x - 6 * s, y + 8 * s, x, y + 3 * s, c, 1);
  line(x + 6 * s, y + 8 * s, x, y + 3 * s, c, 1);
}

function drawSpread(): void {
  fill(PAPER[0], PAPER[1], PAPER[2]);
  // security guilloche across the whole spread
  guilloche(10, 10, 1014, 630, NAVY_LT, 0.10, 1.6, 46);
  guilloche(10, 10, 1014, 630, GOLD, 0.07, 1.2, 31);

  // pages
  rect(16, 16, 488, 608, PAGE, 1);
  rect(520, 16, 488, 608, PAGE, 1);
  // gutter shadow + fold
  rect(504, 16, 16, 608, [60, 50, 40], 0.10);
  vline(512, 16, 624, [90, 80, 66], 0.35, 1);
  frame(8, 8, 1008, 624, NAVY, 2);
  frame(14, 14, 996, 612, NAVY, 1);

  // ================= LEFT PAGE: data page =================
  emblem(38, 40, 0.8, NAVY, 0.95);
  drawTextC("REPUBLIC OF VOSTRANIA", 274, 28, 3, NAVY, 1);
  drawTextC("PUTOVNICA - PASSPORT - PASSEPORT", 260, 56, 1, NAVY_LT, 0.95);
  hline(28, 492, 72, NAVY, 1, 1);
  hline(28, 492, 76, NAVY, 0.6, 1);
  drawTextC("TYPE P      CODE VOS      NO. VS0419827", 260, 88, 2, INK, 1);

  // portrait
  frame(32, 108, 150, 192, NAVY, 2);
  portrait(34, 110, 146, 188, 1);
  drawTextC("PHOTOGRAPH", 107, 302, 1, GREY, 0.9);

  // data fields, two columns
  field(196, 108, "SURNAME / PREZIME", "KOVAC", 140);
  field(344, 108, "GIVEN NAMES / IMENA", "ELENA MARA", 148);
  field(196, 144, "NATIONALITY / NARODNOST", "VOSTRANIAN", 140);
  field(344, 144, "PLACE OF BIRTH / MJESTO", "TARNOVGRAD", 148);
  field(196, 180, "DATE OF BIRTH / RODENJE", "14 JUN 1987", 140);
  field(344, 180, "SEX / SPOL", "F", 148);
  field(196, 216, "ISSUED / IZDAVANJE", "12 MAR 2019", 140);
  field(344, 216, "EXPIRES / ISTEK", "12 MAR 2029", 148);

  // authority, full width under the fields
  drawText("AUTHORITY / TIJELO", 196, 252, 1, GREY, 0.95);
  drawText("MINISTRY OF THE INTERIOR", 196, 261, 2, INK, 1);

  // signature + personal details
  hline(32, 240, 322, NAVY, 0.7, 1);
  signature(48, 336, 1.1, [30, 42, 90], 0.95);
  drawText("HOLDER'S SIGNATURE / POTPIS", 32, 348, 1, GREY, 0.95);
  drawText("PERSONAL NO.", 260, 312, 1, GREY, 0.95);
  drawText("0419827-44", 260, 321, 2, INK, 1);
  drawText("HEIGHT 172 CM   EYES BROWN", 260, 348, 1, INK, 0.95);

  // observations: the telling paperwork detail
  frame(28, 366, 464, 58, NAVY, 1);
  drawText("OBSERVATIONS / NAPOMENE", 38, 374, 1, GREY, 0.95);
  drawText("HOLDER IS A CERTIFIED FERRY PILOT, GRADE II.", 38, 388, 1, INK, 1);
  drawText("VALID FOR SEA CROSSING ONLY - TARNOVGRAD TO PORT DRAVEN.", 38, 402, 1, INK, 1);
  anchor(472, 396, 1.2, NAVY);

  // notes band with faint watermark emblem
  emblem(260, 486, 2.4, NAVY, 0.07);
  drawTextC("THIS PASSPORT REMAINS THE PROPERTY OF THE", 260, 470, 1, GREY, 0.9);
  drawTextC("REPUBLIC OF VOSTRANIA AND MUST BE RETURNED ON DEMAND.", 260, 482, 1, GREY, 0.9);
  drawTextC("IF FOUND, PLEASE RETURN TO THE NEAREST VOSTRANIAN CONSULATE.", 260, 496, 1, GREY, 0.85);

  // machine-readable zone
  rect(16, 548, 488, 56, [228, 228, 222], 1);
  hline(16, 504, 548, NAVY, 0.8, 1);
  const [mrz1, mrz2] = buildMRZ();
  drawMRZ(mrz1, 20, 556);
  drawMRZ(mrz2, 20, 574);
  drawTextC("12", 260, 612, 1, GREY, 0.9);

  // ================= RIGHT PAGE: visas & stamps =================
  emblem(764, 300, 3.2, NAVY, 0.05);
  drawTextC("VISAS - VIZE", 764, 26, 2, NAVY, 1);
  hline(532, 996, 48, NAVY, 1, 1);
  hline(532, 996, 52, NAVY, 0.6, 1);

  // visa sticker, Kingdom of Dravenia
  const vc: [number, number] = [660, 118];
  const vrad = (-3 * Math.PI) / 180, vcos = Math.cos(vrad), vsin = Math.sin(vrad);
  const vrot = (px: number, py: number): [number, number] => [
    vc[0] + (px - vc[0]) * vcos - (py - vc[1]) * vsin,
    vc[1] + (px - vc[0]) * vsin + (py - vc[1]) * vcos,
  ];
  polyFill([vrot(544, 60), vrot(776, 60), vrot(776, 176), vrot(544, 176)], [226, 238, 228], 1);
  polyStroke([vrot(544, 60), vrot(776, 60), vrot(776, 176), vrot(544, 176)], TEAL, 0.95);
  polyStroke([vrot(550, 66), vrot(770, 66), vrot(770, 170), vrot(550, 170)], TEAL, 0.8);
  drawText("VISA", 556, 72, 2, TEAL, 0.95, -3, vc[0], vc[1]);
  drawText("KINGDOM OF DRAVENIA", 556, 94, 1, TEAL, 0.95, -3, vc[0], vc[1]);
  drawText("MULTIPLE ENTRIES - 90 DAYS", 556, 108, 1, INK, 0.95, -3, vc[0], vc[1]);
  drawText("VALID 01 MAY 2024 - 01 NOV 2024", 556, 122, 1, INK, 0.95, -3, vc[0], vc[1]);
  drawText("CONDITION: SEA CROSSING ONLY", 556, 136, 1, RED, 0.95, -3, vc[0], vc[1]);
  drawText("NO. DR-2024-1187", 556, 152, 1, GREY, 0.9, -3, vc[0], vc[1]);

  // border stamps: four visits, each showing entry and exit, all inside
  // the passport's validity (issued 12 MAR 2019, expires 12 MAR 2029)
  roundStamp(880, 122, 54, "DRAVENIA", "14 APR 2019", "28 APR 2019", -8, RED);
  roundStamp(660, 252, 54, "OSTARA", "03 JUL 2021", "19 JUL 2021", 6, RED);
  roundStamp(890, 302, 54, "KELDOR", "17 SEP 2022", "02 OCT 2022", -5, RED);
  roundStamp(682, 382, 54, "DRAVENIA", "05 MAY 2024", "21 MAY 2024", 9, RED);

  // ferry fee stamp
  rectStamp(645, 502, 210, 66, ["FERRY FEE PAID", "40 KN - TARNOVGRAD", "05 MAY 2024"], -6, RED_LT);

  // island map with the capital
  islandMap(740, 440, 256, 160);
  drawTextC("13", 764, 612, 1, GREY, 0.9);
}

// ---------------------------------------------------------------- Main
const outPath = process.env.MAKEFUN_OUTPUT || "/output/entry.png";
drawSpread();
const png = encodePNG(W, H, px);
const dir = outPath.slice(0, outPath.lastIndexOf("/"));
if (dir) mkdirSync(dir, { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
