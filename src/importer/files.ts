import fs from 'node:fs';
import path from 'node:path';
import type { GameId } from '../shared/format';

export type FileIndex = Map<string, string>;

export interface GameFiles {
  index: FileIndex;
  // The original engine looks in the running script's own folder first (Dracula 2:
  // DataM1, DataM2); these are the files that differ there.
  variants: Map<string, FileIndex>;
  skipped: string[];
}

// An installed game folder: Dracula 2 keeps its scripts packed, Dracula 1 as text.
export function findGame(dir: string): GameId | null {
  let names: Set<string>;
  try { names = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase())); } catch { return null; }
  if (names.has('script.pak') && (names.has('datam1') || names.has('datam2'))) return 'dracula2';
  return names.has('script.lst') ? 'dracula1' : null;
}

export const folderOf = (game: string, file: string) => path.relative(game, path.dirname(file)).toLowerCase();

const SKIP_OVERLAY = ['.lst', '.pak', '.exe', '.dll', '.ini', '.txt', '.info', '.hashdb', '.dat'];

// Damaged CD copies have 32 KB+ runs of zeros the original files don't have.
const hasZeroRun = (d: Buffer) => d.indexOf(Buffer.alloc(32768)) >= 0;

function list(dir: string): FileIndex {
  const out: FileIndex = new Map();
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isFile()) out.set(n.toLowerCase(), p);
  }
  return out;
}

const sameFile = (a: string, b: string) => fs.readFileSync(a).equals(fs.readFileSync(b));

export function indexFiles(game: string, overlays: string[] = []): GameFiles {
  const root = list(game);
  const subdirs = fs.readdirSync(game).filter((n) => n.toLowerCase().startsWith('datam')
    && fs.statSync(path.join(game, n)).isDirectory()).sort();
  const subs = subdirs.map((s) => [s.toLowerCase(), list(path.join(game, s))] as const);

  const index: FileIndex = new Map();
  for (const [, files] of subs) for (const [k, p] of files) index.set(k, p);
  for (const [k, p] of root) index.set(k, p);

  const variants = new Map<string, FileIndex>();
  for (const [sub, files] of subs) {
    const v: FileIndex = new Map();
    for (const [k, p] of files) if (!sameFile(p, index.get(k)!)) v.set(k, p);
    if (v.size) variants.set(sub, v);
  }

  const skipped: string[] = [];
  for (const ov of overlays) {
    for (const [key, p] of list(ov)) {
      if (SKIP_OVERLAY.some((e) => key.endsWith(e))) continue;
      const base = index.get(key);
      if (base) {
        const a = fs.readFileSync(base), b = fs.readFileSync(p);
        if (a.equals(b)) continue;
        if (hasZeroRun(b) && !hasZeroRun(a)) { skipped.push(p); continue; }
      }
      index.set(key, p);
    }
  }
  return { index, variants, skipped };
}
