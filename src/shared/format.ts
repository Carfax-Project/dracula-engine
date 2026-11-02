/* Format 3 of the converted data folders (usually data/ = Dracula 1, data2/ = Dracula 2).
 * The .js files contain  __dracula.put("kind","key",<json>);  everything else is plain files.
 *
 *   index.js             { manifest, vr, tests, variants? }
 *   scripts/<name>.js    Script
 *   vr/<name>/meta.json  VrMeta, next to the .webp images it names
 *   cursors/<name>.webp
 *   arn/<name>.webp      (Dracula 2)
 *   sound/<name>.opus
 *   movie/<name>.webm
 */

export const DATA_FORMAT = 3;

export type GameId = 'dracula1' | 'dracula2';
export type Region = [number, number, number, number];

export interface GameIndex {
  manifest: { format: number; game?: GameId; title?: string; scripts: string[]; start?: string; arn?: boolean };
  vr: Record<string, { type: 'panorama' | 'screen'; anims: string[] }>;
  tests: Record<string, Region[]>;
  // script -> lower-case file name -> the file to load instead while that script runs
  variants?: Record<string, Record<string, string>>;
}

export interface VrMeta {
  type: 'panorama' | 'screen';
  images: (string | null)[];
  animations: { name: string; restart_at: number; patches: { atlas: string | null; blocks: [number, number, number][] }[] }[];
}

export interface Script { vars: string[]; warps: Warp[] }
export interface Warp { vr: string; test: string; tests: Test[] }
export interface Test { idx: number; hover: number; labels: Record<string, number>; cmds: Cmd[] }
/** One script command; fields depend on `op` (see dracula-port tools/scripts/lst2json.py). */
export interface Cmd { op: string; [k: string]: any }

export interface SaveFile { script: string; label: string; info: string[]; thumb: string; state: any }

export type ImportStage = 'files' | 'scenes' | 'movies';
export interface ImportProgress { stage: ImportStage; done: number; total: number }

export type GameStatus = 'ok' | 'unset' | 'missing' | 'invalid' | 'outdated';

/** A game as seen by the start screen. `base` is the URL prefix for its data (only when status is 'ok'). */
export interface GameEntry { id: GameId; path: string | null; status: GameStatus; base: string | null }

/** The folder the user picked, and what was detected inside it. */
export interface Library { root: string | null; games: GameEntry[] }

export type ImportPick = 'game' | 'overlay' | 'dest';
export interface ImportState { game: { path: string; id: GameId } | null; overlay: string | null; dest: string; target: string | null }
export interface ImportResult { ok?: true; game?: GameId; cancelled?: true; error?: string }

/** API exposed by the Electron preload as window.dracula */
export interface NativeApi {
  platform: string;
  getLibrary(): Promise<Library>;
  /** Picks one folder holding both games; each game is still detected on its own. */
  chooseLibrary(): Promise<{ ok?: true; cancelled?: true; error?: string }>;
  readSaves(game: GameId): Promise<Record<string, string>>;
  writeSave(game: GameId, slot: number, json: string): Promise<boolean>;
  readPrefs(): Promise<Record<string, unknown>>;
  writePrefs(prefs: Record<string, unknown>): Promise<void>;
  setFullscreen(on: boolean): void;
  isFullscreen(): Promise<boolean>;
  quit(): void;
  version(): Promise<string>;
  importState(): Promise<ImportState>;
  importPick(kind: ImportPick): Promise<{ ok?: true; cancelled?: true; error?: string }>;
  importClear(kind: 'overlay'): Promise<void>;
  importStart(): Promise<ImportResult>;
  importCancel(): void;
  onImportProgress(cb: (p: ImportProgress) => void): void;
}
