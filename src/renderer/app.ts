/* Start screen: one card per game with its data folder (chosen by the user and
 * remembered between sessions): the two covers split the window, and clicking a
 * playable one starts that game.
 * The markup lives in index.html as <template> elements; this file only clones them
 * and fills text from UI in ../shared/strings. */
import type { GameEntry, GameId, GameIndex, ImportPick, Library } from '../shared/format';
import { Engine } from './engine';
import { platform } from './platform';
import { UI } from '../shared/strings';
import { bindSettings } from './settings';
import { $, clamp, clone, fetchData } from './util';

const GAMES: { id: GameId; title: string }[] = [
  { id: 'dracula1', title: 'Dracula: The Resurrection' },
  { id: 'dracula2', title: 'Dracula 2: The Last Sanctuary' },
];

const params = new URLSearchParams(location.search);
let started = false;

let playable: { el: HTMLElement; entry: GameEntry }[] = [];
let selected = -1;

function select(i: number) {
  selected = i;
  playable.forEach((p, j) => p.el.classList.toggle('sel', j === i));
  $('ui').querySelector('.games')?.classList.toggle('picking', i >= 0);
}
function move(step: number) {
  if (!playable.length) return;
  select(selected < 0 ? (step > 0 ? playable.length - 1 : 0) : clamp(selected + step, 0, playable.length - 1));
}
function play() {
  const p = playable[selected] ?? playable[0];
  if (p) void start(p.entry);
}

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
  for (const img of root.querySelectorAll('img')) img.src = `assets/${g.id}-cover.jpg`;
  root.querySelector('.name')!.textContent = g.title;
  if (e.status === 'ok') {
    root.dataset.play = g.id;
    root.onclick = () => void start(e);
    root.onmouseenter = root.onfocus = () => select(playable.findIndex((p) => p.el === root));
  } else {
    root.classList.add('unset');
    root.removeAttribute('tabindex');
    root.onmouseenter = () => select(-1);
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
  if (e.status === 'outdated') return UI.folderOutdated;
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

  scrim.querySelector('.opts')!.append(clone('tpl-prefs'));
  bindSettings(scrim);
  void platform.version().then((v) => { scrim.querySelector('[data-version]')!.textContent = v; });

  const close = () => { scrim.remove(); document.onkeydown = null; };
  scrim.querySelector<HTMLButtonElement>('button.close')!.onclick = close;
  scrim.onclick = (ev) => { if (ev.target === scrim) close(); };
  document.onkeydown = (ev) => { if (ev.key === 'Escape') close(); };
  scrim.querySelector<HTMLButtonElement>('button.pick')!.onclick = async () => {
    const r = await platform.chooseLibrary();
    close();
    if (!r.cancelled) reload();
  };
  scrim.querySelector<HTMLButtonElement>('button[data-import]')!.onclick = () => { close(); openImport(reload); };
}

function openImport(reload: () => void) {
  const ui = $('ui');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.append(clone('tpl-import'));
  ui.append(scrim);
  const q = <T extends Element = HTMLElement>(sel: string) => scrim.querySelector<T>(sel)!;
  const start = q<HTMLButtonElement>('button.start'), stop = q<HTMLButtonElement>('button.stop');
  const closeBtn = q<HTMLButtonElement>('button.close'), msg = q('p.msg');
  const title = (id: GameId) => GAMES.find((g) => g.id === id)!.title;
  let running = false, imported = false;

  const note = (field: string, text: string, kind = '') => {
    const el = q(`[data-note=${field}]`);
    el.textContent = text;
    el.className = 'note ' + kind;
  };
  const refresh = async () => {
    const s = await platform.importState();
    q('[data-path=game]').textContent = s.source ?? UI.importNoGame;
    q('[data-path=dest]').textContent = s.dest;
    if (s.games.length) note('game', UI.importFound(s.games.map((g) => title(g.id))), 'ok');
    const fresh = s.games.filter((g) => !g.exists).map((g) => g.target), skipped = s.games.filter((g) => g.exists).map((g) => g.target);
    note('dest', [fresh.length ? UI.importInto(fresh) : '', skipped.length ? UI.importSkipped(skipped) : ''].filter(Boolean).join('. '));
    start.disabled = !s.games.length;
  };
  for (const b of scrim.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
    b.onclick = async () => {
      const r = await platform.importPick(b.dataset.pick as ImportPick);
      if (r.error) note(b.dataset.pick!, r.error, 'bad');
      await refresh();
    };
  }

  const setRunning = (on: boolean) => {
    running = on;
    for (const b of scrim.querySelectorAll<HTMLButtonElement>('.form button')) b.disabled = on;
    start.hidden = on;
    stop.hidden = !on;
    stop.disabled = false;
    closeBtn.disabled = on;
    q('.progress').hidden = !on;
  };
  platform.onImportProgress((p) => {
    q('.progress .label').textContent = UI.importStep(title(p.game), UI.importStage[p.stage]);
    q('.progress .count').textContent = p.total > 1 ? `${p.done} / ${p.total}` : '';
    q('.progress .bar > div').style.width = (p.total ? (100 * p.done) / p.total : 0) + '%';
  });
  start.onclick = async () => {
    msg.textContent = '';
    setRunning(true);
    const r = await platform.importStart();
    setRunning(false);
    if (r.games?.length) imported = true;
    if (r.ok) msg.textContent = UI.importDone(r.games!.map(title));
    else msg.textContent = r.cancelled ? UI.importCancelled : UI.importFailed(r.error ?? '');
    await refresh();
  };
  stop.onclick = () => { stop.disabled = true; platform.importCancel(); };

  const close = () => {
    if (running) return;
    scrim.remove();
    document.onkeydown = null;
    if (imported) reload();
  };
  closeBtn.onclick = close;
  scrim.onclick = (ev) => { if (ev.target === scrim) close(); };
  document.onkeydown = (ev) => { if (ev.key === 'Escape') close(); };
  void refresh();
}

async function render() {
  const ui = $('ui');
  const lib = await platform.getLibrary().catch(() => ({ root: null, games: [] } as Library));
  const byId = new Map(lib.games.map((e) => [e.id, e]));
  const ready = lib.games.filter((e) => e.status === 'ok');
  ui.className = ready.length ? 'pick-game' : 'pick-game nothing';
  ui.replaceChildren(clone('tpl-start'));
  const games = ui.querySelector<HTMLElement>('.games')!;
  playable = [];
  selected = -1;
  for (const g of GAMES) {
    const e = byId.get(g.id) || { id: g.id, path: null, status: 'unset' as const, base: null };
    games.append(half(g, e));
    if (e.status === 'ok') playable.push({ el: games.lastElementChild as HTMLElement, entry: e });
  }
  games.onmouseleave = () => select(-1);
  ui.querySelector<HTMLButtonElement>('button.gear')!.onclick = () => openSettings(lib, () => void render());
  ui.querySelector<HTMLButtonElement>('button.quit')!.onclick = () => platform.quit();
  return ready;
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
  // F11 on the start screen too. Once a game runs the engine has its own handler,
  // so this one stands down (both firing would toggle twice and cancel out).
  window.addEventListener('keydown', (e) => {
    if (started) return;
    if (e.key === 'F11') { e.preventDefault(); platform.toggleFullscreen(); return; }
    // Enter on a focused button is that button's click
    if ($('ui').querySelector('.scrim') || e.target instanceof HTMLButtonElement) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
  });
  const ready = await render();
  if (params.get('autostart') && ready.length) {
    const want = params.get('game');
    void start(ready.find((e) => e.id === want) || ready[0]);
  }
}

void main();
