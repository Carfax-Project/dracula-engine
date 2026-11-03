/* PhoenixVR v1 scripts (.lst) to the JSON the engine interprets (Script in
 * shared/format.ts).
 *
 * Ported from dracula-port's lst2json.py, itself ported from ScummVM's
 * engines/phoenixvr/parser.h, script.cpp, script_v1.cpp and commands_v1.cpp
 * (ScummVM is the legal property of its developers). GPLv3 or later. */
import type { Cmd, Script, Test, Warp } from '../shared/format';

const PI = 3.14159265358979;
const toAngle = (a: number) => PI / 4096.0 * a;
const toRadian = (deg: number) => PI * deg / 180.0;

// The same character classes as Python's str.isspace() and str.isalpha(), which the
// scripts were first parsed with.
const SPACE = new RegExp('[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]');
const isSpace = (c: string) => c !== '' && SPACE.test(c);
const isAlpha = (c: string) => /^\p{L}$/u.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';
const rstrip = (s: string) => { let e = s.length; while (e > 0 && isSpace(s[e - 1])) e--; return s.slice(0, e); };

function int(s: string) {
  if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new Error(`invalid integer: ${s}`);
  return parseInt(s, 10);
}
function float(s: string) {
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(s)) throw new Error(`invalid number: ${s}`);
  return parseFloat(s);
}

class Parser {
  pos = 0;
  constructor(private line: string, private lineno: number) { this.skip(); }

  skip() {
    if (this.pos === 0 && this.line[0] === ',') { this.pos = this.line.length; return; }
    while (this.pos < this.line.length && isSpace(this.line[this.pos])) this.pos++;
    if (this.line[this.pos] === ';') this.pos = this.line.length;
  }
  atEnd() { return this.pos >= this.line.length; }
  peekc() { return this.line[this.pos] ?? ''; }
  nextc() { return this.pos < this.line.length ? this.line[this.pos++] : ''; }
  expect(ch: string) {
    this.skip();
    const c = this.nextc();
    if (c !== ch) throw new Error(`expected '${ch}' at line ${this.lineno}, got '${c}' in ${this.line}`);
    this.skip();
  }
  maybeChar(ch: string) {
    this.skip();
    if (this.peekc() !== ch) return false;
    this.nextc();
    return true;
  }
  peek(prefix: string) {
    this.skip();
    return this.line.slice(this.pos, this.pos + prefix.length).toLowerCase() === prefix.toLowerCase();
  }
  maybe(prefix: string) {
    if (!this.peek(prefix)) return false;
    this.pos += prefix.length;
    this.skip();
    return true;
  }
  keyword(prefix: string) {
    this.skip();
    if (!this.peek(prefix)) return false;
    const end = this.pos + prefix.length;
    if (end < this.line.length && isAlpha(this.line[end])) return false;
    this.pos = end;
    this.skip();
    return true;
  }
  nextArg() {
    this.skip();
    const begin = this.pos;
    while (this.pos < this.line.length && this.line[this.pos] !== ',' && this.line[this.pos] !== ')') this.pos++;
    let end = this.pos;
    while (end > begin && isSpace(this.line[end - 1])) end--;
    this.skip();
    return this.line.slice(begin, end);
  }
  nextInt() {
    const negative = this.maybeChar('-');
    let value = 0;
    for (let first = true; first || isDigit(this.peekc()); first = false) {
      const c = this.nextc();
      if (!isDigit(c)) throw new Error(`expected digit at line ${this.lineno}: ${this.line}`);
      value = value * 10 + Number(c);
    }
    return negative ? -value : value;
  }
  nextWord() {
    this.skip();
    const begin = this.pos;
    while (this.pos < this.line.length && !isSpace(this.line[this.pos]) && !',(=)'.includes(this.line[this.pos])) this.pos++;
    const end = this.pos;
    this.skip();
    return this.line.slice(begin, end);
  }
  nextString() {
    this.skip();
    this.expect('"');
    let out = '';
    while (this.pos < this.line.length) {
      const c = this.line[this.pos++];
      if (c === '"') break;
      out += c;
    }
    this.skip();
    return out;
  }
  readStringList() {
    const out: string[] = [];
    while (!this.atEnd() && this.peekc() !== ')') {
      out.push(this.peekc() === '"' ? this.nextString() : this.nextArg());
      if (!this.atEnd() && this.peekc() !== ')') this.expect(',');
    }
    return out;
  }
}

function parseCommand(p: Parser): Cmd | null {
  if (p.keyword('setcursordefault')) {
    const idx = p.nextWord();
    p.expect(',');
    return { op: 'setcursordefault', idx: isDigit(idx[0] ?? '') ? int(idx) : -1, file: p.nextWord() };
  }
  if (p.keyword('lockkey')) {
    const idx = p.nextInt();
    p.expect(',');
    return { op: 'lockkey', idx, warp: p.nextWord() };
  }
  if (p.keyword('resetlockkey')) return { op: 'resetlockkey' };
  if (p.maybe('fade=')) {
    const start = p.nextInt(); p.expect(','); const stop = p.nextInt(); p.expect(','); const speed = p.nextInt();
    return { op: 'fade', start, stop, speed };
  }
  if (p.keyword('transfade')) return { op: 'transfade', speed: p.nextInt() };
  if (p.maybe('setzoom=')) return { op: 'setzoom', fov: toRadian(p.nextInt()) };
  if (p.maybe('setangle=') || p.keyword('setangle')) {
    const x = toAngle(p.nextInt()); p.expect(','); const y = toAngle(p.nextInt());
    return { op: 'setangle', x, y };
  }
  if (p.maybe('setnord=')) return { op: 'setnord', angle: toAngle(p.nextInt()) };
  if (p.keyword('interpolangle') || p.keyword('interpolanglezoom')) {
    p.maybeChar(','); p.maybeChar('=');
    const x = toAngle(p.nextInt()); p.expect(','); const y = toAngle(p.nextInt()); p.expect(',');
    const a2 = p.nextInt();
    const a3 = p.maybeChar(',') ? p.nextInt() : 0;
    if (a3 !== 0) return { op: 'interpolangle', x, y, speed: a3, zoom: toRadian(a2) };
    return { op: 'interpolangle', x, y, speed: a2, zoom: 0 };
  }
  if (p.maybe('anglexmax=') || p.keyword('anglexmax')) return { op: 'anglexmax', max: toAngle(p.nextInt()) };
  if (p.maybe('angleymax=') || p.keyword('angleymax')) {
    const min = toAngle(p.nextInt()); p.expect(','); const max = toAngle(p.nextInt());
    return { op: 'angleymax', min, max };
  }
  if (p.keyword('gotowarp')) return { op: 'gotowarp', warp: p.nextWord() };
  if (p.keyword('playsound3d')) {
    const sound = p.nextWord(); p.expect(','); const volume = p.nextInt(); p.expect(','); const a = p.nextInt();
    const loops = p.maybeChar(',') ? p.nextInt() : 0;
    return { op: 'playsound', sound, volume, loops, spatial: true, angle: toAngle(a) };
  }
  if (p.keyword('playmusique')) {
    const sound = p.nextWord();
    const volume = p.maybeChar(',') ? p.nextInt() : 255;
    return { op: 'playsound', sound, volume, loops: -1, music: true };
  }
  if (p.keyword('playsound')) {
    const sound = p.nextWord(); p.expect(','); const volume = p.nextInt();
    const loops = p.maybeChar(',') ? p.nextInt() : 0;
    return { op: 'playsound', sound, volume, loops };
  }
  if (p.keyword('playrndsound')) {
    const sound = p.nextWord(); p.expect(','); const volume = p.nextInt(); p.expect(','); const probability = p.nextInt();
    const loops = p.maybeChar(',') ? p.nextInt() : 0;
    return { op: 'playrndsound', sound, volume, probability, loops };
  }
  if (p.keyword('stopsound3d')) return { op: 'stopsound', sound: p.nextWord() };
  if (p.keyword('stopsound') || p.keyword('stopmusique')) return { op: 'stopsound', sound: p.nextWord() };
  if (p.keyword('setcursor')) {
    const file = p.nextWord();
    p.maybeChar(',');
    const warp = p.nextWord();
    const idx = p.maybeChar(',') ? p.nextInt() : 0;
    return { op: 'setcursor', file, warp, idx };
  }
  if (p.keyword('hidecursor')) {
    const warp = p.nextWord(); p.expect(','); const idx = p.nextInt();
    return { op: 'hidecursor', warp, idx };
  }
  if (p.keyword('set')) {
    const v = p.nextWord();
    if (p.maybeChar(',')) {
      const warp = p.nextWord();
      const idx = p.maybeChar(',') ? p.nextInt() : 0;
      return { op: 'setcursor', file: v, warp, idx };
    }
    let value = 0;
    if (p.maybeChar('=')) {
      p.skip();
      if (!p.atEnd() && p.peekc() !== '!') value = p.nextInt();
    }
    return { op: 'set', var: v, value };
  }
  if (p.keyword('not')) return { op: 'not', var: p.nextWord() };
  if (p.keyword('gosub')) return { op: 'gosub', label: p.nextWord() };
  if (p.keyword('return')) return { op: 'return' };
  if (p.keyword('end')) return { op: 'end' };
  return null;
}

function pluginCommand(name: string, args: string[], lineno: number): Cmd {
  const n = name.toLowerCase();
  switch (n) {
    case 'cmp': {
      const [v, neg, a] = args;
      let op = args[3], b: string;
      if (args.length === 5) b = args[4];
      else {
        const len = op.length > 1 && '=>'.includes(op[1]) ? 2 : 1;
        b = op.slice(len);
        op = op.slice(0, len);
      }
      return { op: 'cmp', var: v, neg, a, cmp: op, b };
    }
    case 'set': {
      let v: string, value: string;
      if (args.length === 2) [v, value] = args;
      else {
        const s = args[0];
        let pos = s.lastIndexOf('=');
        if (pos < 0) pos = s.length;
        v = s.slice(0, pos);
        value = s.slice(pos + 1);
      }
      return { op: 'setvalue', var: v, value };
    }
    case 'add': case 'sub': return { op: n, dst: args[0], a: args[1], b: args[2] };
    case 'copyvar': return { op: 'copyvar', src: args[0], dst: args[1] };
    case 'play_movie': return { op: 'movie', file: args[0] };
    case 'play_animbloc':
      return { op: 'anim', name: args[0], var: args[1], value: int(args[2]), speed: args.length >= 4 ? float(args[3]) : 25 };
    case 'play_animbloc_number':
      return { op: 'anim_number', prefix: args[0], numvar: args[1], var: args[2], value: int(args[3]),
        speed: args.length >= 5 ? float(args[4]) : 25 };
    case 'stop_animbloc': return { op: 'stopanim', name: args[0] };
    case 'while': return { op: 'wait', seconds: float(args[0]) };
    case 'until': return { op: 'until', var: args[0], value: int(args[1]) };
    case 'end': return { op: 'quit' };
    // The disc number in front ("2:0M2Script.lst") is not a drive letter.
    case 'multicd_set_next_script': return { op: 'nextscript', file: args[0]?.replace(/^\d+:/, '') };
    case 'multicd_set_transition_script': case 'multicd_use_install_path': case 'multicd_if_next_script':
    case 'loadsave_init_slots': case 'memoryrelease': case 'preload': case 'updatestage':
      return { op: 'nop', plugin: n, args };
    case 'loadsave_enter_script': return { op: 'ls_enter', reloading: args[0], notreloading: args[1] };
    case 'loadsave_context_restored': return { op: 'ls_restored', progress: args[0], done: args[1] };
    case 'loadsave_capture_context': return { op: 'ls_capture' };
    case 'loadsave_save': return { op: 'ls_save', slot: int(args[0]) };
    case 'loadsave_load': return { op: 'ls_load', slot: int(args[0]) };
    case 'loadsave_test_slot': return { op: 'ls_test', slot: int(args[0]), show: args[1], hide: args[2] };
    case 'loadsave_draw_slot':
      return { op: 'ls_draw', slot: int(args[0]), face: int(args[1]), x: int(args[2]), y: int(args[3]) };
    case 'loadsave_set_context_label': return { op: 'ls_label', label: args[0] };
    case 'changecurseur': return { op: 'scheduletest', idx: int(args[0]) };
    case 'starttimer': return { op: 'timer_start', seconds: float(args[0]), show: args.length < 2 || int(args[1]) !== 0 };
    case 'pausetimer': return { op: 'timer_pause', pause: int(args[0]) !== 0, deactivate: int(args[1]) !== 0 };
    case 'killtimer': return { op: 'timer_kill' };
    case 'afficheimage': return { op: 'overlay_show', image: args[0], x: int(args[1]), y: int(args[2]) };
    case 'stopaffiche': return { op: 'overlay_hide' };
    case 'waves': return { op: 'waves' };
    case 'startcible': return { op: 'cible_start', name: args[0], period: int(args[1]), bounds: args.slice(2).map(int) };
    case 'stopcible': return { op: 'cible_stop' };
    case 'testcible': return { op: 'cible_test', inside: args[0], outside: args[1] };
    case 'exedemo': return { op: 'set', var: args[0], value: 1 };   // the full game answers "yes", like ScummVM
    default: return { op: 'unknown_plugin', name, args, line: lineno };
  }
}

class ScriptV1 {
  vars: string[] = [];
  warps: Warp[] = [];
  warnings: string[] = [];
  private warp: Warp | null = null;
  private test: Test | null = null;
  private plugin: Cmd | null = null;
  private cond: Cmd | null = null;

  parseLine(line: string, lineno: number) {
    if (!line) return;
    const p = new Parser(line, lineno);
    if (p.atEnd()) return;
    if (p.maybeChar('[')) {
      if (p.maybe('bool]=') || p.maybe('bool)=') || p.maybe('b\x00\x00ool]=')) this.vars.push(p.nextWord());
      else if (p.maybe('warp]=')) {
        const vr = p.nextWord();
        const test = p.maybeChar(',') ? p.nextWord() : '';
        this.warp = { vr, test, tests: [] };
        this.warps.push(this.warp);
      } else if (p.maybe('test]=')) {
        if (!this.warp) throw new Error(`test without warp at line ${lineno}`);
        const idx = p.nextInt();
        const hover = p.maybeChar(',') ? p.nextInt() : 0;
        this.test = { idx, hover, labels: {}, cmds: [] };
        this.warp.tests.push(this.test);
      } else throw new Error(`invalid [] directive on line ${lineno}: ${line}`);
      return;
    }
    if (!this.test) throw new Error(`invalid directive at line ${lineno}: ${line}`);
    const cmds = this.test.cmds;
    const add = (c: Cmd) => {
      if (this.cond) { this.cond.then = c; cmds.push(this.cond); this.cond = null; } else cmds.push(c);
    };
    if (p.maybe('ifand=') || p.maybe('ifand')) this.cond = { op: 'ifand', vars: p.readStringList() };
    else if (p.maybe('ifor=') || p.maybe('ifor')) this.cond = { op: 'ifor', vars: p.readStringList() };
    else if (p.maybe('plugin')) {
      if (this.plugin) throw new Error(`nested plugin at line ${lineno}`);
      this.plugin = { op: 'block', cmds: [] };
    } else if (p.maybe('endplugin')) {
      if (!this.plugin) throw new Error(`endplugin without plugin at line ${lineno}`);
      add(this.plugin);
      this.plugin = null;
    } else if (p.maybe('label')) this.test.labels[p.nextWord().toLowerCase()] = cmds.length;
    else if (this.plugin) {
      const name = p.nextWord();
      p.expect('(');
      const args = p.readStringList();
      p.expect(')');
      this.plugin.cmds.push(pluginCommand(name, args, lineno));
    } else {
      const cmd = parseCommand(p);
      if (!cmd) { this.warnings.push(`line ${lineno}: unhandled command: ${line.trim()}`); return; }
      add(cmd);
    }
  }
}

function splitLines(text: string) {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    const cr = text.indexOf('\r', i), lf = text.indexOf('\n', i);
    let end: number;
    if (cr >= 0 && lf >= 0) end = cr + 1 === lf ? lf : Math.min(cr, lf);
    else if (cr >= 0) end = cr;
    else if (lf >= 0) end = lf;
    else end = text.length;
    out.push(rstrip(text.slice(i, end)));
    i = end + 1;
  }
  return out;
}

// Python's cp1252 codec turns the five unmapped bytes into U+FFFD; WHATWG maps them to C1 controls.
const decodeCp1252 = (raw: Uint8Array) =>
  new TextDecoder('windows-1252').decode(raw).replace(/[\x81\x8d\x8f\x90\x9d]/g, '\ufffd');

export function parseLst(raw: Uint8Array): { script: Script; warnings: string[] } {
  const s = new ScriptV1();
  splitLines(decodeCp1252(raw)).forEach((line, i) => s.parseLine(line, i + 1));
  return { script: { vars: s.vars, warps: s.warps }, warnings: s.warnings };
}
