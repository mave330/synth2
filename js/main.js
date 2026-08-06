// main.js — wiring: sensors -> terrain mesh -> renderer + HUD.

import { mPerDegLat, mPerDegLon, clamp } from './geo.js';
import { DemCache } from './dem.js';
import { TerrainMesh, scanAhead, clipmapPlan } from './mesh.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { NavState, Simulator, GpsSource, DeviceAttitude, PRESETS } from './nav.js';
import { SUMMITS, nearestSummit } from './summits.js';
import { nearbyAirports } from './airports.js';
import { nearbyPlaces } from './places.js';

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
  places: true,
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
  refreshLabelCandidates(t);

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
    places: placeLabels(eye, mLat, mLon),
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
  // Mid grey, not near-black: a very dark fill reads as a hole punched in the
  // terrain rather than as a runway, especially against TAWS yellow.
  const SC = [0.34, 0.35, 0.37, 1], EC = [0.96, 0.97, 0.99, 1];

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
  for (const { a, d } of labelCache.airports) {
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

// The label databases are scanned and sorted at a low rate and the survivors
// cached: only the per-frame projection (a handful of multiplies each) has to
// track attitude. Rescanning ~240 entries with hypot+sort every frame was pure
// waste — the candidate set barely changes between frames.
const labelCache = { t: -1e9, lat: 0, lon: 0, places: [], airports: [], summits: [] };

function refreshLabelCandidates(now) {
  if (now - labelCache.t < 400 &&
      Math.abs(state.lat - labelCache.lat) < 0.004 &&
      Math.abs(state.lon - labelCache.lon) < 0.004) return;
  labelCache.t = now; labelCache.lat = state.lat; labelCache.lon = state.lon;

  const maxP = Math.min(cfg.range, 60000);
  labelCache.places = nearbyPlaces(state.lat, state.lon, maxP).slice(0, 24);
  labelCache.airports = nearbyAirports(state.lat, state.lon, Math.min(cfg.range, 45000)).slice(0, 8);

  const maxS = Math.min(cfg.range * 1.12, 90000);
  const cl = Math.cos(state.lat * Math.PI / 180);
  const near = [];
  for (const su of SUMMITS) {
    const dy = (su.la - state.lat) * 111320, dx = (su.lo - state.lon) * 111320 * cl;
    const d = Math.hypot(dx, dy);
    if (d <= maxS && d >= 80) near.push({ s: su, d });
  }
  near.sort((a, b) => a.d - b.d);
  labelCache.summits = near.slice(0, 14);
}

// Towns/cities/landmarks projected onto the ground, decluttered.
function placeLabels(eye, mLat, mLon) {
  if (!cfg.places) return null;
  const maxR = Math.min(cfg.range, 60000);
  const out = [];
  for (const { p, d } of labelCache.places) {
    const ex = (p.lo - mesh.origin.lon) * mLon, ey = (p.la - mesh.origin.lat) * mLat;
    let g = dem.sample(p.la, p.lo, 0);
    if (!(g === g)) continue;                       // no terrain here yet
    const pr = renderer.project(ex, ey, g, {});
    if (!pr.visible) continue;
    if (pr.x < -40 || pr.x > hud.w + 40 || pr.y < 0 || pr.y > hud.h * 0.95) continue;
    out.push({ n: p.n, poi: p.k === 'poi', x: pr.x, y: pr.y,
               alpha: clamp(1.2 - d / maxR, 0.4, 1) });
    if (out.length >= 24) break;
  }
  // Keep the highest-priority ones (nearbyPlaces already sorts by importance)
  // and drop anything that would collide on screen.
  const kept = [], minSep = Math.min(hud.w, hud.h) * 0.085;
  for (const l of out) {
    if (kept.length >= 7) break;
    if (kept.some(k => Math.hypot(k.x - l.x, k.y - l.y) < minSep)) continue;
    kept.push(l);
  }
  return kept;
}

// Project the named summits within range onto their peaks and declutter them.
const _lp = {};
function summitLabels(eye, mLat, mLon) {
  const maxR = Math.min(cfg.range * 1.12, 90000);
  const out = [];
  for (const { s, d } of labelCache.summits) {     // already range-filtered + sorted
    const ex = (s.lo - mesh.origin.lon) * mLon;
    const ey = (s.la - mesh.origin.lat) * mLat;
    // Place the label on the apex; project() applies the curvature drop.
    const p = renderer.project(ex, ey, s.e, _lp);
    if (!p.visible) continue;
    if (p.x < -30 || p.x > hud.w + 30 || p.y < -20 || p.y > hud.h * 0.9) continue;
    out.push({ n: s.n, e: s.e, d, x: p.x, y: p.y,
               alpha: clamp(1.3 - d / maxR, 0.35, 1) });
  }
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
    (dem.stats.throttled ? ` · ${dem.stats.throttled} throttled` : '') +
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
  $('places').onchange = e => { cfg.places = e.target.checked; };
  $('hudOn').onchange = e => { hud.show = e.target.checked; };
  $('fov').oninput = e => { cfg.fov = +e.target.value; $('fovVal').textContent = cfg.fov + '°'; };
  $('altOff').oninput = e => {
    gps.altOffset = +e.target.value;
    $('altOffVal').textContent = (gps.altOffset >= 0 ? '+' : '') + gps.altOffset + ' m';
  };

  $('preloadBtn').onclick = () => {
    $('panel').classList.remove('open');
    $('dl').classList.add('open');
    updateEstimate();
  };
  $('clearBtn').onclick = async () => {
    await dem.clearDisk();
    dem.stats.loaded = dem.stats.fromDisk = 0; dem.stats.bytes = 0;
    rebuildQueued = true;
  };

  applyStyle(cfg.style);          // sync renderer + controls to the default look
}

// --- offline terrain download ----------------------------------------------
//
// Plans exactly what the renderer would sample if the aircraft were anywhere
// inside `radius`: for each clipmap ring, its DEM level over (radius + that
// ring's half-extent). Coarse levels therefore reach far beyond the radius for
// the horizon view, while the expensive fine levels stay tight.

const TILE_BYTES = (64 + 1) * (64 + 1) * 4;
let dlCancel = { stop: false }, dlBusy = false, dlRadius = 10000;

function planDownload(lat, lon, radius) {
  const q = QUALITY[cfg.quality];
  const seen = new Set();
  const jobs = [];
  for (const { dl, half } of clipmapPlan(q.cells, q.s0, cfg.range)) {
    const r = radius + half;
    const dLat = r / mPerDegLat(lat), dLon = r / mPerDegLon(lat);
    jobs.push(...dem.planTiles(dl, lat - dLat, lon - dLon, lat + dLat, lon + dLon, seen));
  }
  return jobs;
}

function dlCentre() {
  const v = $('dlWhere').value;
  if (v === 'here') return { lat: state.lat, lon: state.lon, name: 'current position' };
  const p = PRESETS[+v];
  return { lat: p.lat, lon: p.lon, name: p.name };
}

function updateEstimate() {
  if (dlBusy) return;
  const c = dlCentre();
  const n = planDownload(c.lat, c.lon, dlRadius).length;
  $('dlEst').textContent = n === 0
    ? `${c.name}: already downloaded ✓`
    : `${c.name}: ${n} tiles, about ${(n * TILE_BYTES / 1048576).toFixed(0)} MB`;
}

function buildDownloadUi() {
  const sel = $('dlWhere');
  const here = document.createElement('option');
  here.value = 'here'; here.textContent = 'My current position';
  sel.appendChild(here);
  PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = p.name; sel.appendChild(o);
  });
  sel.onchange = updateEstimate;

  for (const b of document.querySelectorAll('[data-dlr]'))
    b.onclick = () => {
      dlRadius = +b.dataset.dlr;
      for (const o of document.querySelectorAll('[data-dlr]')) o.classList.toggle('on', o === b);
      updateEstimate();
    };

  $('dlOpen').onclick = () => { $('dl').classList.add('open'); updateEstimate(); };
  $('dlClose').onclick = () => {
    if (dlBusy) { dlCancel.stop = true; }
    $('dl').classList.remove('open');
  };
  $('dlGo').onclick = runDownload;
}

async function runDownload() {
  if (dlBusy) {                       // second press = stop
    dlCancel.stop = true;
    return;
  }
  const c = dlCentre();
  const jobs = planDownload(c.lat, c.lon, dlRadius);
  if (!jobs.length) { $('dlMsg').textContent = 'Nothing to do — already cached.'; return; }

  dlBusy = true; dlCancel = { stop: false };
  $('dlGo').textContent = 'Stop';
  const total = jobs.length;

  const r = await dem.fetchArea(jobs, (done, tot, failed) => {
    $('dlBar').style.width = (done / tot * 100).toFixed(1) + '%';
    $('dlMsg').textContent = `${done} / ${tot} tiles` + (failed ? ` · ${failed} failed` : '');
  }, dlCancel);

  dlBusy = false;
  $('dlGo').textContent = 'Download';
  $('dlMsg').textContent = r.cancelled
    ? `Stopped — ${r.done} of ${total} tiles saved (kept for offline use).`
    : `Done: ${r.done} tiles cached` + (r.failed ? `, ${r.failed} failed` : '') + '.';
  if (!r.cancelled && !r.failed) $('dlBar').style.width = '100%';
  updateEstimate();
  rebuildQueued = true;               // show the new detail straight away
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

// The downloader is usable from the start screen, before the app boots.
buildDownloadUi();

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
