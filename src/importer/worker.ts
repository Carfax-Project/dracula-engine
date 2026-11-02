// Runs in an Electron utility process, so decoding never blocks the main process.
import { stopAll } from './ffmpeg';
import { importGame } from './import';

const port = process.parentPort;
const controller = new AbortController();

port.on('message', ({ data }) => {
  if (data.type === 'cancel') { controller.abort(); stopAll(); return; }
  if (data.type !== 'start') return;
  importGame({
    game: data.game, out: data.out, overlays: data.overlays, signal: controller.signal,
    log: (message) => port.postMessage({ type: 'log', message }),
    progress: (stage, done, total) => port.postMessage({ type: 'progress', stage, done, total }),
  }).then(
    () => port.postMessage({ type: 'done' }),
    (e) => port.postMessage(controller.signal.aborted ? { type: 'cancelled' } : { type: 'error', message: (e as Error).message }),
  );
});
