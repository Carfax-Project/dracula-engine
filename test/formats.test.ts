import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeArn, decodePcx, parseTst, unpackPak } from '../src/importer/formats';

function pak(name: string, size: number, body: number[], method = 3) {
  const d = new Uint8Array(0x24 + body.length);
  const v = new DataView(d.buffer);
  d.set(new TextEncoder().encode('PAKF'), 0);
  d.set(new TextEncoder().encode(name), 8);
  v.setUint32(24, method, true);
  v.setUint32(32, size, true);
  d.set(body, 0x24);
  return d;
}

test('PAKF literals and back references', () => {
  // A literal run 'abc', then 3 bytes from 3 back (short form) and from 2 back (long form).
  const { name, data } = unpackPak(pak('script.lst', 9, [2, 97, 98, 99, 0xc2, 2, 0x82, 0, 1]));
  assert.equal(name, 'script.lst');
  assert.equal(new TextDecoder().decode(data), 'abcabcbcb');
});

test('PAKF errors', () => {
  assert.throws(() => unpackPak(new Uint8Array(0x24)), /not a PAKF/);
  assert.throws(() => unpackPak(pak('x', 1, [0, 1], 2)), /unsupported PAKF method 2/);
});

test('.tst regions are ordered min, max', () => {
  const d = new Uint8Array(4 + 16);
  const v = new DataView(d.buffer);
  v.setUint32(0, 2, true);
  [3, 1, 5, 2.5].forEach((f, i) => v.setFloat32(4 + i * 4, f, true));
  assert.deepEqual(parseTst(d), [[1, 3, 2.5, 5]]);
  assert.deepEqual(parseTst(new Uint8Array(2)), []);
});

function pcx(w: number, h: number, bpl: number, body: number[], palette: number[][]) {
  const pal = new Uint8Array(769);
  pal[0] = 12;
  palette.forEach((c, i) => pal.set(c, 1 + i * 3));
  const d = new Uint8Array(128 + body.length + pal.length);
  const v = new DataView(d.buffer);
  d[0] = 10; d[3] = 8; d[65] = 1;
  v.setUint16(8, w - 1, true);
  v.setUint16(10, h - 1, true);
  v.setUint16(66, bpl, true);
  d.set(body, 128);
  d.set(pal, 128 + body.length);
  return d;
}

test('PCX with palette, RLE and black as transparent', () => {
  const { img, alpha } = decodePcx(pcx(3, 1, 4, [0, 0xc3, 1], [[0, 0, 0], [200, 10, 20]]));
  assert.equal(img.w, 3);
  assert.equal(img.h, 1);
  assert.deepEqual([...img.rgb], [0, 0, 0, 200, 10, 20, 200, 10, 20]);
  assert.deepEqual([...alpha], [0, 255, 255]);
});

test('PCX errors', () => {
  assert.throws(() => decodePcx(new Uint8Array(128)), /unsupported PCX/);
  const noPalette = pcx(1, 1, 2, [1], []).subarray(0, 129);
  assert.throws(() => decodePcx(noPalette), /PCX without palette/);
});

function arnHeader(entries: { name: string; w: number; h: number; arch: number; size?: number }[]) {
  const d = new Uint8Array(8 + entries.length * 60);
  const v = new DataView(d.buffer);
  v.setUint32(0, entries.length, true);
  entries.forEach((e, i) => {
    const off = 8 + i * 60;
    d.set(new TextEncoder().encode(e.name), off);
    v.setInt32(off + 40, e.w, true);
    v.setInt32(off + 44, e.h, true);
    v.setUint32(off + 48, e.arch, true);
    v.setUint32(off + 52, e.size ?? e.w * e.h * 2, true);
  });
  return d;
}

test('.arn pictures are RGB565, back to back per archive', () => {
  const header = arnHeader([
    { name: 'red', w: 1, h: 1, arch: 0 },
    { name: 'broken', w: 2, h: 1, arch: 0, size: 2 },
    { name: 'blue', w: 2, h: 1, arch: 0 },
    { name: 'missing', w: 1, h: 1, arch: 1 },
  ]);
  const red = [0x00, 0xf8], blue = [0x1f, 0x00];
  const out = decodeArn(header, (n) => (n === 0 ? new Uint8Array([...red, 0, 0, ...blue, ...blue]) : null));
  assert.deepEqual([...out.keys()], ['red', 'blue']);
  assert.deepEqual([...out.get('red')!.rgb], [255, 0, 0]);
  assert.deepEqual([...out.get('blue')!.rgb], [0, 0, 255, 0, 0, 255]);
});
