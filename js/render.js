// render.js — WebGL2 renderer: sky dome + shaded terrain mesh.
//
// The look is modelled on Garmin SVT: hypsometric base tint by absolute
// elevation, cartographic hillshade from a fixed north-west sun, a lat/lon
// reference grid that recedes into haze, and TAWS colouring (yellow/red) driven
// by terrain height *relative to the aircraft*.
//
// PORTABILITY: the two shaders below are the spec for the ESP32 software
// rasteriser — `terrainColor()` is per-fragment here but becomes per-triangle
// (flat shaded) there, which is why it only depends on values a triangle
// centroid already has: elevation, normal, distance.

import { mat4, perspective, multiply, viewMatrix, viewRotationInverse, DEG } from './geo.js';

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main(){
  // Fullscreen triangle, no vertex buffer needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.999999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat3 uInvRot;
uniform vec2 uTan;          // tan(fov/2)*aspect, tan(fov/2)
uniform vec3 uZenith, uHorizon, uHaze;
uniform vec3 uSun;
out vec4 frag;
void main(){
  vec3 rc = normalize(vec3(vNdc.x * uTan.x, vNdc.y * uTan.y, -1.0));
  vec3 rw = uInvRot * rc;                 // ENU direction, rw.z = sin(elevation)
  float z = rw.z;
  vec3 c;
  if (z >= 0.0) c = mix(uHorizon, uZenith, pow(min(z * 1.35, 1.0), 0.6));
  else          c = mix(uHorizon, uHaze,   pow(min(-z * 4.0, 1.0), 0.7));

  // Sun: a small disc plus the broad forward-scattered glow around it. Gives
  // the sky somewhere to come from, and makes the terrain's lighting direction
  // readable instead of arbitrary.
  float sd = max(dot(rw, uSun), 0.0);
  c += vec3(1.00, 0.94, 0.80) * pow(sd, 1400.0) * 1.6;
  c += vec3(1.00, 0.88, 0.68) * pow(sd, 9.0) * 0.16;

  frag = vec4(c, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;      // world ENU metres from the mesh base, z = true MSL
layout(location=1) in vec3 aNrm;
layout(location=2) in float aAo;      // height above the local smoothed terrain
layout(location=3) in float aSkirt;   // LOD-seam skirt drop, 0 on real terrain
layout(location=4) in float aWater;   // 1 where the surface is a water body
uniform mat4 uMVP;
uniform vec3 uEye;                    // aircraft position in the same frame
out vec2 vWorld;
out vec3 vNrm;
out float vElev;
out float vAo;
out float vDist;
out float vWater;
out float vLogZ;
void main(){
  // Earth curvature is applied here, relative to the eye, so the mesh itself is
  // viewpoint-independent and each clipmap level stays valid as we move.
  vec2 d = aPos.xy - uEye.xy;
  float dist = length(d);
  // vElev is the SURFACE elevation even for skirt vertices, so a skirt shades
  // exactly like the terrain it hangs from and disappears if it pokes through.
  vWorld = aPos.xy; vNrm = aNrm; vAo = aAo; vElev = aPos.z; vDist = dist; vWater = aWater;
  gl_Position = uMVP * vec4(aPos.xy, aPos.z - aSkirt - dot(d, d) / 12742017.6, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 vWorld;
in vec3 vNrm;
in float vElev;
in float vAo;
in float vDist;
in float vWater;
in float vLogZ;

uniform vec3  uSun;          // unit vector toward the sun, ENU
uniform vec3  uEye;          // aircraft position, mesh frame
uniform float uCamAlt;       // aircraft altitude, m MSL
uniform float uFar;
uniform float uFcoef;
uniform vec3  uHorizon;      // haze colour terrain fades into
uniform vec2  uGeoScale;     // metres per degree: (lon, lat)
uniform vec2  uGeoOrigin;    // (lon0, lat0) of the mesh origin
uniform float uGrid;         // grid spacing in degrees, 0 = off
uniform float uWire;         // SVT terrain lattice spacing in degrees, 0 = off
uniform float uTaws;         // 0 = plain relief, 1 = TAWS colouring
uniform float uRefAlt;       // altitude the TAWS bands are measured from
uniform float uStyle;        // 0 = aviation hypsometric, 1 = PeakFinder relief

out vec4 frag;

const float R_EARTH = 6371008.8;

// Soft, desaturated matte ramp — the PeakFinder look: tan lowlands through grey
// rock to snow, no saturated colour, form carried almost entirely by shading.
vec3 relief(float h){
  vec3 c;
  if      (h <  700.0) c = mix(vec3(0.46,0.47,0.41), vec3(0.55,0.53,0.46), h/700.0);
  else if (h < 1500.0) c = mix(vec3(0.55,0.53,0.46), vec3(0.63,0.60,0.55), (h-700.0)/800.0);
  else if (h < 2400.0) c = mix(vec3(0.63,0.60,0.55), vec3(0.71,0.69,0.66), (h-1500.0)/900.0);
  else if (h < 3300.0) c = mix(vec3(0.71,0.69,0.66), vec3(0.80,0.79,0.78), (h-2400.0)/900.0);
  else                 c = mix(vec3(0.80,0.79,0.78), vec3(0.90,0.90,0.90),
                               clamp((h-3300.0)/1300.0, 0.0, 1.0));  // snow: light grey, not blown white
  return c;
}

// Aeronautical-chart hypsometric ramp.
vec3 hypso(float h){
  vec3 c;
  if      (h <  200.0) c = mix(vec3(0.16,0.34,0.19), vec3(0.26,0.44,0.20), h/200.0);
  else if (h <  600.0) c = mix(vec3(0.26,0.44,0.20), vec3(0.45,0.50,0.24), (h-200.0)/400.0);
  else if (h < 1100.0) c = mix(vec3(0.45,0.50,0.24), vec3(0.60,0.51,0.30), (h-600.0)/500.0);
  else if (h < 1700.0) c = mix(vec3(0.60,0.51,0.30), vec3(0.58,0.42,0.27), (h-1100.0)/600.0);
  else if (h < 2400.0) c = mix(vec3(0.58,0.42,0.27), vec3(0.50,0.38,0.32), (h-1700.0)/700.0);
  else if (h < 3200.0) c = mix(vec3(0.50,0.38,0.32), vec3(0.62,0.60,0.60), (h-2400.0)/800.0);
  else                 c = mix(vec3(0.62,0.60,0.60), vec3(0.92,0.93,0.95),
                               clamp((h-3200.0)/1300.0, 0.0, 1.0));
  return c;
}

void main(){
  float d = vDist;
  float elev = vElev;
  vec3 n = normalize(vNrm);

  bool peak = uStyle > 0.5;
  vec3 base = peak ? relief(elev) : hypso(elev);

  // Lakes and reservoirs, flagged by the mesh where the surface is exactly
  // level. Blended, so shorelines fade instead of showing a hard polygon edge.
  float w = smoothstep(0.35, 0.80, vWater);

  // Steep ground is bare rock: pulling colour toward grey on the steep faces
  // breaks up the flat elevation bands and reads far more like real terrain.
  float slope = 1.0 - clamp(n.z, 0.0, 1.0);
  base = mix(base, mix(base, vec3(0.44, 0.42, 0.41), 0.55),
             smoothstep(0.30, 0.78, slope) * (1.0 - w));

  // Ambient occlusion from the ridge/valley measure: valleys sink into shadow,
  // spurs catch light. This is most of the perceived depth. Water is a mirror,
  // not a surface with relief, so it opts out.
  float ao = clamp(vAo, -1.0, 1.0);          // already normalised, ring-invariant
  base *= 1.0 + (0.18 * ao - 0.14 * max(-ao, 0.0)) * (1.0 - w);

  base = mix(base, peak ? vec3(0.50, 0.57, 0.64) : vec3(0.11, 0.24, 0.39), w);

  // --- TAWS bands, relative to the aircraft ------------------------------
  // Tint rather than replace: Garmin/Dynon keep the hillshade readable through
  // the caution/warning colour, so you can still see the shape of the threat.
  if (uTaws > 0.5) {
    float rel = elev - uRefAlt;
    if (rel > -30.0)        base = mix(base, vec3(0.72,0.11,0.11), 0.62);  // < 100 ft below
    else if (rel > -305.0)  base = mix(base, vec3(0.80,0.68,0.10), 0.50);  // < 1000 ft below
  }

  // --- shading ------------------------------------------------------------
  float lam  = max(dot(n, uSun), 0.0);
  float sky  = 0.5 + 0.5 * n.z;                    // ambient sky occlusion-ish
  vec3 c;
  if (peak) {
    // Matte, no specular, but enough directional contrast + gentle slope
    // shadowing that ridges and valleys read the way PeakFinder renders them.
    float ao = 0.84 + 0.16 * n.z;                  // steep faces a little darker
    c = base * ((0.46 + 0.58 * lam) * ao + 0.06 * sky);
  } else {
    c = base * (0.30 * sky + 0.85 * lam);
    // Sharpen ridges a little: rim highlight on slopes facing the sun edge-on.
    c += base * 0.12 * pow(1.0 - abs(n.z), 3.0);
  }

  // --- water surface ------------------------------------------------------
  // Water gets brighter and skyward-tinted at grazing angles (Fresnel) plus a
  // tight sun glint, which is what makes it read as water rather than a flat
  // grey polygon lying on the ground.
  if (w > 0.0) {
    vec3 V = normalize(vec3(uEye.xy - vWorld, uEye.z - elev));
    float fres = pow(1.0 - clamp(V.z, 0.0, 1.0), 4.0);
    vec3 skyRefl = peak ? uHorizon : mix(uHorizon, vec3(0.32, 0.52, 0.82), 0.45);
    c = mix(c, skyRefl, (0.28 + 0.55 * fres) * w);
    vec3 H = normalize(uSun + V);
    c += vec3(pow(max(H.z, 0.0), 180.0) * 0.85 * w);
  }

  // --- SVT terrain lattice -----------------------------------------------
  // The fine dark mesh Garmin/Dynon draw over synthetic terrain: it's what
  // makes slope and distance readable on an otherwise flat-shaded surface.
  if (uWire > 0.0) {
    vec2 ll = uGeoOrigin + vec2(vWorld.x / uGeoScale.x, vWorld.y / uGeoScale.y);
    vec2 g  = ll / uWire;
    vec2 w  = fwidth(g);
    vec2 f  = abs(fract(g - 0.5) - 0.5) / max(w, vec2(1e-6));
    float line = 1.0 - min(min(f.x, f.y), 1.0);
    line *= smoothstep(1.9, 0.8, max(w.x, w.y));   // fade out before it aliases
    c *= mix(1.0, 0.66, line * 0.85);
  }

  // --- lat/lon reference grid --------------------------------------------
  if (uGrid > 0.0) {
    vec2 ll = uGeoOrigin + vec2(vWorld.x / uGeoScale.x, vWorld.y / uGeoScale.y);
    vec2 g  = ll / uGrid;
    vec2 w  = fwidth(g);
    vec2 f  = abs(fract(g - 0.5) - 0.5) / max(w, vec2(1e-6));
    float line = 1.0 - min(min(f.x, f.y), 1.0);
    line *= smoothstep(1.6, 0.7, max(w.x, w.y));   // drop out when it would alias
    c = mix(c, c * 0.55 + vec3(0.25), line * 0.5);
  }

  // --- distance haze ------------------------------------------------------
  // Stronger, earlier haze in relief mode gives the signature stacked pale
  // ridgelines receding into the sky.
  float fDist  = peak ? 0.46 : 0.62;
  float fCurve = peak ? 1.5  : 2.2;
  float fog = 1.0 - exp(-pow(d / (uFar * fDist), fCurve));
  // Haze scatters forward, so distance looking toward the sun is brighter and
  // warmer than distance looking away — the cue that sells depth in real air.
  vec3 Vf = normalize(vec3(vWorld - uEye.xy, elev - uEye.z));
  float toSun = max(dot(Vf, uSun), 0.0);
  vec3 hazeCol = mix(uHorizon, uHorizon * vec3(1.16, 1.10, 0.98) + 0.05,
                     pow(toSun, 6.0) * 0.75);
  c = mix(c, hazeCol, clamp(fog, 0.0, 1.0));

  // A touch of ordered noise: the elevation ramp and the haze both produce wide
  // smooth gradients, which band badly on 8-bit displays.
  float dith = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (dith - 0.5) * (1.0 / 255.0);

  frag = vec4(c, 1.0);
  // Logarithmic depth: keeps 60 m foreground and 45 km ridges both crisp even
  // on a 16-bit depth buffer.
  gl_FragDepth = log2(vLogZ) * uFcoef * 0.5;
}`;

// Flat-coloured geometry laid on the terrain (runways). Shares the terrain's
// logarithmic depth and haze so it sits in the scene correctly.
const OVL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
uniform mat4 uMVP;
uniform vec2 uEyeXY;
out vec4 vCol;
out float vLogZ;
out float vDist;
void main(){
  vec2 d = aPos.xy - uEyeXY;
  vDist = length(d);
  gl_Position = uMVP * vec4(aPos.xy, aPos.z - dot(d, d) / 12742017.6, 1.0);
  vLogZ = 1.0 + gl_Position.w;
  vCol = aCol;
}`;

const OVL_FS = `#version 300 es
precision highp float;
in vec4 vCol;
in float vLogZ;
in float vDist;
uniform float uFcoef;
uniform float uFar;
uniform vec3 uHorizon;
out vec4 frag;
void main(){
  float fog = 1.0 - exp(-pow(vDist / (uFar * 0.62), 2.2));
  frag = vec4(mix(vCol.rgb, uHorizon, clamp(fog, 0.0, 1.0)), vCol.a);
  gl_FragDepth = log2(vLogZ) * uFcoef * 0.5;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function uniforms(gl, p) {
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return u;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, depth: true, alpha: false, powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 unavailable — needs iOS 15+ / a modern browser.');
    this.gl = gl; this.canvas = canvas;

    this.skyProg = link(gl, SKY_VS, SKY_FS);
    this.skyU = uniforms(gl, this.skyProg);
    this.terProg = link(gl, TERRAIN_VS, TERRAIN_FS);
    this.terU = uniforms(gl, this.terProg);
    this.ovlProg = link(gl, OVL_VS, OVL_FS);
    this.ovlU = uniforms(gl, this.ovlProg);

    // Runway overlay: interleaved pos(3) + rgba(4).
    this.ovlVao = gl.createVertexArray();
    this.ovlVbo = gl.createBuffer();
    gl.bindVertexArray(this.ovlVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ovlVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    this.ovlTriCount = 0;
    this.ovlLineStart = 0;
    this.ovlLineCount = 0;

    this.vao = gl.createVertexArray();
    this.vboPos = gl.createBuffer();
    this.vboNrm = gl.createBuffer();
    this.vboAo = gl.createBuffer();
    this.vboSkirt = gl.createBuffer();
    this.vboWater = gl.createBuffer();
    this.ibo = gl.createBuffer();
    this.indexCount = 0;
    this.indexType = gl.UNSIGNED_SHORT;

    this.proj = mat4(); this.view = mat4(); this.mvp = mat4();
    this.invRot = new Float32Array(9);
    this.emptyVao = gl.createVertexArray();

    this.fovDeg = 60;
    this.grid = 0.01;
    this.taws = true;
    this.sunAzDeg = 315; this.sunElDeg = 42;

    // Two looks. 'relief' is the PeakFinder-style pale, hazy panorama; sky
    // colours change with it so distant ridges fade into a matching horizon.
    this.palettes = {
      // Deeper, more saturated blue and a hazier blue-grey terrain fade: the
      // Garmin SVT / Dynon SynVis sky.
      aviation: { zenith: [0.04, 0.19, 0.55], horizon: [0.44, 0.63, 0.85], haze: [0.50, 0.57, 0.62] },
      relief:   { zenith: [0.36, 0.55, 0.78], horizon: [0.85, 0.89, 0.93], haze: [0.80, 0.85, 0.89] },
    };
    this.wire = 0;
    this.style = 'relief';
    this.sky = this.palettes.relief;

    gl.disable(gl.CULL_FACE);            // heightfield: never cull, avoids holes
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  /** Switch visual style ('relief' | 'aviation'); also swaps the sky palette. */
  setStyle(style) {
    this.style = style;
    this.sky = this.palettes[style] || this.palettes.relief;
  }

  /**
   * Upload runway overlay geometry: `tris` then `lines`, each a flat array of
   * [x,y,z, r,g,b,a] per vertex in the mesh's local ENU frame.
   */
  setOverlay(tris, lines) {
    const gl = this.gl;
    const n = tris.length + lines.length;
    this.ovlTriCount = tris.length / 7;
    this.ovlLineStart = this.ovlTriCount;
    this.ovlLineCount = lines.length / 7;
    if (!n) return;
    const buf = new Float32Array(n);
    buf.set(tris, 0); buf.set(lines, tris.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ovlVbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
  }

  /**
   * Upload a rebuilt TerrainMesh. Storage is allocated once and refilled with
   * bufferSubData afterwards — bufferData reallocates the whole store every
   * call, which is ~650 kB of churn per rebuild for no reason.
   */
  upload(mesh, topologyChanged) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    const alloc = topologyChanged || !this._allocated;
    const put = (vbo, arr, loc, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      if (alloc) {
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      }
    };
    put(this.vboPos, mesh.positions, 0, 3);
    put(this.vboNrm, mesh.normals, 1, 3);
    put(this.vboAo, mesh.ao, 2, 1);
    put(this.vboSkirt, mesh.skirt, 3, 1);
    put(this.vboWater, mesh.water, 4, 1);
    if (alloc) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      this.indexCount = mesh.indices.length;
      this.indexType = mesh.indices.BYTES_PER_ELEMENT === 4
        ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    this._allocated = true;
    gl.bindVertexArray(null);
  }

  /**
   * Project a point in the mesh's world frame to CSS pixels, using the MVP from
   * the last draw(). Returns {x, y, visible}; visible is false behind the eye.
   */
  project(x, y, z, out) {
    out = out || {};
    const m = this.mvp;
    // Mirror the vertex shader's eye-relative curvature drop, or labels drift
    // off their features at range.
    const dx = x - this._eyeX, dy = y - this._eyeY;
    z -= (dx * dx + dy * dy) / 12742017.6;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1) { out.visible = false; return out; }
    out.x = (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (0.5 - cy / cw * 0.5) * this.canvas.clientHeight;
    out.w = cw;
    out.visible = true;
    return out;
  }

  resize(dpr) {
    const c = this.canvas;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c.clientWidth / Math.max(c.clientHeight, 1);
  }

  /**
   * @param state {eye:[x,y,z], heading, pitch, roll, refAlt}
   *              eye is in the mesh's local ENU frame.
   * @param geo   {lat0, lon0, mLat, mLon} of the mesh origin
   */
  draw(state, geo, far) {
    const gl = this.gl;
    const aspect = this.resize(Math.min(devicePixelRatio || 1, 2));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    const fov = this.fovDeg * DEG;
    perspective(this.proj, fov, aspect, 20, far * 1.3);
    this._eyeX = state.eye[0]; this._eyeY = state.eye[1];
    viewMatrix(this.view, state.eye, state.heading, state.pitch, state.roll);
    multiply(this.mvp, this.proj, this.view);
    viewRotationInverse(this.invRot, this.view);
    const fcoef = 2 / Math.log2(far * 1.3 + 1);

    gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.skyProg);
    gl.bindVertexArray(this.emptyVao);
    gl.uniformMatrix3fv(this.skyU['uInvRot'], false, this.invRot);
    const t = Math.tan(fov / 2);
    gl.uniform2f(this.skyU['uTan'], t * aspect, t);
    gl.uniform3fv(this.skyU['uZenith'], this.sky.zenith);
    gl.uniform3fv(this.skyU['uHorizon'], this.sky.horizon);
    gl.uniform3fv(this.skyU['uHaze'], this.sky.haze);
    const saz = this.sunAzDeg * DEG, sel = this.sunElDeg * DEG;
    gl.uniform3f(this.skyU['uSun'],
      Math.sin(saz) * Math.cos(sel), Math.cos(saz) * Math.cos(sel), Math.sin(sel));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    if (!this.indexCount) return;

    const az = this.sunAzDeg * DEG, el = this.sunElDeg * DEG;
    gl.useProgram(this.terProg);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.terU['uMVP'], false, this.mvp);
    gl.uniform3f(this.terU['uEye'], state.eye[0], state.eye[1], state.eye[2]);
    gl.uniform3f(this.terU['uSun'],
      Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
    gl.uniform1f(this.terU['uCamAlt'], state.eye[2]);
    gl.uniform1f(this.terU['uRefAlt'], state.refAlt);
    gl.uniform1f(this.terU['uFar'], far);
    gl.uniform1f(this.terU['uFcoef'], fcoef);
    gl.uniform1f(this.terU['uTaws'], this.taws ? 1 : 0);
    gl.uniform1f(this.terU['uStyle'], this.style === 'relief' ? 1 : 0);
    gl.uniform1f(this.terU['uGrid'], this.grid);
    gl.uniform1f(this.terU['uWire'], this.wire);
    gl.uniform3fv(this.terU['uHorizon'], this.sky.horizon);
    gl.uniform2f(this.terU['uGeoScale'], geo.mLon, geo.mLat);
    gl.uniform2f(this.terU['uGeoOrigin'], geo.lon0, geo.lat0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);

    // Runways, laid on top of the terrain.
    if (this.ovlTriCount || this.ovlLineCount) {
      gl.useProgram(this.ovlProg);
      gl.bindVertexArray(this.ovlVao);
      gl.uniformMatrix4fv(this.ovlU['uMVP'], false, this.mvp);
      gl.uniform2f(this.ovlU['uEyeXY'], state.eye[0], state.eye[1]);
      gl.uniform1f(this.ovlU['uFcoef'], fcoef);
      gl.uniform1f(this.ovlU['uFar'], far);
      gl.uniform3fv(this.ovlU['uHorizon'], this.sky.horizon);
      if (this.ovlTriCount) gl.drawArrays(gl.TRIANGLES, 0, this.ovlTriCount);
      if (this.ovlLineCount) gl.drawArrays(gl.LINES, this.ovlLineStart, this.ovlLineCount);
    }
    gl.bindVertexArray(null);
  }
}
