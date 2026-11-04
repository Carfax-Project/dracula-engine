// Panorama vertex shader.
//
// The view ray is computed per vertex (always full float precision) and
// interpolated: it is linear in screen space, so this is exact. Computing it per
// pixel in the fragment shader breaks on GPUs that run fragment math at half
// precision (a black area right of x~102). Don't move it there.

attribute vec2 p;
uniform vec3 uStart, uIncX, uIncY;
uniform vec2 uRes;      // logical view size: 480 high, as wide as the camera
varying vec3 vDir;
varying float vLy;

void main(){
  float lx = (p.x * 0.5 + 0.5) * uRes.x;
  float ly = (0.5 - p.y * 0.5) * uRes.y;
  vDir = uStart + uIncX * lx + uIncY * ly;
  vLy = ly;
  gl_Position = vec4(p, 0.0, 1.0);
}
