/* Format of the already-converted data folders (produced by the dracula-port
 * converters; usually data/ = Dracula 1 and data2/ = Dracula 2).
 * Every .js file contains:  __dracula.put("kind","key",<json>);
 *
 *   index.js            { manifest, vr, tests }
 *   cursors.js          { name: dataURL }
 *   arn.js              { name: dataURL }   (Dracula 2)
 *   scripts/<name>.js   Script
 *   vr/<name>/assets.js { meta, images: { file: dataURL } }
 *   sound/<name>.wav
 *   movie/<name>.webm
 */

export type GameId = 'dracula1' | 'dracula2';
export type Region = [number, number, number, number];

export interface GameIndex {
  manifest: { game?: GameId; title?: string; scripts: string[]; start?: string; arn?: boolean };
  vr: Record<string, { type: 'panorama' | 'screen'; anims: string[] }>;
  tests: Record<string, Region[]>;
}

export interface VrAssets {
  meta: {
    type: 'panorama' | 'screen';
    animations?: { name: string; restart_at: number; patches?: { atlas: string; blocks: [number, number, number][] }[] }[];
  };
  images: Record<string, string>;
}

export interface Script { vars: string[]; warps: Warp[] }
export interface Warp { vr: string; test: string; tests: Test[] }
export interface Test { idx: number; hover: number; labels: Record<string, number>; cmds: Cmd[] }
/** One script command; fields depend on `op` (see dracula-port tools/scripts/lst2json.py). */
export interface Cmd { op: string; [k: string]: any }

export interface SaveFile { script: string; label: string; info: string[]; thumb: string; state: any }

export type GameStatus = 'ok' | 'unset' | 'missing' | 'invalid';

/** A game as seen by the start screen. `base` is the URL prefix for its data (only when status is 'ok'). */
export interface GameEntry { id: GameId; path: string | null; status: GameStatus; base: string | null }

/** The folder the user picked, and what was detected inside it. */
export interface Library { root: string | null; games: GameEntry[] }

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
}
