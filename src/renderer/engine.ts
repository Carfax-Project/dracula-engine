/* Dracula: The Resurrection / Dracula 2: The Last Sanctuary - game engine.
 *
 * Interprets the scripts and scenes of the converted data folders. Game behaviour
 * was derived from the data format itself (see AGENTS.md).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import type { Cmd, GameId, GameIndex, Region, SaveFile, Script, Test, VrMeta, Warp } from '../shared/format';
import { UI } from '../shared/strings';
import { camera, type Camera, PanoramaRenderer, rayAngles } from './panorama';
import { startBackdrop } from './backdrop';
import { platform } from './platform';
import { bindSettings, prefSensitivity, prefVolume } from './settings';
import {
  $, Angle, AngleX, AngleY, atoi, baseOf, clamp, clone, contains2D, contains3D, fetchData, fetchJson, H, loadImage, log, lower,
  nextFrame, PI, PI2, stemOf, TAU, THUMB_H, THUMB_W, W, warn,
} from './util';

type Img = HTMLImageElement;
interface Anim {
  name: string; restart: number; frames: { img: Img | null; blocks: [number, number, number][] }[];
  active: boolean; frame: number; t: number; speed: number; stopRequested: boolean; variable: string; value: number;
}
interface VrState { name: string; isVR: boolean; imgs: (Img | null)[]; anims: Anim[] }
interface Ctx { running: boolean; sub: boolean; root: Test }
interface Cursor { img: Img | null; ox: number; oy: number; failed: boolean }
interface SoundEntry {
  volume: number; loops: number; music: boolean; gain: GainNode; buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null; startedAt: number; offset: number; paused: boolean; ended: boolean; stopped: boolean;
}
type Ev = { type: 'click' } | { type: 'rclick' } | { type: 'skip' } | { type: 'key'; code: number };
interface View { ax: number; ay: number; fov: number }

export interface GameInfo { id: GameId; title: string; base: string; index: GameIndex }

function drawRegions(o: CanvasRenderingContext2D, regs: Region[], cam: Camera | null) {
  o.strokeStyle = '#ff0';
  o.lineWidth = 1;
  if (!cam) {
    for (const r of regs) o.strokeRect(r[0], r[2], r[1] - r[0], r[3] - r[2]);
    return;
  }
  o.fillStyle = 'rgba(255,255,0,0.25)';
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
    const [a, b] = rayAngles(cam, x + 4, y + 4);
    if (regs.some((r) => contains3D(r, a, b))) o.fillRect(x, y, 8, 8);
  }
}

const NO_TIMER = () => ({ flags: 0, t: 0, initial: 0, show: false, warp: '' });

/** Length of the 4:3 <-> stretched easing; matches #box.easing in index.html. */
const LAYOUT_EASE_MS = 450;

export class Engine {
  private glCanvas = $<HTMLCanvasElement>('gl');
  private screen = $<HTMLCanvasElement>('screen2d');
  private sctx = this.screen.getContext('2d')!;
  private overlay = $<HTMLCanvasElement>('overlay');
  private octx = this.overlay.getContext('2d')!;
  private video = $<HTMLVideoElement>('movie');
  private ui = $('ui');
  private msg = $('msg');
  private pano = new PanoramaRenderer(this.glCanvas);
  private faces: HTMLCanvasElement[] = [];
  private faceDirty = [false, false, false, false, false, false];
  private snapshot = document.createElement('canvas');
  private thumbnail = document.createElement('canvas');

  private base = '';
  private index!: GameIndex;
  private faceXScale = 1;

  private vars = new Map<string, number>();
  private declared = new Set<string>();
  private script!: Script;
  private scriptVars: string[] = [];
  private variants: Record<string, string> = {};
  private warpIndex = new Map<string, number>();
  private cursors: { name: string; hidden: boolean }[][] = [];
  private warpIdx = -1;
  warp: Warp | null = null;
  private nextWarp = -1;
  prevWarp = -1;
  private nextTest = -1;
  private nextScript = '';
  private contextScript = '';
  private contextLabel = '';
  private lockKey: string[] = new Array(13).fill('');
  private defaultCursor = ['Cursor1.pcx', 'Cursor2.pcx'];
  private angleX = new AngleX(0);
  private angleY = new AngleY(-PI2);
  private fov = PI2;
  vr: VrState = { isVR: false, anims: [], name: '', imgs: [] };
  private regions: Region[] | null = null;
  private hoverIndex = -1;
  private hoverLeaveIndex = -1;
  private sounds = new Map<string, SoundEntry>();
  private currentMusic = '';
  private currentMusicVolume = 0;
  private capturedState: any = null;
  private loadedState: any = null;
  private fade = 0;
  private transition: { alpha: number } | null = null;
  private quitting = false;
  private running = false;
  private cam: Camera | null = null;
  private prevView: View | null = null;
  private pendingView: View | null = null;
  private debugWarp: string | null = null;
  private layoutTimer = 0;

  private events: Ev[] = [];
  private mouse = { x: W / 2, y: H / 2, inside: false };
  private drag: { x: number; y: number; lx: number; ly: number; moved: boolean } | null = null;
  private classic = false;
  wantClassic = platform.pref('classic', true);
  private stretch = platform.pref('stretch', true);
  private unlockRequested = false;
  private lockFailed = false;
  private lastEscKey = 0;
  private showRegions = false;
  private keyPan: [number, number] | null = null;
  private cursorCache = new Map<string, Cursor>();
  private masterVolume = prefVolume();
  private sensitivity = prefSensitivity();
  private menu: HTMLElement | null = null;
  private heldVideo = false;
  private heldSounds: SoundEntry[] = [];
  private audio = new AudioContext();
  private master = this.audio.createGain();
  private soundCache = new Map<string, Promise<AudioBuffer | null>>();
  private msgTimer = 0;

  // Dracula 2 plugins: timer, AfficheImage, Waves, Cible
  private timer = NO_TIMER();
  private timerImgs: [Img, Img] | 'loading' | null = null;
  private imageOverlay: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
  private waves = false;
  private wavesT = 0;
  private cible: { start: number; period: number; bounds: number[] } | null = null;
  private arnCache = new Map<string, Promise<Img | null>>();

  constructor() {
    for (let i = 0; i < 6; ++i) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 512;
      this.faces.push(c);
    }
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.audio.destination);
    this.snapshot.width = W; this.snapshot.height = H;
    this.thumbnail.width = THUMB_W; this.thumbnail.height = THUMB_H;
  }

  // ------------------------------------------------------------ data
  private url(rel: string) { return this.base + rel.split('/').map(encodeURIComponent).join('/'); }
  async init(game: GameInfo) {
    this.base = game.base;
    this.index = game.index;
    document.title = game.title;
    // Dracula 2: the original renderer skips the last pixel column of each face
    this.faceXScale = game.id === 'dracula2' ? 511 / 512 : 1;
    await platform.loadSaves(game.id);
    this.setupInput();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    startBackdrop(
      () => this.video.style.display === 'block' ? this.video : this.vr.isVR ? this.glCanvas : this.screen,
      () => this.running && !this.stretch,
    );
  }

  // --------------------------------------------------------- variables
  private declare(name: string) {
    const k = lower(name);
    if (!this.declared.has(k)) { this.declared.add(k); this.vars.set(k, 0); }
  }
  private has(name: string) { return this.declared.has(lower(name)); }
  getVar(name: string): number {
    const k = lower(name);
    if (!this.declared.has(k)) { log('undeclared variable', name); return 0; }
    return this.vars.get(k)!;
  }
  private setVar(name: string, value: number) {
    const k = lower(name);
    if (!this.declared.has(k)) return;
    this.vars.set(k, value | 0);
  }
  private valueOf(v: string) {
    if (v && (/^[0-9]/.test(v) || v[0] === '-' || v[0] === '+')) return atoi(v);
    return this.getVar(v);
  }

  // ----------------------------------------------------------- script
  private setNextScript(name: string) {
    log('setNextScript', name);
    this.contextScript = name;
    this.nextScript = stemOf(name);
  }
  private async loadNextScript() {
    const name = this.nextScript;
    this.nextScript = '';
    const s = await fetchData<Script>(this.url('scripts/' + name + '.js'));
    this.script = s;
    this.scriptVars = s.vars;
    this.variants = this.index.variants?.[name] ?? {};
    for (const v of s.vars) this.declare(v);
    this.declare('P_Alliance');
    this.declare('reloaddone');
    this.warpIndex = new Map();
    s.warps.forEach((w, i) => { if (!this.warpIndex.has(w.vr)) this.warpIndex.set(w.vr, i); });
    this.cursors = s.warps.map((w) => w.tests.map(() => ({ name: '', hidden: false })));
    this.warpIdx = 0;
    this.resetState();
  }
  private getWarpIdx(name: string) {
    if (this.warpIndex.has(name)) return this.warpIndex.get(name)!;
    const k = lower(name);
    for (const [n, i] of this.warpIndex) if (lower(n) === k) return i;
    const ws = this.script.warps;
    for (let i = 0; i < ws.length; ++i) if (lower(ws[i].vr) === k) return i;
    return -1;
  }
  private getTest(warp: Warp | null, idx: number) { return warp ? warp.tests.find((t) => t.idx === idx) || null : null; }
  private getLastTest(warp: Warp | null, idx: number) {
    if (!warp) return null;
    for (let i = warp.tests.length - 1; i >= 0; --i) if (warp.tests[i].idx === idx) return warp.tests[i];
    return null;
  }
  private resetState() {
    this.angleX.resetRange();
    this.angleX.set(0);
    this.angleY.resetRange();
    this.angleY.set(-PI2);
    this.imageOverlay = null;
    this.cible = null;
  }

  private async execTest(test: Test) { await this.execCmds(test.cmds, { running: true, sub: false, root: test }, 0); }
  private async execCmds(cmds: Cmd[], ctx: Ctx, start: number) {
    for (let i = start; i < cmds.length; ++i) {
      if (!ctx.running) break;
      await this.exec(cmds[i], ctx);
    }
  }

  private async exec(c: Cmd, ctx: Ctx): Promise<void> {
    switch (c.op) {
      case 'block': return this.execCmds(c.cmds, ctx, 0);
      case 'ifand': {
        let ok = true;
        for (const v of c.vars as string[]) { if (v && this.has(v) && !this.getVar(v)) ok = false; }
        if (ok) await this.exec(c.then, ctx);
        return;
      }
      case 'ifor': {
        let ok = false;
        for (const v of c.vars as string[]) { if (v && this.has(v) && this.getVar(v)) ok = true; }
        if (ok) await this.exec(c.then, ctx);
        return;
      }
      case 'set': return this.setVar(c.var, c.value);
      case 'setvalue': return this.setVar(c.var, this.valueOf(c.value));
      case 'not': return this.setVar(c.var, this.getVar(c.var) ? 0 : 1);
      case 'add': return this.setVar(c.dst, this.valueOf(c.a) + this.valueOf(c.b));
      case 'sub': return this.setVar(c.dst, this.valueOf(c.a) - this.valueOf(c.b));
      case 'copyvar': return this.setVar(c.dst, this.getVar(c.src));
      case 'cmp': {
        const a = this.valueOf(c.a), b = this.valueOf(c.b);
        let r: boolean;
        switch (c.cmp) {
          case '==': r = a === b; break;
          case '!=': case '<>': r = a !== b; break;
          case '<': r = a < b; break;
          case '<=': r = a <= b; break;
          case '>': r = a > b; break;
          case '>=': r = a >= b; break;
          default: warn('invalid cmp', c.cmp); r = false;
        }
        this.setVar(c.var, r ? 1 : 0);
        this.setVar(c.neg, r ? 0 : 1);
        return;
      }
      case 'gotowarp': if (this.goToWarp(c.warp)) ctx.running = false; return;
      case 'return': ctx.running = false; if (!ctx.sub) this.returnToWarp(); return;
      case 'end': ctx.running = false; this.end(); return;
      case 'quit': this.quitting = true; ctx.running = false; return;
      case 'gosub': {
        const root = ctx.root;
        const off = root.labels ? root.labels[lower(c.label)] : undefined;
        if (off === undefined) { warn('gosub: label not found', c.label); return; }
        await this.execCmds(root.cmds, { running: true, sub: true, root }, off);
        return;
      }
      case 'setcursordefault':
        if (c.idx === 0 || c.idx === 1) { this.defaultCursor[c.idx] = c.file; this.loadCursor(c.file); }
        return;
      case 'setcursor': {
        const w = this.getWarpIdx(c.warp);
        if (w < 0) return;
        const cur = this.cursors[w];
        if (c.idx >= 0 && c.idx < cur.length) { cur[c.idx].name = c.file; this.loadCursor(c.file); }
        return;
      }
      case 'hidecursor': {
        const w = this.getWarpIdx(c.warp);
        if (w < 0) return;
        const cur = this.cursors[w];
        if (c.idx >= 0 && c.idx < cur.length) cur[c.idx].hidden = true;
        return;
      }
      case 'lockkey': this.lockKey[c.idx] = c.warp; return;
      case 'resetlockkey': this.prevWarp = -1; return;
      case 'setzoom': this.fov = c.fov; return;
      case 'anglexmax': this.angleY.setRange(-c.max, c.max); return;
      case 'angleymax':
        if (c.min !== c.max) this.angleX.setRange(c.min, c.max); else this.angleX.resetRange();
        return;
      case 'setangle': this.setAngle(c.x, c.y); return;
      case 'setnord': this.angleX.add(c.angle); return;
      case 'interpolangle': return this.interpolateAngle(c.x, c.y, c.speed, c.zoom);
      case 'playsound': return this.playSound(c.sound, c.volume, c.loops, !!c.music);
      case 'stopsound': return this.stopSound(c.sound);
      case 'fade': return this.doFade(c.start, c.stop, c.speed);
      case 'transfade': return this.transFade(c.speed);
      case 'movie': return this.playMovie(c.file);
      case 'anim': return this.playAnimation(c.name, c.var, c.value, c.speed);
      case 'anim_number':
        return this.playAnimation(c.prefix + String(this.getVar(c.numvar)).padStart(4, '0'), c.var, c.value, c.speed);
      case 'stopanim': return this.stopAnimation(c.name);
      case 'wait': return this.wait(c.seconds);
      case 'until': return this.until(c.var, c.value);
      case 'scheduletest': this.nextTest = c.idx; return;
      case 'nextscript': this.setNextScript(c.file); return;
      case 'ls_enter': {
        const loading = this.enterScript();
        this.setVar(c.reloading, loading ? 1 : 0);
        this.setVar(c.notreloading, loading ? 0 : 1);
        return;
      }
      case 'ls_restored': {
        const v = this.getVar(c.progress);
        this.setVar(c.progress, 0);
        this.setVar(c.done, v);
        return;
      }
      case 'ls_capture': this.captureContext(); return;
      case 'ls_save': return this.saveGame(c.slot);
      case 'ls_load': return this.loadGame(c.slot);
      case 'ls_test': {
        const e = platform.hasSave(c.slot);
        this.setVar(c.show, e ? 1 : 0);
        this.setVar(c.hide, e ? 0 : 1);
        return;
      }
      case 'ls_draw': return this.drawSlot(c.slot, c.face, c.x, c.y);
      case 'ls_label': this.contextLabel = c.label; return;
      case 'nop': return;
      case 'timer_start':
        this.timer = { flags: 5, t: c.seconds, initial: c.seconds, show: c.show, warp: c.warp || '' };
        return;
      case 'timer_pause':
        if (this.timer.flags) {
          if (c.pause) this.timer.flags |= 2; else this.timer.flags &= ~2;
          if (c.deactivate) this.timer.flags &= ~4; else this.timer.flags |= 4;
        }
        return;
      case 'timer_kill': this.timer = NO_TIMER(); return;
      case 'overlay_show': return this.showImageOverlay(c.image, c.x, c.y);
      case 'overlay_hide': this.imageOverlay = null; return;
      case 'waves': this.waves = true; return;
      case 'cible_start': this.cible = { start: performance.now(), period: c.period, bounds: c.bounds }; return;
      case 'cible_stop': this.cible = null; return;
      case 'cible_test': {
        if (!this.cible) return;
        let inside = false;
        if (this.cible.period > 0) {
          const periodMs = this.cible.period * 1000;
          const elapsed = (performance.now() - this.cible.start) % periodMs;
          const b = this.cible.bounds;
          for (let i = 0; i + 1 < b.length && b[i] !== 0; i += 2) {
            if (b[i] * 1000 < elapsed && elapsed < b[i + 1] * 1000) { inside = true; break; }
          }
        }
        this.setVar(c.inside, inside ? 1 : 0);
        this.setVar(c.outside, inside ? 0 : 1);
        return;
      }
      default: warn('unsupported command', c); return;
    }
  }

  private setAngle(x: number, y: number) { this.angleX.set(y); this.angleY.set(PI2 - x); }

  private goToWarp(name: string, savePrev = false) {
    log('gotowarp', name, savePrev);
    if (this.warp && this.warp.vr === name) return false;
    this.nextWarp = this.getWarpIdx(name);
    this.hoverIndex = -1;
    this.hoverLeaveIndex = -1;
    if (savePrev) {
      this.prevWarp = this.warpIdx;
      this.prevView = { ax: this.angleX.angle, ay: this.angleY.angle, fov: this.fov };
      this.saveThumbnail();
    }
    return true;
  }
  private returnToWarp() {
    if (this.prevWarp < 0) { this.nextWarp = -1; return; }
    this.nextWarp = this.prevWarp;
    this.prevWarp = -1;
    this.pendingView = this.prevView;   // QoL: come back looking where we were
    this.prevView = null;
  }
  private end() {
    this.stopAllSounds();
    if (!this.nextScript && this.nextWarp < 0) this.quitting = true;
  }

  // ------------------------------------------------------------- warps
  // Dracula 2 missions have their own copies of some files (index.variants).
  private file(name: string) { const b = baseOf(name); return this.variants[b] ?? b; }
  private async loadVR(name: string): Promise<VrState | null> {
    const key = stemOf(this.file(name));
    if (!this.index.vr[key]) return null;
    const dir = 'vr/' + key + '/';
    let meta: VrMeta;
    try { meta = await fetchJson<VrMeta>(this.url(dir + 'meta.json')); }
    catch (e) { warn((e as Error).message); return null; }
    const pic = (file: string | null) => (file ? loadImage(this.url(dir + file)) : Promise.resolve(null));
    const isVR = meta.type === 'panorama';
    const [imgs, anims] = await Promise.all([
      Promise.all(meta.images.map(pic)),
      Promise.all(meta.animations.map(async (a): Promise<Anim> => ({
        name: a.name, restart: a.restart_at,
        frames: await Promise.all(a.patches.map(async (p) => ({ img: await pic(p.atlas), blocks: p.blocks }))),
        active: false, frame: 0, t: 0, speed: 0, stopRequested: false, variable: '', value: 0,
      }))),
    ]);
    return { name: key, isVR, imgs, anims };
  }
  private applyVR(vr: VrState) {
    this.vr = vr;
    this.waves = false;
    this.wavesT = 0;
    if (vr.isVR) {
      for (let i = 0; i < 6; ++i) {
        const ctx = this.faces[i].getContext('2d')!;
        ctx.clearRect(0, 0, 512, 512);
        if (vr.imgs[i]) ctx.drawImage(vr.imgs[i]!, 0, 0);
        this.faceDirty[i] = true;
      }
    } else {
      this.sctx.fillStyle = '#000';
      this.sctx.fillRect(0, 0, W, H);
      if (vr.imgs[0]) this.sctx.drawImage(vr.imgs[0], 0, 0);
    }
  }
  private async enterWarp() {
    this.hoverIndex = -1;
    this.hoverLeaveIndex = -1;
    this.warpIdx = this.nextWarp;
    this.warp = this.script.warps[this.nextWarp];
    this.nextWarp = -1;
    log('warp', this.warp.vr);
    // Debut.vr is both games' intro (logos, then the opening movies) and ends at the menu
    if (stemOf(this.warp.vr) === 'debut' && platform.pref('skipIntro', false)) {
      const menu = this.getWarpIdx('Interface.vr');
      if (menu >= 0) { this.nextWarp = menu; return; }
    }
    for (const c of this.cursors[this.warpIdx]) c.hidden = false;
    const vr = await this.loadVR(this.warp.vr);
    if (vr) this.applyVR(vr);
    if (this.warp.test) {
      const regs = this.index.tests[stemOf(this.file(this.warp.test))];
      if (regs) this.regions = regs;
    }
    const view = this.pendingView;
    this.pendingView = null;
    const t = this.getTest(this.warp, -1);
    if (t) await this.execTest(t);
    if (this.debugWarp && this.nextWarp >= 0 && this.script.warps.length > 2) {
      this.nextWarp = this.getWarpIdx(this.debugWarp);   // --warp=NAME (testing)
      this.debugWarp = null;
    }
    if (view && this.nextWarp < 0 && this.vr.isVR) {
      this.angleX.set(view.ax);
      this.angleY.set(view.ay);
      this.fov = view.fov;
    }
  }

  // -------------------------------------------------------- animations
  private findAnim(name: string) { const k = lower(name); return this.vr.anims.find((a) => lower(a.name) === k); }
  private playAnimation(name: string, variable: string, value: number, speed: number) {
    const a = this.findAnim(name);
    if (!a || a.active) return;
    a.active = true; a.stopRequested = false; a.frame = 0; a.t = 0; a.speed = speed;
    a.variable = variable; a.value = value;
    this.animNextFrame(a);
    if (a.speed === 0) this.setVar(variable, value);
  }
  private stopAnimation(name: string) {
    const a = this.findAnim(name);
    if (a && a.active) a.stopRequested = true;
  }
  private animNextFrame(a: Anim) {
    if (a.frame < a.frames.length) this.applyPatch(a.frames[a.frame++]);
    if (a.frame >= a.frames.length) {
      if (!a.stopRequested && a.restart >= 0 && a.restart < a.frames.length) a.frame = a.restart;
      else { a.active = false; a.stopRequested = false; a.frame = 0; this.setVar(a.variable, a.value); }
    }
  }
  private applyPatch(f: { img: Img | null; blocks: [number, number, number][] }) {
    if (!f.img) return;
    const cols = 32;
    f.blocks.forEach((b, i) => {
      const sx = (i % cols) * 8, sy = Math.floor(i / cols) * 8;
      if (b[0] < 0) this.sctx.drawImage(f.img!, sx, sy, 8, 8, b[1], b[2], 8, 8);
      else {
        this.faces[b[0]].getContext('2d')!.drawImage(f.img!, sx, sy, 8, 8, b[1], b[2], 8, 8);
        this.faceDirty[b[0]] = true;
      }
    });
  }
  private tickAnims(dt: number) {
    for (const a of this.vr.anims) {
      if (!a.active) continue;
      a.t += a.speed * dt;
      if (a.t >= 1) { a.t = a.t % 1; this.animNextFrame(a); }
    }
  }

  // ---------------------------------------------------------- render
  /** Sizes the game box. `animate` (the F3 toggle only, never a window resize) eases the
   *  box between 4:3 and stretched: the frame visibly stretches or pulls back in. */
  layout(animate = false) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / W, vh / H);
    const w = this.stretch ? vw : Math.floor(W * scale);
    const h = this.stretch ? vh : Math.floor(H * scale);
    const box = $('box');
    box.classList.toggle('easing', animate);
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    this.video.style.objectFit = this.stretch ? 'fill' : 'contain';
    // While easing, keep the larger render size so the frame never turns blurry
    // mid-animation; the exact size is set once the box has settled.
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    this.glCanvas.width = animate ? Math.max(cw, this.glCanvas.width) : cw;
    this.glCanvas.height = animate ? Math.max(ch, this.glCanvas.height) : ch;
    clearTimeout(this.layoutTimer);
    if (!animate) return;
    // Settle when the easing actually ends (it can start a frame late, after the
    // canvas reallocation); the timer is only a fallback if no event arrives.
    const settle = () => { box.removeEventListener('transitionend', onEnd); clearTimeout(this.layoutTimer); this.layout(); };
    const onEnd = (e: TransitionEvent) => { if (e.target === box && e.propertyName === 'width') settle(); };
    box.addEventListener('transitionend', onEnd);
    this.layoutTimer = window.setTimeout(settle, LAYOUT_EASE_MS + 400);
  }
  private renderScene(dt: number) {
    this.tickAnims(dt);
    this.glCanvas.style.visibility = this.vr.isVR ? 'visible' : 'hidden';
    this.screen.style.visibility = this.vr.isVR ? 'hidden' : 'visible';
    if (this.vr.isVR) {
      for (let i = 0; i < 6; ++i) if (this.faceDirty[i]) { this.pano.upload(i, this.faces[i]); this.faceDirty[i] = false; }
      this.cam = camera(this.angleX.angle, this.angleY.angle, this.fov);
      if (this.waves) this.wavesT += dt * 20;
      this.pano.draw(this.cam, this.waves ? this.wavesT : -1, this.faceXScale);
    }
  }
  private composite(target: HTMLCanvasElement) {
    const ctx = target.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(this.vr.isVR ? this.glCanvas : this.screen, 0, 0, target.width, target.height);
  }
  private saveThumbnail() {
    const ctx = this.thumbnail.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.vr.isVR ? this.glCanvas : this.screen, 0, 0, THUMB_W, THUMB_H);
  }
  private drawOverlay(cursor: Cursor | null) {
    const o = this.octx;
    o.clearRect(0, 0, W, H);
    if (this.transition) {
      o.globalAlpha = this.transition.alpha;
      o.drawImage(this.snapshot, 0, 0);
      o.globalAlpha = 1;
    }
    if (this.imageOverlay) o.drawImage(this.imageOverlay.canvas, this.imageOverlay.x, this.imageOverlay.y);
    this.drawTimer();
    if (DEV && this.showRegions && this.regions) {
      drawRegions(this.octx, this.regions, this.vr.isVR ? this.cam || camera(this.angleX.angle, this.angleY.angle, this.fov) : null);
    }
    if (this.fade < 0) {
      o.fillStyle = 'rgba(0,0,0,' + clamp(-this.fade / 255, 0, 1) + ')';
      o.fillRect(0, 0, W, H);
    } else if (this.fade > 0) {
      o.fillStyle = 'rgba(255,255,255,' + clamp(this.fade / 255, 0, 1) + ')';
      o.fillRect(0, 0, W, H);
    }
    if (cursor && cursor.img) {
      const p = this.cursorPos();
      o.drawImage(cursor.img, Math.round(p.x - cursor.ox), Math.round(p.y - cursor.oy));
    }
  }

  // ---------------------------------------------- Dracula 2: .arn archive pictures
  private arnImage(name: string) {
    const k = stemOf(name);
    if (!this.arnCache.has(k)) this.arnCache.set(k, loadImage(this.url('arn/' + k + '.webp')));
    return this.arnCache.get(k)!;
  }
  private async showImageOverlay(name: string, x: number, y: number) {
    this.imageOverlay = null;
    const img = await this.arnImage(name);
    if (!img) { warn('.arn image not found', name); return; }
    // The bottom-right pixel's colour is the transparent one
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const px = d.data, last = (c.width * c.height - 1) * 4;
    const kr = px[last], kg = px[last + 1], kb = px[last + 2];
    for (let i = 0; i < px.length; i += 4) if (px[i] === kr && px[i + 1] === kg && px[i + 2] === kb) px[i + 3] = 0;
    ctx.putImageData(d, 0, 0);
    this.imageOverlay = { canvas: c, x, y };
  }
  private tickTimer(dt: number) {
    const tm = this.timer;
    if (!tm.flags) return;
    if ((tm.flags & 2) === 0) tm.t = tm.t > dt ? tm.t - dt : 0;
    if ((tm.flags & 4) && tm.t <= 0) {
      const warp = tm.warp;
      this.timer = NO_TIMER();
      if (warp) this.goToWarp(warp); else this.nextTest = 99;
    }
  }
  private drawTimer() {
    const tm = this.timer;
    if ((tm.flags & 4) === 0 || !tm.show || !(tm.initial > 0)) return;
    if (!this.timerImgs) {
      this.timerImgs = 'loading';
      void Promise.all([this.arnImage('cadre.bmp'), this.arnImage('cadreB.bmp')]).then(([a, b]) => {
        this.timerImgs = a && b ? [a, b] : null;
      });
      return;
    }
    if (this.timerImgs === 'loading') return;
    const [bg, fg] = this.timerImgs;
    const o = this.octx;
    o.drawImage(bg, 165, 15);   // Dracula 2 timer bar position
    const w = Math.floor(fg.width * (tm.t / tm.initial));
    if (w > 0) o.drawImage(fg, 0, 0, w, fg.height, 177, 15, w, fg.height);
  }
  setMessage(text: string, ms = 2500) {
    this.msg.textContent = text;
    this.msg.style.display = 'block';
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { this.msg.style.display = 'none'; }, ms);
  }

  // ---------------------------------------------------------- cursors
  private loadCursor(name: string): Cursor | null {
    if (!name) return null;
    const key = stemOf(this.file(name));
    let c = this.cursorCache.get(key);
    if (!c) {
      const cc: Cursor = { img: null, ox: 0, oy: 0, failed: false };
      this.cursorCache.set(key, cc);
      void loadImage(this.url('cursors/' + key + '.webp')).then((img) => {
        if (!img) { cc.failed = true; return; }
        cc.img = img; cc.ox = Math.floor(img.width / 2); cc.oy = Math.floor(img.height / 2);
      });
      c = cc;
    }
    return c.img ? c : null;
  }
  /** Crosshair in the centre: classic mouse, in panoramas. */
  private centered() { return this.vr.isVR && this.classic; }
  private cursorPos() { return this.centered() ? { x: W / 2, y: H / 2 } : { x: this.mouse.x, y: this.mouse.y }; }
  private hitPoint(): [number, number] {
    if (this.vr.isVR) {
      if (this.centered()) return [Angle.mod(this.angleX.angle, 0, TAU), Angle.mod(-this.angleY.angle, 0, TAU)];
      const cam = this.cam || camera(this.angleX.angle, this.angleY.angle, this.fov);
      return rayAngles(cam, this.mouse.x, this.mouse.y);
    }
    return [this.mouse.x, this.mouse.y];
  }
  private regionHit(r: Region, p: [number, number]) { return this.vr.isVR ? contains3D(r, p[0], p[1]) : contains2D(r, p[0], p[1]); }

  // ------------------------------------------------------------- input
  private setupInput() {
    const ov = this.overlay;
    const toLogical = (e: MouseEvent) => {
      const rect = ov.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * W / rect.width, y: (e.clientY - rect.top) * H / rect.height };
    };
    ov.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === ov) {
        if (this.vr.isVR) {
          this.angleX.add(e.movementX * 0.0035 * this.sensitivity);
          this.angleY.add(e.movementY * 0.0035 * this.sensitivity);
        } else {
          // 2D screens (menus, close-ups): the locked mouse moves a virtual cursor
          const rect = ov.getBoundingClientRect();
          this.mouse.x = clamp(this.mouse.x + e.movementX * this.sensitivity * W / rect.width, 0, W - 1);
          this.mouse.y = clamp(this.mouse.y + e.movementY * this.sensitivity * H / rect.height, 0, H - 1);
          this.mouse.inside = true;
        }
        return;
      }
      const p = toLogical(e);
      this.mouse.x = clamp(p.x, 0, W - 1);
      this.mouse.y = clamp(p.y, 0, H - 1);
      this.mouse.inside = true;
      if (this.drag && this.vr.isVR) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved) {
          const k = this.fov / ov.getBoundingClientRect().width;
          this.angleX.add(-(e.clientX - this.drag.lx) * k);
          this.angleY.add(-(e.clientY - this.drag.ly) * k);
        }
        this.drag.lx = e.clientX; this.drag.ly = e.clientY;
      }
    });
    ov.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    ov.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        const moved = !!this.drag?.moved;
        this.drag = null;
        if (e.target === ov && this.wantClassic && !document.pointerLockElement && this.running) {
          // classic mode lost the lock (Esc, alt-tab): a click takes it back
          const swallow = this.vr.isVR && !this.lockFailed;
          this.lockPointer();
          if (swallow) return;
        }
        if (!moved && e.target === ov) this.events.push({ type: 'click' });
      } else if (e.button === 2 && e.target === ov) {
        this.events.push({ type: 'rclick' });
      }
    });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    // F2-F4 and F10 no longer reach the scripts: neither game binds them as a lockkey
    const keyCodes: Record<string, number> = { Escape: 0, Backspace: 0, F1: 1, F5: 5, F6: 6,
      F7: 7, F8: 8, F9: 9, Enter: 11, Tab: 12 };
    const hotkeys: Record<string, () => void> = {
      F2: () => this.toggleClassic(),
      F3: () => this.toggleStretch(),
      F10: () => this.openMenu(),
      F11: () => platform.toggleFullscreen(),
    };
    if (DEV) hotkeys.F4 = () => { this.showRegions = !this.showRegions; };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.lastEscKey = performance.now();
      if (this.menu) {
        // Esc does not count as a user gesture, so it cannot take the pointer lock back
        if (e.repeat) return;
        if (e.key === 'Escape') { e.preventDefault(); this.closeMenu(false); }
        else if (e.key === 'F10') { e.preventDefault(); this.closeMenu(true); }
        return;
      }
      if (e.key in hotkeys) { e.preventDefault(); if (!e.repeat) hotkeys[e.key](); return; }
      if (e.key in keyCodes) { e.preventDefault(); this.events.push({ type: 'key', code: keyCodes[e.key] }); }
      else if (e.key === ' ') { e.preventDefault(); this.events.push({ type: 'skip' }); }
      else if (e.key === 'ArrowLeft') this.keyPan = [-1, 0];
      else if (e.key === 'ArrowRight') this.keyPan = [1, 0];
      else if (e.key === 'ArrowUp') this.keyPan = [0, -1];
      else if (e.key === 'ArrowDown') this.keyPan = [0, 1];
    });
    window.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) this.keyPan = null; });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === ov;
      if (locked && !this.classic && !this.mouse.inside) { this.mouse.x = W / 2; this.mouse.y = H / 2; }
      this.classic = locked;
      if (!locked && this.wantClassic && !this.unlockRequested && this.running) {
        // Chromium drops the lock by itself on Esc, often without passing the key on:
        // treat it as Esc so the menu still opens.
        if (performance.now() - this.lastEscKey > 300) this.events.push({ type: 'key', code: 0 });
      }
      this.unlockRequested = false;
    });
  }
  lockPointer() {
    this.lockFailed = false;
    const r = this.overlay.requestPointerLock() as unknown as Promise<void> | undefined;
    if (r && r.catch) r.catch(() => { this.lockFailed = true; });
  }
  private setClassic(on: boolean) {
    this.wantClassic = on;
    platform.setPref('classic', on);
    if (this.menu) return;   // closing the menu takes the lock back
    if (on) this.lockPointer();
    else if (document.pointerLockElement) { this.unlockRequested = true; document.exitPointerLock(); }
  }
  private toggleClassic() {
    this.setClassic(!this.wantClassic);
    this.setMessage(this.wantClassic ? UI.classicMouse : UI.freeMouse);
  }
  private setStretch(on: boolean) {
    this.stretch = on;
    platform.setPref('stretch', on);
    this.layout(true);
  }
  private toggleStretch() {
    this.setStretch(!this.stretch);
    this.setMessage(this.stretch ? UI.stretched : UI.original43);
  }

  private openMenu() {
    if (this.menu || !this.running) return;
    if (document.pointerLockElement) { this.unlockRequested = true; document.exitPointerLock(); }
    this.keyPan = null;
    this.drag = null;
    this.holdMedia(true);
    const ui = this.ui;
    ui.className = 'menu';
    ui.replaceChildren(clone('tpl-options'));
    ui.style.display = '';
    this.menu = ui;
    ui.querySelector('.opts')!.prepend(clone('tpl-prefs'));
    bindSettings(ui, {
      volume: (v) => this.setVolume(v),
      sensitivity: (v) => { this.sensitivity = v; },
      classic: (on) => this.setClassic(on),
      stretch: (on) => this.setStretch(on),
    });
    const input = (name: string) => ui.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    const fs = input('fullscreen');
    fs.onchange = () => platform.setFullscreen(fs.checked);
    void platform.isFullscreen().then((on) => { fs.checked = on; });
    ui.querySelector<HTMLButtonElement>('button.resume')!.onclick = () => this.closeMenu(true);
    input('volume').focus();
  }
  private closeMenu(relock: boolean) {
    if (!this.menu) return;
    this.menu = null;
    this.ui.style.display = 'none';
    this.ui.className = '';
    this.ui.replaceChildren();
    this.holdMedia(false);
    if (relock && this.wantClassic) this.lockPointer();
  }
  // Still drawn while paused: a layout change behind the menu clears the WebGL canvas
  private async hold() {
    while (this.menu) {
      this.renderScene(0);
      this.drawOverlay(null);
      await nextFrame();
    }
  }
  // The scripts wait on the movie and one-shot sounds; loops play on so volume can be judged
  private holdMedia(hold: boolean) {
    if (!hold) {
      if (this.heldVideo) this.video.play().catch(() => {});
      for (const e of this.heldSounds) this.resumeSound(e);
      this.heldVideo = false;
      this.heldSounds = [];
      return;
    }
    if (!this.video.paused && !this.video.ended) { this.video.pause(); this.heldVideo = true; }
    for (const [, e] of this.sounds) if (!this.loops(e) && !e.ended) { this.pauseSound(e); this.heldSounds.push(e); }
  }
  private setVolume(v: number) {
    this.masterVolume = v;
    this.video.volume = v;
    this.master.gain.value = v;
  }

  private edgePan(dt: number) {
    if (!this.vr.isVR) return;
    let dx = 0, dy = 0;
    if (this.keyPan) { [dx, dy] = this.keyPan; }
    else if (!this.classic && this.mouse.inside && !this.drag) {
      const m = 14;
      if (this.mouse.x < m) dx = -(m - this.mouse.x) / m;
      else if (this.mouse.x > W - m) dx = (this.mouse.x - (W - m)) / m;
      if (this.mouse.y < m) dy = -(m - this.mouse.y) / m;
      else if (this.mouse.y > H - m) dy = (this.mouse.y - (H - m)) / m;
    }
    if (dx) this.angleX.add(dx * 1.4 * dt);
    if (dy) this.angleY.add(dy * 1.0 * dt);
  }
  private async processEvents() {
    const evs = this.events;
    this.events = [];
    for (const e of evs) {
      if (e.type === 'key') {
        if (this.prevWarp !== -1) continue;
        if (this.lockKey[e.code]) this.goToWarp(this.lockKey[e.code], true);
      } else if (e.type === 'rclick') {
        if (this.prevWarp !== -1) { this.returnToWarp(); continue; }
        if (this.lockKey[12]) this.goToWarp(this.lockKey[12], true);
      } else if (e.type === 'click') {
        if (this.warpIdx < 0 || !this.warp) continue;
        const p = this.hitPoint();
        const cur = this.cursors[this.warpIdx];
        const regs = this.regions || [];
        const n = Math.max(regs.length, cur.length);
        for (let i = 0; i < n; ++i) {
          const r = regs[i];
          if (!r) continue;
          const t = this.getTest(this.warp, i);
          if (t && t.hover !== 0) continue;
          if (this.regionHit(r, p)) {
            const ct = this.getLastTest(this.warp, i);
            if (ct) await this.execTest(ct);
            break;
          }
        }
      }
    }
  }
  private drainEvents() {
    let skip = false;
    for (const e of this.events) if (e.type === 'skip' || (e.type === 'key' && e.code === 0)) skip = true;
    this.events = [];
    return skip;
  }

  // ---------------------------------------------------------- blocking
  private async frameLoop(fn: (dt: number, skip: boolean) => boolean) {
    let last = performance.now();
    for (;;) {
      const now = await nextFrame();
      if (this.menu) { await this.hold(); last = performance.now(); continue; }
      const dt = Math.min((now - last) / 1000, 4 / 60);
      last = now;
      const skip = this.drainEvents();
      if (!fn(dt, skip)) break;
    }
  }
  private async wait(seconds: number) {
    let t = 0;
    await this.frameLoop((dt) => {
      t += dt;
      this.renderScene(dt);
      this.drawOverlay(null);
      return t < seconds;
    });
  }
  private async until(v: string, value: number) {
    await this.frameLoop((dt) => {
      this.renderScene(dt);
      this.drawOverlay(null);
      return this.getVar(v) !== value;
    });
  }
  private async doFade(start: number, stop: number, speed: number) {
    if (start === stop) return;
    const inc = start < stop;
    if (!inc) speed = -speed;
    const speedMs = speed * 1000 / 16;
    let pos = start;
    await this.frameLoop((dt, skip) => {
      if (skip || !(inc ? pos < stop : pos > stop)) return false;
      this.renderScene(dt);
      this.fade = pos;
      this.drawOverlay(null);
      pos += dt * speedMs + (speed >= 0 ? 1 : -1);
      return true;
    });
    this.fade = 0;
  }
  private async transFade(speed: number) {
    this.composite(this.snapshot);
    const dur = Math.max(0.05, 2 * 256 / (Math.max(1, speed) * 1000 / 16));
    let t = 0;
    const tr = { alpha: 1 };
    this.transition = tr;
    await this.frameLoop((dt, skip) => {
      t += dt;
      if (skip || t >= dur) return false;
      this.renderScene(dt);
      tr.alpha = 1 - t / dur;
      this.drawOverlay(null);
      return true;
    });
    this.transition = null;
  }
  private async interpolateAngle(x: number, y: number, speed: number, zoom: number) {
    const dur = 4096 * 16 / 1000;
    const x0 = this.angleY.angle + PI2, y0 = this.angleX.angle, z0 = this.fov;
    let dx = x - x0, dy = y - y0;
    const dz = zoom - z0;
    if (dy < -PI) dy += TAU;
    if (dy > PI) dy -= TAU;
    if (dx < -PI) dx += TAU;
    if (dx > PI) dx -= TAU;
    let t = 0;
    await this.frameLoop((dt, skip) => {
      if (skip || t >= dur) return false;
      const t1 = t / dur, t2 = t1 * t1;
      this.setAngle(x0 + t2 * dx, y0 + t2 * dy);
      if (zoom > 0) this.fov = z0 + t1 * dz;
      this.renderScene(dt);
      this.drawOverlay(null);
      t += dt * speed;
      return true;
    });
    this.setAngle(x, y);
    if (zoom > 0) this.fov = zoom;
  }
  private async playMovie(file: string) {
    const src = this.url('movie/' + stemOf(this.file(file)) + '.webm');
    log('movie', src);
    const v = this.video;
    v.src = src;
    v.volume = this.masterVolume;
    v.style.display = 'block';
    let done = false;
    v.onended = () => { done = true; };
    v.onerror = () => { warn('video not found', src); done = true; };
    try { await v.play(); } catch (e) { warn('video playback failed', src, e); done = true; }
    this.octx.clearRect(0, 0, W, H);
    let clicked = false;
    const onClick = () => { if (!this.menu) clicked = true; };
    window.addEventListener('mouseup', onClick);
    await this.frameLoop((_dt, skip) => {
      if (skip || clicked || this.events.some((e) => e.type === 'click')) done = true;
      return !done;
    });
    window.removeEventListener('mouseup', onClick);
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.style.display = 'none';
  }

  // ------------------------------------------------------------ sound
  private soundUrl(name: string) { return this.url('sound/' + stemOf(this.file(name)) + '.opus'); }
  private soundBuffer(url: string) {
    let b = this.soundCache.get(url);
    if (!b) {
      b = fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then((d) => this.audio.decodeAudioData(d))
        .catch(() => { warn('sound not found', url); return null; });
      this.soundCache.set(url, b);
    }
    return b;
  }
  private loops(e: SoundEntry) { return e.loops < 0 || e.music; }
  private playSound(name: string, volume: number, loops: number, music: boolean) {
    if (this.sounds.has(name)) return;
    if (music) {
      if (this.currentMusic) this.stopSound(this.currentMusic);
      this.currentMusic = name;
      this.currentMusicVolume = volume;
    }
    const gain = this.audio.createGain();
    gain.gain.value = clamp(volume / 255, 0, 1);
    gain.connect(this.master);
    const e: SoundEntry = { volume, loops, music, gain, buffer: null, source: null, startedAt: 0, offset: 0,
      paused: false, ended: false, stopped: false };
    this.sounds.set(name, e);
    void this.audio.resume();
    void this.soundBuffer(this.soundUrl(name)).then((buf) => {
      if (e.stopped) return;
      if (!buf) { e.ended = true; return; }
      e.buffer = buf;
      if (!e.paused) this.startSource(e);
    });
  }
  private startSource(e: SoundEntry) {
    const src = this.audio.createBufferSource();
    src.buffer = e.buffer;
    src.loop = this.loops(e);
    src.connect(e.gain);
    src.onended = () => { if (e.source === src) e.ended = true; };
    e.startedAt = this.audio.currentTime - e.offset;
    src.start(0, e.offset % e.buffer!.duration);
    e.source = src;
  }
  private pauseSound(e: SoundEntry) {
    e.paused = true;
    if (!e.source) return;
    e.offset = this.audio.currentTime - e.startedAt;
    const src = e.source;
    e.source = null;
    src.stop();
  }
  private resumeSound(e: SoundEntry) {
    e.paused = false;
    if (e.buffer && !e.stopped && !e.ended) this.startSource(e);
  }
  private stopSound(name: string) {
    if (name === this.currentMusic) this.currentMusic = '';
    const s = this.sounds.get(name);
    if (s) { this.killAudio(s); this.sounds.delete(name); }
  }
  private stopAllSounds() {
    for (const [, s] of this.sounds) this.killAudio(s);
    this.sounds.clear();
    this.currentMusic = '';
  }
  private killAudio(e: SoundEntry) {
    e.stopped = true;
    const src = e.source;
    e.source = null;
    src?.stop();
    e.gain.disconnect();
  }
  private cleanupSounds() { for (const [n, s] of this.sounds) if (s.ended) this.sounds.delete(n); }

  // ------------------------------------------------------------- saves
  private captureContext() {
    const finite = (v: number) => (Number.isFinite(v) ? v : null);
    const vars: Record<string, number> = {};
    for (const v of this.scriptVars) vars[v] = this.getVar(v);
    const sounds: { name: string; volume: number }[] = [];
    for (const [name, s] of this.sounds) {
      if (s.loops >= 0 || name === this.currentMusic) continue;
      sounds.push({ name, volume: s.volume });
    }
    this.capturedState = {
      ax: this.angleX.angle, ay: this.angleY.angle,
      xmax: finite(this.angleY.rangeMax + PI2),
      ymin: finite(this.angleX.rangeMin), ymax: finite(this.angleX.rangeMax),
      warpIdx: this.warpIdx, cursors: this.cursors.map((ws) => ws.map((c) => c.name)), vars, prevWarp: this.prevWarp,
      lockKeys: this.lockKey.slice(0, 12), music: this.currentMusic, musicVolume: this.currentMusicVolume,
      sounds, prevView: this.prevView,
    };
  }
  private enterScript() {
    const s = this.loadedState;
    if (!s) return false;
    this.angleX.set(s.ax);
    this.angleY.set(s.ay);
    if (s.xmax !== null) this.angleY.setRange(-s.xmax, s.xmax);
    if (s.ymin !== null && s.ymax !== null) this.angleX.setRange(s.ymin, s.ymax);
    this.nextWarp = s.warpIdx;
    this.cursors.forEach((ws, i) => ws.forEach((c, j) => {
      let n: string = (s.cursors[i] && s.cursors[i][j]) || '';
      if (/\.vr$/i.test(n)) n = '';
      c.name = n;
      if (n) this.loadCursor(n);
    }));
    for (const v of this.scriptVars) if (v in s.vars) this.setVar(v, s.vars[v]);
    this.prevWarp = s.prevWarp;
    this.prevView = s.prevView || null;
    for (let i = 0; i < 12; ++i) this.lockKey[i] = s.lockKeys[i] || '';
    this.stopAllSounds();
    if (s.music && s.musicVolume > 0) this.playSound(s.music, s.musicVolume, -1, true);
    for (const snd of s.sounds) if (snd.name && snd.name !== s.music) this.playSound(snd.name, snd.volume, -1, false);
    this.loadedState = null;
    return true;
  }
  private readSave(slot: number): SaveFile | null {
    const raw = platform.readSave(slot);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  private async saveGame(slot: number) {
    const d = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const p2 = (n: number) => String(n).padStart(2, '0');
    const info = [days[d.getDay()] + ' ' + p2(d.getDate()) + ' ' + p2(d.getMonth() + 1) + ' ' + d.getFullYear(),
      p2(d.getHours()) + ' h ' + p2(d.getMinutes())];
    const save: SaveFile = {
      script: this.contextScript, label: this.contextLabel, info,
      thumb: this.thumbnail.toDataURL('image/jpeg', 0.85), state: this.capturedState,
    };
    const ok = await platform.writeSave(slot, JSON.stringify(save));
    if (!ok) this.setMessage(UI.saveFailed, 5000);
    else if (slot !== 9) this.setMessage(UI.saved);
  }
  private async loadGame(slot: number) {
    const save = this.readSave(slot);
    if (!save) { warn('slot vazio', slot); return; }
    this.setNextScript(save.script);
    await this.loadNextScript();
    this.loadedState = save.state;
    const t = this.getTest(this.script.warps[0], -1);
    if (t) await this.execTest(t);
  }
  private async drawSlot(slot: number, face: number, x: number, y: number) {
    const save = this.readSave(slot);
    if (!save || !this.vr.isVR) return;
    const img = await loadImage(save.thumb);
    const ctx = this.faces[face].getContext('2d')!;
    if (img) ctx.drawImage(img, x, y, THUMB_W, THUMB_H);
    ctx.fillStyle = '#000';
    ctx.font = '12px "Noto Sans", "DejaVu Sans", Arial, sans-serif';
    ctx.textBaseline = 'top';
    let ty = y + 0x72;
    if (save.label) { ctx.fillText(save.label, x, ty, THUMB_W); ty += 14; }
    for (const line of save.info || []) { ctx.fillText(line, x, ty, THUMB_W); ty += 14; }
    this.faceDirty[face] = true;
  }

  // -------------------------------------------------------------- tick
  private async tick(dt: number) {
    this.tickTimer(dt);
    this.edgePan(dt);
    this.cleanupSounds();
    if (this.nextScript) {
      await this.loadNextScript();
      this.goToWarp(this.script.warps[0].vr);
    }
    while (this.nextWarp >= 0 && !this.quitting) await this.enterWarp();
    if (this.nextTest >= 0) {
      const n = this.nextTest;
      this.nextTest = -1;
      const t = this.getTest(this.warp, n);
      if (t) await this.execTest(t);
    }
    if (this.nextWarp < 0 && !this.nextScript) this.renderScene(dt);

    let cursor: Cursor | null = null;
    let anyMatched = false;
    let hoverIndex = -1, hoverLeaveIndex = -1;
    if (this.warpIdx >= 0 && this.warp) {
      const p = this.hitPoint();
      const cur = this.cursors[this.warpIdx] || [];
      const regs = this.regions || [];
      const n = Math.max(regs.length, cur.length);
      for (let i = 0; i < n; ++i) {
        const r = regs[i];
        if (!r || !this.regionHit(r, p)) continue;
        const valid = i < cur.length;
        anyMatched = !(valid && cur[i].hidden);
        const t = this.getTest(this.warp, i);
        if (t) {
          if (t.hover === 1 && hoverIndex < 0) hoverIndex = i;
          else if (t.hover === 2 && hoverLeaveIndex < 0) hoverLeaveIndex = i;
        }
        if (!cursor && valid) cursor = this.loadCursor(cur[i].name);
      }
    }
    if (hoverLeaveIndex !== this.hoverLeaveIndex) {
      const prev = this.hoverLeaveIndex;
      this.hoverLeaveIndex = hoverLeaveIndex;
      if (prev >= 0) { const t = this.getTest(this.warp, prev); if (t) await this.execTest(t); }
    }
    if (hoverIndex !== this.hoverIndex) {
      this.hoverIndex = hoverIndex;
      if (hoverIndex >= 0) { const t = this.getTest(this.warp, hoverIndex); if (t) await this.execTest(t); }
    }
    if (!cursor) cursor = this.loadCursor(anyMatched ? this.defaultCursor[1] : this.defaultCursor[0]);
    this.drawOverlay(this.mouse.inside || this.classic ? cursor : null);
  }

  async run(params: URLSearchParams) {
    this.running = true;
    this.setNextScript(this.index.manifest.start || 'script');
    if (params.get('script')) this.setNextScript(params.get('script')!);
    this.debugWarp = params.get('warp');
    let last = performance.now();
    for (;;) {
      const now = await nextFrame();
      if (this.menu) { await this.hold(); last = performance.now(); continue; }
      const dt = Math.min((now - last) / 1000, 4 / 60);
      last = now;
      try {
        await this.processEvents();
        await this.tick(dt);
      } catch (e) {
        console.error(e);
        this.setMessage(UI.runtimeError((e as Error).message), 8000);
      }
      if (this.quitting) { this.backToStart(); return; }
    }
  }

  /** The game is over: drop straight back to the cover selection, no end screen. */
  private backToStart() {
    this.running = false;
    this.stopAllSounds();
    if (document.pointerLockElement) { this.unlockRequested = true; document.exitPointerLock(); }
    location.reload();
  }
}
