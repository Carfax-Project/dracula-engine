import fs from 'node:fs';
import path from 'node:path';
import type { GameId } from '../shared/format';
import { readDisc } from './disc';

export interface GameFile { name: string; folder: string; size: number; read(): Buffer }
// One game found in a folder: an installed copy, or its CD images among others.
export interface GameSource { id: GameId; dir: string }
export type FileIndex = Map<string, GameFile>;

export interface GameFiles {
  index: FileIndex;
  root: FileIndex;
  // The original engine looks in the running script's own folder first (Dracula 2:
  // DataM1, DataM2; the CDs: each disc); these are the files that differ there.
  variants: Map<string, FileIndex>;
}

const DISC_IMAGE = /\.(img|bin|iso)$/i;

// An installed game folder: Dracula 2 keeps its scripts packed, Dracula 1 as text.
function installedGame(dir: string): GameId | null {
  let names: Set<string>;
  try { names = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase())); } catch { return null; }
  if (names.has('script.pak') && (names.has('datam1') || names.has('datam2'))) return 'dracula2';
  return names.has('script.lst') ? 'dracula1' : null;
}

function installedFiles(dir: string): GameFile[] {
  const out: GameFile[] = [];
  const add = (sub: string) => {
    for (const name of fs.readdirSync(path.join(dir, sub))) {
      const p = path.join(dir, sub, name), st = fs.statSync(p);
      if (st.isFile()) out.push({ name, folder: sub.toLowerCase(), size: st.size, read: () => fs.readFileSync(p) });
    }
  };
  add('');
  for (const s of fs.readdirSync(dir)) {
    if (s.toLowerCase().startsWith('datam') && fs.statSync(path.join(dir, s)).isDirectory()) add(s);
  }
  return out;
}

// The installer copied Install/ to the hard disk, so it is the game folder; the rest of
// each disc is the data of the mission on it.
function discGames(dir: string) {
  const complete = new Map<GameId, GameFile[]>();
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => DISC_IMAGE.test(n)).sort(); } catch { return complete; }
  const games = new Map<GameId, GameFile[][]>();
  for (const n of names) {
    const disc = readDisc(path.join(dir, n));
    if (!disc) continue;
    const id: GameId | null = disc.some((f) => /^datam\d\//i.test(f.path)) ? 'dracula2'
      : disc.some((f) => /(^|\/)0m\dscript\.pak$/i.test(f.path)) ? 'dracula1' : null;
    if (!id) continue;
    const discs = games.get(id) ?? [];
    const own = `cd${discs.length + 1}`;
    discs.push(disc.map((f) => {
      const parts = f.path.split('/'), name = parts.pop()!;
      const folder = parts.length === 1 && parts[0].toLowerCase() === 'install' ? '' : parts.join('/').toLowerCase() || own;
      return { name, folder, size: f.size, read: f.read };
    }));
    games.set(id, discs);
  }
  for (const [id, discs] of games) {
    const files = discs.flat();
    const has = (name: string, root = false) => files.some((f) => f.name.toLowerCase() === name && (!root || !f.folder));
    if (has('script.pak', true) && has('0m1script.pak') && has('0m2script.pak')) complete.set(id, files);
  }
  return complete;
}

const gamesIn = (dir: string): GameId[] => {
  const id = installedGame(dir);
  return id ? [id] : [...discGames(dir).keys()];
};

// The folder itself or its direct subfolders (symlinks included), first match per game.
export function findGames(dir: string): GameSource[] {
  const found = new Map<GameId, string>();
  let subs: string[] = [];
  try { subs = fs.readdirSync(dir).sort(); } catch { return []; }
  for (const d of [dir, ...subs.map((s) => path.join(dir, s))]) {
    for (const id of gamesIn(d)) if (!found.has(id)) found.set(id, d);
  }
  return [...found].map(([id, d]) => ({ id, dir: d })).sort((a, b) => (a.id < b.id ? -1 : 1));
}

const same = (a: GameFile, b: GameFile) => a === b || (a.size === b.size && a.read().equals(b.read()));

export function indexFiles({ id, dir }: GameSource): GameFiles {
  const files = installedGame(dir) === id ? installedFiles(dir) : discGames(dir).get(id) ?? [];
  const folders = new Map<string, FileIndex>();
  for (const f of files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!folders.has(f.folder)) folders.set(f.folder, new Map());
    folders.get(f.folder)!.set(f.name.toLowerCase(), f);
  }
  const root = folders.get('') ?? new Map();
  const subs = [...folders].filter(([k]) => k).sort(([a], [b]) => (a < b ? -1 : 1));

  const index: FileIndex = new Map();
  for (const [, sub] of subs) for (const [k, f] of sub) index.set(k, f);
  for (const [k, f] of root) index.set(k, f);

  const variants = new Map<string, FileIndex>();
  for (const [folder, sub] of subs) {
    const v: FileIndex = new Map();
    for (const [k, f] of sub) if (!same(f, index.get(k)!)) v.set(k, f);
    if (v.size) variants.set(folder, v);
  }
  return { index, root, variants };
}
