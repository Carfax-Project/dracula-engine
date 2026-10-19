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

The app does **not** convert anything yet. It reads data folders produced by the
sibling project `dracula-port` (Python and C++ converters).

Platforms: Linux (AppImage) and Windows (portable `.exe`) only. There is no macOS
support, by decision; don't add a `mac` build target.

## Hard rules

1. **Never write into the game data folders**, and never modify, re-encode or "optimize"
   existing converted assets in place. A converter, a lighter scene format and an
   upscale are all planned (see "Known gaps"), but only start them when asked; until then, don't add re-encoding, format changes or format benchmarks.
   When one of them is done, it writes new output and leaves the old folders intact.
2. **No game assets in this repository** (scripts, images, sounds, videos, extracted
   text). The engine must stay distributable on its own. One deliberate exception:
   the two box-art covers in `src/renderer/assets/`, the app
   icon next to them, and the four README screenshots in `docs/images/`, all covered
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
npm run test:e2e          # Playwright drives the real app (see below)
npm run dist              # AppImage + portable .exe into release/
```

E2E test: `DRACULA_TEST_D1=<data> DRACULA_TEST_D2=<data2> npm run test:e2e`

- Uses a throwaway profile (`DRACULA_USER_DATA`), so saves stay in that profile.
- Stubs the native folder dialog.
- Headless: run under `xvfb-run -a`, add `DRACULA_TEST_SWGL=1` when there is no GPU.
- Running as root needs `--no-sandbox`; the script adds it.

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

After any change: `npm run typecheck` and `npm run build` must pass. For behaviour
changes, run the e2e test when game data is available.

## Layout

```
src/main/main.ts          Electron main: window, game:// protocol (Range support), IPC,
                          library folder config + per-game detection, saves/prefs as JSON
src/main/preload.ts       contextBridge -> window.dracula (NativeApi)
src/shared/format.ts      Types: data folder format, GameEntry, Library, NativeApi
src/shared/strings.ts     UI object: every player-visible string, main + renderer
src/renderer/app.ts       Start screen: the two covers, the gear sheet, start a game
src/renderer/engine.ts    The engine (script interpreter, warps, input, sound, video, saves)
src/renderer/panorama.ts  WebGL 360° cube-face renderer + camera math
src/renderer/backdrop.ts  4:3 mode: fills the bars with the current frame, blurred
src/renderer/shaders/     GLSL shaders (.glsl), inlined by esbuild's text loader
src/renderer/assets/      Cover art and the app icon (icon.ico + icon.png), copied to
                          dist/ and served from game://app/assets/
src/renderer/platform.ts  Bridge to the main process (NativeApi): data, saves, prefs
src/renderer/util.ts      Constants, angles, region hit tests, data loading
src/renderer/index.html   Page + CSS (layered canvases: gl, screen2d, overlay; video)
                          and the <template> markup for every runtime screen
scripts/build.mjs         esbuild config (main/preload as CJS, renderer as IIFE)
scripts/e2e.mjs           End-to-end smoke test
docs/images/              README screenshots (start screen + three scenes)
```

## Architecture notes

- **Protocol.** `game://app/...` serves `dist/app/renderer`. `game://<gameId>/...`
  serves that game's configured data folder, and only while it validates. Path
  traversal is blocked by `resolveInside`. Video and audio need HTTP Range: keep it.
- **Start screen.** The two covers split the window; each half is a `.game` carrying
  `data-play=<id>` once its game was found. The art uses `object-fit: contain` so the
  box art is never cropped; a game that was not found gets the `unset` class and stays
  dark. The halves carry no controls at all; everything lives in the `.corner` pair at
  the top right: the gear, which opens the `tpl-settings` sheet (chosen folder, what
  was detected per game, and the one "Choose folder…" button — `data-choose`, which
  the e2e test clicks), and a quit button calling `platform.quit()`. The gear
  brightens (`#ui.nothing`) while nothing is playable, since it is then the only
  thing worth clicking.
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
  means `dracula1`, since early conversions lack it. `chooseLibrary` runs `locate()`
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
- **Preferences.** `classic` (pointer-lock mouse, default on) and `stretch` (fill the
  window, default on), stored in `<userData>/prefs.json`.

## Data folder format (read-only input)

Every file is JavaScript of the form `__dracula.put("kind","key",<json>);`. It was
built so the old runtime could load it with `<script>` tags from `file://`. This app
uses `fetch` and parses the JSON part (`fetchData` in `util.ts`).

```
index.js             { manifest: { game, title?, scripts[], start, arn? }, vr: {name: {type, anims}}, tests: {name: Region[]} }
cursors.js           { stem: "data:image/png;base64,..." }
arn.js               { stem: dataURL }          Dracula 2 only (gun sight, magnifier, timer bar...)
scripts/<name>.js    { vars[], warps[{ vr, test, tests[{ idx, hover, labels, cmds[] }] }] }
vr/<name>/assets.js  { meta: { type: panorama|screen, animations[{ name, restart_at, patches[{ atlas, blocks[[face,x,y]] }] }] },
                       images: { "face0.png".."face5.png" | "image.png", "<atlas>.png": dataURL } }
sound/<name>.wav     (lowercase file name as referenced by scripts)
movie/<name>.webm    (VP9 + Opus, lowercase stem)
```

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
- **Gamepad.** Polled each frame (`pollGamepad`). Using it centres the crosshair in
  panoramas (`pad.active`). Mouse movement clears that.
- **4:3 <-> stretched easing.** `layout(true)`, called only by the `A` toggle, adds
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
- **Blocking commands.** `wait`, `until`, `fade`, `transfade`, `interpolangle` and
  `movie` run their own `frameLoop`. Space or Esc skips them.
- **Fullscreen.** Picking a game calls `platform.setFullscreen(true)` before loading
  its data, so the window transition is over by the time the engine asks for the
  pointer lock (a resize can drop it). The start screen itself stays windowed.
- **End of game.** There is no end screen: when a script quits, `backToStart()` stops
  the sound, releases the pointer lock and reloads the page, which lands back on the
  cover selection. The window stays fullscreen; `F` / `F11` toggle it on every
  screen (`app.ts` handles them until a game starts, then the engine takes over;
  never let both react, or the two toggles cancel out).

## Known gaps / ideas (not started; ask first)

- In-game settings overlay, opened by a hotkey: volume (`masterVolume` exists but
  has no UI), mouse sensitivity, and the options that today are hotkeys only. Pick
  a key the engine doesn't already use (taken: Esc, Space, Enter, Tab, F1–F11, F, L,
  A, H, the arrows).
- Bring the converter into this project: turn the original games' files into the
  data folder format this engine reads, so `dracula-port` is no longer needed. Today
  that lives in `dracula-port` (Python and C++: scripts, VR images, 4XM video).
  Its first version must produce the current format exactly, since existing
  folders stay as they are; the format changes below come after that.
- Lighter, simpler assets: store each scene as a 360° picture in plain PNG/JPG files
  instead of base64 images inside `vr/<name>/assets.js`, and cut the overall size.
  Watch out: animations patch atlas blocks onto specific cube faces (`[face, x, y]`),
  and the shader samples six faces. Keeping six face files is a small change; an
  equirectangular image means reprojecting every patch and rewriting the shader.
- Mass upscale of every asset (scenes, 2D screens, cursors, overlays, maybe videos).
  Logical coordinates must not move: click regions, cursor positions and the 640×480
  screen space stay as they are, only the pictures get sharper. Mind the Dracula 2
  face quirk (`uXScale = 511/512`), which is tied to the original face width.

- Release builds on GitHub Actions: a workflow in `.github/workflows/` that runs
  when a version tag (`v*`) is pushed on `main`, builds the AppImage and the portable
  `.exe` (Linux and Windows runners), and attaches them to a GitHub release.

The lighter-assets and upscale items change the data format, so they need a format version in `index.js`
the engine can check, with the current format still supported.

## Related project

`dracula-port` (separate folder) has:

- the converters (`converter.sh` for D1, `converter-dracula2.sh` for D2, `tools/`);
- the C++ decoders (4XM video, VR images);
- the original browser runtime (`runtime/engine.js`) this engine was ported from.

Its output folder (`Dracula/` with `data/`, `data2/`, `runtime/`, `Jogar.html`) must
keep working on its own.
