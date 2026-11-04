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
  folderOutdated: "Old data format; remove it and import it again.",
  remove: "Remove",
  removeFailed: (reason: string) => "Could not delete: " + reason,
  updateAvailable: (version: string) => "Version " + version + " is available",
  updateReimport: "The games will need to be imported again after updating.",

  // ---------------------------------------------------------------- importer
  importNoGame: "No game folder chosen yet.",
  importFound: (titles: string[]) => "Found " + titles.join(" and "),
  importInto: (folders: string[]) => "Will be created as " + folders.join(" and "),
  importSkipped: (folders: string[]) => "Already there, skipped: " + folders.join(" and "),
  importStage: { files: "Scripts, cursors and sounds", scenes: "Scenes", movies: "Movies" } as Record<string, string>,
  importStep: (title: string, stage: string) => title + ": " + stage,
  importDone: (titles: string[]) => titles.join(" and ") + (titles.length > 1 ? " are" : " is") + " ready to play.",
  importCancelled: "Import stopped. Starting it again picks up where it left off.",
  importFailed: (reason: string) => "Import failed: " + reason,
  importNotAGame: "No Dracula: The Resurrection or Dracula 2 in that folder or the ones right inside it, installed or as CD images.",
  importBusy: "An import is already running.",
  importIncomplete: "Choose the game folder and where to save it first.",
  importExists: (folders: string[]) => folders.join(" and ") + (folders.length > 1 ? " already exist" : " already exists") + ". Move it away or choose another destination.",
  importCrashed: (code: number) => "the importer stopped unexpectedly (" + code + ")",

  // -------------------------------------------------------- in-game messages
  classicMouse: "Mouse: Original, the mouse turns the view (F2 to switch)",
  freeMouse: "Mouse: Free cursor, drag to look around (F2 to switch)",
  widescreen: "Aspect ratio: Widescreen (F3 to switch)",
  original43: "Aspect ratio: Original 4:3 (F3 to switch)",
  volumeValue: (v: number) => Math.round(v * 100) + "%",
  sensitivityValue: (v: number) => v.toFixed(2) + "×",
  saved: "Game saved",
  saveFailed: "Could not write the save to disk",
  runtimeError: (reason: string) => "Error: " + reason,

  // ---------------------------------------------- main process folder dialogs
  folderDialogTitle: "Folder holding the converted Dracula game data",
  folderHasNoData: "Neither game was found in that folder.",  importGameDialog: "Installed game, a folder with its CD images, or a folder holding both games",
  importDestDialog: "Folder to save the converted game in",
} as const;
