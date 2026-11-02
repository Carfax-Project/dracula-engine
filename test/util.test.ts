import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Angle, AngleY, PI, TAU, atoi, baseOf, contains2D, contains3D, stemOf } from '../src/renderer/util';

test('file names from scripts', () => {
  assert.equal(stemOf('C:\\x\\Foo.PCX'), 'foo');
  assert.equal(stemOf('sons/porte'), 'porte');
  assert.equal(stemOf(null), '');
  assert.equal(baseOf('sons\\Porte.WAV'), 'porte.wav');
});

test('atoi reads a leading integer like C', () => {
  assert.equal(atoi(' -12abc'), -12);
  assert.equal(atoi('x1'), 0);
  assert.equal(atoi(undefined), 0);
});

test('2D regions include the top-left edge only', () => {
  const r = [10, 20, 30, 40];
  assert.ok(contains2D(r, 10, 30));
  assert.ok(!contains2D(r, 20, 30));
  assert.ok(!contains2D(r, 15, 40));
});

test('3D regions wrap around north', () => {
  // .tst regions are stored as min, max; one wider than PI is the short way across 0.
  const across = [0.2, TAU - 0.2, -1, 1];
  assert.ok(contains3D(across, 0.1, 0));
  assert.ok(contains3D(across, TAU - 0.1, 0));
  assert.ok(!contains3D(across, PI, 0));
  assert.ok(contains3D([1, 2, -1, 1], 1.5, 0.5));
  assert.ok(!contains3D([1, 2, -1, 1], 1.5, 1.5));
});

test('angles', () => {
  assert.ok(Math.abs(Angle.mod(-0.5, 0, TAU) - (TAU - 0.5)) < 1e-12);
  const y = new AngleY(-PI / 2);
  y.add(10);
  assert.ok(y.angle < 0 && y.angle > -PI);
});
