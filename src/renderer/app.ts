/* Start screen: one card per game with its data folder (chosen by the user and
 * remembered between sessions): the two covers split the window, and clicking a
 * playable one starts that game.
 * The markup lives in index.html as <template> elements; this file only clones them
 * and fills text from UI in ../shared/strings. */
import type { GameEntry, GameId, GameIndex, Library } from '../shared/format';
import { Engine } from './engine';
import { platform } from './platform';
import { UI } from '../shared/strings';
import { $, clone, fetchData } from './util';

const GAMES: { id: GameId; title: string }[] = [
  { id: 'dracula1', title: 'Dracula: The Resurrection' },
  { id: 'dracula2', title: 'Dracula 2: The Last Sanctuary' },
];

const params = new URLSearchParams(location.search);
let started = false;

/** Brief notice in the corner (the same strip the engine uses during play). */
function notice(text: string) {
  const el = $('msg');
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

/** One half of the screen: a cover that starts its game once the folder is known. */
function half(g: typeof GAMES[number], e: GameEntry) {
  const frag = clone('tpl-game');
  const root = frag.querySelector<HTMLElement>('.game')!;
  root.querySelector<HTMLImageElement>('img')!.src = `assets/${g.id}-cover.jpg`;
  root.querySelector('.name')!.textContent = g.title;
  if (e.status === 'ok') {
    root.dataset.play = g.id;
    root.title = e.path ?? '';
    root.onclick = () => void start(e);
    root.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void start(e); } };
  } else {
    root.classList.add('unset');
    root.removeAttribute('tabindex');
  }
  return frag;
}

/** Where each game stands inside the chosen folder. */
function foundText(e: GameEntry, root: string | null) {
  // The folder is shown above, so name only the part below it.
  if (e.status === 'ok') {
    const p = e.path!;
    return UI.detected(root && p.startsWith(root) ? p.slice(root.length).replace(/^[/\\]/, '') || '.' : p);
  }
  if (!root) return '';   // the path box above already says no folder is set
  if (e.status === 'missing') return UI.folderGone;
  if (e.status === 'invalid') return UI.folderInvalid;
  return UI.notFound;
}

/** The gear sheet: current folder, what was detected, and a way to change it. */
function openSettings(lib: Library, reload: () => void) {
  const ui = $('ui');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.append(clone('tpl-settings'));
  ui.append(scrim);

  scrim.querySelector('.path')!.textContent = lib.root ?? UI.noFolder;
  const list = scrim.querySelector('ul.found')!;
  for (const g of GAMES) {
    const e = lib.games.find((x) => x.id === g.id);
    const ok = e?.status === 'ok';
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'no';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = ok ? '\u2713' : '\u2014';
    const name = document.createElement('span');
    name.className = 'gname';
    name.textContent = g.title;
    const where = document.createElement('span');
    where.className = 'gwhere';
    where.textContent = foundText(e ?? { id: g.id, path: null, status: 'unset', base: null }, lib.root);
    li.append(mark, name, where);
    list.append(li);
  }

  const close = () => { scrim.remove(); document.onkeydown = null; };
  scrim.querySelector<HTMLButtonElement>('button.close')!.onclick = close;
  scrim.onclick = (ev) => { if (ev.target === scrim) close(); };
  document.onkeydown = (ev) => { if (ev.key === 'Escape') close(); };
  scrim.querySelector<HTMLButtonElement>('button.pick')!.onclick = async () => {
    const r = await platform.chooseLibrary();
    close();
    if (!r.cancelled) reload();
  };
}

async function render() {
  const ui = $('ui');
  const lib = await platform.getLibrary().catch(() => ({ root: null, games: [] } as Library));
  const byId = new Map(lib.games.map((e) => [e.id, e]));
  const playable = lib.games.filter((e) => e.status === 'ok');
  ui.className = playable.length ? 'pick-game' : 'pick-game nothing';
  ui.replaceChildren(clone('tpl-start'));
  const games = ui.querySelector('.games')!;
  for (const g of GAMES) {
    games.append(half(g, byId.get(g.id) || { id: g.id, path: null, status: 'unset', base: null }));
  }
  ui.querySelector<HTMLButtonElement>('button.gear')!.onclick = () => openSettings(lib, () => void render());
  ui.querySelector<HTMLButtonElement>('button.quit')!.onclick = () => platform.quit();
  return playable;
}

async function start(e: GameEntry) {
  if (started || e.status !== 'ok' || !e.base) return;
  started = true;
  // Fullscreen now, while the data loads: the transition is over before the engine
  // asks for the pointer lock, which a window resize can otherwise drop.
  platform.setFullscreen(true);
  const ui = $('ui');
  const g = GAMES.find((x) => x.id === e.id)!;
  ui.className = '';
  ui.replaceChildren(clone('tpl-loading'));
  ui.querySelector('h1')!.textContent = g.title.toUpperCase();
  let engine: Engine;
  try {
    const index = await fetchData<GameIndex>(e.base + 'index.js');
    engine = new Engine();
    window.engine = engine;
    await engine.init({ id: e.id, title: index.manifest.title || g.title, base: e.base, index });
  } catch (err) {
    console.error(err);
    started = false;
    await render();
    notice(UI.startFailed((err as Error).message));
    return;
  }
  ui.style.display = 'none';
  if (engine.wantClassic) engine.lockPointer();   // needs the click that chose the game
  void engine.run(params);
}

async function main() {
  await platform.loadPrefs();
  // F / F11 on the start screen too. Once a game runs the engine has its own handler,
  // so this one stands down (both firing would toggle twice and cancel out).
  window.addEventListener('keydown', (e) => {
    if (started || !(e.key === 'F11' || e.key === 'f' || e.key === 'F')) return;
    e.preventDefault();
    platform.toggleFullscreen();
  });
  const entries = await render();
  const ready = entries.filter((e) => e.status === 'ok');
  // gamepad: A starts the first available game
  const pollPad = () => {
    if (started) return;
    const gp = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected);
    if (gp && gp.buttons[0]?.pressed && ready[0]) { void start(ready[0]); return; }
    requestAnimationFrame(pollPad);
  };
  requestAnimationFrame(pollPad);
  if (params.get('autostart') && ready.length) {
    const want = params.get('game');
    void start(ready.find((e) => e.id === want) || ready[0]);
  }
}

void main();
