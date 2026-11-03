/* Electron main process.
 *  - Serves the renderer and each game's data folder over the game:// protocol
 *    (with HTTP Range support so audio/video can seek without loading whole files).
 *  - Each game's data folder is chosen by the user on the start screen and stored in
 *    <userData>/config.json. Nothing is hardcoded; stored paths are re-validated on
 *    every launch.
 *  - Saves and preferences are plain JSON files (see savesDir()).
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, utilityProcess, type UtilityProcess } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { findGames, type GameSource } from '../importer/files';
import { DATA_FORMAT, type GameEntry, type GameId, type ImportGame, type ImportResult, type ImportState, type UpdateInfo } from '../shared/format';
import { UI } from '../shared/strings';
import { findUpdate } from './update';

const GAME_IDS: readonly GameId[] = ['dracula1', 'dracula2'];
const isGameId = (v: unknown): v is GameId => typeof v === 'string' && (GAME_IDS as readonly string[]).includes(v);
const RENDERER = path.join(__dirname, 'renderer');

// Tests (and anyone wanting a separate profile) can isolate config, prefs and fallback saves.
if (process.env.DRACULA_USER_DATA) app.setPath('userData', process.env.DRACULA_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'game', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------------------------------------------------------------- config

interface Config { root?: string; games?: Partial<Record<GameId, string>> }

const configFile = () => path.join(app.getPath('userData'), 'config.json');
function readConfig(): Config {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}
function writeConfig(c: Config) { writeAtomic(configFile(), JSON.stringify(c, null, 2)); }

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------ game folders

/** Reads the game id and data format from a data folder's index.js (null if it is not a data folder). */
function gameOf(dir: string): { id: GameId; format: number } | null {
  try {
    const fd = fs.openSync(path.join(dir, 'index.js'), 'r');
    const buf = Buffer.alloc(512);
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8');
    if (!head.startsWith('__dracula.put(')) return null;
    const m = /"manifest":\{[^}]*"game":"(\w+)"/.exec(head);
    const id = m ? m[1] : 'dracula1';   // early Dracula 1 conversions have no "game" field
    const f = /"manifest":\{[^}]*"format":(\d+)/.exec(head);
    return isGameId(id) ? { id, format: f ? Number(f[1]) : 1 } : null;
  } catch { return null; }
}

/** Accepts the data folder itself or a parent holding it (data/, data2/ or any direct subfolder). */
function locate(dir: string, id: GameId): string | null {
  if (gameOf(dir)?.id === id) return dir;
  let subs: string[] = [];
  try { subs = fs.readdirSync(dir).sort(); } catch { return null; }   // gameOf() also skips non-folders and follows symlinks
  for (const s of subs) if (gameOf(path.join(dir, s))?.id === id) return path.join(dir, s);
  return null;
}

function entry(id: GameId, cfg = readConfig()): GameEntry {
  const p = cfg.games?.[id] ?? null;
  if (!p) return { id, path: null, status: 'unset', base: null };
  if (!fs.existsSync(p)) return { id, path: p, status: 'missing', base: null };
  const g = gameOf(p);
  if (g?.id !== id) return { id, path: p, status: 'invalid', base: null };
  if (g.format !== DATA_FORMAT) return { id, path: p, status: 'outdated', base: null };
  return { id, path: p, status: 'ok', base: `game://${id}/` };
}

/** Only folders that are currently valid are reachable through game://. */
function validDir(id: string): string | null {
  if (!isGameId(id)) return null;
  const e = entry(id);
  return e.status === 'ok' ? e.path : null;
}

/** <userData>/saves/<game>: ~/.config/Dracula on Linux, %APPDATA%\Dracula on Windows.
 *  Saves never go next to the game data, which stays read-only and may sit anywhere
 *  (a repository checkout, a read-only mount). DRACULA_USER_DATA redirects the whole
 *  profile, so the tests get their own throwaway saves. */
function savesDir(id: GameId): string {
  const d = path.join(app.getPath('userData'), 'saves', id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');

// Where imports go unless the user picks a folder: local app data, which is never
// synced (unlike %APPDATA% or a OneDrive Documents folder). A test profile keeps them
// inside the profile.
function defaultGamesDir() {
  if (process.env.DRACULA_USER_DATA) return path.join(app.getPath('userData'), 'games');
  const home = app.getPath('home');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Dracula', 'Games');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Dracula', 'games');
}

// --------------------------------------------------------------- protocol

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.map': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

// Game data is another origin than the page; without this, canvases drawn from its images
// cannot be read back (save thumbnails, .arn overlays).
const CORS = { 'Access-Control-Allow-Origin': 'game://app' };

async function serveFile(file: string, req: Request): Promise<Response> {
  let st: fs.Stats;
  try { st = await fs.promises.stat(file); } catch { return new Response('not found', { status: 404 }); }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : st.size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { ...CORS,
      'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${st.size}` } });
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...CORS,
    'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' } });
}

function resolveInside(base: string, rel: string): string | null {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function handleGameProtocol() {
  protocol.handle('game', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    let file: string | null = null;
    if (u.host === 'app') file = resolveInside(RENDERER, rel || 'index.html');
    else {
      const dir = validDir(u.host);
      if (dir) file = resolveInside(path.resolve(dir), rel);
    }
    if (!file) return new Response('forbidden', { status: 403 });
    return serveFile(file, req);
  });
}

// -------------------------------------------------------------------- IPC

function setupIpc(win: () => BrowserWindow | null) {
  ipcMain.handle('getLibrary', () => {
    const cfg = readConfig();
    return { root: cfg.root ?? null, games: GAME_IDS.map((id) => entry(id, cfg)) };
  });

  /* One folder holds both games; each one is still located and validated on its own,
     so a folder with only one of them works too. */
  ipcMain.handle('chooseLibrary', async () => {
    const current = readConfig().root;
    const w = win();
    const opts: Electron.OpenDialogOptions = {
      title: UI.folderDialogTitle,
      properties: ['openDirectory'],
      defaultPath: current && fs.existsSync(current) ? current : undefined,
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    const root = r.filePaths[0];
    const games: Partial<Record<GameId, string>> = {};
    for (const id of GAME_IDS) {
      const dir = locate(root, id);
      if (dir) games[id] = dir;
    }
    if (!Object.keys(games).length) return { error: UI.folderHasNoData };
    writeConfig({ root, games });
    return { ok: true };
  });

  // Deletes the game's own folder, never the library around it, and only while it still
  // holds that game: a hand-edited config.json can't point this at anything else.
  ipcMain.handle('removeGame', async (_e, id: unknown) => {
    if (!isGameId(id)) return { cancelled: true };
    const e = entry(id);
    if (!e.path || (e.status !== 'ok' && e.status !== 'outdated')) return { error: e.status === 'missing' ? UI.folderGone : UI.folderInvalid };
    const w = win();
    const opts: Electron.MessageBoxOptions = {
      type: 'warning', buttons: [UI.removeButton, UI.cancel], defaultId: 1, cancelId: 1,
      message: UI.removeQuestion, detail: UI.removeDetail(e.path),
    };
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 0) return { cancelled: true };
    if (gameOf(e.path)?.id !== id) return { error: UI.folderInvalid };
    try {
      await fs.promises.rm(e.path, { recursive: true, force: true });
      // what an interrupted import into the same place left behind
      if (path.basename(e.path) === id) await fs.promises.rm(e.path + '.partial', { recursive: true, force: true });
    } catch (err) { return { error: UI.removeFailed((err as Error).message) }; }
    const cfg = readConfig();
    const { [id]: _gone, ...games } = cfg.games ?? {};
    writeConfig({ ...cfg, games });
    return { ok: true };
  });

  ipcMain.handle('readSaves', (_e, id: unknown) => {
    const out: Record<string, string> = {};
    if (!isGameId(id)) return out;
    const d = savesDir(id);
    for (const f of fs.readdirSync(d)) {
      const m = /^slot(\d+)\.json$/.exec(f);
      if (m) { try { out[m[1]] = fs.readFileSync(path.join(d, f), 'utf8'); } catch { /* unreadable slot */ } }
    }
    return out;
  });
  ipcMain.handle('writeSave', (_e, id: unknown, slot: unknown, json: unknown) => {
    if (!isGameId(id) || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 99 || typeof json !== 'string') return false;
    try { writeAtomic(path.join(savesDir(id), `slot${slot}.json`), json); return true; }
    catch (e) { console.error(e); return false; }
  });

  ipcMain.handle('readPrefs', () => {
    try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; }
  });
  ipcMain.handle('writePrefs', (_e, prefs: unknown) => {
    if (!prefs || typeof prefs !== 'object') return;
    try { writeAtomic(prefsFile(), JSON.stringify(prefs, null, 2)); } catch (e) { console.error(e); }
  });

  // The renderer never passes paths: it asks for a dialog, and main keeps what was picked.
  const picks: { source?: string; games: GameSource[]; dest?: string } = { games: [] };
  let importer: UtilityProcess | null = null;
  let cancelled = false;
  const pickTitles = { game: UI.importGameDialog, dest: UI.importDestDialog };
  const importDest = () => picks.dest ?? readConfig().root ?? defaultGamesDir();
  const importGames = (dest = importDest()) => picks.games.map((g): ImportGame => {
    const target = path.join(dest, g.id);
    return { id: g.id, path: g.dir, target, exists: fs.existsSync(target) };
  });

  ipcMain.handle('importState', (): ImportState => ({ source: picks.source ?? null, games: importGames(), dest: importDest() }));
  ipcMain.handle('importPick', async (_e, kind: unknown) => {
    if (kind !== 'game' && kind !== 'dest') return { cancelled: true };
    const w = win();
    const opts: Electron.OpenDialogOptions = { title: pickTitles[kind], properties: ['openDirectory', 'createDirectory'] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    const dir = r.filePaths[0];
    if (kind === 'game') {
      const games = findGames(dir);
      if (!games.length) return { error: UI.importNotAGame };
      picks.source = dir;
      picks.games = games;
    } else picks.dest = dir;
    return { ok: true };
  });
  ipcMain.on('importCancel', () => { cancelled = true; importer?.postMessage({ type: 'cancel' }); });

  // Written to <dest>/<game>.partial (an interrupted import resumes there) and renamed
  // once complete, so a half-converted folder never looks like a game.
  const importOne = (game: GameSource, dest: string) => new Promise<ImportResult>((resolve) => {
    const target = path.join(dest, game.id), out = target + '.partial';
    const child = utilityProcess.fork(path.join(__dirname, 'import-worker.js'), [], { serviceName: 'Dracula importer' });
    importer = child;
    const finish = (r: ImportResult) => { importer = null; child.kill(); resolve(r); };
    child.on('message', (m) => {
      if (m.type === 'progress') win()?.webContents.send('importProgress', { game: game.id, stage: m.stage, done: m.done, total: m.total });
      else if (m.type === 'log') console.log('[import]', m.message);
      else if (m.type === 'cancelled') finish({ cancelled: true });
      else if (m.type === 'error') finish({ error: m.message });
      else if (m.type === 'done') {
        try { fs.renameSync(out, target); } catch (e) { return finish({ error: (e as Error).message }); }
        const cfg = readConfig();
        writeConfig({ root: cfg.root ?? dest, games: { ...cfg.games, [game.id]: target } });
        finish({ ok: true });
      }
    });
    child.on('exit', (code) => { if (importer === child) finish({ error: UI.importCrashed(code) }); });
    child.postMessage({ type: 'start', game, out });
  });

  let running = false;
  ipcMain.handle('importStart', async (): Promise<ImportResult> => {
    if (running) return { error: UI.importBusy };
    const dest = importDest();
    if (!picks.games.length || !dest) return { error: UI.importIncomplete };
    const games = importGames(dest);
    const todo = picks.games.filter((g) => !games.find((x) => x.id === g.id)!.exists);
    if (!todo.length) return { error: UI.importExists(games.map((g) => g.target)) };
    running = true;
    cancelled = false;
    const done: GameId[] = [];
    try {
      for (const g of todo) {
        if (cancelled) return { cancelled: true, games: done };
        const r = await importOne(g, dest);
        if (!r.ok) return { ...r, games: done };
        done.push(g.id);
      }
      return { ok: true, games: done };
    } finally { running = false; }
  });

  ipcMain.on('setFullscreen', (_e, on: boolean) => win()?.setFullScreen(!!on));
  ipcMain.handle('isFullscreen', () => !!win()?.isFullScreen());
  ipcMain.on('quit', () => app.quit());
  ipcMain.handle('version', () => app.getVersion());

  let update: Promise<UpdateInfo | null> | null = null;
  ipcMain.handle('checkUpdate', () => update ??= findUpdate((u, i) => net.fetch(u, i), app.getVersion(), DATA_FORMAT).catch(() => null));
  ipcMain.on('openUpdate', () => { void update?.then((u) => u && shell.openExternal(u.url)); });
}

// ----------------------------------------------------------------- window

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const args = process.argv.slice(1);
  mainWindow = new BrowserWindow({
    width: 1280, height: 960, minWidth: 640, minHeight: 480,
    backgroundColor: '#000000', title: 'Dracula', autoHideMenuBar: true,
    fullscreen: args.includes('--fullscreen'),
    // Window and taskbar icon. Electron reads .ico only on Windows; elsewhere the PNG.
    icon: path.join(__dirname, 'renderer/assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false,
    },
  });
  mainWindow.setMenu(null);
  const q = new URLSearchParams();
  for (const a of args) {
    const m = /^--(game|warp|script)=(.+)$/.exec(a);
    if (m) q.set(m[1], m[2]);
    if (a === '--autostart') q.set('autostart', '1');
  }
  void mainWindow.loadURL('game://app/index.html' + (q.toString() ? '?' + q : ''));
  if (args.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  handleGameProtocol();
  setupIpc(() => mainWindow);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
