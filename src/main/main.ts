/* Electron main process.
 *  - Serves the renderer and each game's data folder over the game:// protocol
 *    (with HTTP Range support so audio/video can seek without loading whole files).
 *  - Each game's data folder is chosen by the user on the start screen and stored in
 *    <userData>/config.json. Nothing is hardcoded; stored paths are re-validated on
 *    every launch.
 *  - Saves and preferences are plain JSON files (see savesDir()).
 */
import { app, BrowserWindow, dialog, ipcMain, protocol, utilityProcess, type UtilityProcess } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { findGame } from '../importer/files';
import { DATA_FORMAT, type GameEntry, type GameId, type ImportResult, type ImportState } from '../shared/format';
import { UI } from '../shared/strings';

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
  const picks: { game?: { path: string; id: GameId }; overlay?: string; dest?: string } = {};
  let importer: UtilityProcess | null = null;
  const pickTitles = { game: UI.importGameDialog, overlay: UI.importOverlayDialog, dest: UI.importDestDialog };

  ipcMain.handle('importState', (): ImportState => {
    const dest = picks.dest ?? readConfig().root ?? defaultGamesDir();
    const target = picks.game && dest ? path.join(dest, picks.game.id) : null;
    return { game: picks.game ?? null, overlay: picks.overlay ?? null, dest, target };
  });
  ipcMain.handle('importPick', async (_e, kind: unknown) => {
    if (kind !== 'game' && kind !== 'overlay' && kind !== 'dest') return { cancelled: true };
    const w = win();
    const opts: Electron.OpenDialogOptions = { title: pickTitles[kind], properties: ['openDirectory', 'createDirectory'] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    const dir = r.filePaths[0];
    if (kind === 'game') {
      const id = findGame(dir);
      if (!id) return { error: UI.importNotAGame };
      picks.game = { path: dir, id };
    } else picks[kind] = dir;
    return { ok: true };
  });
  ipcMain.handle('importClear', (_e, kind: unknown) => { if (kind === 'overlay') delete picks.overlay; });
  ipcMain.on('importCancel', () => importer?.postMessage({ type: 'cancel' }));

  // Written to <dest>/<game>.partial (an interrupted import resumes there) and renamed
  // once complete, so a half-converted folder never looks like a game.
  ipcMain.handle('importStart', () => new Promise<ImportResult>((resolve) => {
    const game = picks.game, dest = picks.dest ?? readConfig().root ?? defaultGamesDir();
    if (importer) return resolve({ error: UI.importBusy });
    if (!game || !dest) return resolve({ error: UI.importIncomplete });
    const target = path.join(dest, game.id), out = target + '.partial';
    if (fs.existsSync(target)) return resolve({ error: UI.importExists(target) });
    const child = utilityProcess.fork(path.join(__dirname, 'import-worker.js'), [], { serviceName: 'Dracula importer' });
    importer = child;
    const finish = (r: ImportResult) => { importer = null; child.kill(); resolve(r); };
    child.on('message', (m) => {
      if (m.type === 'progress') win()?.webContents.send('importProgress', { stage: m.stage, done: m.done, total: m.total });
      else if (m.type === 'log') console.log('[import]', m.message);
      else if (m.type === 'cancelled') finish({ cancelled: true });
      else if (m.type === 'error') finish({ error: m.message });
      else if (m.type === 'done') {
        try { fs.renameSync(out, target); } catch (e) { return finish({ error: (e as Error).message }); }
        const cfg = readConfig();
        writeConfig({ root: cfg.root ?? dest, games: { ...cfg.games, [game.id]: target } });
        finish({ ok: true, game: game.id });
      }
    });
    child.on('exit', (code) => { if (importer === child) finish({ error: UI.importCrashed(code) }); });
    child.postMessage({ type: 'start', game: game.path, out, overlays: picks.overlay ? [picks.overlay] : [] });
  }));

  ipcMain.on('setFullscreen', (_e, on: boolean) => win()?.setFullScreen(!!on));
  ipcMain.handle('isFullscreen', () => !!win()?.isFullScreen());
  ipcMain.on('quit', () => app.quit());
  ipcMain.handle('version', () => app.getVersion());
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
