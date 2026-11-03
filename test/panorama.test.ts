import assert from 'node:assert/strict';
import { test } from 'node:test';
import { camera, rayAngles } from '../src/renderer/panorama';
import { H, PI2, W } from '../src/renderer/util';

const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('a wider view keeps the original one in its middle (Hor+)', () => {
  const wide = 853, ox = (wide - W) / 2;
  for (const [ax, ay, fov] of [[0, -PI2, PI2], [1.2, -1.1, 85 * Math.PI / 180]]) {
    const narrow = camera(ax, ay, fov), wider = camera(ax, ay, fov, wide);
    for (const [x, y] of [[0, 0], [W / 2, H / 2], [W, H], [100, 400]]) close(rayAngles(wider, x + ox, y), rayAngles(narrow, x, y));
  }
});

test('a wider view sees further to the sides', () => {
  const yaw = (x: number, width: number) => rayAngles(camera(0, -PI2, PI2, width), x, H / 2)[0];
  close([yaw(0, W)], [2 * Math.PI - Math.PI / 4]);
  assert.ok(yaw(0, 853) < yaw(0, W));
});
