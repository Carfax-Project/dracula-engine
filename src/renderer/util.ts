export const W = 640, H = 480;
export const PI = Math.PI, TAU = Math.PI * 2, PI2 = Math.PI / 2, EPS = 1e-6;
export const THUMB_W = 139, THUMB_H = 103;

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** Clones a <template> from index.html, so markup stays out of the .ts files. */
export const clone = (id: string) =>
  ($(id) as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
export const lower = (s: string | null | undefined) => (s || '').toLowerCase();
/** "C:\\x\\Foo.PCX" -> "foo" */
export const stemOf = (name: string | null | undefined) => {
  let s = (name || '').replace(/^[a-zA-Z]:/, '');
  s = s.split(/[\\/]/).pop() || '';
  const dot = s.lastIndexOf('.');
  return lower(dot >= 0 ? s.slice(0, dot) : s);
};
/** "sons\\Porte.WAV" -> "porte.wav" */
export const baseOf = (name: string) => lower(name.split(/[\\/]/).pop() || '');
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const fmod = (a: number, b: number) => a - b * Math.trunc(a / b);
export function atoi(s: string | null | undefined): number {
  const m = /^\s*([+-]?\d+)/.exec(s || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** requestAnimationFrame with a timer fallback (minimised window, etc.). */
export const nextFrame = () => new Promise<number>((resolve) => {
  let done = false;
  const fire = () => { if (!done) { done = true; resolve(performance.now()); } };
  requestAnimationFrame(fire);
  setTimeout(fire, 50);
});

declare global { interface Window { DEBUG_LOG?: boolean; engine?: unknown } }
export function log(...a: unknown[]) { if (window.DEBUG_LOG) console.log('[dracula]', ...a); }
export function warn(...a: unknown[]) { console.warn('[dracula]', ...a); }

/** Reads a data file in the  __dracula.put("kind","key",<json>);  format. */
export async function fetchData<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + (r.status === 404 ? 'not found' : r.status));
  const s = await r.text();
  const a = s.indexOf(',', s.indexOf(',') + 1) + 1;
  const b = s.lastIndexOf(')');
  if (!s.startsWith('__dracula.put(') || a <= 0 || b < a) throw new Error(url + ': invalid format');
  return JSON.parse(s.slice(a, b)) as T;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + (r.status === 404 ? 'not found' : r.status));
  return await r.json() as T;
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => { warn('image not found', src.slice(0, 120)); resolve(null); };
    img.src = src;
  });
}

// ------------------------------------------------------------------ angles

export class Angle {
  protected _angle = 0;
  protected _rangeMin = -Infinity;
  protected _rangeMax = Infinity;
  constructor(angle: number, protected _min: number, protected _max: number) { this.set(angle); }
  get angle() { return this._angle; }
  static mod(v: number, min: number, max: number) {
    const range = max - min;
    let a = fmod(v - min, range);
    if (a < 0) a += range;
    return a + min;
  }
  set(v: number) {
    this._angle = Angle.mod(v, this._min, this._max);
    const range = this._max - this._min, min = this._rangeMin, max = this._rangeMax;
    const a = this._angle;
    if (a >= min && a <= max) return;
    if (a >= min - range && a <= max - range) return;
    if (a >= min + range && a <= max + range) return;
    const l = Math.min(Math.abs(a - this._rangeMin), Math.abs(a - this._rangeMin - range));
    const r = Math.min(Math.abs(this._rangeMax - a), Math.abs(range + this._rangeMax - a));
    this._angle = l < r ? this._rangeMin : this._rangeMax;
  }
  add(v: number) { this.set(this._angle + v); }
  get rangeMin() { return this._rangeMin; }
  get rangeMax() { return this._rangeMax; }
  setRange(min: number, max: number) { this._rangeMin = min; this._rangeMax = max; }
  resetRange() { this.setRange(-Infinity, Infinity); }
}

export class AngleX extends Angle {
  constructor(a: number) { super(a, 0, TAU); }
}

export class AngleY extends Angle {
  constructor(a: number) { super(a, -PI, -EPS); this.resetRange(); }
  override setRange(min: number, max: number) { super.setRange(-PI2 + min, -PI2 + max); }
  override resetRange() { const d = PI * 0.375; this.setRange(-d, d); }
  override add(v: number) {
    v += this.angle;
    if (v <= this._min) v = this._min + EPS;
    if (v >= this._max) v = this._max - EPS;
    this.set(v);
  }
}

// --------------------------------------------------------------- regions

export type Region = readonly number[];

export function contains3D(r: Region, ax: number, ay: number) {
  let x0 = r[0], x1 = r[1], y0 = r[2], y1 = r[3];
  if (x1 - x0 > PI) { const t = x0 + TAU; x0 = x1; x1 = t; }
  if (y1 - y0 > PI) { const t = y0 + TAU; y0 = y1; y1 = t; }
  const p = ax + TAU, m = ax - TAU;
  if ((ax >= x0 && ax <= x1) || (p >= x0 && p <= x1) || (m >= x0 && m <= x1)) {
    if (ay >= y0 && ay <= y1) return true;
    const q = ay + TAU;
    if (q < y0) return false;
    if (q <= y1) return true;
  }
  return false;
}
export const contains2D = (r: Region, x: number, y: number) => x >= r[0] && x < r[1] && y >= r[2] && y < r[3];
