import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLst } from '../src/importer/lst';

const lst = (...lines: string[]) => new TextEncoder().encode(lines.join('\r\n'));

test('vars, warps, tests and commands', () => {
  const { script, warnings } = parseLst(lst(
    '[bool]=door_open',
    '[warp]=A01.vr,A01.tst',
    '[test]=1,2',
    '  playsound porte.wav,200 ; a comment',
    '  set door_open=1',
    '  gotowarp A02.vr',
    '[test]=2',
    '  end',
  ));
  assert.deepEqual(warnings, []);
  assert.deepEqual(script.vars, ['door_open']);
  assert.equal(script.warps.length, 1);
  const [warp] = script.warps;
  assert.equal(warp.vr, 'A01.vr');
  assert.equal(warp.test, 'A01.tst');
  assert.deepEqual(warp.tests.map((t) => [t.idx, t.hover]), [[1, 2], [2, 0]]);
  assert.deepEqual(warp.tests[0].cmds, [
    { op: 'playsound', sound: 'porte.wav', volume: 200, loops: 0 },
    { op: 'set', var: 'door_open', value: 1 },
    { op: 'gotowarp', warp: 'A02.vr' },
  ]);
  assert.deepEqual(warp.tests[1].cmds, [{ op: 'end' }]);
});

test('a condition wraps the next command', () => {
  const { script } = parseLst(lst('[warp]=A01.vr', '[test]=1', 'ifand=key,lamp', 'gotowarp A03.vr'));
  assert.deepEqual(script.warps[0].tests[0].cmds, [
    { op: 'ifand', vars: ['key', 'lamp'], then: { op: 'gotowarp', warp: 'A03.vr' } },
  ]);
});

test('plugin blocks and labels', () => {
  const { script } = parseLst(lst(
    '[warp]=A01.vr', '[test]=1',
    'gotowarp A02.vr',
    'label next',
    'plugin',
    'play_movie(intro.4xm)',
    'cmp(score,0,score,>=10)',
    'endplugin',
  ));
  const t = script.warps[0].tests[0];
  assert.deepEqual(t.labels, { next: 1 });
  assert.deepEqual(t.cmds[1], {
    op: 'block', cmds: [
      { op: 'movie', file: 'intro.4xm' },
      { op: 'cmp', var: 'score', neg: '0', a: 'score', cmp: '>=', b: '10' },
    ],
  });
});

test('unknown commands warn instead of failing', () => {
  const { warnings } = parseLst(lst('[warp]=A01.vr', '[test]=1', 'frobnicate 3'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /line 3: unhandled command: frobnicate 3/);
});

test('a test needs a warp', () => {
  assert.throws(() => parseLst(lst('[test]=1')), /test without warp/);
});

test('cp1252 text', () => {
  const { script } = parseLst(new Uint8Array([...new TextEncoder().encode('[bool]=caf'), 0xe9]));
  assert.deepEqual(script.vars, ['café']);
});
