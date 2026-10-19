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

  // -------------------------------------------------------- in-game messages
  classicMouse: "Classic mouse: the mouse turns the camera (L to switch)",
  freeMouse: "Free look: drag to look around (L to switch)",
  stretched: "Stretched to the window (A to toggle)",
  original43: "Original 4:3 (A to toggle)",
  saved: "Game saved",
  saveFailed: "Could not write the save to disk",
  runtimeError: (reason: string) => "Error: " + reason,

  // ---------------------------------------------- main process folder dialogs
  folderDialogTitle: "Folder holding the converted Dracula game data",
  folderHasNoData: "Neither game was found in that folder.",
} as const;
