import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { Rgb } from './vr';

// A packaged app keeps the binary next to the asar archive (asarUnpack), where it can run.
const BIN = (ffmpegStatic ?? '').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const children = new Set<ChildProcess>();
export const stopAll = () => { for (const c of children) c.kill(); };

let running = 0;
const waiting: (() => void)[] = [];
const MAX = Math.max(1, os.availableParallelism());

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX) await new Promise<void>((ok) => waiting.push(ok));
  running++;
  try { return await job(); } finally { running--; waiting.shift()?.(); }
}

type Feed = (write: (chunk: Uint8Array) => Promise<void>) => Promise<void>;

export function ffmpeg(args: string[], input?: Uint8Array | Feed) {
  if (!BIN) throw new Error('ffmpeg-static has no binary for this platform');
  return slot(() => new Promise<void>((ok, fail) => {
    const p = spawn(BIN, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    children.add(p);
    let err = '', closed = false;
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', fail);
    p.on('close', (code) => {
      closed = true;
      children.delete(p);
      p.stdin.emit('drain');
      if (code === 0) ok(); else fail(new Error(err.trim().slice(-300) || `ffmpeg exited with ${code}`));
    });
    p.stdin.on('error', () => {});
    if (typeof input !== 'function') { p.stdin.end(input); return; }
    const write = (chunk: Uint8Array) => new Promise<void>((done, stop) => {
      if (closed) stop(new Error('ffmpeg stopped'));
      else if (p.stdin.write(chunk)) done();
      else p.stdin.once('drain', () => (closed ? stop(new Error('ffmpeg stopped')) : done()));
    });
    input(write).then(() => p.stdin.end(), (e) => { p.kill(); fail(e); });
  }));
}

const raw = (w: number, h: number, fmt: string) => ['-f', 'rawvideo', '-pix_fmt', fmt, '-s', `${w}x${h}`, '-i', '-'];

// 95: WebP lossy is 4:2:0 and tops out near 43 dB on these faces; 95 gets 42 dB at the
// size the earlier JPEGs had.
export const webpPhoto = (img: Rgb, file: string) =>
  ffmpeg([...raw(img.w, img.h, 'rgb24'), '-c:v', 'libwebp', '-quality', '95', '-compression_level', '6',
    '-preset', 'photo', '-frames:v', '1', '-f', 'webp', file], img.rgb);

export function webpLossless(img: Rgb, file: string, alpha?: Uint8Array) {
  let data = img.rgb, fmt = 'rgb24';
  if (alpha) {
    data = new Uint8Array(img.w * img.h * 4);
    for (let i = 0; i < alpha.length; ++i) data.set([img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2], alpha[i]], i * 4);
    fmt = 'rgba';
  }
  return ffmpeg([...raw(img.w, img.h, fmt), '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6',
    '-pix_fmt', 'bgra', '-frames:v', '1', '-f', 'webp', file], data);
}

const VIDEO = ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
  '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '96k', '-f', 'webm'];

export const webm = (movie: string, file: string) => ffmpeg(['-i', movie, ...VIDEO, file]);

export const webmFromFrames = (w: number, h: number, fps: number, wav: string, file: string, frames: Feed) =>
  ffmpeg([...raw(w, h, 'rgb24').slice(0, -2), '-r', fps.toFixed(3), '-i', '-', '-i', wav, ...VIDEO, file], frames);

export const opus = (wav: string, file: string) =>
  ffmpeg(['-i', wav, '-c:a', 'libopus', '-b:a', '64k', '-f', 'opus', file]);
