import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_FORMAT, type GameId, type GameIndex, type ImportStage, type Region, type VrMeta } from '../shared/format';
import { type FileIndex, findGame, folderOf, indexFiles } from './files';
import { opus, webm, webmFromFrames, webpLossless, webpPhoto } from './ffmpeg';
import { isRawMovie, RawMovie } from './fourxm';
import { decodeArn, decodePcx, parseTst, unpackPak } from './formats';
import { parseLst } from './lst';
import { decodeVr } from './vr';

const TITLES: Record<GameId, string> = {
  dracula1: 'Dracula: The Resurrection',
  dracula2: 'Dracula 2: The Last Sanctuary',
};

export interface ImportOptions {
  game: string;
  out: string;
  overlays?: string[];
  videos?: boolean;
  log?: (msg: string) => void;
  progress?: (stage: ImportStage, done: number, total: number) => void;
  signal?: AbortSignal;
}

const stem = (key: string) => key.replace(/\.[^.]*$/, '');
const variantName = (key: string, folder: string) => `${stem(key)}~${folder}${key.slice(stem(key).length)}`;
const VARIANT_TYPES = ['.vr', '.tst', '.wav', '.pcx', '.4xm'];
const put = (kind: string, key: string, value: unknown) =>
  `__dracula.put(${JSON.stringify(kind)},${JSON.stringify(key)},${JSON.stringify(value)});\n`;

function writeAtomic(file: string, data: string | Uint8Array) {
  fs.writeFileSync(file + '.part', data);
  fs.renameSync(file + '.part', file);
}

function importScripts(game: string, files: FileIndex, out: string, log: (m: string) => void) {
  const sources = new Map<string, string>();
  for (const [key, p] of [...files].sort()) if (key.endsWith('.lst')) sources.set(stem(key), p);
  for (const [key, p] of [...files].sort()) if (key.endsWith('.pak') && !sources.has(stem(key))) sources.set(stem(key), p);
  fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });
  const folders = new Map<string, string>();
  for (const [name, p] of [...sources].sort()) {
    let raw: Uint8Array = fs.readFileSync(p);
    if (p.toLowerCase().endsWith('.pak')) {
      if (Buffer.from(raw.subarray(0, 4)).toString('latin1') !== 'PAKF') continue;
      raw = unpackPak(raw).data;
    }
    const { script, warnings } = parseLst(raw);
    for (const w of warnings) log(`warning ${name}: ${w}`);
    writeAtomic(path.join(out, 'scripts', name + '.js'), put('script', name, script));
    folders.set(name, folderOf(game, p));
  }
  return folders;
}

// Scripts always name cursors .pcx; the .gif and .bmp next to some are unused leftovers.
async function importCursors(files: FileIndex, out: string) {
  fs.mkdirSync(path.join(out, 'cursors'), { recursive: true });
  const keys = [...files.keys()].filter((k) => k.endsWith('.pcx'));
  await Promise.all(keys.map((key) => {
    const { img, alpha } = decodePcx(fs.readFileSync(files.get(key)!));
    return webpLossless(img, path.join(out, 'cursors', stem(key) + '.webp'), alpha);
  }));
  return keys.length;
}

// The copy in the game folder is the one the original engine reads, not DataM2's.
async function importArn(game: string, out: string) {
  const root = new Map(fs.readdirSync(game).map((n) => [n.toLowerCase(), path.join(game, n)]));
  const header = root.get('bdataheader.vit');
  if (!header) return 0;
  const archives = new Map<number, Uint8Array | null>();
  const archive = (n: number) => {
    if (!archives.has(n)) { const p = root.get(`bdata${n}.arn`); archives.set(n, p ? fs.readFileSync(p) : null); }
    return archives.get(n)!;
  };
  const images = decodeArn(fs.readFileSync(header), archive);
  fs.mkdirSync(path.join(out, 'arn'), { recursive: true });
  await Promise.all([...images].map(([name, img]) => webpLossless(img, path.join(out, 'arn', stem(name.toLowerCase()) + '.webp'))));
  return images.size;
}

async function importSounds(files: FileIndex, out: string, log: (m: string) => void) {
  fs.mkdirSync(path.join(out, 'sound'), { recursive: true });
  let n = 0;
  await Promise.all([...files].filter(([key]) => key.endsWith('.wav')).map(async ([key, p]) => {
    const file = path.join(out, 'sound', stem(key) + '.opus');
    if (fs.existsSync(file)) { n++; return; }
    try { await opus(p, file + '.part'); fs.renameSync(file + '.part', file); n++; }
    catch (e) { log(`!! ${key}: ${(e as Error).message}`); }
  }));
  return n;
}

function wavHeader(pcmBytes: number, ch: number, rate: number) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + pcmBytes, 4); h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(pcmBytes, 40);
  return h;
}

// Dracula 1's raw 4XM is decoded twice: once for the audio, which ffmpeg needs as a file
// up front, then frame by frame into ffmpeg's stdin. The audio is cut or padded to the
// video's length here: ffmpeg's -shortest overshoots by up to a second.
async function rawMovieToWebm(data: Uint8Array, file: string, signal?: AbortSignal) {
  const audio = new RawMovie(data), pcm: number[] = [];
  for (let i = 0; i < audio.frames.length; ++i) { audio.next(); for (const s of audio.pcm) pcm.push(s); }
  const { width: w, height: h, fps } = audio.info, ch = audio.info.channels || 2, rate = audio.info.sampleRate || 22050;
  const wav = file + '.wav';
  const samples = Buffer.alloc(Math.round((audio.frames.length / fps) * rate) * ch * 2);
  for (let i = 0; i < pcm.length && i * 2 < samples.length; ++i) samples.writeInt16LE(pcm[i], i * 2);
  fs.writeFileSync(wav, Buffer.concat([wavHeader(samples.length, ch, rate), samples]));
  try {
    await webmFromFrames(w, h, fps, wav, file, async (write) => {
      const movie = new RawMovie(data);
      const rgb = Buffer.alloc(w * h * 3);
      for (let i = 0; i < movie.frames.length; ++i) {
        signal?.throwIfAborted();
        const px = movie.next();
        for (let j = 0; j < px.length; ++j) {
          const p = px[j], r = (p >> 10) & 31, g = (p >> 5) & 31, b = p & 31;
          rgb[j * 3] = (r << 3) | (r >> 2); rgb[j * 3 + 1] = (g << 3) | (g >> 2); rgb[j * 3 + 2] = (b << 3) | (b >> 2);
        }
        await write(Buffer.from(rgb));
      }
    });
  } finally { fs.rmSync(wav, { force: true }); }
}

async function importMovies(files: FileIndex, out: string, opts: ImportOptions, log: (m: string) => void) {
  fs.mkdirSync(path.join(out, 'movie'), { recursive: true });
  const keys = [...files.keys()].filter((k) => k.endsWith('.4xm')).sort();
  let done = 0, ok = 0;
  const queue = [...keys];
  const worker = async () => { for (let key; (key = queue.shift());) { opts.signal?.throwIfAborted(); await one(key); } };
  const one = async (key: string) => {
    const file = path.join(out, 'movie', stem(key) + '.webm');
    try {
      if (!fs.existsSync(file)) {
        const src = files.get(key)!, data = fs.readFileSync(src);
        if (isRawMovie(data)) await rawMovieToWebm(data, file + '.part', opts.signal);
        else await webm(src, file + '.part');
        fs.renameSync(file + '.part', file);
      }
      ok++;
    } catch (e) { opts.signal?.throwIfAborted(); log(`!! ${key}: ${(e as Error).message}`); }
    log(`movies: ${++done}/${keys.length} (${key})`);
    opts.progress?.('movies', done, keys.length);
  };
  // libvpx already spreads one encode over several threads
  await Promise.all(Array.from({ length: Math.max(1, os.availableParallelism() >> 1) }, worker));
  return ok;
}

function importTests(files: FileIndex) {
  const tests: Record<string, Region[]> = {};
  for (const [key, p] of files) if (key.endsWith('.tst')) tests[stem(key)] = parseTst(fs.readFileSync(p));
  return tests;
}

// Scenes already written are kept, so an interrupted import resumes.
async function importVr(key: string, file: string, out: string): Promise<GameIndex['vr'][string]> {
  const dir = path.join(out, 'vr', stem(key));
  const metaFile = path.join(dir, 'meta.json');
  if (fs.existsSync(metaFile)) {
    const m: VrMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return { type: m.type, anims: m.animations.map((a) => a.name) };
  }
  const vr = decodeVr(fs.readFileSync(file));
  fs.mkdirSync(dir, { recursive: true });
  const names = vr.type === 'panorama' ? vr.images.map((_, i) => `face${i}.webp`) : ['image.webp'];
  const jobs = vr.images.map((img, i) => webpPhoto(img, path.join(dir, names[i])));
  const meta: VrMeta = {
    type: vr.type,
    images: names,
    animations: vr.anims.map((a, ai) => ({
      name: a.name,
      restart_at: a.restart,
      patches: a.frames.map((f, fi) => {
        const atlas = `a${String(ai).padStart(2, '0')}_${String(fi).padStart(3, '0')}.webp`;
        jobs.push(webpLossless(f.atlas, path.join(dir, atlas)));
        return { atlas, blocks: f.blocks };
      }),
    })),
  };
  await Promise.all(jobs);
  writeAtomic(metaFile, JSON.stringify(meta));
  return { type: meta.type, anims: meta.animations.map((a) => a.name) };
}

export async function importGame(opts: ImportOptions) {
  const log = opts.log ?? (() => {});
  const progress = opts.progress ?? (() => {});
  const id = findGame(opts.game);
  if (!id) throw new Error(`not a Dracula game folder: ${opts.game}`);
  const { index: files, variants, skipped } = indexFiles(opts.game, opts.overlays);
  if (![...files.keys()].some((k) => k.endsWith('.lst') || k.endsWith('.pak'))) {
    throw new Error(`no scripts (.lst/.pak) in ${opts.game}`);
  }
  for (const p of skipped) log(`ignored (looks damaged): ${p}`);
  log(`${TITLES[id]}: ${files.size} files`);
  fs.mkdirSync(opts.out, { recursive: true });
  progress('files', 0, 1);

  const scripts = importScripts(opts.game, files, opts.out, log);
  log(`scripts: ${scripts.size}`);

  // A script's own folder wins over the game folder: its differing copies are written
  // under their own name, and index.js maps the original name to it for that script.
  const all: FileIndex = new Map(files);
  const byScript: Record<string, Record<string, string>> = {};
  for (const [name, folder] of scripts) {
    const map: Record<string, string> = {};
    for (const [key, p] of variants.get(folder) ?? []) {
      if (!VARIANT_TYPES.some((e) => key.endsWith(e))) continue;
      map[key] = variantName(key, folder);
      all.set(map[key], p);
    }
    if (Object.keys(map).length) byScript[name] = map;
  }

  const tests = importTests(all);
  log(`click regions: ${Object.keys(tests).length}`);
  log(`cursors: ${await importCursors(all, opts.out)}`);
  const arn = await importArn(opts.game, opts.out);
  if (arn) log(`.arn pictures: ${arn}`);
  log(`sounds: ${await importSounds(all, opts.out, log)}`);

  // Decoding runs here while ffmpeg encodes the scenes before it; a few in flight keep
  // every core busy without holding the whole game in memory.
  const vr: GameIndex['vr'] = {};
  const keys = [...all.keys()].filter((k) => k.endsWith('.vr')).sort();
  const inFlight = new Set<Promise<void>>();
  let done = 0;
  progress('scenes', 0, keys.length);
  for (const key of keys) {
    opts.signal?.throwIfAborted();
    const job = importVr(key, all.get(key)!, opts.out)
      .then((v) => { vr[stem(key)] = v; }, (e) => log(`!! ${key}: ${(e as Error).message}`))
      .then(() => {
        inFlight.delete(job);
        progress('scenes', ++done, keys.length);
        if (done % 100 === 0 || done === keys.length) log(`scenes: ${done}/${keys.length}`);
      });
    inFlight.add(job);
    if (inFlight.size >= 8) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  opts.signal?.throwIfAborted();
  if (opts.videos !== false) log(`movies: ${await importMovies(all, opts.out, opts, log)}`);

  const index: GameIndex = {
    manifest: { format: DATA_FORMAT, game: id, title: TITLES[id], scripts: [...scripts.keys()], start: 'script', arn: arn > 0 },
    vr, tests,
    ...(Object.keys(byScript).length ? { variants: byScript } : {}),
  };
  writeAtomic(path.join(opts.out, 'index.js'), put('index', 'all', index));
  return id;
}
