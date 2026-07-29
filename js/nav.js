// nav.js — where position and attitude come from.
//
// Three interchangeable providers, all producing the same state object:
//   sim     — a simple flight/drive model, for the desktop and for demos
//   gps     — Geolocation, with attitude *derived* from the track (this is what
//             a real synthetic-vision box does when it has no AHRS: pitch from
//             climb angle, bank from turn rate)
//   ar      — full device attitude from the iPhone's IMU, camera out the back
//
// PORTABILITY: on the ESP32 `gps` becomes the NMEA feed you already parse, and
// `ar` becomes the Mahony AHRS. The consumer only ever reads NavState, so the
// renderer does not change.

import { DEG, RAD, clamp, diffDeg, normDeg, mPerDegLat, mPerDegLon } from './geo.js';

const G = 9.80665;

export class NavState {
  constructor() {
    this.lat = 45.9237; this.lon = 6.8694;   // Chamonix, looking at Mont Blanc
    this.alt = 3200;                          // m MSL
    this.heading = 160; this.pitch = -3; this.roll = 0;
    this.track = 160; this.gs = 55; this.vs = 0;
    this.accuracy = NaN; this.fixAge = Infinity; this.source = 'sim';
  }
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

export const PRESETS = [
  // Default: in the Chamonix valley looking due south at the Mont Blanc massif,
  // so tan lower slopes rise to the white summits — a scenic showcase of the
  // relief style rather than sitting on top of the all-white glacier.
  // 3300 m works for both styles: above most of the valley walls (so SVT shows
  // green/tan terrain with only the summits in TAWS amber/red), while still low
  // enough that relief mode shows tan slopes rising to the snow.
  { name: 'Mont Blanc',   lat: 45.9200, lon: 6.8700,  alt: 3300, hdg: 184, gs: 55 },
  // Lined up on Courchevel's altiport (LFLJ) from the north-east: the classic
  // SVT shot — a runway on a shelf with terrain all around it.
  { name: 'Approach Courchevel', lat: 45.4300, lon: 6.6750, alt: 2450, hdg: 220, gs: 50 },
  { name: 'Approach Annecy',  lat: 45.8850, lon: 6.0700, alt: 1250, hdg:  40, gs: 50 },
  { name: 'Vallée de Chamonix', lat: 45.9900, lon: 6.7500, alt: 2600, hdg: 215, gs: 45 },
  { name: 'Vercors / Grenoble', lat: 45.1200, lon: 5.6000, alt: 1800, hdg: 200, gs: 50 },
  { name: 'Lac d\'Annecy', lat: 45.8300, lon: 6.1700, alt: 1500, hdg: 180, gs: 45 },
  { name: 'Cirque de Gavarnie', lat: 42.7900, lon: -0.0300, alt: 2600, hdg: 180, gs: 45 },
  { name: 'Monte Cinto (Corse)', lat: 42.3600, lon: 8.9200, alt: 2400, hdg: 240, gs: 50 },
  { name: 'Puy de Dôme',  lat: 45.7720, lon: 2.9640,  alt: 1600, hdg: 190, gs: 45 },
  { name: 'Gorges du Verdon', lat: 43.7500, lon: 6.3300, alt: 1200, hdg: 90,  gs: 40 },
  { name: 'Mercantour / Nice', lat: 44.0800, lon: 7.2500, alt: 2600, hdg: 210, gs: 50 },
  { name: 'Route: col du Galibier', lat: 45.0640, lon: 6.4080, alt: 2640, hdg: 20, gs: 14, drive: true },
];

export class Simulator {
  constructor(state) {
    this.s = state;
    this.drive = false;
    this.input = { pitch: 0, roll: 0, thr: 0 };   // -1..1 commands
    this.paused = false;
  }

  load(p) {
    const s = this.s;
    s.lat = p.lat; s.lon = p.lon; s.alt = p.alt;
    s.heading = p.hdg; s.track = p.hdg; s.gs = p.gs;
    s.pitch = 0; s.roll = 0; s.vs = 0;
    this.drive = !!p.drive;
  }

  update(dt, dem) {
    if (this.paused) dt = 0;
    const s = this.s, i = this.input;
    dt = Math.min(dt, 0.1);

    if (this.drive) {
      s.roll = 0;
      s.gs = clamp(s.gs + i.thr * 8 * dt, 0, 45);
      s.heading = normDeg(s.heading + i.roll * 45 * dt);
      // Glue the vehicle to the ground and let the road's slope set the pitch.
      const mLat = mPerDegLat(s.lat), mLon = mPerDegLon(s.lat);
      const ah = dem.sample(s.lat + Math.cos(s.heading * DEG) * 60 / mLat,
                            s.lon + Math.sin(s.heading * DEG) * 60 / mLon, 0);
      const h = dem.sample(s.lat, s.lon, 0);
      if (h === h) {
        const target = h + 1.6;
        s.vs = (target - s.alt) / Math.max(dt, 0.016);
        s.alt += (target - s.alt) * Math.min(1, dt * 4);
        if (ah === ah) s.pitch = clamp(Math.atan2(ah - h, 60) * RAD, -25, 25);
      }
    } else {
      s.roll = clamp(s.roll + i.roll * 60 * dt - s.roll * 0.9 * dt, -75, 75);
      s.pitch = clamp(s.pitch + i.pitch * 25 * dt - s.pitch * 0.3 * dt, -35, 35);
      s.gs = clamp(s.gs + i.thr * 12 * dt - s.pitch * 0.25 * dt, 15, 180);
      // Coordinated turn.
      const omega = G * Math.tan(s.roll * DEG) / Math.max(s.gs, 12);
      s.heading = normDeg(s.heading + omega * RAD * dt);
      s.vs = s.gs * Math.sin(s.pitch * DEG);
      s.alt = Math.max(s.alt + s.vs * dt, -100);
    }

    s.track = s.heading;
    const mLat = mPerDegLat(s.lat), mLon = mPerDegLon(s.lat);
    const d = s.gs * dt;
    s.lat += (d * Math.cos(s.heading * DEG)) / mLat;
    s.lon += (d * Math.sin(s.heading * DEG)) / mLon;
    s.source = 'sim';
    s.fixAge = 0;

    // Don't let the sim fly into the ground unnoticed.
    const g = dem.sample(s.lat, s.lon, 0);
    if (!this.drive && g === g && s.alt < g + 30) { s.alt = g + 30; if (s.vs < 0) s.vs = 0; }
  }
}

// ---------------------------------------------------------------------------
// GPS + derived attitude
// ---------------------------------------------------------------------------

export class GpsSource {
  constructor() {
    this.watchId = null;
    this.last = null;
    this.raw = { lat: NaN, lon: NaN, alt: NaN, gs: 0, track: NaN, acc: NaN, t: 0 };
    this.vsFilt = 0; this.pitchFilt = 0; this.rollFilt = 0; this.trackFilt = NaN;
    this.altOffset = 0;
    this.error = null;
    this.ok = false;
  }

  start() {
    if (!navigator.geolocation) { this.error = 'no geolocation API'; return; }
    this.watchId = navigator.geolocation.watchPosition(
      p => this._onFix(p),
      e => { this.error = e.message; this.ok = false; },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null; this.ok = false;
  }

  _onFix(p) {
    const c = p.coords, t = p.timestamp / 1000;
    const prev = this.last;
    this.raw = {
      lat: c.latitude, lon: c.longitude,
      alt: c.altitude === null ? NaN : c.altitude,
      gs: c.speed === null || isNaN(c.speed) ? 0 : c.speed,
      track: c.heading === null || isNaN(c.heading) ? NaN : c.heading,
      acc: c.accuracy, t
    };

    if (prev) {
      const dt = Math.max(t - prev.t, 0.2);
      if (isFinite(this.raw.alt) && isFinite(prev.alt)) {
        const vs = (this.raw.alt - prev.alt) / dt;
        this.vsFilt += (clamp(vs, -25, 25) - this.vsFilt) * Math.min(1, dt / 3);
      }
      // No GPS course below walking pace: derive it from the position delta.
      let trk = this.raw.track;
      if (!isFinite(trk) && this.raw.gs > 1.5) {
        const mLat = mPerDegLat(this.raw.lat), mLon = mPerDegLon(this.raw.lat);
        trk = normDeg(Math.atan2((this.raw.lon - prev.lon) * mLon,
                                 (this.raw.lat - prev.lat) * mLat) * RAD);
      }
      if (isFinite(trk)) {
        if (!isFinite(this.trackFilt)) this.trackFilt = trk;
        const dHead = diffDeg(trk, this.trackFilt);
        const k = Math.min(1, dt / 1.2);
        this.trackFilt = normDeg(this.trackFilt + dHead * k);
        // Bank angle implied by a coordinated turn at this rate.
        const omega = (dHead * DEG) / dt;
        const bank = Math.atan(omega * Math.max(this.raw.gs, 5) / G) * RAD;
        this.rollFilt += (clamp(bank, -60, 60) - this.rollFilt) * Math.min(1, dt / 1.5);
      }
      const climbAngle = Math.atan2(this.vsFilt, Math.max(this.raw.gs, 3)) * RAD;
      this.pitchFilt += (clamp(climbAngle, -25, 25) - this.pitchFilt) * Math.min(1, dt / 2);
    }

    this.last = this.raw;
    this.ok = true; this.error = null;
  }

  /** Write GPS-derived position + attitude into the shared NavState. */
  apply(s) {
    const r = this.raw;
    if (!isFinite(r.lat)) return false;
    s.lat = r.lat; s.lon = r.lon;
    if (isFinite(r.alt)) s.alt = r.alt + this.altOffset;
    s.gs = r.gs;
    s.accuracy = r.acc;
    s.fixAge = performance.timeOrigin / 1000 + performance.now() / 1000 - r.t;
    s.track = isFinite(this.trackFilt) ? this.trackFilt : s.track;
    s.heading = s.track;
    s.pitch = this.pitchFilt;
    s.roll = this.rollFilt;
    s.vs = this.vsFilt;
    s.source = 'gps';
    return true;
  }
}

// ---------------------------------------------------------------------------
// Device attitude (AR mode) — camera looks out of the phone's back
// ---------------------------------------------------------------------------

export class DeviceAttitude {
  constructor() {
    this.enabled = false;
    this.have = false;
    this.att = { heading: 0, pitch: 0, roll: 0 };
    this._h = e => this._onEvent(e);
  }

  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** Must be called from a user gesture on iOS 13+. */
  static async requestPermission() {
    if (!DeviceAttitude.needsPermission()) return true;
    try { return (await DeviceOrientationEvent.requestPermission()) === 'granted'; }
    catch (e) { return false; }
  }

  start() {
    if (this.enabled) return;
    window.addEventListener('deviceorientation', this._h, true);
    this.enabled = true;
  }
  stop() {
    window.removeEventListener('deviceorientation', this._h, true);
    this.enabled = false; this.have = false;
  }

  _onEvent(e) {
    if (e.alpha === null && e.beta === null && e.gamma === null) return;
    // iOS gives a true-north compass heading separately; alpha alone is
    // relative to an arbitrary start. alpha = 360 - heading in the W3C frame.
    let alpha = e.alpha || 0;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading))
      alpha = 360 - e.webkitCompassHeading;

    const scr = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const q = quatFromDeviceOrientation(alpha * DEG, (e.beta || 0) * DEG,
                                        (e.gamma || 0) * DEG, scr * DEG);

    // Camera basis in the device frame, rotated into ENU.
    const fwd = rotate(q, 0, 0, -1);
    const up = rotate(q, 0, 1, 0);

    const heading = normDeg(Math.atan2(fwd[0], fwd[1]) * RAD);
    const pitch = Math.asin(clamp(fwd[2], -1, 1)) * RAD;
    const h = heading * DEG;
    const r0 = [Math.cos(h), -Math.sin(h), 0];
    const u0 = [fwd[1] * r0[2] - fwd[2] * r0[1],
                fwd[2] * r0[0] - fwd[0] * r0[2],
                fwd[0] * r0[1] - fwd[1] * r0[0]];
    const roll = Math.atan2(up[0] * r0[0] + up[1] * r0[1] + up[2] * r0[2],
                            up[0] * u0[0] + up[1] * u0[1] + up[2] * u0[2]) * RAD;

    this.att.heading = heading; this.att.pitch = pitch; this.att.roll = roll;
    this.have = true;
  }

  apply(s) {
    if (!this.have) return false;
    s.heading = this.att.heading; s.pitch = this.att.pitch; s.roll = this.att.roll;
    return true;
  }
}

// Quaternion (x,y,z,w) taking device axes to ENU, for a camera looking out the
// back of the phone. Derived from the W3C Z-X'-Y'' intrinsic convention, with
// the screen-rotation term so landscape and portrait both come out upright.
function quatFromDeviceOrientation(a, b, g, scr) {
  const c1 = Math.cos(b / 2), s1 = Math.sin(b / 2);
  const c2 = Math.cos(a / 2), s2 = Math.sin(a / 2);
  const c3 = Math.cos(-g / 2), s3 = Math.sin(-g / 2);
  // 'YXZ' ordering, as used by every browser implementation of this transform.
  let q = [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
  q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);              // -90 deg about X
  q = qmul(q, [0, 0, Math.sin(-scr / 2), Math.cos(-scr / 2)]);   // screen rotation
  return q;
}

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// Rotate a vector by q, then map the Y-up intermediate frame to ENU
// (E = x, N = -z, U = y).
function rotate(q, x, y, z) {
  const ix = q[3] * x + q[1] * z - q[2] * y;
  const iy = q[3] * y + q[2] * x - q[0] * z;
  const iz = q[3] * z + q[0] * y - q[1] * x;
  const iw = -q[0] * x - q[1] * y - q[2] * z;
  const rx = ix * q[3] + iw * -q[0] + iy * -q[2] - iz * -q[1];
  const ry = iy * q[3] + iw * -q[1] + iz * -q[0] - ix * -q[2];
  const rz = iz * q[3] + iw * -q[2] + ix * -q[1] - iy * -q[0];
  return [rx, -rz, ry];
}
