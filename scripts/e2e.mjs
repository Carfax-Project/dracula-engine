// End-to-end smoke test of the desktop app (Playwright driving Electron).
//
//   DRACULA_TEST_D1=<Dracula 1 data folder> DRACULA_TEST_D2=<Dracula 2 data folder> npm run test:e2e
//
// Either variable can be omitted (that game is skipped). The app is pointed at their
// parent folder, since one folder holds both games. Uses a throwaway profile, so
// your real config, prefs and saves are not touched (with DRACULA_USER_DATA set the app
// keeps saves inside that profile). The game data folders are never written.
// On a headless Linux box run it under xvfb:  xvfb-run -a npm run test:e2e
import { _electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'test-results');
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'dracula-e2e-'));
writeFileSync(join(profile, 'prefs.json'), JSON.stringify({ updateCheck: false }));
const games = { dracula1: process.env.DRACULA_TEST_D1, dracula2: process.env.DRACULA_TEST_D2 };
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };

async function launch(extra = []) {
  const args = [root, ...extra];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  if (process.env.DRACULA_TEST_SWGL) args.unshift('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const app = await _electron.launch({ args, env: { ...process.env, DRACULA_USER_DATA: profile } });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
  await win.waitForTimeout(1500);
  return { app, win };
}
const cards = (win) => win.evaluate(() => Object.fromEntries([...document.querySelectorAll('.game')].map((c, i) =>
  [i ? 'dracula2' : 'dracula1', { play: c.hasAttribute('data-play'), text: c.innerText.replace(/\s+/g, ' ') }])));

try {
  // 1. fresh profile: nothing configured
  let { app, win } = await launch();
  let c = await cards(win);
  check(!c.dracula1.play && !c.dracula2.play, 'fresh profile shows no playable game');

  // 2. one folder holds both games; pick it once through the gear sheet
  //    (the native dialog is stubbed)
  const library = dirname(Object.values(games).find(Boolean));
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, library);
  await win.click('button.gear');
  await win.click('button[data-choose]');
  await win.waitForTimeout(600);
  c = await cards(win);
  for (const [id, dir] of Object.entries(games)) {
    if (!dir) continue;
    check(c[id].play, `${id}: detected inside ${library}`);
  }
  await win.screenshot({ path: join(shots, 'start-screen.png') });
  await app.close();

  // 3. new session: choices remembered; each game starts and reaches its first scene
  for (const [id, dir] of Object.entries(games)) {
    if (!dir) continue;
    ({ app, win } = await launch());
    c = await cards(win);
    check(c[id].play, `${id}: folder remembered in a new session`);
    await win.click(`[data-play=${id}]`);   // the cover itself is the play target
    await win.waitForTimeout(6000);
    for (let i = 0; i < 4; i++) { await win.keyboard.press('Space'); await win.waitForTimeout(1000); }
    const warp = await win.evaluate(() => window.engine?.warp?.vr || null);
    check(!!warp, `${id}: running, current scene ${warp}`);
    await win.keyboard.press('F10');
    await win.waitForTimeout(400);
    check(await win.isVisible('#ui.menu input[name=volume]'), `${id}: F10 opens the options menu`);
    await win.evaluate(() => {
      const el = document.querySelector('#ui.menu input[name=volume]');
      el.value = '40';
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    });
    await win.screenshot({ path: join(shots, `${id}-options.png`) });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    check(!(await win.isVisible('#ui.menu')), `${id}: Esc closes the options menu`);
    let prefs = {};
    try { prefs = JSON.parse(readFileSync(join(profile, 'prefs.json'), 'utf8')); } catch { /* missing */ }
    check(prefs.volume === 0.4, `${id}: volume stored in prefs.json`);
    await win.keyboard.press('F3');
    await win.waitForTimeout(300);
    check(!(await win.evaluate(() => window.engine.stretch)), `${id}: F3 toggles stretch`);
    await win.keyboard.press('F3');
    await win.evaluate(async () => { const e = window.engine; e.captureContext(); e.saveThumbnail(); await e.saveGame(7); });
    await win.screenshot({ path: join(shots, `${id}.png`) });
    await app.close();
    let wrote = false;
    try { wrote = readdirSync(join(profile, 'saves', id)).includes('slot7.json'); } catch { /* missing */ }
    check(wrote, `${id}: save file written`);
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
