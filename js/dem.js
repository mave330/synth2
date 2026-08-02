// dem.js — Digital Elevation Model tile cache backed by the French IGN
// Géoplateforme WMS ("wms-r"), which serves raw float32 heightfields.
//
// Endpoint (no API key, CORS: *):
//   https://data.geopf.fr/wms-r/wms?...&FORMAT=image/x-bil;bits=32
//     LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES  -> RGE ALTI, 1-25 m, France
//     LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3    -> SRTM 90 m, near-global
//
// The response body is WIDTH*HEIGHT little-endian float32 metres, row 0 = north.
// Nodata is -99999. HIGHRES stops at the French border, so any tile that comes
// back mostly-nodata is refilled from SRTM3 — that keeps Alpine and Pyrenean
// views seamless across the border.
//
// PORTABILITY: on the ESP32 this class is replaced by a reader over DEM tiles
// pre-baked to SD card / SPIFFS (see PORTING.md). Everything above `sample()`
// is transport; `sample()` itself is the only thing the renderer needs.

const WMS = 'https://data.geopf.fr/wms-r/wms';
const LAYER_HI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const LAYER_LO = 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3';
const NODATA = -9000;                 // anything below this is "no data"

// A tile holds (N+1)^2 point samples on an exact lat/lon lattice, so that the
// last row/column of a tile coincides with the first of its neighbour: no seams.
const N = 64;                         // cells per tile edge
const S = N + 1;                      // samples per edge
// Level-0 tile spans 0.01 deg (~1.1 km), i.e. ~17 m between elevation posts —
// four times finer than the original 0.04. RGE ALTI is 1-25 m natively, so this
// is real detail, not interpolation, and it's what puts gullies and ridges back
// into the terrain. More levels keep the same far coverage.
const BASE_DEG = 0.01;
export const MAX_LEVEL = 7;

// The Géoplateforme rate-limits: push too hard and it answers 429 (and, under
// load, stray 400s). Tiles then fail, leaving holes that show up as flat or
// mis-shaped terrain. Keep concurrency modest and back off when asked to.
const MAX_INFLIGHT = 6;               // live streaming while flying
const DOWNLOAD_CONCURRENCY = 4;       // bulk offline download
const FETCH_ATTEMPTS = 4;
const DB_NAME = 'synthvis-dem-v2';    // v2: tile geometry changed with BASE_DEG
const DB_STORE = 'tiles';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Interruptible wait: backoff pauses can be seconds long, and a user who hits
// Stop should not have to sit through them.
async function sleepCancellable(ms, cancel) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cancel && cancel.stop) return;
    await sleep(Math.min(200, end - Date.now()));
  }
}

export function levelDeg(level) { return BASE_DEG * (1 << level); }

/** Pick a DEM level whose post spacing suits terrain `d` metres away. */
export function levelForDistance(d) {
  const l = Math.round(Math.log2(Math.max(d, 1) / 3000));
  return l < 0 ? 0 : l > MAX_LEVEL ? MAX_LEVEL : l;
}

export class DemCache {
  constructor() {
    this.tiles = new Map();            // key -> {data:Float32Array|null, state}
    this.queue = [];                   // pending {key, level, tx, ty, prio}
    this.inflight = 0;
    this.stats = { loaded: 0, failed: 0, bytes: 0, fromDisk: 0, throttled: 0 };
    this._cooldownUntil = 0;
    this.onTile = null;                // callback fired when a tile lands
    this.center = { lat: 46, lon: 2 }; // used to prioritise the fetch queue
    this._db = null;
    this._openDB();
  }

  // -- persistent cache (IndexedDB) ---------------------------------------
  // Keeping tiles on disk is what makes the app usable with no signal: preload
  // your route on the ground, fly it offline.

  _openDB() {
    try {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(DB_STORE);
      rq.onsuccess = () => { this._db = rq.result; };
      rq.onerror = () => { this._db = null; };
    } catch (e) { this._db = null; }
  }

  _dbGet(key) {
    return new Promise(res => {
      if (!this._db) return res(null);
      try {
        const rq = this._db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }

  _dbPut(key, buf) {
    if (!this._db) return;
    try {
      this._db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(buf, key);
    } catch (e) { /* quota — not fatal, memory cache still works */ }
  }

  async clearDisk() {
    if (!this._db) return;
    await new Promise(res => {
      const rq = this._db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).clear();
      rq.onsuccess = rq.onerror = res;
    });
    this.tiles.clear();
  }

  // -- tile addressing ----------------------------------------------------

  key(level, tx, ty) { return level + '/' + tx + '/' + ty; }

  /**
   * Bilinear height at (lat, lon) from the requested level. Falls back to any
   * coarser level already in memory so terrain fades in progressively instead
   * of punching holes, and queues whatever is missing.
   * Returns NaN only if nothing at all is available yet.
   */
  sample(lat, lon, level) {
    for (let l = level; l <= MAX_LEVEL; l++) {
      const td = levelDeg(l);
      const tx = Math.floor(lon / td), ty = Math.floor(lat / td);
      const t = this.tiles.get(this.key(l, tx, ty));
      if (t && t.data) {
        const h = this._bilinear(t.data, lat, lon, tx, ty, td);
        if (l === level) return h;
        // Coarse stand-in: still request the sharp tile.
        this._want(level, lon, lat);
        return h;
      }
      if (l === level) this._want(level, lon, lat);
    }
    return NaN;
  }

  _bilinear(d, lat, lon, tx, ty, td) {
    const cell = td / N;
    let u = (lon - tx * td) / cell;              // 0..N across the tile
    let v = ((ty + 1) * td - lat) / cell;        // 0..N, row 0 is north
    if (u < 0) u = 0; else if (u > N) u = N;
    if (v < 0) v = 0; else if (v > N) v = N;
    const i0 = u | 0, j0 = v | 0;
    const i1 = i0 < N ? i0 + 1 : N, j1 = j0 < N ? j0 + 1 : N;
    const fu = u - i0, fv = v - j0;
    const a = d[j0 * S + i0], b = d[j0 * S + i1];
    const c = d[j1 * S + i0], e = d[j1 * S + i1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
  }

  _want(level, lon, lat) {
    const td = levelDeg(level);
    const tx = Math.floor(lon / td), ty = Math.floor(lat / td);
    const key = this.key(level, tx, ty);
    if (this.tiles.has(key)) return;
    this.tiles.set(key, { data: null, state: 'queued' });
    this.queue.push({ key, level, tx, ty });
    this._pump();
  }

  /** Explicitly request every tile of `level` covering a lat/lon box. */
  request(level, latMin, lonMin, latMax, lonMax) {
    const td = levelDeg(level);
    let n = 0;
    for (let ty = Math.floor(latMin / td); ty <= Math.floor(latMax / td); ty++)
      for (let tx = Math.floor(lonMin / td); tx <= Math.floor(lonMax / td); tx++) {
        const key = this.key(level, tx, ty);
        if (this.tiles.has(key)) continue;
        this.tiles.set(key, { data: null, state: 'queued' });
        this.queue.push({ key, level, tx, ty });
        n++;
      }
    this._pump();
    return n;
  }

  get pending() { return this.queue.length + this.inflight; }

  /**
   * List the tiles of `level` covering a box that aren't already in memory.
   * `seen` de-duplicates across several calls while building one plan.
   */
  planTiles(level, latMin, lonMin, latMax, lonMax, seen) {
    const td = levelDeg(level);
    const out = [];
    for (let ty = Math.floor(latMin / td); ty <= Math.floor(latMax / td); ty++)
      for (let tx = Math.floor(lonMin / td); tx <= Math.floor(lonMax / td); tx++) {
        const key = this.key(level, tx, ty);
        if (seen.has(key) || this.tiles.has(key)) continue;
        seen.add(key);
        out.push({ key, level, tx, ty });
      }
    return out;
  }

  /**
   * Bulk-download a plan built with planTiles(), for offline use. Reports
   * progress after every tile and stops promptly if `cancel.stop` is set.
   */
  async fetchArea(jobs, onProgress, cancel = {}) {
    const total = jobs.length;
    let done = 0;

    // Run one pass over `list`, returning whatever failed. Concurrency is kept
    // modest: the aim is a reliable bulk download, not a fast one.
    const pass = async (list, countProgress) => {
      const retry = [];
      const next = () => list.pop();
      const worker = async () => {
        for (let job = next(); job && !cancel.stop; job = next()) {
          let ok = true;
          if (!this.tiles.has(job.key)) {
            this.tiles.set(job.key, { data: null, state: 'queued' });
            ok = await this._load(job, cancel);  // per-job result, not a shared counter
          }
          if (!ok) retry.push(job);
          if (countProgress) { done++; if (onProgress) onProgress(done, total, retry.length); }
        }
      };
      await Promise.all(new Array(DOWNLOAD_CONCURRENCY).fill(0).map(worker));
      return retry;
    };

    let failedJobs = await pass(jobs, true);
    if (failedJobs.length && !cancel.stop) {
      await new Promise(r => setTimeout(r, 800));   // let a transient blip pass
      failedJobs = await pass(failedJobs, false);
    }
    return { done, total, failed: failedJobs.length, cancelled: !!cancel.stop };
  }

  _pump() {
    while (this.inflight < MAX_INFLIGHT && this.queue.length) {
      // Nearest-first: the terrain you are about to hit loads before the horizon.
      const c = this.center;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i], td = levelDeg(q.level);
        const dy = (q.ty + 0.5) * td - c.lat, dx = (q.tx + 0.5) * td - c.lon;
        const d = dx * dx + dy * dy + q.level * 0.02;
        if (d < bd) { bd = d; bi = i; }
      }
      const job = this.queue.splice(bi, 1)[0];
      this.inflight++;
      this._load(job).finally(() => { this.inflight--; this._pump(); });
    }
  }

  _url(layer, level, tx, ty) {
    const td = levelDeg(level), half = td / N / 2;
    // Shift the bbox by half a cell so WMS pixel *centres* land exactly on the
    // lattice points tx*td + i*cell — that is what makes tiles seamless.
    const latMin = ty * td - half, latMax = (ty + 1) * td + half;
    const lonMin = tx * td - half, lonMax = (tx + 1) * td + half;
    return WMS + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=' +
      '&LAYERS=' + layer + '&CRS=EPSG:4326&FORMAT=image/x-bil;bits=32' +
      '&WIDTH=' + S + '&HEIGHT=' + S +
      '&BBOX=' + latMin.toFixed(7) + ',' + lonMin.toFixed(7) + ',' +
      latMax.toFixed(7) + ',' + lonMax.toFixed(7);
  }

  /**
   * Fetch one grid, retrying with exponential backoff when the server pushes
   * back. A 429 sets a shared cooldown so every worker eases off together
   * rather than each discovering the limit on its own.
   */
  async _fetchGrid(layer, level, tx, ty, cancel) {
    const url = this._url(layer, level, tx, ty);
    let wait = 500;
    for (let attempt = 1; ; attempt++) {
      if (cancel && cancel.stop) throw new Error('cancelled');
      const cool = this._cooldownUntil - Date.now();
      if (cool > 0) await sleepCancellable(cool + Math.random() * 200, cancel);

      let r;
      try {
        r = await fetch(url, { cache: 'force-cache' });
      } catch (e) {
        if (attempt >= FETCH_ATTEMPTS) throw e;         // network blip
        await sleepCancellable(wait, cancel); wait = Math.min(wait * 2, 8000);
        continue;
      }

      if (r.ok) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength !== S * S * 4) throw new Error('bad payload ' + buf.byteLength);
        this.stats.bytes += buf.byteLength;
        return new Float32Array(buf);   // little-endian, matches every target we care about
      }

      // 429/5xx are "come back later"; a 400 under heavy load is usually the
      // same thing wearing a different hat, so give it one chance too.
      const retryable = r.status === 429 || r.status >= 500 || r.status === 400;
      if (!retryable || attempt >= FETCH_ATTEMPTS) throw new Error('HTTP ' + r.status);

      const ra = parseFloat(r.headers.get('Retry-After'));
      const pause = Math.min(isFinite(ra) ? ra * 1000 : wait, 8000);
      if (r.status === 429) this._cooldownUntil = Date.now() + pause;
      this.stats.throttled++;
      await sleepCancellable(pause + Math.random() * 250, cancel);
      wait = Math.min(wait * 2, 8000);
    }
  }

  /** @returns {Promise<boolean>} true if the tile is now available. */
  async _load(job, cancel) {
    const rec = this.tiles.get(job.key);
    rec.state = 'loading';

    const cached = await this._dbGet(job.key);
    if (cached) {
      rec.data = new Float32Array(cached); rec.state = 'ok';
      this.stats.loaded++; this.stats.fromDisk++;
      if (this.onTile) this.onTile(job);
      return true;
    }

    try {
      const hi = await this._fetchGrid(LAYER_HI, job.level, job.tx, job.ty, cancel);
      let holes = 0;
      for (let i = 0; i < hi.length; i++) if (hi[i] < NODATA) holes++;

      if (holes > 0) {
        // Outside RGE ALTI coverage: patch the holes with SRTM3.
        try {
          const lo = await this._fetchGrid(LAYER_LO, job.level, job.tx, job.ty, cancel);
          for (let i = 0; i < hi.length; i++)
            if (hi[i] < NODATA) hi[i] = lo[i] < NODATA ? 0 : lo[i];
        } catch (e) {
          for (let i = 0; i < hi.length; i++) if (hi[i] < NODATA) hi[i] = 0;
        }
      }
      // Lake/sea bathymetry sneaks in as large negatives; clamp to sea level.
      for (let i = 0; i < hi.length; i++) if (hi[i] < -50) hi[i] = 0;

      rec.data = hi; rec.state = 'ok';
      this.stats.loaded++;
      this._dbPut(job.key, hi.buffer);
      if (this.onTile) this.onTile(job);
      return true;
    } catch (e) {
      rec.state = 'error';
      this.stats.failed++;
      this.tiles.delete(job.key);       // allow a retry later
      return false;
    }
  }
}
