# AGENTS.md

Context for AI coding agents (Claude Code, Copilot, Codex, Cursor…) working on this
repository. Read this file before changing anything. Keep it up to date when you
change architecture, conventions or decisions.

## What this is

A desktop app (Electron + TypeScript) that plays two 1999/2000 point-and-click
adventures built on the PhoenixVR engine:

- **Dracula: The Resurrection** (`dracula1`)
- **Dracula 2: The Last Sanctuary** (`dracula2`)

The engine was ported from the plain-browser runtime of `dracula-port`, an earlier
version of this same project; it is not based on any other codebase. GPLv3 or later.

The app converts the original game files itself (Settings → "Import from game
files…", or `npm run import`) into data folders it then plays from. The sibling
project `dracula-port` (Python and C++) was the earlier converter.

Platforms: Linux (AppImage and `.deb`) and Windows (a per-user NSIS installer, no admin rights) only. There is no macOS
support, by decision; don't add a `mac` build target.

## Hard rules

1. **Never write into the game data folders** from the app or the tests. Converting
   or re-encoding data is a separate step, done only when the user asks, and it either
   writes new output or keeps a backup of what it replaces. The engine reads only the
   current data format (`DATA_FORMAT`); there is no compatibility layer for older ones.
2. **No game assets in this repository** (scripts, images, sounds, videos, extracted
   text). The engine must stay distributable on its own. One deliberate exception:
   the two box-art covers in `src/renderer/assets/`, the app
   icon next to them, and the README animations in `docs/images/`, all covered
   by the attribution notice in the README's License section. Don't add any other
   game file.
3. **No hardcoded paths** to anyone's machine. The user picks one folder holding
   the games; each game is still located and validated inside it on its own. The
   choice is stored in `<userData>/config.json` and re-validated on every launch.
4. Don't break the separate `dracula-port` project or local game installs.
5. Keep game behaviour faithful to the original games. When in doubt, check the
   converted data (the script commands in `scripts/<name>.js`) and the behaviour of
   `dracula-port/runtime/engine.js` rather than guessing.

## Language conventions

- Code, comments, docs, commit messages, and `log()` / `warn()` / `throw` messages:
  **English**.
- **All app text is English**: start screen, dialogs, in-game messages. The games'
  own content (videos, pictures, voice) is whatever the converted data holds.
- **Text the code injects lives in `src/shared/strings.ts`** (the `UI` object), used
  by both the main process and the renderer. Don't inline player-facing text at the
  call site; add a key there and reference `UI.<key>`. Entries that take an argument
  are functions. It is written with `textContent`, so no HTML markup in there.
- **Static text that is part of a screen's markup lives in its `<template>`** in
  `index.html`, next to the structure it belongs to (the gear sheet labels, for example).

## Working on this repo

- **Comments only when strictly necessary**: a non-obvious why (an engine quirk,
  a browser constraint, a workaround). Never restate what the code does, and no
  doc comments, section banners or explanatory comments on self-explanatory code.

- Do what was asked, verify it, and report briefly. No side quests (benchmarks,
  speculative features).
- When only a question is asked, answer it; don't edit files.
- Ask before expanding scope (new subsystems, new dependencies).
- Prefer small, focused edits that keep the main / preload / shared / renderer split.
  Skim `src/renderer/engine.ts` before touching game behaviour.

## Commands

```bash
npm install
npm start                 # build + run the desktop app
npm run build             # esbuild bundles to dist/app
npm run typecheck         # tsc --noEmit, strict mode (must pass)
npm test                  # unit tests (node:test), no game data needed
npm run test:e2e          # Playwright drives the real app (see below)
npm run dist              # release build (DEV off) for this OS: AppImage + .deb on Linux, NSIS installer on Windows
npm run import -- --game <installed game, CD images, or a folder holding both> --out <new data folder>
```

E2E test: `DRACULA_TEST_D1=<data> DRACULA_TEST_D2=<data2> npm run test:e2e`

- Uses a throwaway profile (`DRACULA_USER_DATA`), so saves stay in that profile.
- Stubs the native folder dialog.
- Headless: run under `xvfb-run -a`, add `DRACULA_TEST_SWGL=1` when there is no GPU.
- Running as root needs `--no-sandbox`; the script adds it.
- Terminals inside VS Code export `ELECTRON_RUN_AS_NODE=1`, which makes Electron
  start as plain Node ("Process failed to launch!"). Run with
  `env -u ELECTRON_RUN_AS_NODE …` there.

Requirements and runtime details (kept out of the README, which is for players):

- Node.js 22.12+. Older versions fail to install Electron (its install script needs
  `require(esm)`); `.npmrc` sets `engine-strict` so npm says so up front.
- Command-line flags, after `--` with `npm start`: `--fullscreen`, `--devtools`,
  `--game=dracula1|dracula2` with `--autostart` to skip the start screen, and for
  testing `--script=<name> --warp=<NAME>.vr` to jump to a scene of that script
  (e.g. `--script=0m1script --warp=A01.vr`).
- `<userData>` is `~/.config/Dracula` on Linux and `%APPDATA%\Dracula` on Windows. It
  holds `config.json`, `prefs.json` and `saves/`. `DRACULA_USER_DATA=<dir>` swaps it.
- On Ubuntu 24.04+, an AppImage that exits with a sandbox error needs `--no-sandbox`.

After any change: `npm run typecheck`, `npm test` and `npm run build` must pass. For
behaviour changes, run the e2e test when game data is available.

Unit tests live in `test/*.test.ts`; `scripts/test.mjs` bundles them with esbuild and
runs `node --test`. Their inputs are a few bytes built inside the test, never game
files (hard rule 2).

## Layout

```
src/main/main.ts          Electron main: window, game:// protocol (Range support), IPC,
                          library folder config + per-game detection, saves/prefs as JSON
src/main/preload.ts       contextBridge -> window.dracula (NativeApi)
src/shared/format.ts      Types: data folder format, GameEntry, Library, NativeApi
src/shared/strings.ts     UI object: every player-visible string, main + renderer
src/importer/             Original game files -> data format 3 (Node; ffmpeg for encoding):
                          vr.ts (.vr decoder), lst.ts (scripts), formats.ts (.pak, .tst,
                          .pcx, .arn), fourxm.ts (Dracula 1's raw 4XM movies), disc.ts
                          (CD images), files.ts (game detection, file lookup, per-folder
                          variants), ffmpeg.ts (WebP, Opus, VP9), import.ts, cli.ts
                          (npm run import [-- --no-videos]),
                          worker.ts (the utility process the import screen runs)
src/renderer/app.ts       Start screen: the two covers, the gear sheet, the import
                          screen, start a game
src/renderer/engine.ts    The engine (script interpreter, warps, input, sound, video, saves)
src/renderer/panorama.ts  WebGL 360° cube-face renderer + camera math
src/renderer/backdrop.ts  4:3 mode: fills the bars with the current frame, blurred
src/renderer/shaders/     GLSL shaders (.glsl), inlined by esbuild's text loader
src/renderer/assets/      Cover art and the app icon (icon.ico + icon.png), copied to
                          dist/ and served from game://app/assets/
src/renderer/platform.ts  Bridge to the main process (NativeApi): data, saves, prefs
src/renderer/settings.ts  Player settings rows (tpl-prefs) shared by the gear sheet
                          and the in-game options menu
src/renderer/util.ts      Constants, angles, region hit tests, data loading
src/renderer/env.d.ts     The build-time DEV flag
src/renderer/index.html   Page + CSS (layered canvases: gl, screen2d, overlay; video)
                          and the <template> markup for every runtime screen
scripts/build.mjs         esbuild config (main, preload and the importer as CJS,
                          renderer as IIFE; --release turns DEV off)
scripts/e2e.mjs           End-to-end smoke test
scripts/test.mjs          Unit test runner
test/                     Unit tests (importer decoders, file lookup, util)
docs/images/              README animations (start screen, three scenes, options menu)
```

## Architecture notes

- **Protocol.** `game://app/...` serves `dist/app/renderer`. `game://<gameId>/...`
  serves that game's configured data folder, and only while it validates. Path
  traversal is blocked by `resolveInside`. Video and audio need HTTP Range: keep it.
  Game data is another origin than the page, so responses carry
  `Access-Control-Allow-Origin: game://app` and `loadImage` sets `crossOrigin`;
  without both, canvases drawn from game images are tainted (save thumbnails and
  `.arn` overlays read pixels back).
- **Start screen.** The two covers split the window; each half is a `.game` carrying
  `data-play=<id>` once its game was found. The art (`img.art`) uses `object-fit:
  contain` so the box art is never cropped; behind it the same picture (`img.blur`),
  blurred and covering, fills the bars. Only its opacity animates, never the blur.
  A game that was not found gets the `unset` class and stays dark.
  - **Selection.** One cover at a time is `.sel` (and `.games` is `.picking`), set
    by the mouse, keyboard focus or ←/→; Enter or Space plays it, or the first
    playable game when none is selected. The
    styling hangs on `.sel`, not `:hover`, so every input looks the same. The keys
    are ignored while the gear sheet is open or a corner button has the focus.
  - **Corner.** The halves carry no controls; the `.corner` pair at the top right
    holds the gear and quit (`platform.quit()`), each a glyph in a pill whose label
    slides out on hover. The gear opens the `tpl-settings` sheet: chosen folder, what
    was detected per game, the "Choose folder…" button (`data-choose`, which the
    e2e test clicks), "Import from game files…" (`data-import`, opens `tpl-import`),
    the player settings from `tpl-prefs`, stored for the next game, and the version
    in the footer. While nothing is playable (`#ui.nothing`) the gear shows its label and
    stands out, since it is then the only thing worth clicking.
- **Version.** `version` in `package.json` is the only source: electron-builder names
  the packages after it, and the settings sheet footer shows it (`app.getVersion()`
  through the `version` IPC). Bump it there before a release.
- **Releases.** `.github/workflows/release.yml` runs on a pushed `v*` tag: it checks
  that the tag is on `main` and equals `v` + `version`, runs `typecheck`, `npm test`
  and `npm run dist` on a Linux and a Windows runner, and creates a draft GitHub
  release with the AppImage, the `.deb` and the installer, published by hand after
  testing them. Run by hand (`workflow_dispatch`) it
  only builds, and the packages are left as workflow artifacts.
- **App icon.** One source, `assets/icon.ico` (16/32/48/256 px). `icon.png` is its
  256 px entry, extracted byte for byte, because Electron loads `.ico` only on
  Windows: window and `win` build use the `.ico`, Linux uses the PNG. If the icon
  changes, re-extract the PNG. `desktopName` keeps Linux taskbars on the right icon.
- **Renderer assets.** Files under `src/renderer/assets/` are copied verbatim by
  `build.mjs` into `dist/app/renderer/assets/`. The page loads them by relative URL;
  they are not bundled. Game assets never go here (hard rule 2).
- **No HTML in TypeScript.** Screens are `<template>` elements in `index.html`,
  cloned by `clone()` (`util.ts`) and filled with `textContent`, which escapes by
  itself. Never build markup by string concatenation or assign `innerHTML`.
- **Renderer security.** `contextIsolation: true`, `sandbox: true`, no Node in the
  renderer. Everything native goes through `NativeApi` in `src/shared/format.ts`.
  Add new IPC there, in `preload.ts` and in `main.ts`, and validate arguments in main.
- **Validating a game folder.** It must contain `index.js` starting with
  `__dracula.put(`, and `manifest.game` must match the id; a missing `game` field
  means `dracula1`, since early conversions lack it. A `manifest.format` other than
  `DATA_FORMAT` (missing means 1) gives the status `outdated`: the game is found but
  not playable, and the gear sheet says to convert it again. `chooseLibrary` runs `locate()`
  once per game over the picked folder: it matches the folder itself or any direct
  subfolder (symlinks included), so picking the parent finds both games, and picking a
  single game's folder finds just that one. `config.json` keeps `root` (what the user
  picked, for display and as the dialog's starting point) and `games` (the folder
  resolved per game, which is what the protocol serves).
- **Saves.**
  - One file per slot at `<userData>/saves/<gameId>/slotN.json`, always. Never write
    saves next to the game data: that folder is read-only input and may live in a
    repository checkout or a read-only mount.
  - The renderer loads all slots at game start (`platform.loadSaves`), then reads
    them synchronously; writes go through IPC.
  - Slot 9 is used internally by the game scripts; saving to it shows no "Game saved" message.
- **Preferences.** `classic` (pointer-lock mouse, shown as Mouse: Original / Free
  cursor, default on), `stretch` (shown as Aspect ratio: Fill screen / Original 4:3,
  default on), `volume` (0–1, default 1), `sensitivity` (shown as Look speed, for the
  pointer-lock mouse, 0.25–3, default 1) and `skipIntro` (default off), stored in
  `<userData>/prefs.json`. `skipIntro` makes `enterWarp` send `Debut.vr` (both games'
  logos and opening movies, which end at `Interface.vr`, the menu) straight to the
  menu; Dracula 1's "new game" also passes through `Debut.vr`. `platform.pref` takes
  the default's type, so a value of the wrong type falls back to it.

## Data folder format (read-only input)

Format 3 (`DATA_FORMAT` in `src/shared/format.ts`). `index.js` and the scripts are
JavaScript of the form `__dracula.put("kind","key",<json>);` (a leftover from the old
runtime, which loaded them with `<script>` tags); this app fetches them and parses the
JSON part (`fetchData`). Everything else is plain files in three formats: every image
is WebP (faces and screens lossy at quality 95; atlases, cursors and `.arn` pictures
lossless), sounds are Ogg Opus, movies WebM.

```
index.js             { manifest: { format: 3, game, title?, scripts[], start, arn? }, vr: {name: {type, anims}}, tests: {name: Region[]},
                       variants?: {script: {"name.ext": "name~folder.ext"}} }
scripts/<name>.js    { vars[], warps[{ vr, test, tests[{ idx, hover, labels, cmds[] }] }] }
vr/<name>/meta.json  { type: panorama|screen, images: [6 faces | 1 picture] (file names, null if missing),
                       animations[{ name, restart_at, patches[{ atlas: file name, blocks[[face,x,y]] }] }] }
vr/<name>/*.webp     the files meta.json names
cursors/<stem>.webp
arn/<stem>.webp      Dracula 2 only (gun sight, magnifier, timer bar...)
sound/<stem>.opus    (lowercase stem of the name scripts use)
movie/<name>.webm    (VP9 + Opus, lowercase stem)
```

`variants`: Dracula 2 keeps files with the same name but different content in
`DataM1` and `DataM2` (21 in the GOG version, one on the CDs), and the original engine
looks in the running script's folder first. On the CDs each disc is such a folder
(Dracula 1: `Credit.vr` differs between them, and `Data/` has its own cursors). The importer writes those copies as `<name>~<folder>` and maps them per
script; the engine resolves every file name through `Engine.file()` (scenes, click
regions, sounds, cursors, movies). Without it, one mission gets the other's files
(e.g. the notebook has 4 click regions in mission 1, where the 4th turns the page,
and 3 in mission 2 of the GOG version). Folders converted by `dracula-port` have no variants.

Only the importer writes format 3. A change to the data format bumps `DATA_FORMAT`;
folders in the old format are then reported as outdated and converted again, not
supported side by side.

The script command set (`op` values) is defined by `dracula-port/tools/scripts/lst2json.py`
and interpreted in `Engine.exec`. Unknown ops log a warning; don't throw.

## Engine details worth knowing

- **Shaders.** They live in `src/renderer/shaders/*.glsl` as plain GLSL and are
  imported as strings (esbuild's `text` loader, declared in `shaders/glsl.d.ts`).
  Screen size reaches the vertex shader through the `uRes` uniform, set once at
  program creation. Keep GLSL out of the `.ts` files.
- **Shader precision.** The view ray is computed in the **vertex** shader and passed
  as a varying. Computing it from `gl_FragCoord` in the fragment shader broke on GPUs
  that use fp16 for fragment math (a black area right of x≈102). Don't move it back.
- **Dracula 2 face width.** Faces are sampled with `uXScale = 511/512`, because the
  original renderer skips the last pixel of each tile.
- **Dracula 2 plugins.**
  - Timer (`timer_*`): flags 5/2/4; on expiry it either schedules test 99 or warps.
    The bar is drawn at bg (165,15), fg (177,15).
  - `AfficheImage` overlays (`overlay_*`): the bottom-right pixel colour is transparent.
  - `Waves`: a per-row offset in the fragment shader. `wavesT += dt*20`, reset when
    a new VR picture loads.
  - `Cible` (`cible_*`): a target timing window.
  - `exeDemo` sets its variable to 1.
- **Classic mouse (pointer lock).**
  - A click re-locks after Esc or alt-tab. In panoramas that click is swallowed
    unless locking failed.
  - On 2D screens the locked mouse moves a virtual cursor.
  - Losing the lock without a recent Esc keydown is treated as Esc (key code 0),
    because Chromium often eats the key.
- **4:3 <-> stretched easing.** `layout(true)`, called only by the `F3` toggle, adds
  `#box.easing` so the box width/height transition over `LAYOUT_EASE_MS` (450 ms) and
  the frame visibly stretches or pulls back in. Window resizes call `layout()` without
  it, so dragging a window edge never lags. While easing, the WebGL canvas keeps the
  larger of the old and new sizes (no blurry frame mid-way); the exact size is set on
  `transitionend`, with a timer as fallback. The backdrop fades with it (`.off`).
- **4:3 backdrop.** With `stretch` off, `#backdrop` (behind `#box`) shows the current
  frame (video, panorama or 2D screen) cropped to the window's aspect, refreshed at
  15 fps into a 320 px canvas; CSS scales, blurs and darkens it. It runs on its own
  `requestAnimationFrame`, so movies and blocking commands need no hook. Keep the
  canvas at least that big: smaller canvases are CPU-backed in Chromium, and copying
  the WebGL canvas into one would read the whole frame back every refresh. Hidden in
  stretch mode, where there are no bars.
- **Options menu (`F10`).** `tpl-options`, shown on the `#ui` layer as `#ui.menu`:
  the `tpl-prefs` rows (volume, mouse mode, look speed, aspect ratio, skip intro;
  the two modes are radio pairs styled as one segmented control, `.seg`; wired by
  `bindSettings` with live hooks) plus fullscreen, next to the
  Controls list. Every shortcut lives only in that list, never on the setting rows;
  keep it, the README's Controls table and the key handlers in step.
  While it is open the game holds still: the main loop and every `frameLoop` sit in
  `hold()`, which keeps drawing the scene (a layout change clears the WebGL canvas)
  but advances no time, and the movie and one-shot sounds are paused (scripts wait
  on them). Looping sounds and music play on, so a volume change can be heard.
  Opening it releases the pointer lock; `F10` or Resume takes it back, Esc can't (it
  is not a user gesture), so the next click does. Keys other than F10/Esc are
  ignored while it is open.
- **Hotkeys.** The engine's own shortcuts are F keys: F2 mouse mode, F3 aspect ratio,
  F10 options, F11 fullscreen, and in dev builds F4 clickable areas. Those used to reach the scripts
  as `lockkey` codes, but neither game binds any of them (the data only uses 0 and
  12), so F1 and F5–F9 still go to the scripts. Esc, Space, Enter, Tab, Backspace
  and the arrows are game controls. No letter keys are used. There is no gamepad
  support, by decision.
- **Dev-only code.** `build.mjs` defines `DEV` (declared in `env.d.ts`): true for
  `npm start` and the e2e test, false with `--release` (the `dist` scripts), where
  `minifySyntax` drops every `if (DEV)` branch. Debug aids such as the clickable
  areas (F4) go behind it and never reach a release; keep their code reachable only
  from such a branch (e.g. a module-level function) so the bundle drops it.
- **Importer** (`src/importer/`). The user points at an installed game (the GOG
  version), at a folder with CD images, or at a folder holding both games, and it
  writes format 3. `findGames` looks in the folder itself and its direct subfolders
  (symlinks included, like `locate()`), first match per game; one folder of images can
  hold both games' discs. With two games found they are imported one after the other
  (the CLI writes each to `<out>/<game>`). The engine never reads the original files;
  only the importer does. Port from
  `dracula-port` only what the importer needs; the engine already has the rest.
  - CD images (`disc.ts`): `.iso` or raw `.img`/`.bin` (2352-byte sectors, Mode 1 or
    Mode 2 Form 1), names from Joliet when present. Files are read straight from the
    image, never extracted. The game is told by content (`DataM1/` means Dracula 2,
    `0M1Script.pak` Dracula 1), so any edition with the same layout works; the PT-BR
    CDs of both games are the ones tested. `Install/` (what the installer copied to
    the disk) is the game folder; the rest of each disc is its script's folder, named
    after its path or `cdN` for the disc root (numbered per game).
  - Multi-CD scripts write the next script as `"2:0M2Script.lst"`; `lst.ts` drops the
    disc number, which `stemOf` would otherwise keep.
  - Scripts (`.lst`, `.pak`), click regions, scenes, cursors (only `.pcx`: scripts
    never name the `.gif`/`.bmp` copies), `.arn` (root copy), sounds and movies.
  - Movies: Dracula 2's 4XM is standard and ffmpeg reads it. Dracula 1's raw 4XM is
    decoded by `fourxm.ts` and piped to ffmpeg; its audio is cut or padded to the
    video's length first, because `-shortest` overshoots. VP9 CRF 30 (realtime,
    `-cpu-used 8`: about 8x faster than `good` at the same quality) + Opus.
  - Encoding goes through `ffmpeg-static` (an npm dependency that downloads the
    binary for the OS it is installed on; nothing OS-specific lives in the repo).
    `asarUnpack` keeps it runnable in a packaged app; `ffmpeg.ts` runs up to one
    process per core, `stopAll()` kills them. Because the binary is per OS,
    `npm run dist` builds only the current OS's package.
  - Import screen (`tpl-import`, `openImport` in `app.ts`): the renderer never sends
    paths; `importPick` opens a dialog and main keeps the choice. `importStart` forks
    `import-worker.js` as an Electron utility process per game, in turn (decoding would
    otherwise block the main process), relays its progress as `importProgress` events
    tagged with the game, and writes to `<dest>/<game>.partial`, renamed to
    `<dest>/<game>` when done; then `config.json` points that game at it. An existing
    `<dest>/<game>` is never overwritten: that game is skipped (the screen says so),
    and only when every found game is already there does starting fail. `<dest>` defaults to the library root, else `defaultGamesDir()`:
    `%LOCALAPPDATA%\Dracula\Games` on Windows, `$XDG_DATA_HOME` (or
    `~/.local/share`)`/Dracula/games` on Linux; local data, never synced. Stop
    aborts the import and kills ffmpeg; starting again resumes (scenes with a
    `meta.json`, sounds and movies already written are skipped).
- **Sound.** Web Audio: each sound is a decoded `AudioBuffer` played by a buffer
  source into its own gain, then the master gain (the volume setting). Loops use
  `source.loop`, which is seamless; `<audio loop>` leaves a gap with Opus. Pausing
  (the options menu) stops the source and keeps the offset to restart from.
- **Blocking commands.** `wait`, `until`, `fade`, `transfade`, `interpolangle` and
  `movie` run their own `frameLoop`. Space or Esc skips them.
- **Fullscreen.** Picking a game calls `platform.setFullscreen(true)` before loading
  its data, so the window transition is over by the time the engine asks for the
  pointer lock (a resize can drop it). The start screen itself stays windowed.
- **End of game.** There is no end screen: when a script quits, `backToStart()` stops
  the sound, releases the pointer lock and reloads the page, which lands back on the
  cover selection. The window stays fullscreen; `F11` toggles it on every
  screen (`app.ts` handles them until a game starts, then the engine takes over;
  never let both react, or the two toggles cancel out).

## Planned work

Lives in the GitHub issues, not in this file. Ask before starting one.

## Related project

`dracula-port` (separate folder) has:

- the converters (`converter.sh` for D1, `converter-dracula2.sh` for D2, `tools/`);
- the C++ decoders (4XM video, VR images);
- the original browser runtime (`runtime/engine.js`) this engine was ported from.

Its output folder (`Dracula/` with `data/`, `data2/`, `runtime/`, `Jogar.html`) must
keep working on its own.
