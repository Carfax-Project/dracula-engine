/* PhoenixVR .vr pictures: 2D screens, 360° panoramas (six cube faces) and the
 * animations patched onto them.
 *
 * Decoding ported from dracula-port's vr_dump.cpp, itself ported from ScummVM's
 * engines/phoenixvr/vr.cpp, dct_tables.h, video/4xm_utils.cpp and
 * common/compression/huffman.h (ScummVM is the legal property of its developers).
 * GPLv3 or later. */

export interface Rgb { w: number; h: number; rgb: Uint8Array }
export interface VrPatch { atlas: Rgb; blocks: [number, number, number][] }
export interface VrAnim { name: string; restart: number; frames: VrPatch[] }
export interface VrPicture { type: 'panorama' | 'screen'; images: Rgb[]; anims: VrAnim[] }

const CHUNK_VR = 0x12fa84ab, V2_CHUNK_VR = 0x44414548;
const STATIC_2D = [0xa0b1c400, 0x43505453], STATIC_3D = [0xa0b1c200, 0x50575453];
const ANIMATION = [0xa0b1c201, 0x50574e41], ANIM_BLOCK = [0xa0b1c211, 0x4d415246];
const ANIM_RESTART = [0xa0b1c221, 0x504d554a];

const TILE = 256, FACE = 512;

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48,
  41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
  15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QY = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QUV = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
const Q = [
  0x4000, 0x58C5, 0x539F, 0x4B42, 0x4000, 0x3249, 0x22A3, 0x11A8, 0x58C5, 0x7B21, 0x73FC, 0x6862, 0x58C5, 0x45BF, 0x300B, 0x187E,
  0x539F, 0x73FC, 0x6D41, 0x6254, 0x539F, 0x41B3, 0x2D41, 0x1712, 0x4B42, 0x6862, 0x6254, 0x587E, 0x4B42, 0x3B21, 0x28BA, 0x14C3,
  0x4000, 0x58C5, 0x539F, 0x4B42, 0x4000, 0x3249, 0x22A3, 0x11A8, 0x3249, 0x45BF, 0x41B3, 0x3B21, 0x3249, 0x2782, 0x1B37, 0x0DE0,
  0x22A3, 0x300B, 0x2D41, 0x28BA, 0x22A3, 0x1B37, 0x12BF, 0x098E, 0x11A8, 0x187E, 0x1712, 0x14C3, 0x11A8, 0x0DE0, 0x098E, 0x04DF];

const le32 = (d: Uint8Array, p: number) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;

class BitReader {   // MSB first, zero padded past the end
  pos = 0;
  constructor(private d: Uint8Array, private start: number, private end: number) {}
  bit() {
    const i = this.start + (this.pos >> 3);
    const b = i < this.end ? (this.d[i] >> (7 - (this.pos & 7))) & 1 : 0;
    this.pos++;
    return b;
  }
  bits(n: number) {
    let v = 0;
    while (n--) v = (v << 1) | this.bit();
    return v >>> 0;
  }
  peek(n: number) {
    const save = this.pos, v = this.bits(n);
    this.pos = save;
    return v;
  }
}

const reverseBits = (v: number, n: number) => {
  let r = 0;
  while (n--) { r = (r << 1) | (v & 1); v >>>= 1; }
  return r;
};
const readInt = (value: number, n: number) => (n === 0 ? 0 : (value & (1 << (n - 1))) === 0 ? value + 1 - (1 << n) : value);

const FAST = 10;

// Built exactly like Common::Huffman::fromFrequencies: the codes must match bit for bit.
class Huffman {
  private byLen: Map<number, number>[] = [];
  private maxLen = 0;
  private fast = new Int32Array(1 << FAST);   // (symbol << 5 | length) + 1 for short codes

  constructor(freq: number[], symbols: number[]) {
    const n = freq.length, END = -1;
    const codes = new Array<number>(n).fill(0), lengths = new Array<number>(n).fill(0);
    const syms = freq.map((f) => ({ zero: END, one: END, freq: f }));
    const appendBit = (top: number, bit: boolean) => {
      const queue = [top];
      for (let q = 0; q < queue.length; ++q) {
        const idx = queue[q];
        if (idx < n) {
          if (bit) codes[idx] += 2 ** lengths[idx];
          ++lengths[idx];
        } else queue.push(syms[idx].zero, syms[idx].one);
      }
    };
    for (;;) {
      let s1 = END, s2 = END;
      for (let idx = 0; idx < syms.length; ++idx) {
        const s = syms[idx];
        if (s.freq === 0) continue;
        if (s1 !== END && s.freq >= syms[s1].freq) {
          if (s2 === END || s.freq < syms[s2].freq) s2 = idx;
        } else { s2 = s1; s1 = idx; }
      }
      if (s2 === END) break;
      const sum = syms[s1].freq + syms[s2].freq;
      syms[s1].freq = 0;
      syms[s2].freq = 0;
      syms.push({ zero: s1, one: s2, freq: sum });
      appendBit(s1, false);
      appendBit(s2, true);
    }
    for (let i = 0; i < n; ++i) {
      const len = lengths[i];
      (this.byLen[len] ??= new Map()).set(codes[i], symbols[i]);
      this.maxLen = Math.max(this.maxLen, len);
      if (len >= 1 && len <= FAST) {
        const base = codes[i] * 2 ** (FAST - len);
        for (let k = 0; k < 2 ** (FAST - len); ++k) this.fast[base + k] = ((symbols[i] << 5) | len) + 1;
      }
    }
  }

  get(br: BitReader) {
    const f = this.fast[br.peek(FAST)];
    if (f) { br.pos += (f - 1) & 31; return (f - 1) >> 5; }
    let code = 0;
    for (let len = 1; len <= this.maxLen; ++len) {
      code = code * 2 + br.bit();
      const s = this.byLen[len]?.get(code);
      if (s !== undefined) return s;
    }
    return 0;   // treated as end of block
  }
}

function loadStatistics(d: Uint8Array, offset: number): [Huffman, number] {
  const freqs: number[] = [], symbols: number[] = [];
  let first = d[offset++];
  do {
    const last = d[offset++];
    if (first <= last) {
      for (let idx = first; idx <= last; ++idx) {
        const f = d[offset++];
        if (f) { freqs.push(f); symbols.push(idx); }
      }
    }
    first = d[offset++];
  } while (first !== 0);
  freqs.push(1);
  symbols.push(256);
  return [new Huffman(freqs, symbols), offset];
}

const FIX_1_082392200 = 70936, FIX_1_414213562 = 92682, FIX_1_847759065 = 121095, FIX_2_613125930 = 171254;
const mul = (v: number, c: number) => Math.imul(v, c) >> 16;
const temp = new Int32Array(64);

function idct(block: Int16Array, shift: number) {
  for (let i = 0; i < 8; i++) {
    let t10 = block[i] + block[32 + i];
    let t11 = block[i] - block[32 + i];
    const t13 = block[16 + i] + block[48 + i];
    let t12 = mul(block[16 + i] - block[48 + i], FIX_1_414213562) - t13;
    const t0 = t10 + t13, t3 = t10 - t13, t1 = t11 + t12, t2 = t11 - t12;
    const z13 = block[40 + i] + block[24 + i], z10 = block[40 + i] - block[24 + i];
    const z11 = block[8 + i] + block[56 + i], z12 = block[8 + i] - block[56 + i];
    const t7 = z11 + z13;
    t11 = mul(z11 - z13, FIX_1_414213562);
    const z5 = mul(z10 + z12, FIX_1_847759065);
    t10 = mul(z12, FIX_1_082392200) - z5;
    t12 = mul(z10, -FIX_2_613125930) + z5;
    const t6 = t12 - t7, t5 = t11 - t6, t4 = t10 + t5;
    temp[i] = t0 + t7; temp[56 + i] = t0 - t7;
    temp[8 + i] = t1 + t6; temp[48 + i] = t1 - t6;
    temp[16 + i] = t2 + t5; temp[40 + i] = t2 - t5;
    temp[32 + i] = t3 + t4; temp[24 + i] = t3 - t4;
  }
  for (let i = 0; i < 64; i += 8) {
    let t10 = temp[i] + temp[4 + i];
    let t11 = temp[i] - temp[4 + i];
    const t13 = temp[2 + i] + temp[6 + i];
    let t12 = mul(temp[2 + i] - temp[6 + i], FIX_1_414213562) - t13;
    const t0 = t10 + t13, t3 = t10 - t13, t1 = t11 + t12, t2 = t11 - t12;
    const z13 = temp[5 + i] + temp[3 + i], z10 = temp[5 + i] - temp[3 + i];
    const z11 = temp[1 + i] + temp[7 + i], z12 = temp[1 + i] - temp[7 + i];
    const t7 = z11 + z13;
    t11 = mul(z11 - z13, FIX_1_414213562);
    const z5 = mul(z10 + z12, FIX_1_847759065);
    t10 = mul(z12, FIX_1_082392200) - z5;
    t12 = mul(z10, -FIX_2_613125930) + z5;
    const t6 = t12 - t7, t5 = t11 - t6, t4 = t10 + t5;
    block[i] = (t0 + t7) >> shift; block[7 + i] = (t0 - t7) >> shift;
    block[1 + i] = (t1 + t6) >> shift; block[6 + i] = (t1 - t6) >> shift;
    block[2 + i] = (t2 + t5) >> shift; block[5 + i] = (t2 - t5) >> shift;
    block[4 + i] = (t3 + t4) >> shift; block[3 + i] = (t3 - t4) >> shift;
  }
}

const image = (w: number, h: number): Rgb => ({ w, h, rgb: new Uint8Array(w * h * 3) });
const clip = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function quantTables(quality: number): [Int32Array, Int32Array] {
  const q = quality <= 0 ? 5000 : quality > 100 ? 0 : quality >= 50 ? 2 * (100 - quality) : Math.trunc(5000 / quality);
  const qY = new Int32Array(64), qC = new Int32Array(64);
  for (let i = 0; i < 64; ++i) {
    let v = Math.trunc((QY[i] * q + 50) / 100);
    v = v > 255 ? 255 : v < 8 ? 8 : v;
    qY[i] = (v * Q[i]) >> 13;
    v = Math.trunc((QUV[i] * q + 50) / 100);
    v = v > 255 ? 255 : v < 8 ? 8 : v;
    qC[i] = (v * Q[i]) >> 13;
  }
  return [qY, qC];
}

// ScummVM's 32 bpp path, without its 16-bit dithering.
function unpack(pic: Rgb, d: Uint8Array, huff: number, huffSize: number, ac: number, dc: number, end: number,
  quality: number, prefix?: number[]) {
  if (huffSize < 4) return false;
  const [qY, qC] = quantTables(quality);
  const [hd, off] = loadStatistics(d, huff);
  const hb = new BitReader(d, off, huff + huffSize), ab = new BitReader(d, ac, dc), db = new BitReader(d, dc, end);
  const numBlocks = prefix ? prefix.length : Math.ceil(pic.w / 8) * Math.ceil(pic.h / 8);
  const blocks = [new Int16Array(64), new Int16Array(64), new Int16Array(64)];
  for (let bi = 0; bi < numBlocks; ++bi) {
    for (let ch = 0; ch < 3; ++ch) {
      const c = blocks[ch];
      c.fill(0);
      const iq = ch ? qC : qY;
      const dc8 = (reverseBits(db.bits(8), 8) << 24) >> 24;
      c[0] = iq[0] * dc8;
      for (let idx = 1; idx < 64;) {
        const b = hd.get(hb);
        if (b === 0x00 || b >= 0x100) break;
        if (b === 0xf0) { idx += 16; continue; }
        const h = b >> 4, l = b & 0x0f;
        idx += h;
        if (l && idx < 64) {
          const ai = ZIGZAG[idx];
          c[ai] = iq[ai] * readInt(reverseBits(ab.bits(l), l), l);
          ++idx;
        }
      }
      idct(c, 4);
    }
    let dstX: number, dstY: number;
    if (prefix) {
      dstY = Math.floor(prefix[bi] / pic.w);
      dstX = prefix[bi] % pic.w;
    } else {
      const o = bi << 3;
      dstX = o % pic.w;
      dstY = Math.floor(o / pic.w) << 3;
    }
    const [by, bu, bv] = blocks;
    for (let y = 0; y < 8; ++y) {
      const py = dstY + y;
      if (py >= pic.h) continue;
      for (let x = 0; x < 8; ++x) {
        const px = dstX + x;
        if (px >= pic.w) continue;
        const i = y * 8 + x;
        const Y = by[i] + 128, cb = bu[i], cr = bv[i];
        const o = (py * pic.w + px) * 3;
        pic.rgb[o] = clip(Y + Math.trunc((cr << 4) / 10));
        pic.rgb[o + 1] = clip(Y - Math.trunc(cb / 3) - Math.trunc((cr * 8) / 10));
        pic.rgb[o + 2] = clip(Y + cb * 2);
      }
    }
  }
  return true;
}

function renderAnimFrame(pic: Rgb, d: Uint8Array, start: number, end: number): number[] {
  if (end - start < 4) return [];
  const n = le32(d, start);
  if (!n || 4 + n * 4 + 16 > end - start) return [];
  const prefix: number[] = [];
  let off = start + 4;
  for (let i = 0; i < n; ++i, off += 4) prefix.push(le32(d, off));
  const quality = le32(d, off) | 0;
  off += 8;
  const huffSize = le32(d, off);
  off += 8;
  if (off + huffSize + 8 > end) return prefix;
  const huff = off, ac = off + huffSize + 4;
  const dc = off + huffSize + 8 + le32(d, off + huffSize);
  if (dc <= end) unpack(pic, d, huff, huffSize, ac, dc, end, quality, prefix);
  return prefix;
}

// Tiles inside a face: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
function makeFace(strip: Rgb, face: number): Rgb {
  const out = image(FACE, FACE);
  for (let y = 0; y < FACE; ++y) {
    for (let x = 0; x < FACE; ++x) {
      const tile = face * 4 + (y < TILE ? (x < TILE ? 0 : 1) : (x < TILE ? 3 : 2));
      const s = ((((y & (TILE - 1)) + tile * TILE) * strip.w) + (x & (TILE - 1))) * 3;
      const o = (y * FACE + x) * 3;
      out.rgb[o] = strip.rgb[s]; out.rgb[o + 1] = strip.rgb[s + 1]; out.rgb[o + 2] = strip.rgb[s + 2];
    }
  }
  return out;
}

// Atlas: 8×8 blocks, 32 per row; each goes to [face, x, y], face -1 on 2D screens.
function patchFrame(work: Rgb, prefix: number[], is3d: boolean): VrPatch {
  const cols = 32, n = prefix.length;
  const atlas = image(cols * 8, Math.max(1, Math.ceil(n / cols)) * 8);
  const blocks: [number, number, number][] = [];
  for (let b = 0; b < n; ++b) {
    const sx = prefix[b] % work.w, sy = Math.floor(prefix[b] / work.w);
    const ax = (b % cols) * 8, ay = Math.floor(b / cols) * 8;
    for (let y = 0; y < 8; ++y) {
      for (let x = 0; x < 8; ++x) {
        if (sx + x >= work.w || sy + y >= work.h) continue;
        const s = ((sy + y) * work.w + sx + x) * 3, o = ((ay + y) * atlas.w + ax + x) * 3;
        atlas.rgb[o] = work.rgb[s]; atlas.rgb[o + 1] = work.rgb[s + 1]; atlas.rgb[o + 2] = work.rgb[s + 2];
      }
    }
    if (is3d) {
      const tile = Math.floor(sy / TILE), face = Math.floor(tile / 4), t = tile % 4;
      blocks.push([face, sx + (t === 1 || t === 2 ? TILE : 0), (sy % TILE) + (t === 2 || t === 3 ? TILE : 0)]);
    } else blocks.push([-1, sx, sy]);
  }
  return { atlas, blocks };
}

export function decodeVr(d: Uint8Array): VrPicture {
  if (d.length < 8) throw new Error('too small');
  const magic = le32(d, 0);
  if (magic !== CHUNK_VR && magic !== V2_CHUNK_VR) throw new Error('not a VR file');
  const fsize = Math.min(le32(d, 4), d.length);
  let pos = 8;
  let pic: Rgb | null = null, is3d = false;
  const raw: { name: string; restart: number; frames: [number, number][] }[] = [];
  while (pos + 8 <= fsize) {
    const chunk = pos, id = le32(d, pos), size = le32(d, pos + 4);
    if (size < 8 || chunk + size > d.length) break;
    const p2d = STATIC_2D.includes(id), p3d = STATIC_3D.includes(id);
    if ((p2d || p3d) && !pic) {
      const quality = le32(d, pos + 8) | 0, dataSize = le32(d, pos + 12), vd = pos + 16;
      if (vd + dataSize > d.length) break;
      const huffSize = le32(d, vd);
      const p = p3d ? image(TILE, TILE * 4 * 6) : image(640, 480);
      const huff = vd + 8, ac = vd + huffSize + 12;
      const dc = ac + 4 + le32(d, huff + huffSize), end = vd + dataSize;
      if (dc <= end && unpack(p, d, huff, huffSize, ac, dc, end, quality)) { pic = p; is3d = p3d; }
    } else if (ANIMATION.includes(id)) {
      let name = '';
      for (let i = 0; i < 32 && d[pos + 8 + i]; ++i) name += String.fromCharCode(d[pos + 8 + i]);
      const a = { name, restart: -1, frames: [] as [number, number][] };
      for (let p = pos + 8 + 32 + 4; p + 8 <= chunk + size;) {
        const aid = le32(d, p), asz = le32(d, p + 4);
        if (asz < 8 || p + asz > chunk + size) break;
        if (ANIM_BLOCK.includes(aid)) a.frames.push([p + 8, p + asz]);
        else if (ANIM_RESTART.includes(aid) && asz >= 12) a.restart = le32(d, p + 8) | 0;
        p += asz;
      }
      raw.push(a);
    }
    pos = chunk + size;
  }
  if (!pic) throw new Error('no picture chunk');
  const base = pic;
  const anims = raw.map((a): VrAnim => {
    const work: Rgb = { w: base.w, h: base.h, rgb: base.rgb.slice() };
    const frames: VrPatch[] = [];
    for (const [s, e] of a.frames) {
      frames.push(patchFrame(work, renderAnimFrame(work, d, s, e), is3d));
    }
    return { name: a.name, restart: a.restart, frames };
  });
  return {
    type: is3d ? 'panorama' : 'screen',
    images: is3d ? [0, 1, 2, 3, 4, 5].map((f) => makeFace(base, f)) : [base],
    anims,
  };
}
