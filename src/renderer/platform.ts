/* Bridge to the Electron main process: game data, saves, preferences, window.
 * Everything native goes through NativeApi, exposed by preload.ts. */
import type { GameId, ImportPick, ImportProgress, NativeApi } from '../shared/format';

declare global { interface Window { dracula?: NativeApi } }

class Platform {
  private saves: Record<string, string> = {};
  private game: GameId = 'dracula1';
  private prefs: Record<string, unknown> = {};
  constructor(private api: NativeApi) {}
  getLibrary() { return this.api.getLibrary(); }
  chooseLibrary() { return this.api.chooseLibrary(); }
  removeGame(game: GameId) { return this.api.removeGame(game); }
  async loadSaves(game: GameId) { this.game = game; this.saves = await this.api.readSaves(game); }
  hasSave(slot: number) { return !!this.saves[slot]; }
  readSave(slot: number) { return this.saves[slot] || null; }
  writeSave(slot: number, json: string) { this.saves[slot] = json; return this.api.writeSave(this.game, slot, json); }
  async loadPrefs() {
    this.prefs = await this.api.readPrefs();
    // "stretch" (fill the window) became "widescreen"; off still means 4:3
    if ('stretch' in this.prefs) {
      this.prefs.widescreen ??= this.prefs.stretch;
      delete this.prefs.stretch;
      void this.api.writePrefs(this.prefs);
    }
  }
  pref(name: string, def: boolean): boolean;
  pref(name: string, def: number): number;
  pref(name: string, def: boolean | number) {
    const v = this.prefs[name];
    return typeof v === typeof def ? v : def;
  }
  setPref(name: string, v: boolean | number) { this.prefs[name] = v; void this.api.writePrefs(this.prefs); }
  setFullscreen(on: boolean) { this.api.setFullscreen(on); }
  isFullscreen() { return this.api.isFullscreen(); }
  toggleFullscreen() { void this.api.isFullscreen().then((on) => this.api.setFullscreen(!on)); }
  quit() { this.api.quit(); }
  version() { return this.api.version(); }
  checkUpdate() { return this.api.checkUpdate(); }
  openUpdate() { this.api.openUpdate(); }
  importState() { return this.api.importState(); }
  importPick(kind: ImportPick) { return this.api.importPick(kind); }
  importStart() { return this.api.importStart(); }
  importCancel() { this.api.importCancel(); }
  onImportProgress(cb: (p: ImportProgress) => void) { this.api.onImportProgress(cb); }
}

if (!window.dracula) throw new Error('preload bridge missing: window.dracula is undefined');
export const platform = new Platform(window.dracula);
