// main.js — wiring: sensors -> terrain mesh -> renderer + HUD.

import { mPerDegLat, mPerDegLon, clamp } from './geo.js';
import { DemCache } from './dem.js';
import { TerrainMesh, scanAhead } from './mesh.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { NavState, Simulator, GpsSource, DeviceAttitude, PRESETS } from './nav.js';
import { SUMMITS, nearestSummit } from './summits.js';
import { nearbyAirports } from './airports.js';

const $ = id => document.getElementById(id);

// Clipmap terrain: cells per side per level, and finest cell size (m).
const QUALITY = {
  low: { cells: 32, s0: 45 },
  med: { cells: 48, s0: 28 },
  high: { cells: 64, s0: 20 },
};

const cfg = {
  mode: 'sim',            // sim | gps | ar
  range: 45000,
  quality: 'med',
  units: 'aero',
  taws: false,
  grid: false,
  summits: true,
  runways: true,
  fov: 60,
  style: 'aviation',     // 'aviation' (Garmin/Dynon SVT) | 'relief' (PeakFinder-like)
};

const dem = new DemCache();
const state = new NavState();
const sim = new Simulator(state);
const gps = new GpsSource();
const dev = new DeviceAttitude();

let renderer, hud, mesh;
let running = false, lastT = 0;
let rebuildQueued = true, lastTileRebuild = 0;
let alert = 'none', aglNow = NaN, lastScan = 0;
let fps = 0, frames = 0, fpsT = 0;

// ---------------------------------------------------------------------------
// terrain mesh lifecycle
// ---------------------------------------------------------------------------

function makeMesh() {
  const q = QUALITY[cfg.quality];
  mesh = new TerrainMesh(q.cells, q.s0, cfg.range);
  mesh.rebuild(dem, state.lat, state.lon, true);
  renderer.upload(mesh, true);
  rebuildQueued = false;
}

function maybeRebuild() {
  // The mesh is world-anchored, so this is a no-op on most frames: rebuild()
  // only re-samples (and returns true) when a clipmap level's snapped centre
  // moved, or a new DEM tile arrived (rebuildQueued). Between those, the aircraft
  // simply flies through stable terrain.
  const changed = mesh.rebuild(dem, state.lat, state.lon,
                               rebuildQueued || !mesh.origin.valid);
  if (changed) renderer.upload(mesh, false);
  rebuildQueued = false;
}

// New DEM data means the mesh is stale — but don't rebuild more than a few
// times a second while a burst of tiles lands.
dem.onTile = () => {
  const now = performance.now();
  if (now - lastTileRebuild > 250) { lastTileRebuild = now; rebuildQueued = true; }
};

/**
 * Queue exactly the tiles the mesh will sample. Asking the mesh itself (rather
 * than guessing radii per level) keeps the fine levels to their small inner
 * rings — important now that level 0 is ~17 m data.
 */
function preload() {
  return mesh ? mesh.prefetch(dem, state.lat, state.lon) : 0;
}

// ---------------------------------------------------------------------------
// terrain awareness (TAWS-lite)
// ---------------------------------------------------------------------------

function updateAlert() {
  const g = dem.sample(state.lat, state.lon, 0);
  aglNow = g === g ? state.alt - g : NaN;

  if (state.gs < 5 || !isFinite(state.track)) { alert = 'none'; return; }
  const warnR = clamp(state.gs * 30, 800, 15000);
  const cautR = clamp(state.gs * 60, 1500, 30000);
  const w = scanAhead(dem, state.lat, state.lon, state.track, warnR, 500);
  const c = scanAhead(dem, state.lat, state.lon, state.track, cautR, 900);
  if (w.maxElev === w.maxElev && w.maxElev > state.alt - 30) alert = 'warning';
  else if (c.maxElev === c.maxElev && c.maxElev > state.alt - 150) alert = 'caution';
  else alert = 'none';
}

// ---------------------------------------------------------------------------
// frame loop
// ---------------------------------------------------------------------------

function frame(t) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.25) : 0.016;
  lastT = t;

  if (cfg.mode === 'sim') {
    sim.update(dt, dem);
  } else {
    gps.apply(state);
    if (cfg.mode === 'ar') dev.apply(state);
  }

  dem.center.lat = state.lat; dem.center.lon = state.lon;
  maybeRebuild();

  if (t - lastScan > 500) { lastScan = t; updateAlert(); }

  const mLat = mPerDegLat(mesh.origin.lat), mLon = mPerDegLon(mesh.origin.lat);
  const eye = [
    (state.lon - mesh.origin.lon) * mLon,
    (state.lat - mesh.origin.lat) * mLat,
    state.alt,
  ];

  buildRunways(false);

  renderer.taws = cfg.taws;
  renderer.grid = cfg.grid ? gridStepFor(cfg.range) : 0;
  renderer.wire = cfg.style === 'aviation' ? wireStepFor(cfg.range) : 0;
  renderer.fovDeg = cfg.fov;
  renderer.draw({ eye, heading: state.heading, pitch: state.pitch, roll: state.roll,
                  refAlt: state.alt },
                { lat0: mesh.origin.lat, lon0: mesh.origin.lon, mLat, mLon },
                cfg.range);

  const labels = cfg.summits ? summitLabels(eye, mLat, mLon) : null;
  const of = nearestSummit(state.lat, state.lon, 2500);

  hud.units = cfg.units;
  hud.draw(state, {
    fovDeg: cfg.fov, agl: aglNow, alert, labels,
    airports: airportLabels(eye, mLat, mLon),
    zeroPitchHeadings: cfg.style === 'aviation',
    overflying: cfg.summits && of ? of.summit : null,
    status: cfg.mode === 'sim' ? 'SIM'
      : (gps.ok ? (cfg.mode === 'ar' ? 'GPS+IMU' : 'GPS') : 'NO FIX'),
  });

  frames++;
  if (t - fpsT > 1000) { fps = frames * 1000 / (t - fpsT); frames = 0; fpsT = t; updateStatus(); }
}

function gridStepFor(range) {
  return range > 60000 ? 0.1 : range > 25000 ? 0.05 : 0.01;
}

// SVT lattice: finer than the reference grid — roughly a 1-2 km mesh.
function wireStepFor(range) {
  return range > 60000 ? 0.02 : range > 25000 ? 0.01 : 0.005;
}

// Switch the terrain look. Relief (PeakFinder-like) turns the aviation overlays
// off by default for a clean panorama; both stay user-toggleable afterwards.
function applyStyle(s) {
  cfg.style = s;
  renderer.setStyle(s);
  // SVT mode brings the aviation overlays with it; the lat/lon grid stays off
  // because the finer SVT lattice already carries the terrain texture.
  cfg.taws = (s === 'aviation');
  cfg.grid = false;
  $('taws').checked = cfg.taws;
  $('grid').checked = cfg.grid;
  for (const b of document.querySelectorAll('[data-style]'))
    b.classList.toggle('on', b.dataset.style === s);
}

// --- runways drawn on the terrain (Garmin SVT / Dynon SynVis signature) -----

let ovlKey = '';

function buildRunways(force) {
  // Keyed on the aircraft position (the mesh origin is now a fixed world base),
  // rounded to ~1 km so this only regenerates as we actually travel.
  const key = cfg.runways
    ? state.lat.toFixed(2) + ',' + state.lon.toFixed(2) + ',' + cfg.range
    : 'off';
  if (!force && key === ovlKey) return;
  ovlKey = key;

  if (!cfg.runways) { renderer.setOverlay([], []); return; }

  const mLat = mPerDegLat(mesh.origin.lat), mLon = mPerDegLon(mesh.origin.lat);
  const tris = [], lines = [];
  // Runway asphalt, and a bright edge outline so it reads at a distance.
  const SC = [0.16, 0.17, 0.19, 1], EC = [0.94, 0.95, 0.97, 1];

  for (const { a } of nearbyAirports(state.lat, state.lon, Math.min(cfg.range, 45000))) {
    const ex = (a.lo - mesh.origin.lon) * mLon;
    const ey = (a.la - mesh.origin.lat) * mLat;
    // Sit on whichever is higher, the DEM or the published field elevation, so
    // the strip never sinks into a hillside; +6 m keeps it above the mesh.
    let g = dem.sample(a.la, a.lo, 0);
    if (!(g === g)) g = a.e;
    const z = Math.max(g, a.e) + 6;   // curvature is applied in the shader

    for (const r of a.r) {
      const th = r.h * Math.PI / 180;
      const dx = Math.sin(th), dy = Math.cos(th);      // along the runway
      const px = Math.cos(th), py = -Math.sin(th);     // across it
      const hl = r.l / 2, hw = (r.w || 45) / 2;
      const c = [
        [ex + dx * hl + px * hw, ey + dy * hl + py * hw],
        [ex + dx * hl - px * hw, ey + dy * hl - py * hw],
        [ex - dx * hl - px * hw, ey - dy * hl - py * hw],
        [ex - dx * hl + px * hw, ey - dy * hl + py * hw],
      ];
      const V = (p, col) => { tris.push(p[0], p[1], z, col[0], col[1], col[2], col[3]); };
      V(c[0], SC); V(c[1], SC); V(c[2], SC);
      V(c[0], SC); V(c[2], SC); V(c[3], SC);
      for (let i = 0; i < 4; i++) {
        const p = c[i], q = c[(i + 1) % 4];
        lines.push(p[0], p[1], z + 1, ...EC, q[0], q[1], z + 1, ...EC);
      }
      // Centreline.
      lines.push(ex - dx * hl * 0.9, ey - dy * hl * 0.9, z + 1, ...EC,
                 ex + dx * hl * 0.9, ey + dy * hl * 0.9, z + 1, ...EC);
    }
  }
  renderer.setOverlay(tris, lines);
}

function airportLabels(eye, mLat, mLon) {
  if (!cfg.runways) return null;
  const maxR = Math.min(cfg.range, 45000);
  const out = [];
  for (const { a, d } of nearbyAirports(state.lat, state.lon, maxR)) {
    const ex = (a.lo - mesh.origin.lon) * mLon, ey = (a.la - mesh.origin.lat) * mLat;
    let g = dem.sample(a.la, a.lo, 0);
    if (!(g === g)) g = a.e;
    const p = renderer.project(ex, ey, Math.max(g, a.e), {});
    if (!p.visible) continue;
    if (p.x < -30 || p.x > hud.w + 30 || p.y < -20 || p.y > hud.h * 0.95) continue;
    out.push({ c: a.c, d, x: p.x, y: p.y, alpha: clamp(1.25 - d / maxR, 0.4, 1) });
    if (out.length >= 4) break;
  }
  return out;
}

// Project the named summits within range onto their peaks and declutter them.
const _lp = {};
function summitLabels(eye, mLat, mLon) {
  const maxR = Math.min(cfg.range * 1.12, 90000);
  const out = [];
  for (const s of SUMMITS) {
    const ex = (s.lo - mesh.origin.lon) * mLon;
    const ey = (s.la - mesh.origin.lat) * mLat;
    const dx = ex - eye[0], dy = ey - eye[1];
    const d = Math.hypot(dx, dy);
    if (d > maxR || d < 80) continue;
    // Place the label on the apex, curvature-dropped to match the terrain.
    const z = s.e;                    // project() applies the curvature drop
    const p = renderer.project(ex, ey, z, _lp);
    if (!p.visible) continue;
    if (p.x < -30 || p.x > hud.w + 30 || p.y < -20 || p.y > hud.h * 0.9) continue;
    out.push({ n: s.n, e: s.e, d, x: p.x, y: p.y,
               alpha: clamp(1.3 - d / maxR, 0.35, 1) });
  }
  // Nearest first, then greedily drop labels that would stack on screen.
  out.sort((a, b) => a.d - b.d);
  const kept = [], minSep = Math.min(hud.w, hud.h) * 0.11;
  for (const l of out) {
    if (kept.length >= 6) break;
    if (kept.some(k => Math.hypot(k.x - l.x, k.y - l.y) < minSep)) continue;
    kept.push(l);
  }
  if (kept.length) kept[0].near = true;   // highlight the closest
  return kept;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function updateStatus() {
  const s = dem.stats;
  $('stat').textContent =
    `${fps.toFixed(0)} fps · ${mesh ? (mesh.triCount / 1000).toFixed(0) : 0}k tri · ` +
    `DEM ${s.loaded} tiles (${(s.bytes / 1048576).toFixed(1)} MB net, ${s.fromDisk} cached)` +
    (dem.pending ? ` · ${dem.pending} loading` : '') +
    (gps.error ? ` · GPS: ${gps.error}` : '');
}

function setMode(m) {
  cfg.mode = m;
  $('simControls').classList.toggle('hidden', m !== 'sim');
  if (m === 'sim') { gps.stop(); dev.stop(); }
  else {
    gps.start();
    if (m === 'ar') dev.start(); else dev.stop();
  }
  for (const b of document.querySelectorAll('[data-mode]'))
    b.classList.toggle('on', b.dataset.mode === m);
}

function buildUi() {
  const sel = $('preset');
  PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = p.name; sel.appendChild(o);
  });
  sel.onchange = () => {
    const p = PRESETS[+sel.value];
    sim.load(p); mesh.origin.valid = false; rebuildQueued = true; preload();
  };

  $('menuBtn').onclick = () => $('panel').classList.toggle('open');
  $('closeBtn').onclick = () => $('panel').classList.remove('open');

  for (const b of document.querySelectorAll('[data-mode]'))
    b.onclick = async () => {
      if (b.dataset.mode === 'ar' && DeviceAttitude.needsPermission()) {
        const ok = await DeviceAttitude.requestPermission();
        if (!ok) { alertBox('Motion access was declined — AR mode needs it.'); return; }
      }
      setMode(b.dataset.mode);
    };

  for (const b of document.querySelectorAll('[data-range]'))
    b.onclick = () => {
      cfg.range = +b.dataset.range;
      for (const o of document.querySelectorAll('[data-range]')) o.classList.toggle('on', o === b);
      makeMesh(); preload();
    };

  for (const b of document.querySelectorAll('[data-quality]'))
    b.onclick = () => {
      cfg.quality = b.dataset.quality;
      for (const o of document.querySelectorAll('[data-quality]')) o.classList.toggle('on', o === b);
      makeMesh();
    };

  for (const b of document.querySelectorAll('[data-units]'))
    b.onclick = () => {
      cfg.units = b.dataset.units;
      for (const o of document.querySelectorAll('[data-units]')) o.classList.toggle('on', o === b);
    };

  for (const b of document.querySelectorAll('[data-style]'))
    b.onclick = () => applyStyle(b.dataset.style);

  $('taws').onchange = e => { cfg.taws = e.target.checked; };
  $('grid').onchange = e => { cfg.grid = e.target.checked; };
  $('summits').onchange = e => { cfg.summits = e.target.checked; };
  $('runways').onchange = e => { cfg.runways = e.target.checked; buildRunways(true); };
  $('hudOn').onchange = e => { hud.show = e.target.checked; };
  $('fov').oninput = e => { cfg.fov = +e.target.value; $('fovVal').textContent = cfg.fov + '°'; };
  $('altOff').oninput = e => {
    gps.altOffset = +e.target.value;
    $('altOffVal').textContent = (gps.altOffset >= 0 ? '+' : '') + gps.altOffset + ' m';
  };

  $('preloadBtn').onclick = () => {
    const n = preload();
    $('preloadBtn').textContent = n ? `queued ${n} tiles…` : 'already cached ✓';
    setTimeout(() => { $('preloadBtn').textContent = 'Preload this area'; }, 2500);
  };
  $('clearBtn').onclick = async () => {
    await dem.clearDisk();
    dem.stats.loaded = dem.stats.fromDisk = 0; dem.stats.bytes = 0;
    rebuildQueued = true;
  };

  applyStyle(cfg.style);          // sync renderer + controls to the default look
}

function alertBox(msg) {
  const e = $('toast'); e.textContent = msg; e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 3500);
}

// --- simulator input --------------------------------------------------------

function bindSimInput() {
  const surface = $('stick');
  let id = null, ox = 0, oy = 0;
  const norm = () => Math.min(innerWidth, innerHeight) * 0.22;

  surface.addEventListener('pointerdown', e => {
    if (cfg.mode !== 'sim') return;
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    surface.setPointerCapture(id);
  });
  surface.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    sim.input.roll = clamp((e.clientX - ox) / norm(), -1, 1);
    sim.input.pitch = clamp(-(e.clientY - oy) / norm(), -1, 1);
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null; sim.input.roll = 0; sim.input.pitch = 0;
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);

  const hold = (el, set) => {
    let t = null;
    const on = e => { e.preventDefault(); set(); };
    const off = () => { sim.input.thr = 0; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  };
  hold($('thrUp'), () => { sim.input.thr = 1; });
  hold($('thrDn'), () => { sim.input.thr = -1; });
  $('pauseBtn').onclick = () => {
    sim.paused = !sim.paused;
    $('pauseBtn').textContent = sim.paused ? '▶' : '❚❚';
  };

  addEventListener('keydown', e => {
    if (cfg.mode !== 'sim') return;
    if (e.key === 'ArrowLeft') sim.input.roll = -1;
    else if (e.key === 'ArrowRight') sim.input.roll = 1;
    else if (e.key === 'ArrowUp') sim.input.pitch = 1;
    else if (e.key === 'ArrowDown') sim.input.pitch = -1;
    else if (e.key === 'w' || e.key === '+') sim.input.thr = 1;
    else if (e.key === 's' || e.key === '-') sim.input.thr = -1;
    else if (e.key === ' ') { sim.paused = !sim.paused; }
    else if (e.key === 'h') hud.show = !hud.show;
    else return;
    e.preventDefault();
  });
  addEventListener('keyup', e => {
    if (e.key.startsWith('Arrow')) { sim.input.roll = 0; sim.input.pitch = 0; }
    if ('ws+-'.includes(e.key)) sim.input.thr = 0;
  });
}

// ---------------------------------------------------------------------------

async function boot() {
  try {
    renderer = new Renderer($('view'));
  } catch (e) {
    $('startCard').innerHTML = `<h1>Can't start</h1><p>${e.message}</p>`;
    return;
  }
  hud = new Hud($('hud'));
  buildUi();
  bindSimInput();
  sim.load(PRESETS[0]);
  makeMesh();
  preload();
  setMode('sim');
  // Console handle for debugging (and for cross-checking the ESP32 port against
  // this reference implementation).
  window.SV = { cfg, state, sim, dem, get mesh() { return mesh; }, renderer, hud };
  running = true;
  requestAnimationFrame(frame);
}

$('startBtn').onclick = async () => {
  $('start').classList.add('gone');
  await boot();
  // Ask for location straight away — the sim keeps running until a fix lands.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => {
        $('useHere').classList.remove('hidden');
        $('useHere').onclick = async () => {
          if (DeviceAttitude.needsPermission()) await DeviceAttitude.requestPermission();
          setMode('gps');
          state.lat = p.coords.latitude; state.lon = p.coords.longitude;
          if (p.coords.altitude != null) state.alt = p.coords.altitude;
          mesh.origin.valid = false; rebuildQueued = true; preload();
          $('panel').classList.remove('open');
        };
      },
      () => { /* denied or unavailable: sim mode is still fully usable */ },
      { enableHighAccuracy: true, timeout: 15000 });
  }
};

if ('serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
