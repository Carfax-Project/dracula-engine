/* Every string the player can see, in one place. All of it is English, like the
 * code, comments and log/warn messages. Used by both the main process and the
 * renderer, so keep it free of Node and DOM imports.
 *
 * This holds text the code injects at runtime; it is written with textContent, so
 * no HTML markup here. Static text that is part of a screen's markup lives in its
 * <template> in index.html.
 *
 * To add text: put it here and reference it as UI.<key>. Entries that take an
 * argument are functions; the rest are plain strings. */

export const UI = {
  // ------------------------------------------------------------ start screen
  startFailed: (reason: string) => "Could not start: " + reason,
  noFolder: "No folder selected yet.",
  detected: (where: string) => "Found in " + where,
  notFound: "Not found in this folder.",
  folderGone: "Folder is gone.",
  folderInvalid: "No longer holds this game.",
  folderOutdated: "Old data format; convert this game again.",

  // ---------------------------------------------------------------- importer
  importNoGame: "No game folder chosen yet.",
  importNoOverlay: "None",
  importFound: (title: string) => "Found " + title,
  importInto: (folder: string) => "Will be created as " + folder,
  importStage: { files: "Scripts, cursors and sounds", scenes: "Scenes", movies: "Movies" } as Record<string, string>,
  importDone: (title: string) => title + " is ready to play.",
  importCancelled: "Import stopped. Starting it again picks up where it left off.",
  importFailed: (reason: string) => "Import failed: " + reason,
  importNotAGame: "That folder doesn't hold Dracula: The Resurrection or Dracula 2.",
  importBusy: "An import is already running.",
  importIncomplete: "Choose the game folder and where to save it first.",
  importExists: (folder: string) => folder + " already exists. Move it away or choose another destination.",
  importCrashed: (code: number) => "the importer stopped unexpectedly (" + code + ")",

  // -------------------------------------------------------- in-game messages
  classicMouse: "Mouse: Original, the mouse turns the view (F2 to switch)",
  freeMouse: "Mouse: Free cursor, drag to look around (F2 to switch)",
  stretched: "Aspect ratio: Fill screen (F3 to switch)",
  original43: "Aspect ratio: Original 4:3 (F3 to switch)",
  volumeValue: (v: number) => Math.round(v * 100) + "%",
  sensitivityValue: (v: number) => v.toFixed(2) + "×",
  saved: "Game saved",
  saveFailed: "Could not write the save to disk",
  runtimeError: (reason: string) => "Error: " + reason,

  // ---------------------------------------------- main process folder dialogs
  folderDialogTitle: "Folder holding the converted Dracula game data",
  folderHasNoData: "Neither game was found in that folder.",
  importGameDialog: "Installed game folder (Dracula: The Resurrection or Dracula 2)",
  importOverlayDialog: "Translation folder (its files replace the game's)",
  importDestDialog: "Folder to save the converted game in",
} as const;
