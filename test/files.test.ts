import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { readDisc } from '../src/importer/disc';
import { findGames, indexFiles } from '../src/importer/files';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dracula-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function tree(name: string, files: Record<string, string | Buffer>) {
  const dir = path.join(tmp, name);
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), data);
  }
  return dir;
}

// An ISO 9660 image: descriptors at 16-18, one sector per directory, then the files.
// With joliet, the names are only readable through the supplementary descriptor.
function iso(files: Record<string, string>, { mode = 0, joliet = false } = {}) {
  const dirs = new Map<string, string[]>([['', []]]);
  for (const p of Object.keys(files)) {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; ++i) {
      const parent = parts.slice(0, i - 1).join('/'), child = parts.slice(0, i).join('/');
      if (!dirs.get(parent)!.includes(child)) dirs.get(parent)!.push(child);
      if (i < parts.length && !dirs.has(child)) dirs.set(child, []);
    }
  }
  let next = 19;
  const lba = new Map<string, number>();
  for (const d of dirs.keys()) lba.set(d, next++);
  for (const [p, data] of Object.entries(files)) { lba.set(p, next); next += Math.max(1, Math.ceil(data.length / 2048)); }
  const id = (s: string) => (joliet ? Buffer.from(s, 'utf16le').swap16() : Buffer.from(s, 'latin1'));
  const record = (name: Buffer, at: number, size: number, dir: boolean) => {
    const r = Buffer.alloc(34 + name.length);
    r[0] = r.length; r.writeUInt32LE(at, 2); r.writeUInt32LE(size, 10); r[25] = dir ? 2 : 0; r[32] = name.length;
    name.copy(r, 33);
    return r;
  };
  const img = Buffer.alloc(next * 2048);
  for (const [d, kids] of dirs) {
    Buffer.concat([
      record(Buffer.from([0]), lba.get(d)!, 2048, true), record(Buffer.from([1]), 0, 2048, true),
      ...kids.map((k) => record(id(k.split('/').pop()! + (dirs.has(k) ? '' : ';1')), lba.get(k)!, dirs.has(k) ? 2048 : files[k].length, dirs.has(k))),
    ]).copy(img, lba.get(d)! * 2048);
  }
  for (const [p, data] of Object.entries(files)) img.write(data, lba.get(p)! * 2048, 'latin1');
  const desc = (sector: number, type: number) => {
    img[sector * 2048] = type;
    img.write('CD001', sector * 2048 + 1, 'latin1');
    record(Buffer.from([0]), lba.get('')!, 2048, true).copy(img, sector * 2048 + 156);
  };
  desc(16, 1);
  if (joliet) { desc(17, 2); img.write('%/E', 17 * 2048 + 88, 'latin1'); } else desc(17, 255);
  desc(18, 255);
  if (!mode) return img;
  const raw = Buffer.alloc(next * 2352);
  for (let i = 0; i < next; ++i) {
    raw.fill(255, i * 2352 + 1, i * 2352 + 11);
    raw[i * 2352 + 15] = mode;
    img.copy(raw, i * 2352 + (mode === 2 ? 24 : 16), i * 2048, (i + 1) * 2048);
  }
  return raw;
}

const long = 'x'.repeat(3000) + 'end';

test('readDisc reads .iso and raw Mode 1 / Mode 2 images, with Joliet names', () => {
  const files = { 'Install/script.pak': 'pak', 'DataM1/Long.4xm': long, 'A18TST.': 'tst' };
  const dir = tree('images', {
    'plain.iso': iso(files),
    'mode1.img': iso(files, { mode: 1 }),
    'mode2.bin': iso(files, { mode: 2, joliet: true }),
    'junk.img': 'not a disc',
  });
  for (const f of ['plain.iso', 'mode1.img', 'mode2.bin']) {
    const disc = readDisc(path.join(dir, f))!;
    assert.deepEqual(disc.map((d) => [d.path, d.size, d.read().toString('latin1')]).sort(), [
      ['A18TST', 3, 'tst'], ['DataM1/Long.4xm', long.length, long], ['Install/script.pak', 3, 'pak'],
    ], f);
  }
  assert.equal(readDisc(path.join(dir, 'junk.img')), null);
  assert.equal(readDisc(path.join(dir, 'missing.iso')), null);
});

const d1 = [iso({ 'Install/script.pak': '', 'Data/0M1Script.pak': '' }), iso({ '0M2Script.pak': '' }, { mode: 2 })];
const d2 = [iso({ 'Install/script.pak': '', 'DataM1/0M1Script.pak': '' }), iso({ 'DataM2/0M2Script.pak': '' })];
const ids = (dir: string) => findGames(dir).map((g) => [g.id, path.relative(tmp, g.dir)]);

test('findGames tells the two games apart, installed or on CD', () => {
  assert.deepEqual(ids(tree('d1', { 'Script.LST': '' })), [['dracula1', 'd1']]);
  assert.deepEqual(ids(tree('d2', { 'script.pak': '', 'DataM1/a.vr': '' })), [['dracula2', 'd2']]);
  assert.deepEqual(ids(tree('none', { 'readme.txt': '' })), []);
  assert.deepEqual(ids(path.join(tmp, 'does-not-exist')), []);
  assert.deepEqual(ids(tree('cd1', { 'Disc 1.img': d1[0], 'Disc 2.img': d1[1] })), [['dracula1', 'cd1']]);
  assert.deepEqual(ids(tree('cd2', { 'Disc 1.iso': d2[0], 'Disc 2.iso': d2[1] })), [['dracula2', 'cd2']]);
  assert.deepEqual(ids(tree('cd-half', { 'Disc 1.img': d1[0] })), []);
});

test('findGames finds both games in one folder or the ones right inside it', () => {
  assert.deepEqual(ids(tree('cd-both', { 'a1.img': d1[0], 'a2.img': d1[1], 'b1.iso': d2[0], 'b2.iso': d2[1] })),
    [['dracula1', 'cd-both'], ['dracula2', 'cd-both']]);
  assert.deepEqual(ids(tree('library', {
    'GOG D1/script.lst': '', 'Dracula 2/script.pak': '', 'Dracula 2/DataM2/a.vr': '', 'deep/er/script.lst': '',
  })), [['dracula1', 'library/GOG D1'], ['dracula2', 'library/Dracula 2']]);
  assert.deepEqual(ids(tree('mixed', { 'script.lst': '', 'cds/1.img': d1[0], 'cds/2.img': d1[1], 'cds/3.iso': d2[0], 'cds/4.iso': d2[1] })),
    [['dracula1', 'mixed'], ['dracula2', 'mixed/cds']]);
});

const names = (files: Map<string, { folder: string; read(): Buffer }>) =>
  [...files].map(([k, f]) => [k, f.folder, f.read().toString()]);

test('the root wins, and differing DataM copies become variants', () => {
  const game = tree('variants', {
    'script.pak': '',
    'Root.vr': 'root',
    'DataM1/root.vr': 'm1',
    'DataM1/notebook.tst': 'four regions',
    'DataM2/notebook.tst': 'three regions',
    'DataM2/same.wav': 'same',
    'DataM1/same.wav': 'same',
  });
  const { index, root, variants } = indexFiles({ id: 'dracula2', dir: game });
  assert.deepEqual(names(new Map([['root.vr', index.get('root.vr')!], ['notebook.tst', index.get('notebook.tst')!]])), [
    ['root.vr', '', 'root'], ['notebook.tst', 'datam2', 'three regions'],
  ]);
  assert.deepEqual([...root.keys()].sort(), ['root.vr', 'script.pak']);
  assert.deepEqual([...variants.keys()], ['datam1']);
  assert.deepEqual(names(variants.get('datam1')!), [['notebook.tst', 'datam1', 'four regions'], ['root.vr', 'datam1', 'm1']]);
});

test('on CD, Install is the game folder and each disc a script folder', () => {
  const game = tree('cd-variants', {
    'Disc 1.img': iso({
      'Install/script.pak': '', 'Install/Cursor1.pcx': 'big', 'Autorun.inf': '',
      'Data/0M1Script.pak': 'm1', 'Data/cursor1.pcx': 'small', 'Data/Credit.vr': 'credits',
    }, { mode: 2, joliet: true }),
    'Disc 2.img': iso({ '0M2Script.pak': 'm2', 'Cursor1.pcx': 'big', 'Credit.vr': 'cast' }, { mode: 2, joliet: true }),
  });
  const { index, root, variants } = indexFiles({ id: 'dracula1', dir: game });
  assert.deepEqual([...root.keys()].sort(), ['cursor1.pcx', 'script.pak']);
  assert.equal(index.get('0m1script.pak')!.folder, 'data');
  assert.equal(index.get('0m2script.pak')!.folder, 'cd2');
  assert.equal(index.get('autorun.inf')!.folder, 'cd1');
  assert.equal(index.get('credit.vr')!.read().toString(), 'credits');
  assert.deepEqual(names(variants.get('data')!), [['cursor1.pcx', 'data', 'small']]);
  assert.deepEqual(names(variants.get('cd2')!), [['credit.vr', 'cd2', 'cast']]);
});
