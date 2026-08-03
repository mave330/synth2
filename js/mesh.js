// mesh.js — world-anchored terrain geometry (geometry clipmap).
//
// WHY THIS SHAPE: an earlier polar mesh was re-centred on the aircraft every
// frame, so its vertices slid across the ground and the terrain appeared to
// "swim" / reshape as it approached. The fix is to anchor vertices to a FIXED
// world lattice: as you fly you translate *through* stable terrain, so it can't
// swim. Detail is provided by nested square rings (clipmap levels), each twice
// the spacing and extent of the one inside it. Each level's centre snaps to its
// own lattice, so it only re-samples in discrete steps that reuse the same world
// points — no popping. Rebuild therefore happens ~once a second, not per frame.
//
// PORTABILITY: the topology (index buffer) is built once and never changes; a
// rebuild only rewrites vertex positions + normals for the levels whose snap
// moved. That is exactly the structure the ESP32 software rasteriser wants —
// see PORTING.md. Drop to ~4 levels of a 24-cell grid there.

import { mPerDegLat, mPerDegLon } from './geo.js';
import { levelForDistance, levelDeg, MAX_LEVEL } from './dem.js';

// Metres between DEM posts at level 0 (~BASE_DEG/64 of a degree of latitude).
const POST0_M = levelDeg(0) * 111320 / 64;

/**
 * The DEM levels a clipmap of this shape samples, and the half-extent over
 * which each is used. Standalone (no mesh instance needed) so the offline
 * downloader can plan before the app has booted.
 * @returns {{dl:number, half:number}[]}
 */
export function clipmapPlan(cells, s0, range) {
  const m = Math.max(8, cells - (cells % 4));
  const L = Math.min(9, Math.max(2, 1 + Math.ceil(Math.log2(Math.max(range, 1) / (m * s0)))));
  const out = [];
  for (let k = 0; k < L; k++) {
    const sk = s0 * (1 << k);
    let dl = Math.floor(Math.log2(sk / POST0_M));
    dl = dl < 0 ? 0 : dl > MAX_LEVEL ? MAX_LEVEL : dl;
    out.push({ dl, half: m * sk / 2 });
  }
  return out;
}

export class TerrainMesh {
  /**
   * @param cells  grid cells per side, per level (rounded to a multiple of 4)
   * @param s0     finest cell size in metres
   * @param range  desired look-ahead radius in metres (sets the level count)
   */
  constructor(cells = 32, s0 = 45, range = 45000) {
    const m = this.m = Math.max(8, cells - (cells % 4));
    this.s0 = s0;
    // Enough levels so the coarsest ring reaches `range`.
    this.L = Math.min(9, Math.max(2, 1 + Math.ceil(Math.log2(Math.max(range, 1) / (m * s0)))));
    this.far = m * s0 * (1 << (this.L - 1));

    this.VPL = (m + 1) * (m + 1);           // grid vertices per level
    this.skirtVPL = 4 * (m + 1);            // outer-boundary skirt verts per level
    this.skirtBase = this.L * this.VPL;
    this.vertCount = this.L * this.VPL + this.L * this.skirtVPL;

    this.positions = new Float32Array(this.vertCount * 3);
    this.normals = new Float32Array(this.vertCount * 3);
    // Per-vertex "openness": this point's height minus a heavily smoothed
    // height. Positive on ridges and spurs, negative in valleys and cirques.
    // Shading it is what gives the terrain the depth a plain hillshade lacks.
    this.ao = new Float32Array(this.vertCount);
    // How far below its terrain vertex each skirt vertex hangs (0 for real
    // terrain). Applied in the vertex shader so skirts keep the colour and
    // shading of the surface they extend.
    this.skirt = new Float32Array(this.vertCount);
    this._cx = new Float64Array(this.L);
    this._cy = new Float64Array(this.L);

    this.base = null;                       // world-frame reference lat/lon
    this.mLat = 0; this.mLon = 0;
    this._dirty = new Uint8Array(this.L);
    this._first = true;
    this.origin = { lat: 0, lon: 0, valid: false };
    this.triCount = 0;
    this.buildMs = 0;

    this.indices = this._buildIndices();
  }

  _g(k, i, j) { return k * this.VPL + j * (this.m + 1) + i; }

  // Outer-boundary grid vertex for a skirt: edge 0=south,1=north,2=west,3=east.
  _boundaryG(k, edge, t) {
    const m = this.m;
    if (edge === 0) return this._g(k, t, 0);
    if (edge === 1) return this._g(k, t, m);
    if (edge === 2) return this._g(k, 0, t);
    return this._g(k, m, t);
  }
  _skirtV(k, edge, t) { return this.skirtBase + k * this.skirtVPL + edge * (this.m + 1) + t; }

  // DEM level at least as fine as this clipmap level's cell size (floor, not
  // round). Oversampling the DEM used to make terrain swim, but the lattice is
  // world-anchored now — a level only ever shifts by a whole number of its own
  // cells — so finer data is free detail with no motion artefacts.
  _demLevel(k) {
    const sk = this.s0 * (1 << k);
    const l = Math.floor(Math.log2(sk / POST0_M));
    return l < 0 ? 0 : l > MAX_LEVEL ? MAX_LEVEL : l;
  }

  /** Queue exactly the DEM tiles this mesh samples around (lat, lon). */
  prefetch(dem, lat, lon) {
    const mLat = mPerDegLat(lat), mLon = mPerDegLon(lat);
    let n = 0;
    for (let k = 0; k < this.L; k++) {
      const half = this.m * this.s0 * (1 << k) / 2;
      const dLat = half / mLat, dLon = half / mLon;
      n += dem.request(this._demLevel(k), lat - dLat, lon - dLon, lat + dLat, lon + dLon);
    }
    return n;
  }

  // Build the fixed topology once: filled finest level, hollow coarser rings,
  // plus a downward skirt around every level's outer edge to hide LOD seams.
  // Coarse levels are emitted first so the finer levels draw last and win in
  // the one-cell overlap band.
  _buildIndices() {
    const m = this.m, L = this.L;
    const idx = [];
    // Hole (covered by the next finer level), shrunk one cell each side so the
    // finer ring always overlaps and never leaves a gap, even when the two
    // levels' independent snaps differ by a cell.
    const hlo = (m >> 2) + 1, hhi = m - (m >> 2) - 1;

    for (let k = L - 1; k >= 0; k--) {
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < m; i++) {
          if (k > 0 && i >= hlo && i < hhi && j >= hlo && j < hhi) continue;
          const a = this._g(k, i, j), b = this._g(k, i + 1, j);
          const c = this._g(k, i, j + 1), d = this._g(k, i + 1, j + 1);
          idx.push(a, b, c, b, d, c);
        }
      }
      for (let edge = 0; edge < 4; edge++) {
        for (let t = 0; t < m; t++) {
          const ta = this._boundaryG(k, edge, t), tb = this._boundaryG(k, edge, t + 1);
          const ba = this._skirtV(k, edge, t), bb = this._skirtV(k, edge, t + 1);
          idx.push(ta, ba, bb, ta, bb, tb);
        }
      }
    }

    this.triCount = idx.length / 3;
    const arr = this.vertCount > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length);
    arr.set(idx);
    return arr;
  }

  /**
   * Resample the terrain around (lat, lon). Positions land in a local ENU frame
   * whose origin is the finest level's snapped centre. Returns true only when
   * something actually changed (a level's snap moved, or `force`), so the caller
   * can skip the GPU upload on the many frames where nothing moved.
   */
  rebuild(dem, lat, lon, force = false) {
    // (Re)base the world frame at start, or if we've wandered far enough that
    // the flat-earth approximation would start to drift.
    if (this.base) {
      const ex = (lon - this.base.lon) * this.mLon, ey = (lat - this.base.lat) * this.mLat;
      if (Math.hypot(ex, ey) > 150000) this.base = null;
    }
    if (!this.base) {
      this.base = { lat, lon };
      this.mLat = mPerDegLat(lat); this.mLon = mPerDegLon(lat);
      force = true;
    }

    const t0 = performance.now();
    const mLat = this.mLat, mLon = this.mLon, m = this.m, L = this.L;
    const eyeWX = (lon - this.base.lon) * mLon, eyeWY = (lat - this.base.lat) * mLat;

    // Only the levels whose snapped centre actually moved need resampling. The
    // finest ring snaps every few seconds, the coarse ones almost never, so a
    // typical rebuild touches one small level instead of all of them.
    const dirty = this._dirty;
    let any = false;
    for (let k = 0; k < L; k++) {
      const snap = 2 * this.s0 * (1 << k);
      const cx = Math.round(eyeWX / snap) * snap;
      const cy = Math.round(eyeWY / snap) * snap;
      dirty[k] = (force || this._first || cx !== this._cx[k] || cy !== this._cy[k]) ? 1 : 0;
      if (dirty[k]) { this._cx[k] = cx; this._cy[k] = cy; any = true; }
    }
    if (!any) return false;
    this._first = false;

    // Vertices are plain world-ENU metres from `base`; earth curvature is
    // applied in the vertex shader relative to the eye, so the geometry does
    // not depend on where the aircraft is and levels stay independently valid.
    const ox = 0, oy = 0;
    this.origin.lat = this.base.lat;
    this.origin.lon = this.base.lon;
    this.origin.valid = true;

    // Fallback height for vertices whose DEM tile hasn't loaded yet. Holding
    // the terrain height under the aircraft (not 0) means not-yet-loaded areas
    // sit at a plausible altitude and blend in, instead of dropping to sea
    // level and showing as flat blue plates far below the mountains.
    let seed = dem.sample(lat, lon, 0);
    if (!(seed === seed)) seed = (this._seed !== undefined ? this._seed : 0);
    this._seed = seed;

    const P = this.positions, VPL = this.VPL;
    for (let k = 0; k < L; k++) {
      if (!dirty[k]) continue;
      const sk = this.s0 * (1 << k), dl = this._demLevel(k);
      const cx = this._cx[k], cy = this._cy[k];
      let lastGood = seed;
      for (let j = 0; j <= m; j++) {
        const wy = cy + (j - m / 2) * sk, ly = wy - oy, latv = this.base.lat + wy / mLat;
        for (let i = 0; i <= m; i++) {
          const wx = cx + (i - m / 2) * sk, lx = wx - ox;
          let h = dem.sample(latv, this.base.lon + wx / mLon, dl);
          if (!(h === h)) h = lastGood; else lastGood = h;
          const o = (k * VPL + j * (m + 1) + i) * 3;
          P[o] = lx; P[o + 1] = ly; P[o + 2] = h;
        }
      }
      this._computeAo(k);
      this._computeNormalsLevel(k);
      this._buildSkirtsLevel(k);
    }

    this.buildMs = performance.now() - t0;
    return true;
  }

  // Ridge/valley measure straight off the grid: this point's height minus the
  // mean of its neighbours R cells away. Reusing the heights we just sampled
  // avoids a second DEM lookup per vertex, and dividing by the kernel's own
  // size makes it dimensionless, so every ring shades identically (otherwise
  // the ring boundaries appear as horizontal bands).
  _computeAo(k) {
    const P = this.positions, AO = this.ao, m = this.m, VPL = this.VPL;
    const R = 3, sk = this.s0 * (1 << k);
    const inv = 1 / (0.45 * R * sk);
    const at = (i, j) => P[(k * VPL + j * (m + 1) + i) * 3 + 2];
    for (let j = 0; j <= m; j++) {
      const jm = Math.max(j - R, 0), jp = Math.min(j + R, m);
      for (let i = 0; i <= m; i++) {
        const im = Math.max(i - R, 0), ip = Math.min(i + R, m);
        const h = at(i, j);
        const mean = (at(im, j) + at(ip, j) + at(i, jm) + at(i, jp)) * 0.25;
        const a = (h - mean) * inv;
        AO[k * VPL + j * (m + 1) + i] = a < -1 ? -1 : a > 1 ? 1 : a;
      }
    }
  }

  // Central-difference grid normals: stable frame-to-frame (unlike face-averaged
  // normals, which flicker) and cheap.
  _computeNormalsLevel(k) {
    const P = this.positions, N = this.normals, m = this.m, VPL = this.VPL;
    const inv = 1 / (2 * this.s0 * (1 << k));
    for (let j = 0; j <= m; j++) {
      for (let i = 0; i <= m; i++) {
        const zL = P[(k * VPL + j * (m + 1) + Math.max(i - 1, 0)) * 3 + 2];
        const zR = P[(k * VPL + j * (m + 1) + Math.min(i + 1, m)) * 3 + 2];
        const zD = P[(k * VPL + Math.max(j - 1, 0) * (m + 1) + i) * 3 + 2];
        const zU = P[(k * VPL + Math.min(j + 1, m) * (m + 1) + i) * 3 + 2];
        let nx = (zL - zR) * inv, ny = (zD - zU) * inv, nz = 1;
        const l = Math.hypot(nx, ny, nz) || 1;
        const o = (k * VPL + j * (m + 1) + i) * 3;
        N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
      }
    }
  }

  // Drop a short vertical skirt around each level's outer edge; the wall hides
  // any hairline crack against the next-coarser ring behind it.
  // Skirts are hidden walls that cover hairline cracks between detail rings.
  // They must be INVISIBLE when they do peek through — so they carry the same
  // position, normal and AO as the terrain vertex above them, and the drop is
  // kept in a separate attribute that only the vertex shader applies. Baking
  // the drop into z instead made the shader colour them by an elevation
  // hundreds of metres too low, and a downward normal killed the light: the
  // result was near-black bands flickering along the ring boundaries.
  _buildSkirtsLevel(k) {
    const P = this.positions, N = this.normals, m = this.m;
    const depth = Math.min(500, Math.max(80, this.s0 * (1 << k) * 2));
    for (let edge = 0; edge < 4; edge++) {
      for (let t = 0; t <= m; t++) {
        const gi = this._boundaryG(k, edge, t), si = this._skirtV(k, edge, t);
        const go = gi * 3, so = si * 3;
        P[so] = P[go]; P[so + 1] = P[go + 1]; P[so + 2] = P[go + 2];
        N[so] = N[go]; N[so + 1] = N[go + 1]; N[so + 2] = N[go + 2];
        this.ao[si] = this.ao[gi];
        this.skirt[si] = depth;
      }
    }
  }
}

/**
 * Look ahead along the ground track for the highest terrain inside a corridor.
 * This is the input to the TAWS-style caution/warning logic.
 * @returns {{maxElev:number, atDist:number}}
 */
export function scanAhead(dem, lat, lon, trackDeg, rangeM, halfWidthM) {
  const mLat = mPerDegLat(lat), mLon = mPerDegLon(lat);
  const t = trackDeg * Math.PI / 180;
  const fx = Math.sin(t), fy = Math.cos(t);
  const rx = fy, ry = -fx;                       // right of track
  let maxElev = -1e9, atDist = 0;
  for (let d = 200; d <= rangeM; d += Math.max(150, d * 0.08)) {
    const w = Math.min(halfWidthM, 200 + d * 0.15);
    for (let s = -1; s <= 1; s++) {
      const x = fx * d + rx * w * s, y = fy * d + ry * w * s;
      const h = dem.sample(lat + y / mLat, lon + x / mLon, levelForDistance(d));
      if (h === h && h > maxElev) { maxElev = h; atDist = d; }
    }
  }
  return { maxElev: maxElev < -1e8 ? NaN : maxElev, atDist };
}
