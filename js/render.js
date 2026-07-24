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
out vec4 frag;
void main(){
  vec3 rc = normalize(vec3(vNdc.x * uTan.x, vNdc.y * uTan.y, -1.0));
  vec3 rw = uInvRot * rc;                 // ENU direction, rw.z = sin(elevation)
  float z = rw.z;
  vec3 c;
  if (z >= 0.0) c = mix(uHorizon, uZenith, pow(min(z * 1.35, 1.0), 0.6));
  else          c = mix(uHorizon, uHaze,   pow(min(-z * 4.0, 1.0), 0.7));
  frag = vec4(c, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;      // local ENU metres, z already curvature-dropped
layout(location=1) in vec3 aNrm;
uniform mat4 uMVP;
uniform float uFcoef;                 // 2 / log2(far + 1)
out vec3 vPos;
out vec3 vNrm;
out float vLogZ;
void main(){
  vPos = aPos; vNrm = aNrm;
  gl_Position = uMVP * vec4(aPos, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNrm;
in float vLogZ;

uniform vec3  uSun;          // unit vector toward the sun, ENU
uniform float uCamAlt;       // aircraft altitude, m MSL
uniform float uFar;
uniform float uFcoef;
uniform vec3  uHorizon;      // haze colour terrain fades into
uniform vec2  uGeoScale;     // metres per degree: (lon, lat)
uniform vec2  uGeoOrigin;    // (lon0, lat0) of the mesh origin
uniform float uGrid;         // grid spacing in degrees, 0 = off
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
  float d  = length(vPos.xy);
  float elev = vPos.z + (d*d)/(2.0*R_EARTH);      // undo the curvature drop
  vec3 n = normalize(vNrm);

  bool peak = uStyle > 0.5;
  vec3 base = peak ? relief(elev) : hypso(elev);

  // --- TAWS bands, relative to the aircraft ------------------------------
  if (uTaws > 0.5) {
    float rel = elev - uRefAlt;
    if (rel > -30.0)        base = mix(base, vec3(0.78,0.10,0.10), 0.80);  // < 100 ft below
    else if (rel > -305.0)  base = mix(base, vec3(0.85,0.72,0.08), 0.70);  // < 1000 ft below
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

  // --- lat/lon reference grid --------------------------------------------
  if (uGrid > 0.0) {
    vec2 ll = uGeoOrigin + vec2(vPos.x / uGeoScale.x, vPos.y / uGeoScale.y);
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
  c = mix(c, uHorizon, clamp(fog, 0.0, 1.0));

  frag = vec4(c, 1.0);
  // Logarithmic depth: keeps 60 m foreground and 45 km ridges both crisp even
  // on a 16-bit depth buffer.
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

    this.vao = gl.createVertexArray();
    this.vboPos = gl.createBuffer();
    this.vboNrm = gl.createBuffer();
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
      aviation: { zenith: [0.13, 0.30, 0.62], horizon: [0.62, 0.74, 0.86], haze: [0.30, 0.33, 0.33] },
      relief:   { zenith: [0.36, 0.55, 0.78], horizon: [0.85, 0.89, 0.93], haze: [0.80, 0.85, 0.89] },
    };
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

  /** Upload a rebuilt TerrainMesh. */
  upload(mesh, topologyChanged) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboNrm);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    if (topologyChanged || !this.indexCount) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      this.indexCount = mesh.indices.length;
      this.indexType = mesh.indices.BYTES_PER_ELEMENT === 4
        ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    gl.bindVertexArray(null);
  }

  /**
   * Project a point in the mesh's local ENU frame to CSS pixels, using the MVP
   * from the last draw(). Returns {x, y, dist, visible}. visible is false when
   * the point is behind the camera.
   */
  project(x, y, z, out) {
    out = out || {};
    const m = this.mvp;
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    if (!this.indexCount) return;

    const az = this.sunAzDeg * DEG, el = this.sunElDeg * DEG;
    gl.useProgram(this.terProg);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.terU['uMVP'], false, this.mvp);
    gl.uniform3f(this.terU['uSun'],
      Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
    gl.uniform1f(this.terU['uCamAlt'], state.eye[2]);
    gl.uniform1f(this.terU['uRefAlt'], state.refAlt);
    gl.uniform1f(this.terU['uFar'], far);
    gl.uniform1f(this.terU['uFcoef'], fcoef);
    gl.uniform1f(this.terU['uTaws'], this.taws ? 1 : 0);
    gl.uniform1f(this.terU['uStyle'], this.style === 'relief' ? 1 : 0);
    gl.uniform1f(this.terU['uGrid'], this.grid);
    gl.uniform3fv(this.terU['uHorizon'], this.sky.horizon);
    gl.uniform2f(this.terU['uGeoScale'], geo.mLon, geo.mLat);
    gl.uniform2f(this.terU['uGeoOrigin'], geo.lon0, geo.lat0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    gl.bindVertexArray(null);
  }
}
