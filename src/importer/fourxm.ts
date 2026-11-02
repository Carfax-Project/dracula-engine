/* Dracula 1's raw 4XM movies (Dracula 2 uses standard 4XM, which ffmpeg reads).
 *
 * Ported from dracula-port's fourxm_raw.cpp, itself ported from ScummVM's
 * video/4xm_decoder.cpp and video/4xm_utils.cpp (ScummVM is the legal property of
 * its developers). GPLv3 or later.
 *
 * The arithmetic is 32-bit like the C++ one (Math.imul, int8/uint16 wraps), so the
 * frames match it bit for bit. */

const FILE_ID = 0xfb814000, FRAME_CONTAINER = 0xfb814100, FULL_FRAME = 0xfb814210, FULL_FRAME_ALT = 0xfb814211;
const DELTA_FRAME = 0xfb814220, COMPRESSED_AUDIO = 0xfb814230, CACHED_FRAME = 0xfb814240, RAW_AUDIO = 0xfb814250;

const le32 = (d: Uint8Array, p: number) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
const le16 = (d: Uint8Array, p: number) => d[p] | (d[p + 1] << 8);
const int8 = (v: number) => (v << 24) >> 24;
const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

class RawDeltaReader {
  mode = 0; wordBitsLeft = 16; wordIndex = 1; controlWord = 0; pairIndex = 0; byteIndex = 0;
  nibbleBitsLeft = 8; nibbleWordIndex = 1; nibbleWord = 0; pairOffset = 0; byteOffset = 0;
  signedByteOffset = 0; nibbleOffset = 0; signedByteIndex = 0; separate = false;
  constructor(public d: Uint8Array, public size: number) {}

  static plain(d: Uint8Array, size: number) {
    const r = new RawDeltaReader(d, size);
    if (size < 0x18) return r;
    r.mode = le32(d, 0);
    r.pairOffset = le32(d, 8) + 0x18;
    r.byteOffset = le32(d, 12) + 0x18;
    r.signedByteOffset = r.byteOffset;
    r.nibbleOffset = le32(d, 16) + 0x18;
    r.controlWord = le32(d, 0x18);
    if (r.nibbleOffset + 4 <= size) r.nibbleWord = le32(d, r.nibbleOffset);
    return r;
  }
  static split(d: Uint8Array, size: number, base: number, pair: number, byte: number, sbyte: number, nib: number, control: number) {
    const r = new RawDeltaReader(d, size);
    r.pairOffset = base + pair;
    r.byteOffset = base + byte;
    r.signedByteOffset = base + sbyte;
    r.nibbleOffset = base + nib;
    r.separate = true;
    if (control + 4 <= size) r.controlWord = le32(d, control);
    if (r.nibbleOffset + 4 <= size) r.nibbleWord = le32(d, r.nibbleOffset);
    return r;
  }
  valid() { return this.size >= 0x18; }
  readControl2() {
    const r = this.controlWord & 3;
    if (--this.wordBitsLeft === 0) {
      const off = 0x18 + this.wordIndex * 4;
      this.controlWord = off + 4 <= this.size ? le32(this.d, off) : 0;
      ++this.wordIndex;
      this.wordBitsLeft = 16;
    } else this.controlWord >>>= 2;
    return r;
  }
  readPair() {
    const off = this.pairOffset + this.pairIndex++ * 2;
    return off + 2 <= this.size ? le16(this.d, off) : 0;
  }
  readByteIndex() {
    const off = this.byteOffset + this.byteIndex++;
    return off < this.size ? this.d[off] : 0;
  }
  readSignedByte() {
    if (!this.separate) return int8(this.readByteIndex());
    const off = this.signedByteOffset + this.signedByteIndex++;
    return off < this.size ? int8(this.d[off]) : 0;
  }
  readNibble() {
    const r = this.nibbleWord & 0xf;
    if (--this.nibbleBitsLeft === 0) {
      const off = this.nibbleOffset + this.nibbleWordIndex * 4;
      this.nibbleWord = off + 4 <= this.size ? le32(this.d, off) : 0;
      ++this.nibbleWordIndex;
      this.nibbleBitsLeft = 8;
    } else this.nibbleWord >>>= 4;
    return r;
  }
}

// [swapAxes, flipX, flipY]
const TRANSFORMS: [boolean, boolean, boolean][] = [
  [false, false, false], [false, true, false], [false, false, true], [false, true, true],
  [true, true, true], [true, false, true], [true, true, false], [true, false, false]];

const RAW_ORDER = [
  0, 1, 8, 9, 2, 3, 10, 11, 16, 17, 24, 25, 18, 19, 26, 27, 4, 5, 12, 20, 13, 6, 7, 14, 21, 28, 29, 22, 15, 23, 30, 31,
  32, 33, 40, 48, 41, 34, 35, 42, 49, 56, 57, 50, 43, 51, 58, 59, 36, 37, 44, 52, 45, 38, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const DCT_ORDER = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

// [zeroes, values]
const TOKENS: [number, number[]][] = [[64, []], [5, []], [1, [1]], [1, [-1]], [2, [1]], [1, [0, -1]], [2, [0, 1]], [3, [-1]]];

const sign2 = (v: number) => (v & 2 ? v | ~3 : v + 1);
const sign4 = (v: number) => (v & 8 ? v | ~15 : v + 1);

interface NibbleSource { readNibble(): number }

function readToken(r: NibbleSource, signedByte: () => number, order: number[], coeff: Int32Array, index: number) {
  const zero = (count: number) => { for (let i = 0; i < count && index < 64; ++i, ++index) coeff[order[index]] = 0; };
  const write = (v: number) => { if (index < 64) coeff[order[index++]] = v; };
  const code = r.readNibble();
  if (code <= 7) {
    const [zeroes, values] = TOKENS[code];
    zero(code === 0 ? 64 - index : zeroes);
    for (const v of values) write(v);
  } else if (code === 8) {
    const header = r.readNibble(), pair = r.readNibble();
    zero((header >> 2) + 1);
    write(sign2(pair >> 2));
    write(sign2(pair & 3));
    if (header & 3) {
      const extra = r.readNibble();
      write(sign2(extra >> 2));
      if ((header & 3) > 1) write(sign2(extra & 3));
      if ((header & 3) > 2) write(sign2(r.readNibble() >> 2));
    }
  } else if (code === 9) {
    const header = r.readNibble();
    zero((header >> 2) + 1);
    for (let i = 0; i <= (header & 3); ++i) write(sign4(r.readNibble()));
  } else if (code === 10) {
    const v = r.readNibble();
    write(sign2(v >> 2));
    write(sign2(v & 3));
  } else if (code <= 13) {
    for (let i = 0; i < code - 10; ++i) write(sign4(r.readNibble()));
  } else if (code === 14) write(0);
  else write(signedByte());
  return index;
}

function buildMotionTables(width: number) {
  const full: number[] = [];
  for (let radius = 0; radius < 0x801; ++radius) {
    for (let y = -0x20; y < 0x20; ++y) for (let x = -0x20; x < 0x20; ++x) if (x * x + y * y === radius) full.push(y * width + x);
  }
  const scale = Math.fround(0.021327873691916466);
  const exp: number[] = new Array(0x100).fill(0);
  let last = -1;
  for (let i = 0, out = 0; out < exp.length; ++i) {
    let index = Math.floor(Math.fround(Math.exp(Math.fround(i * scale)))) - 1;
    if (index >= full.length) index = full.length - 1;
    if (last < index) { exp[out++] = full[index]; last = index; }
  }
  return { full, exp };
}

function copyRawBlock(dst: Uint16Array, d0: number, src: Uint16Array, s0: number, stride: number, w: number, h: number, mode: number, add: number) {
  const sw = mode >= 4 ? h : w, sh = mode >= 4 ? w : h;
  const [swap, flipX, flipY] = TRANSFORMS[mode & 7];
  for (let sy = 0; sy < sh; ++sy) {
    for (let sx = 0; sx < sw; ++sx) {
      let dx = swap ? sy : sx, dy = swap ? sx : sy;
      if (flipX) dx = w - 1 - dx;
      if (flipY) dy = h - 1 - dy;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) dst[d0 + dy * stride + dx] = src[s0 + sy * stride + sx] + add;
    }
  }
}

function readRawCoefficients(r: RawDeltaReader) {
  const coeffs = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
  for (const coeff of coeffs) {
    coeff[0] = r.readSignedByte();
    for (let index = 1; index <= 63;) index = readToken(r, () => r.readSignedByte(), RAW_ORDER, coeff, index);
  }
  return coeffs;
}

function transformRaw(coeff: Int32Array, scaleCode: number, chroma: boolean) {
  const dst = new Int32Array(64);
  if (!chroma) coeff[0] <<= 1;
  const temp = new Int32Array(64), first = new Int32Array(10);
  const dc = 1 << scaleCode, s1 = 1 << (scaleCode + 2), s2 = 1 << (scaleCode + 4);
  const m = Math.imul;
  const b0 = m(coeff[8] + coeff[0], dc), b1 = m(coeff[0] - coeff[8], dc);
  const b2 = m(coeff[1] + coeff[9], dc), b3 = m(coeff[1] - coeff[9], dc);
  first[0] = b2 + b0; first[1] = b0 - b2; first[8] = b3 + b1; first[9] = b1 - b3;
  for (let y = 0; y < 4; y += 2) {
    for (let x = 0; x < 4; x += 2) {
      const i = (x >> 1) + (y >> 1) * 8;
      const v0 = (first[i] + m(coeff[i + 0x10], s1)) | 0, v1 = (first[i] - m(coeff[i + 0x10], s1)) | 0;
      const v2 = coeff[i + 2] + coeff[i + 0x12], v3 = (m(coeff[i + 2], s1) - m(coeff[i + 0x12], s1)) | 0;
      temp[y * 8 + x] = m(v2, s1) + v0;
      temp[y * 8 + x + 1] = v0 - m(v2, s1);
      temp[(y + 1) * 8 + x] = v3 + v1;
      temp[(y + 1) * 8 + x + 1] = v1 - v3;
    }
  }
  for (let y = 0; y < 8; y += 2) {
    for (let x = 0; x < 8; x += 2) {
      const i = (x >> 1) + (y >> 1) * 8;
      const v0 = (m(coeff[i + 0x20], s2) + temp[i]) | 0, v1 = (temp[i] - m(coeff[i + 0x20], s2)) | 0;
      const v2 = coeff[i + 4] + coeff[i + 0x24], v3 = (m(coeff[i + 4], s2) - m(coeff[i + 0x24], s2)) | 0;
      dst[y * 8 + x] = ((v0 + m(v2, s2)) | 0) >> 6;
      dst[y * 8 + x + 1] = ((v0 - m(v2, s2)) | 0) >> 6;
      dst[(y + 1) * 8 + x] = ((v3 + v1) | 0) >> 6;
      dst[(y + 1) * 8 + x + 1] = ((v1 - v3) | 0) >> 6;
    }
  }
  return dst;
}

function writeRawDctBlock(y: Int32Array, cb: Int32Array, cr: Int32Array, dst: Uint16Array, d0: number, stride: number) {
  for (let py = 0; py < 8; ++py) {
    for (let px = 0; px < 8; ++px) {
      const i = py * 8 + px, luma = y[i] + 0x80, r_ = cr[i], b_ = cb[i];
      const r = clip((r_ + luma) >> 3, 0, 0x1f);
      const g = clip((luma - ((r_ + b_) >> 1)) >> 3, 0, 0x1f);
      const b = clip((luma + b_ * 2) >> 3, 0, 0x1f);
      dst[d0 + py * stride + px] = (r << 10) | (g << 5) | b;
    }
  }
}

function rawDctBlock(r: RawDeltaReader, dst: Uint16Array, off: number, fw: number) {
  const sy = r.readNibble(), scb = r.readNibble(), scr = r.readNibble();
  const [cy, ccb, ccr] = readRawCoefficients(r);
  writeRawDctBlock(transformRaw(cy, sy, false), transformRaw(ccb, scb, true), transformRaw(ccr, scr, true), dst, off, fw);
}

function applyDelta(d: Uint8Array, dst: Uint16Array, src: Uint16Array, fw: number, fh: number, full: number[], exp: number[]) {
  const r = RawDeltaReader.plain(d, d.length);
  if (!r.valid()) return false;
  const copyLeaf = (off: number, bw: number, bh: number, op: number) => {
    let motion: number, transform: number, addFlag: number;
    if (r.mode === 0) {
      const packed = r.readPair();
      motion = packed & 0xfff; transform = (packed >> 12) & 7; addFlag = packed >> 15;
    } else {
      motion = r.readByteIndex();
      const packed = r.readNibble();
      transform = packed & 7; addFlag = (packed & 0xf) >> 3;
    }
    let add = 0;
    if (op === 3 && !addFlag) return true;
    if (addFlag) {
      const p = r.readPair();
      if (op === 3) {
        add = (int8(((p >> 5) & 0x1f) - 0x10) & 0xf) * 0x40 + (int8(((p >> 10) & 0x1f) - 0x10) & 0xf) * 0x800
          + ((((p & 0xff & 0x1f) - 0x10) * 2) & 0xff & 0x1f);
      } else {
        add = ((int8(((p >> 10) & 0x1f) - 0x10) & 0x1f) * 0x20 + (int8(((p >> 5) & 0x1f) - 0x10) & 0x1f)) * 0x20
          + (int8((p & 0x1f) - 0x10) & 0x1f);
      }
    }
    const table = r.mode === 0 ? full : exp;
    let srcOff = off;
    if (motion < table.length) srcOff += table[motion];
    const sw = transform < 4 ? bw : bh, sh = transform < 4 ? bh : bw;
    if (srcOff < 0 || srcOff + fw * (sh - 1) + sw - 1 >= fw * fh) return false;
    copyRawBlock(dst, off, src, srcOff, fw, bw, bh, transform, add);
    return true;
  };
  const decodeBlock = (off: number, bw: number, bh: number, allowDct: boolean): boolean => {
    switch (r.readControl2() & 3) {
      case 0: return copyLeaf(off, bw, bh, 0);
      case 1:
        if (bh < 2) return false;
        decodeBlock(off, bw, bh >> 1, false);
        decodeBlock(off + fw * (bh >> 1), bw, bh >> 1, false);
        return true;
      case 2:
        if (bw < 2) return false;
        decodeBlock(off, bw >> 1, bh, false);
        decodeBlock(off + (bw >> 1), bw >> 1, bh, false);
        return true;
      default: {
        const sub = r.readControl2();
        if (sub === 0 && allowDct) { rawDctBlock(r, dst, off, fw); return true; }
        if (sub === 2) return copyLeaf(off, bw, bh, 3);
        return false;
      }
    }
  };
  let off = 0;
  for (let y = 0; y < (fh + 7) >> 3; ++y) {
    for (let x = 0; x < (fw + 7) >> 3; ++x) { decodeBlock(off, 8, 8, true); off += 8; }
    off += fw * 7;
  }
  return true;
}

class NibbleDctReader {
  bytePos = 0; nibbleWordPos = 1; nibbleBitsLeft = 8; nibbleWord = 0;
  byteStart = -1; byteSize = 0; nibbleStart = -1; nibbleSize = 0;
  constructor(private d: Uint8Array) {
    if (d.length < 8) return;
    const nibOff = le32(d, 0);
    if (nibOff + 4 > d.length) return;
    this.byteStart = 4; this.byteSize = nibOff;
    this.nibbleStart = nibOff + 4; this.nibbleSize = d.length - nibOff - 4;
    this.nibbleWord = this.nibbleSize >= 4 ? le32(d, this.nibbleStart) : 0;
  }
  valid() { return this.byteStart >= 0; }
  readByte() { return this.bytePos < this.byteSize ? this.d[this.byteStart + this.bytePos++] : 0; }
  readNibble() {
    const r = this.nibbleWord & 0xf;
    if (--this.nibbleBitsLeft === 0) {
      const off = this.nibbleWordPos * 4;
      this.nibbleWord = off + 4 <= this.nibbleSize ? le32(this.d, this.nibbleStart + off) : 0;
      ++this.nibbleWordPos;
      this.nibbleBitsLeft = 8;
    } else this.nibbleWord >>>= 4;
    return r;
  }
}

const DCT_QUANT = [
  [32, 31, 26, 38, 48, 63, 55, 34, 33, 46, 51, 62, 72, 126, 90, 42, 37, 47, 55, 74, 105, 117, 98, 40, 33, 55, 68, 80, 120, 161, 102, 40,
    36, 61, 97, 132, 136, 171, 111, 42, 38, 76, 113, 118, 127, 128, 96, 40, 53, 96, 110, 111, 111, 103, 70, 30, 40, 70, 68, 64, 62, 43, 31, 15],
  [64, 61, 52, 75, 96, 126, 110, 67, 67, 92, 101, 124, 144, 253, 180, 84, 73, 94, 109, 147, 209, 234, 195, 81, 66, 111, 135, 160, 240, 322, 204, 80,
    72, 122, 193, 263, 272, 343, 223, 85, 75, 153, 226, 237, 255, 257, 192, 80, 106, 192, 221, 221, 223, 206, 141, 60, 79, 141, 137, 127, 124, 87, 62, 30],
  [8, 12, 16, 28, 50, 39, 27, 14, 12, 20, 24, 54, 69, 54, 37, 19, 16, 24, 48, 76, 65, 51, 35, 18, 28, 54, 76, 68, 58, 46, 31, 16,
    50, 69, 65, 58, 50, 39, 27, 14, 39, 54, 51, 46, 39, 31, 21, 11, 27, 37, 35, 31, 27, 21, 14, 7, 14, 19, 18, 16, 14, 11, 7, 4],
  [16, 25, 31, 55, 99, 78, 54, 27, 25, 40, 47, 108, 137, 108, 74, 38, 31, 47, 96, 152, 129, 102, 70, 36, 55, 108, 152, 137, 116, 91, 63, 32,
    99, 137, 129, 116, 99, 78, 54, 27, 78, 108, 102, 91, 78, 61, 42, 21, 54, 74, 70, 63, 54, 42, 29, 15, 27, 38, 36, 32, 27, 21, 15, 8],
  [128, 122, 105, 151, 192, 251, 221, 135, 133, 185, 203, 248, 289, 506, 360, 168, 146, 188, 219, 295, 418, 468, 390, 161, 132, 222, 270, 321, 480, 643, 407, 161,
    144, 244, 387, 527, 544, 685, 446, 170, 151, 305, 452, 473, 509, 514, 384, 160, 212, 384, 441, 443, 446, 412, 281, 121, 159, 282, 274, 254, 247, 173, 123, 60]];

function idct1D(b: Int32Array, o: number, step: number, shift: number) {
  const m = (v: number, c: number) => Math.imul(v, c) >> 16;
  const in0 = b[o], in1 = b[o + step], in2 = b[o + 2 * step], in3 = b[o + 3 * step];
  const in4 = b[o + 4 * step], in5 = b[o + 5 * step], in6 = b[o + 6 * step], in7 = b[o + 7 * step];
  const e04s = (in0 + in4) | 0, e04d = (in0 - in4) | 0, e26s = (in2 + in6) | 0;
  const evenSum = (e04s + e26s) | 0, evenDiff = (e04s - e26s) | 0;
  const e26r = (m((in2 - in6) | 0, 0x16a0a) - e26s) | 0;
  const midA = (e26r + e04d) | 0, midB = (e04d - e26r) | 0;
  const o35s = (in3 + in5) | 0, o35d = (in5 - in3) | 0, o17s = (in7 + in1) | 0, o17d = (in1 - in7) | 0;
  const oddSum = (o17s + o35s) | 0;
  const oddRot = m((o17d + o35d) | 0, 0x1d907);
  const oddA = ((m(o35d, -0x29cf6) - oddSum) + oddRot) | 0;
  const oddB = (m((o17s - o35s) | 0, 0x16a0a) - oddA) | 0;
  const oddC = ((m(o17d, 0x11518) - oddRot) + oddB) | 0;
  b[o] = ((oddSum + evenSum) | 0) >> shift;
  b[o + 7 * step] = ((evenSum - oddSum) | 0) >> shift;
  b[o + step] = ((oddA + midA) | 0) >> shift;
  b[o + 6 * step] = ((midA - oddA) | 0) >> shift;
  b[o + 5 * step] = ((midB - oddB) | 0) >> shift;
  b[o + 4 * step] = ((oddC + evenDiff) | 0) >> shift;
  b[o + 2 * step] = ((oddB + midB) | 0) >> shift;
  b[o + 3 * step] = ((evenDiff - oddC) | 0) >> shift;
}

function idct(coeff: Int32Array, quant: number[]) {
  const out = new Int32Array(64);
  for (let i = 0; i < 64; ++i) out[i] = Math.imul(coeff[i], quant[i]);
  for (let x = 0; x < 8; ++x) idct1D(out, x, 8, 0);
  for (let y = 0; y < 8; ++y) idct1D(out, y * 8, 1, 6);
  return out;
}

function writeDctRgbPixel(rgb: Uint8Array, o: number, y: number, cb: number, cr: number) {
  rgb[o] = clip(y + cb * 2, 0, 0xff);
  rgb[o + 1] = clip(y - ((cb + cr) >> 1), 0, 0xff);
  rgb[o + 2] = clip(y + cr, 0, 0xff);
}

function writeDctTile(rgb: Uint8Array, stride: number, dstX: number, dstY: number, planes: Int32Array[]) {
  const getY = (i: number) => planes[i >> 6][i & 0x3f];
  let yIndex = 0;
  for (let block = 0; block < 4; ++block) {
    const bx = block & 1, by = block >> 1;
    let ci = (bx + by * 8) * 4;
    let po = ((dstY + by * 8) * stride + dstX + bx * 8) * 4;
    for (let y = 0; y < 4; ++y) {
      let ro = po;
      for (let x = 0; x < 4; ++x) {
        const cb = planes[4][ci], cr = planes[5][ci];
        writeDctRgbPixel(rgb, ro, getY(yIndex) + 0x80, cb, cr);
        writeDctRgbPixel(rgb, ro + 4, getY(yIndex + 1) + 0x80, cb, cr);
        writeDctRgbPixel(rgb, ro + stride * 4, getY(yIndex + 8) + 0x80, cb, cr);
        writeDctRgbPixel(rgb, ro + stride * 4 + 4, getY(yIndex + 9) + 0x80, cb, cr);
        yIndex += 2;
        ro += 8;
        ++ci;
      }
      po += stride * 8;
      ci += 4;
      yIndex += 8;
    }
  }
}

const qComp = (v: number) => Math.min((((clip(v, 0, 0xff0000) >> 16) & 0xff) + 4) >> 3, 0x1f) << 3;

function ditherTo555(rgb: Uint8Array, dst: Uint16Array, w: number, h: number) {
  const err = new Int32Array(w * h * 3 + w * 3 + 16);
  for (let i = 0; i < w * h; ++i) {
    err[i * 3] = rgb[i * 4] << 16; err[i * 3 + 1] = rgb[i * 4 + 1] << 16; err[i * 3 + 2] = rgb[i * 4 + 2] << 16;
  }
  const clampPix = (p: number) => { for (let k = -2; k <= 0; ++k) err[p + k] = clip(err[p + k], 0, 0xff0000); };
  const W = [7, 5, 3, 1];
  const step = (p: number, below: number, pn: number, a: number, b: number, c: number) => {
    clampPix(p);
    const diff: number[] = [];
    for (let k = -2; k <= 0; ++k) { const q = qComp(err[p + k]); diff.push(err[p + k] - (q << 16)); err[p + k] = q << 16; }
    const targets = [p + pn, below + a, below + b, below + c];
    for (let i = 0; i < 4; ++i) for (let k = 0; k < 3; ++k) err[targets[i] + k] += (diff[k] * W[i]) >> 4;
  };
  for (let y = 0; y < h - 1; ++y) {
    if ((y & 1) === 0) {
      let p = y * w * 3 + 2, bl = (y + 1) * w * 3 + 2;
      for (let x = 0; x < w - 1; ++x, p += 3, bl += 3) step(p, bl, 1, -2, -5, 1);
    } else {
      let p = y * w * 3 + (w - 2) * 3 + 2, bl = (y + 1) * w * 3 + (w - 2) * 3 + 2;
      for (let x = 0; x < w - 1; ++x, p -= 3, bl -= 3) step(p, bl, -5, -2, 1, -5);
    }
  }
  for (let i = 0; i < w * h; ++i) {
    const p = i * 3 + 2;
    clampPix(p);
    dst[i] = ((qComp(err[p]) >> 3) << 10) | ((qComp(err[p - 1]) >> 3) << 5) | (qComp(err[p - 2]) >> 3);
  }
}

function applyFullDct(d: Uint8Array, dst: Uint16Array, w: number, h: number, alt: boolean) {
  const r = new NibbleDctReader(d);
  if (!r.valid() || w <= 0 || h <= 0) return false;
  const rgb = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w; x += 16) {
      const flags = r.readByte();
      const coeffs: Int32Array[] = [];
      for (let b = 0; b < 6; ++b) {
        const c = new Int32Array(64);
        c[0] = int8(r.readByte());
        for (let index = 1; index <= 63;) index = readToken(r, () => int8(r.readByte()), DCT_ORDER, c, index);
        coeffs.push(c);
      }
      const planes = [0, 1, 2, 3].map((i) => idct(coeffs[i], DCT_QUANT[flags & (1 << i) ? 1 : 0]));
      if (alt) {
        planes.push(idct(coeffs[4], DCT_QUANT[flags & 0x10 ? 4 : 1]), idct(coeffs[5], DCT_QUANT[flags & 0x20 ? 4 : 1]));
      } else {
        planes.push(idct(coeffs[4], DCT_QUANT[flags & 0x10 ? 3 : 2]), idct(coeffs[5], DCT_QUANT[flags & 0x20 ? 3 : 2]));
      }
      if (x + 16 <= w && y + 16 <= h) writeDctTile(rgb, w, x, y, planes);
    }
  }
  ditherTo555(rgb, dst, w, h);
  return true;
}

function applyNativeDelta(d: Uint8Array, dst: Uint16Array, src: Uint16Array, fw: number, fh: number, motion: number[]) {
  const size = d.length;
  if (size < 0x24 || fw <= 0 || fh <= 0) return false;
  const addOff = le32(d, 8), byteOff = le32(d, 12), sbyteOff = le32(d, 16), nibOff = le32(d, 24);
  if (0x20 + addOff > size || 0x20 + byteOff > size || 0x20 + sbyteOff > size || 0x20 + nibOff > size) return false;
  const dct = RawDeltaReader.split(d, size, 0x20, addOff, byteOff, sbyteOff, nibOff, 0x20);
  if (!dct.valid()) return false;
  let controlWord = le32(d, 0x20), controlBitsLeft = 32, controlPos = 0x24, addPos = 0, bytePos = 0;
  const addStart = 0x20 + addOff, addSize = size - addStart, byteStart = 0x20 + byteOff, byteSize = size - byteStart;
  const readBit = () => {
    const r = (controlWord & 0x80000000) !== 0;
    controlWord = (controlWord << 1) >>> 0;
    if (--controlBitsLeft === 0) {
      controlWord = controlPos + 4 <= size ? le32(d, controlPos) : 0;
      controlPos += 4;
      controlBitsLeft = 32;
    }
    return r;
  };
  const copyBlock = (off: number, bw: number, bh: number, add: boolean) => {
    const mi = bytePos < byteSize ? d[byteStart + bytePos++] : 0;
    let addValue = 0;
    if (add) { const o = addPos++ * 2; addValue = o + 2 <= addSize ? le16(d, addStart + o) : 0; }
    if (off < 0 || off + fw * (bh - 1) + bw > fw * fh) return;
    let srcOff = off;
    if (mi < motion.length) srcOff += motion[mi];
    if (srcOff < 0 || srcOff + fw * (bh - 1) + bw > fw * fh) return;
    for (let y = 0; y < bh; ++y) {
      const sr = srcOff + y * fw, dr = off + y * fw;
      if (!add) for (let x = 0; x < bw; ++x) dst[dr + x] = src[sr + x];
      else if (bw === 1) dst[dr] = src[sr] + addValue;
      else {
        for (let x = 0; x < bw; x += 2) {
          dst[dr + x] = (src[sr + x] & 0x7fff) + addValue;
          dst[dr + x + 1] = (src[sr + x + 1] & 0x7fff) + addValue + (((src[sr + x] & 0x7fff) + addValue) >> 16);
        }
      }
    }
  };
  const decodeBlock = (off: number, bw: number, bh: number, allowDct: boolean): void => {
    if (!readBit()) return copyBlock(off, bw, bh, false);
    const canV = bh > 1 && (bw > 1 || bh > 2), canH = bw > 1 && (bh > 1 || bw > 2);
    if (canV && !readBit()) {
      const top = bh >> 1;
      decodeBlock(off, bw, top, false);
      decodeBlock(off + top * fw, bw, bh - top, false);
      return;
    }
    if (canH && !readBit()) {
      const left = bw >> 1;
      decodeBlock(off, left, bh, false);
      decodeBlock(off + left, bw - left, bh, false);
      return;
    }
    if (!readBit()) return;
    if (!allowDct || !readBit()) return copyBlock(off, bw, bh, true);
    if (bw === 8 && bh === 8) rawDctBlock(dct, dst, off, fw);
  };
  for (let y = 0; y < fh; y += 8) for (let x = 0; x < fw; x += 8) decodeBlock(y * fw + x, Math.min(8, fw - x), Math.min(8, fh - y), true);
  return true;
}

const STEP_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];

export interface RawMovieInfo { width: number; height: number; fps: number; channels: number; sampleRate: number }

export const isRawMovie = (d: Uint8Array) => d.length >= 8 && le32(d, 0) === FILE_ID;

export class RawMovie {
  info: RawMovieInfo;
  frames: [number, number][] = [];
  private cur = 0;
  private frame: Uint16Array;
  private prev: Uint16Array;
  private full: number[];
  private exp: number[];
  private cache: { frame: number; declared: number; data: number[] }[] = [];
  private native = false;
  private codec: number;
  private bits: number;
  private predictor = [0, 0];
  private stepIndex = [0, 0];
  pcm: number[] = [];

  constructor(private d: Uint8Array) {
    if (d.length < 0x88 || le32(d, 0) !== FILE_ID || le32(d, 4) !== 0x01000000) throw new Error('not a raw 4XM movie');
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const fps = v.getFloat32(28, true);
    this.info = { width: le32(d, 8), height: le32(d, 12), fps: fps > 0 ? fps : 15, channels: le16(d, 34), sampleRate: le32(d, 36) };
    this.codec = le16(d, 32);
    this.bits = le16(d, 46);
    if (!this.info.width || !this.info.height) throw new Error('raw 4XM movie without size');
    for (let pos = 0x88; pos + 8 <= d.length;) {
      const id = le32(d, pos), sz = le32(d, pos + 4);
      if (sz < 8 || pos + sz > d.length) break;
      if (id === FRAME_CONTAINER) this.frames.push([pos, pos + sz]);
      pos += sz;
    }
    if (!this.frames.length) throw new Error('raw 4XM movie without frames');
    this.frame = new Uint16Array(this.info.width * this.info.height);
    this.prev = new Uint16Array(this.info.width * this.info.height);
    for (let i = 0; i < 256; ++i) this.cache.push({ frame: -1, declared: 0, data: [] });
    ({ full: this.full, exp: this.exp } = buildMotionTables(this.info.width));
  }

  // The frame on screen after decoding the next one (RGB555); `pcm` holds its audio.
  next(): Uint16Array {
    this.pcm = [];
    let shown = this.prev;
    if (this.cur >= this.frames.length) return shown;
    const [start] = this.frames[this.cur];
    const sz = le32(this.d, start + 4);
    if (this.container(this.d.subarray(start + 8, start + sz), this.cur)) {
      shown = this.frame;
      [this.frame, this.prev] = [this.prev, this.frame];
    }
    ++this.cur;
    return shown;
  }

  private fullFrame(p: Uint8Array, alt: boolean) {
    const { width: w, height: h } = this.info;
    if (p.length < w * h * 2) {
      const ok = applyFullDct(p, this.frame, w, h, alt);
      this.native = ok;
      return ok;
    }
    this.native = false;
    for (let i = 0; i < w * h; ++i) this.frame[i] = le16(p, i * 2);
    return true;
  }

  private cacheEntry(frame: number) {
    let e = this.cache.find((c) => c.frame === frame) ?? this.cache.find((c) => c.frame === -1);
    if (!e) e = this.cache[0];
    if (e.frame !== frame) { e.frame = frame; e.declared = 0; e.data = []; }
    return e;
  }

  private cachedFrame(p: Uint8Array, current: number): boolean {
    if (p.length < 8) return false;
    const cacheFrame = le32(p, 0) | 0, declared = le32(p, 4);
    const e = this.cacheEntry(cacheFrame);
    e.declared = declared;
    for (const b of p.subarray(8)) e.data.push(b);
    const data = Uint8Array.from(e.data);
    if (cacheFrame !== current || data.length < 8 || le32(data, 0) !== FRAME_CONTAINER) return false;
    const nestedDeclared = e.declared >= 8 ? e.declared : le32(data, 4);
    const nestedSize = Math.min(data.length - 8, nestedDeclared - 8);
    e.frame = -1; e.declared = 0; e.data = [];
    return this.container(data.subarray(8, 8 + nestedSize), current);
  }

  private container(p: Uint8Array, current: number): boolean {
    const { width: w, height: h } = this.info;
    let changed = false;
    for (let pos = 0; pos + 8 <= p.length;) {
      const id = le32(p, pos), sz = le32(p, pos + 4);
      if (sz < 8 || pos + sz > p.length) break;
      const sub = p.subarray(pos + 8, pos + sz);
      if (id === FULL_FRAME || id === FULL_FRAME_ALT) changed = this.fullFrame(sub, id === FULL_FRAME_ALT) || changed;
      else if (id === DELTA_FRAME) {
        changed = (this.native ? applyNativeDelta(sub, this.frame, this.prev, w, h, this.exp)
          : applyDelta(sub, this.frame, this.prev, w, h, this.full, this.exp)) || changed;
      } else if (id === CACHED_FRAME) changed = this.cachedFrame(sub, current) || changed;
      else if (id === COMPRESSED_AUDIO) this.adpcm(sub);
      else if (id === RAW_AUDIO) for (let i = 4; i + 1 < sub.length; i += 2) this.pcm.push((le16(sub, i) << 16) >> 16);
      pos += sz;
    }
    return changed;
  }

  private nibble(n: number, ch: number) {
    const step = IMA[this.stepIndex[ch]];
    const diff = ((step >> 1) + (n & 7) * step) >> 3;
    this.predictor[ch] = clip(this.predictor[ch] + (n & 8 ? -diff : diff), -32768, 32767);
    this.stepIndex[ch] = clip(this.stepIndex[ch] + STEP_ADJUST[n], 0, 88);
    return this.predictor[ch];
  }

  private adpcmChannel(src: Uint8Array, ch: number, samples: number) {
    const out = new Array<number>(samples).fill(0);
    for (let i = 0; i < samples; ++i) {
      const off = (i >> 3) * 4 + ((i & 7) >> 1);
      if (off >= src.length) break;
      out[i] = this.nibble(i & 1 ? src[off] >> 4 : src[off] & 0xf, ch);
    }
    return out;
  }

  private adpcm(p: Uint8Array) {
    const ch = this.info.channels;
    if (this.codec !== 1 || this.bits !== 16 || p.length < 4 || (ch !== 1 && ch !== 2)) return;
    const spc = Math.floor(le32(p, 0) / (ch * 2));
    if (!spc) return;
    const src = p.subarray(4);
    if (ch === 1) { this.pcm.push(...this.adpcmChannel(src, 0, spc)); return; }
    const chSize = ((spc + 7) >> 3) * 4;
    const l = this.adpcmChannel(src.subarray(0, Math.min(src.length, chSize)), 0, spc);
    const r = src.length > chSize ? this.adpcmChannel(src.subarray(chSize), 1, spc) : new Array<number>(spc).fill(0);
    for (let i = 0; i < spc; ++i) this.pcm.push(l[i], r[i]);
  }
}
