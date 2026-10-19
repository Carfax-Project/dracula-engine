// Panorama fragment shader: samples the 6 cube faces along the interpolated ray.

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec3 vDir;
varying float vLy;
uniform sampler2D f0, f1, f2, f3, f4, f5;
uniform vec3 uIncYf;
uniform float uWaveT;   // < 0: no waves
uniform float uXScale;  // Dracula 2 skips the last pixel column of each face

void main(){
  vec3 r = vDir;
  if (uWaveT >= 0.0) {
    float s = sin(floor(vLy) * 0.039269909 + uWaveT * 0.4);
    float off = floor(abs(s * 3.0)) * -sign(s);
    r -= uIncYf * off;
  }
  float ax = abs(r.x), ay = abs(r.y), az = abs(r.z);
  float m = 1.0, cx = 0.0, cy = 0.0; int face = 0;
  if (r.x > 0.0 && ax >= ay && ax >= az) { m = ax; cx = r.y; cy = r.z; face = 4; }
  if (!(r.x > 0.0) && ax >= ay && ax >= az) { m = ax; cx = -r.y; cy = r.z; face = 5; }
  if (r.y > 0.0 && ay >= ax && ay >= az) { m = ay; cx = -r.x; cy = r.z; face = 3; }
  if (!(r.y > 0.0) && ay >= ax && ay >= az) { m = ay; cx = r.x; cy = r.z; face = 1; }
  if (r.z > 0.0 && az >= ax && az >= ay) { m = az; cx = r.y; cy = -r.x; face = 0; }
  if (!(r.z > 0.0) && az >= ax && az >= ay) { m = az; cx = r.y; cy = r.x; face = 2; }
  vec2 uv = clamp(vec2(0.5 * (cx / m + 1.0) * uXScale, 0.5 * (cy / m + 1.0)), vec2(0.5/512.0), vec2(1.0 - 0.5/512.0));
  vec4 c;
  if (face == 0) c = texture2D(f0, uv);
  else if (face == 1) c = texture2D(f1, uv);
  else if (face == 2) c = texture2D(f2, uv);
  else if (face == 3) c = texture2D(f3, uv);
  else if (face == 4) c = texture2D(f4, uv);
  else c = texture2D(f5, uv);
  gl_FragColor = vec4(c.rgb, 1.0);
}
