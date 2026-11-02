/* PAKF ported from dracula-port's pakf.py, itself ported from ScummVM's pakf.cpp
 * (ScummVM is the legal property of its developers). GPLv3 or later. */
import type { Region } from '../shared/format';
import type { Rgb } from './vr';

export function unpackPak(d: Uint8Array): { name: string; data: Uint8Array } {
  const ascii = (a: number, b: number) => String.fromCharCode(...d.subarray(a, b));
  if (ascii(0, 4) !== 'PAKF') throw new Error('not a PAKF archive');
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const nul = d.subarray(8, 24).indexOf(0);
  const name = ascii(8, nul < 0 ? 24 : 8 + nul);
  const method = v.getUint32(24, true), usize = v.getUint32(32, true);
  if (method !== 3) throw new Error(`unsupported PAKF method ${method}`);
  const out = new Uint8Array(usize);
  let o = 0;
  for (let i = 0x24; i < d.length && o < usize;) {
    const n = d[i++];
    if (n & 0x80) {
      const len = (n & 0x3f) + 1;
      const off = n & 0x40 ? d[i++] + 1 : ((d[i] << 8) | d[i + 1]) + 1;
      if (!(n & 0x40)) i += 2;
      for (let k = 0; k < len && o < usize; ++k, ++o) out[o] = out[o - off];
    } else {
      for (let k = 0; k <= n && i < d.length && o < usize; ++k) out[o++] = d[i++];
    }
  }
  return { name, data: out.subarray(0, o) };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function parseTst(d: Uint8Array): Region[] {
  if (d.length < 4) return [];
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const regs: Region[] = [];
  for (let i = 0, n = v.getUint32(0, true); i < n; ++i) {
    const off = 4 + 16 * i;
    if (off + 16 > d.length) break;
    const [a, b, c, e] = [0, 4, 8, 12].map((k) => v.getFloat32(off + k, true));
    regs.push([round6(Math.min(a, b)), round6(Math.max(a, b)), round6(Math.min(c, e)), round6(Math.max(c, e))]);
  }
  return regs;
}

// Pure black is transparent, as in the original engine.
export function decodePcx(d: Uint8Array): { img: Rgb; alpha: Uint8Array } {
  if (d[0] !== 10 || d[3] !== 8 || (d[65] !== 1 && d[65] !== 3)) throw new Error('unsupported PCX');
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const w = v.getUint16(8, true) - v.getUint16(4, true) + 1, h = v.getUint16(10, true) - v.getUint16(6, true) + 1;
  const planes = d[65], bpl = v.getUint16(66, true), line = planes * bpl;
  const raw = new Uint8Array(line * h);
  for (let i = 128, o = 0; o < raw.length && i < d.length;) {
    const b = d[i++];
    if (b >= 0xc0) { raw.fill(d[i++], o, Math.min(o + (b & 0x3f), raw.length)); o += b & 0x3f; } else raw[o++] = b;
  }
  const pal = planes === 1 && d.length >= 769 && d[d.length - 769] === 12 ? d.subarray(d.length - 768) : null;
  if (planes === 1 && !pal) throw new Error('PCX without palette');
  const img: Rgb = { w, h, rgb: new Uint8Array(w * h * 3) }, alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const o = (y * w + x) * 3, s = y * line + x;
      if (pal) img.rgb.set(pal.subarray(raw[s] * 3, raw[s] * 3 + 3), o);
      else { img.rgb[o] = raw[s]; img.rgb[o + 1] = raw[s + bpl]; img.rgb[o + 2] = raw[s + 2 * bpl]; }
      alpha[y * w + x] = img.rgb[o] | img.rgb[o + 1] | img.rgb[o + 2] ? 255 : 0;
    }
  }
  return { img, alpha };
}

// BDataHeader.vit lists the pictures; BData<n>.arn holds them back to back as RGB565.
export function decodeArn(header: Uint8Array, archive: (n: number) => Uint8Array | null) {
  const v = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const out = new Map<string, Rgb>(), offsets = new Map<number, number>();
  for (let i = 0, off = 8, n = v.getUint32(0, true); i < n; ++i, off += 60) {
    const nul = header.subarray(off, off + 32).indexOf(0);
    const name = String.fromCharCode(...header.subarray(off, nul < 0 ? off + 32 : off + nul));
    const [l, t, r, b] = [0, 4, 8, 12].map((k) => v.getInt32(off + 32 + k, true));
    const arch = v.getUint32(off + 48, true), size = v.getUint32(off + 52, true);
    const data = archive(arch);
    if (!data) continue;
    const pos = offsets.get(arch) ?? 0;
    offsets.set(arch, pos + size);
    const w = r - l, h = b - t;
    if (size !== w * h * 2 || pos + size > data.length) continue;
    const img: Rgb = { w, h, rgb: new Uint8Array(w * h * 3) };
    for (let p = 0; p < w * h; ++p) {
      const c = data[pos + p * 2] | (data[pos + p * 2 + 1] << 8);
      const r5 = c >> 11, g6 = (c >> 5) & 63, b5 = c & 31;
      img.rgb[p * 3] = (r5 << 3) | (r5 >> 2);
      img.rgb[p * 3 + 1] = (g6 << 2) | (g6 >> 4);
      img.rgb[p * 3 + 2] = (b5 << 3) | (b5 >> 2);
    }
    out.set(name, img);
  }
  return out;
}
