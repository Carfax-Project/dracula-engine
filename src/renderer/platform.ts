/* Bridge to the Electron main process: game data, saves, preferences, window.
 * Everything native goes through NativeApi, exposed by preload.ts. */
import type { GameId, NativeApi } from '../shared/format';

declare global { interface Window { dracula?: NativeApi } }

class Platform {
  private saves: Record<string, string> = {};
  private game: GameId = 'dracula1';
  private prefs: Record<string, unknown> = {};
  constructor(private api: NativeApi) {}
  getLibrary() { return this.api.getLibrary(); }
  chooseLibrary() { return this.api.chooseLibrary(); }
  async loadSaves(game: GameId) { this.game = game; this.saves = await this.api.readSaves(game); }
  hasSave(slot: number) { return !!this.saves[slot]; }
  readSave(slot: number) { return this.saves[slot] || null; }
  writeSave(slot: number, json: string) { this.saves[slot] = json; return this.api.writeSave(this.game, slot, json); }
  async loadPrefs() { this.prefs = await this.api.readPrefs(); }
  pref(name: string, def: boolean) { const v = this.prefs[name]; return typeof v === 'boolean' ? v : def; }
  setPref(name: string, v: boolean) { this.prefs[name] = v; void this.api.writePrefs(this.prefs); }
  setFullscreen(on: boolean) { this.api.setFullscreen(on); }
  toggleFullscreen() { void this.api.isFullscreen().then((on) => this.api.setFullscreen(!on)); }
  quit() { this.api.quit(); }
}

if (!window.dracula) throw new Error('preload bridge missing: window.dracula is undefined');
export const platform = new Platform(window.dracula);
