// geo.js — geodesy, local ENU frame, and 4x4 matrix helpers.
//
// PORTABILITY: this file is pure math, no browser APIs, no allocation in the
// hot paths. It transliterates to C almost line-for-line for the ESP32 port.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const R_EARTH = 6371008.8;       // mean earth radius, m
export const FT = 3.280839895;          // m -> ft
export const KT = 1.943844;             // m/s -> kt
export const KMH = 3.6;                 // m/s -> km/h

// Meters per degree of latitude / longitude at a given latitude (WGS84 series).
export function mPerDegLat(lat) {
  const c = Math.cos(2 * lat * DEG), c4 = Math.cos(4 * lat * DEG);
  return 111132.92 - 559.82 * c + 1.175 * c4;
}
export function mPerDegLon(lat) {
  const c = Math.cos(lat * DEG), c3 = Math.cos(3 * lat * DEG);
  return 111412.84 * c - 93.5 * c3;
}

// Earth-curvature drop: how far below the local tangent plane a point at
// ground distance d sits. At 45 km this is ~159 m — very visible in a
// synthetic-vision view, so we always apply it.
export function curvatureDrop(d) { return (d * d) / (2 * R_EARTH); }

// Great-circle-ish distance for short ranges (flat earth, good to <100 km).
export function flatDistance(lat1, lon1, lat2, lon2) {
  const mLat = mPerDegLat(lat1), mLon = mPerDegLon(lat1);
  const dy = (lat2 - lat1) * mLat, dx = (lon2 - lon1) * mLon;
  return Math.hypot(dx, dy);
}

export function normDeg(d) { d %= 360; return d < 0 ? d + 360 : d; }
// Shortest signed difference a-b, in (-180, 180].
export function diffDeg(a, b) { let d = (a - b) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Minimal 4x4 matrix math (column-major, OpenGL layout)
// ---------------------------------------------------------------------------

export function mat4() { return new Float32Array(16); }

export function perspective(out, fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf;
  out[11] = -1; out[14] = 2 * far * near * nf;
  return out;
}

export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/**
 * View matrix for an aircraft attitude in the ENU frame.
 *
 *   ENU axes: +x East, +y North, +z Up.
 *   heading: degrees from true north, clockwise (the nose direction)
 *   pitch:   degrees, nose up positive
 *   roll:    degrees, right wing down positive
 *
 * Camera convention is OpenGL's: it looks down its own -Z.
 */
export function viewMatrix(out, eye, headingDeg, pitchDeg, rollDeg) {
  const h = headingDeg * DEG, p = pitchDeg * DEG, r = rollDeg * DEG;
  const sh = Math.sin(h), ch = Math.cos(h), sp = Math.sin(p), cp = Math.cos(p);
  const sr = Math.sin(r), cr = Math.cos(r);

  // Nose direction, and the wings-level right/up basis around it.
  const fx = sh * cp, fy = ch * cp, fz = sp;
  const r0x = ch, r0y = -sh, r0z = 0;                 // level right wing
  // up0 = right0 x fwd  (gives +z when level; the opposite order flips the
  // world vertically — that was the "upside down" bug).
  const u0x = r0y * fz - r0z * fy;
  const u0y = r0z * fx - r0x * fz;
  const u0z = r0x * fy - r0y * fx;

  // Rolling right is a NEGATIVE rotation about the nose vector.
  const rx = r0x * cr - u0x * sr, ry = r0y * cr - u0y * sr, rz = r0z * cr - u0z * sr;
  const ux = r0x * sr + u0x * cr, uy = r0y * sr + u0y * cr, uz = r0z * sr + u0z * cr;

  // out = R^T * translate(-eye)
  out[0] = rx; out[4] = ry; out[8] = rz;
  out[1] = ux; out[5] = uy; out[9] = uz;
  out[2] = -fx; out[6] = -fy; out[10] = -fz;
  out[3] = 0; out[7] = 0; out[11] = 0;
  out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = (fx * eye[0] + fy * eye[1] + fz * eye[2]);
  out[15] = 1;
  return out;
}

// Inverse of the 3x3 rotation part, packed as a mat3 for the sky shader:
// turns a clip-space ray back into an ENU direction.
export function viewRotationInverse(out9, view) {
  // For a pure rotation, inverse == transpose.
  out9[0] = view[0]; out9[1] = view[4]; out9[2] = view[8];
  out9[3] = view[1]; out9[4] = view[5]; out9[5] = view[9];
  out9[6] = view[2]; out9[7] = view[6]; out9[8] = view[10];
  return out9;
}
