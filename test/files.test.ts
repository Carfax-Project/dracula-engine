import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { findGame, folderOf, indexFiles } from '../src/importer/files';

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

test('findGame tells the two games apart', () => {
  assert.equal(findGame(tree('d1', { 'Script.LST': '' })), 'dracula1');
  assert.equal(findGame(tree('d2', { 'script.pak': '', 'DataM1/a.vr': '' })), 'dracula2');
  assert.equal(findGame(tree('none', { 'readme.txt': '' })), null);
  assert.equal(findGame(path.join(tmp, 'does-not-exist')), null);
});

test('folderOf works with the OS separator', () => {
  const game = path.join(tmp, 'game');
  assert.equal(folderOf(game, path.join(game, 'DataM1', 'a.tst')), 'datam1');
  assert.equal(folderOf(game, path.join(game, 'a.tst')), '');
});

test('the root wins, and differing DataM copies become variants', () => {
  const game = tree('variants', {
    'Root.vr': 'root',
    'DataM1/root.vr': 'm1',
    'DataM1/notebook.tst': 'four regions',
    'DataM2/notebook.tst': 'three regions',
    'DataM2/same.wav': 'same',
    'DataM1/same.wav': 'same',
  });
  const { index, variants } = indexFiles(game);
  assert.equal(index.get('root.vr'), path.join(game, 'Root.vr'));
  assert.equal(index.get('notebook.tst'), path.join(game, 'DataM2', 'notebook.tst'));
  assert.deepEqual([...variants.keys()], ['datam1']);
  assert.deepEqual([...variants.get('datam1')!], [
    ['notebook.tst', path.join(game, 'DataM1', 'notebook.tst')],
    ['root.vr', path.join(game, 'DataM1', 'root.vr')],
  ]);
});

test('overlays replace files, except scripts, equal copies and damaged reads', () => {
  const game = tree('base', { 'a.wav': 'en', 'b.wav': 'same', 'c.wav': 'good', 'script.lst': 'en' });
  const damaged = Buffer.concat([Buffer.from('pt'), Buffer.alloc(32768)]);
  const overlay = tree('overlay', { 'A.WAV': 'pt', 'b.wav': 'same', 'c.wav': damaged, 'script.lst': 'pt', 'new.wav': 'pt' });
  const { index, skipped } = indexFiles(game, [overlay]);
  assert.equal(index.get('a.wav'), path.join(overlay, 'A.WAV'));
  assert.equal(index.get('b.wav'), path.join(game, 'b.wav'));
  assert.equal(index.get('c.wav'), path.join(game, 'c.wav'));
  assert.equal(index.get('script.lst'), path.join(game, 'script.lst'));
  assert.equal(index.get('new.wav'), path.join(overlay, 'new.wav'));
  assert.deepEqual(skipped, [path.join(overlay, 'c.wav')]);
});
