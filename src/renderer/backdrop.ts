/* Fills the side or top bars of the 4:3 mode with the current frame, blurred and
 * dimmed, the "ambient" look other players use instead of plain black.
 *
 * The frame is copied into a small canvas a few times a second and cropped to the
 * window's shape; CSS (#backdrop in index.html) scales it up, blurs and darkens it.
 * Small but not tiny: canvases below a certain size are not GPU-backed in Chromium,
 * and copying the WebGL canvas into a CPU one would read the whole frame back. */
import { $ } from './util';

const FPS = 15;
const WIDTH = 320;

export function startBackdrop(source: () => CanvasImageSource | null, active: () => boolean) {
  const canvas = $<HTMLCanvasElement>('backdrop');
  const ctx = canvas.getContext('2d')!;
  let last = 0;

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const on = active();
    canvas.classList.toggle('off', !on);
    if (!on || now - last < 1000 / FPS) return;
    last = now;

    const src = source();
    const [sw, sh] = sizeOf(src);
    if (!src || !sw || !sh) return;

    // Cover the window: crop the frame to the window's aspect ratio.
    const aspect = innerWidth / innerHeight;
    const h = Math.max(1, Math.round(WIDTH / aspect));
    if (canvas.width !== WIDTH || canvas.height !== h) { canvas.width = WIDTH; canvas.height = h; }
    let cw = sw, ch = sw / aspect;
    if (ch > sh) { ch = sh; cw = sh * aspect; }
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, WIDTH, h);
  };
  requestAnimationFrame(tick);
}

function sizeOf(src: CanvasImageSource | null): [number, number] {
  if (src instanceof HTMLVideoElement) return src.readyState >= 2 ? [src.videoWidth, src.videoHeight] : [0, 0];
  if (src instanceof HTMLCanvasElement) return [src.width, src.height];
  return [0, 0];
}
