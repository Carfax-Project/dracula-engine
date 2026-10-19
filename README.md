<p align="center">
  <img src="src/renderer/assets/icon.png" width="112" alt="">
</p>

<h1 align="center">Dracula Engine</h1>

<p align="center">
  <b>Dracula: The Resurrection</b> and <b>The Last Sanctuary</b>, risen from the grave.
</p>

<p align="center">
  <img src="docs/images/main-menu.gif" width="760" alt="Start screen">
</p>

<p align="center">
  <img src="docs/images/crypt.jpg" width="250" alt="Dracula: The Resurrection">
  <img src="docs/images/cathedral.jpg" width="250" alt="Dracula: The Resurrection">
  <img src="docs/images/chains.jpg" width="250" alt="Dracula 2: The Last Sanctuary">
</p>

## Features

- **Both games, one app** — pick a folder once and both are found on their own
- **Smooth 360° panoramas** rendered with WebGL, at any window size
- **Classic or free mouse** — the original crosshair look, or drag to look around
- **Gamepad support** — stick to look, buttons to act
- **Fullscreen in one click**, stretched or in the original 4:3 with a blurred ambient fill
- **Linux AppImage** and **portable Windows `.exe`**, nothing to install

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Look around | mouse | sticks or d-pad |
| Act | left click | `A` |
| Inventory | right click | `B` |
| Menu | `Esc` | `Start` |
| Skip video | `Space` | `Select` |
| Fullscreen | `F` / `F11` | |
| Classic / free mouse | `L` | |
| Stretched / 4:3 | `A` | |
| Show clickable areas | `H` | |

## Run it

Dracula Engine requires game data files from your own copies of Dracula: The Resurrection and/or Dracula 2: The Last Sanctuary.

**GOG installation support** is a work in progress. For now, the games must be manually converted into a format supported by the engine before they can be played. Instructions for preparing the game files will be provided as support is finalized.

To run the engine in development mode:

```bash
npm install
npm start
```

Build the executables with `npm run dist`.

## License

The engine is licensed under the GNU GPL v3 or later.
Game assets and screenshots belong to their respective copyright holders and are used for identification purposes only.
