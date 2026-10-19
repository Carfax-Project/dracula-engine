/* 360° panorama in WebGL: 6 cube faces, with the camera the original scenes expect.
 * The shaders live in ./shaders/*.glsl and are inlined at build time (esbuild's
 * text loader), so they stay plain GLSL that an editor can highlight. */
import FS from './shaders/panorama.frag.glsl';
import VS from './shaders/panorama.vert.glsl';
import { clamp, H, TAU, W } from './util';

export interface Camera { start: number[]; incX: number[]; incY: number[] }

export class PanoramaRenderer {
  private gl: WebGLRenderingContext;
  private tex: WebGLTexture[] = [];
  private u: Record<string, WebGLUniformLocation | null>;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < 6; ++i) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
      gl.uniform1i(gl.getUniformLocation(prog, 'f' + i), i);
      this.tex.push(t);
    }
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);   // constant for the life of the program
    const names = { start: 'uStart', incX: 'uIncX', incY: 'uIncY', incYf: 'uIncYf', waveT: 'uWaveT', xScale: 'uXScale' };
    this.u = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, gl.getUniformLocation(prog, n)]));
  }
  upload(i: number, src: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  }
  draw(cam: Camera, waveT = -1, xScale = 1) {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.uniform3fv(this.u.start, cam.start);
    gl.uniform3fv(this.u.incX, cam.incX);
    gl.uniform3fv(this.u.incY, cam.incY);
    gl.uniform3fv(this.u.incYf, cam.incY);
    gl.uniform1f(this.u.waveT, waveT);
    gl.uniform1f(this.u.xScale, xScale);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

export function camera(ax: number, ay: number, fov: number): Camera {
  const f = [Math.cos(ax) * Math.sin(-ay), Math.sin(ax) * Math.sin(-ay), Math.cos(-ay)];
  const fl = Math.hypot(f[0], f[1], f[2]);
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const r = [-f[1], f[0], 0];
  const rl = Math.hypot(r[0], r[1]) || 1;
  r[0] /= rl; r[1] /= rl;
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const gx = Math.tan(fov / 2), gy = gx * H / W;
  const incX = r.map((v) => v * 2 * gx / W);
  const incY = u.map((v) => v * 2 * gy / H);
  const start = [0, 1, 2].map((i) => f[i] - r[i] * gx - u[i] * gy);
  return { start, incX, incY };
}

export function rayAngles(cam: Camera, lx: number, ly: number): [number, number] {
  const d = [0, 1, 2].map((i) => cam.start[i] + cam.incX[i] * lx + cam.incY[i] * ly);
  const len = Math.hypot(d[0], d[1], d[2]);
  let yaw = Math.atan2(d[1], d[0]);
  if (yaw < 0) yaw += TAU;
  const pitch = Math.acos(clamp(d[2] / len, -1, 1));
  return [yaw, pitch];
}
