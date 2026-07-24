// hud.js — the PFD overlay drawn on a 2D canvas above the WebGL view.
//
// Conventions follow a Western attitude indicator: the pitch ladder and the
// roll pointer are attached to the horizon (so they rotate by -roll), the
// aircraft symbol and the roll scale are fixed to the airframe. The ladder is
// conformal with the 3D scene — the same vertical FOV is used for both, so a
// 10 deg ladder line lands exactly on terrain 10 deg below the nose.

import { DEG, RAD, normDeg, clamp, FT, KT, KMH } from './geo.js';

const WHITE = '#f2f5f8';
const AMBER = '#ffcc33';
const RED = '#ff4136';
const CYAN = '#5fd6ff';
const GREEN = '#61e26a';

export class Hud {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.units = 'aero';           // 'aero' | 'metric'
    this.show = true;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(this.c.clientWidth * dpr), h = Math.round(this.c.clientHeight * dpr);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.dpr = dpr;
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param s     NavState
   * @param opt   {fovDeg, agl, alert, terrainAhead, status}
   */
  draw(s, opt) {
    this.resize();
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    if (!this.show) return;

    this.u = Math.min(w, h) / 100;          // one layout unit ~ 1% of the short side
    this.pxPerRad = (h / 2) / Math.tan(opt.fovDeg * DEG / 2);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.font = `600 ${(2.6 * this.u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'middle';

    this._ladder(s, opt);
    this._rollScale(s);
    this._aircraft();
    this._fpm(s, opt);
    this._summits(opt.labels);
    this._speedTape(s);
    this._altTape(s);
    this._headingTape(s);
    this._dataBlock(s, opt);
    this._overflying(opt.overflying);
    this._alert(opt);
  }

  // --- named summits, projected onto the peaks in the 3D view --------------

  _summits(labels) {
    if (!labels || !labels.length) return;
    const ctx = this.ctx, u = this.u;
    ctx.textAlign = 'left';
    ctx.font = `600 ${(2.1 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const metric = this.units === 'metric';

    for (const L of labels) {
      const near = L.near;
      const col = near ? AMBER : WHITE;
      const x = L.x, y = L.y;
      // marker: a small chevron sitting on the summit
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = Math.max(1, 0.22 * u);
      ctx.globalAlpha = L.alpha;
      ctx.beginPath();
      ctx.moveTo(x - 1.3 * u, y - 1.3 * u); ctx.lineTo(x, y);
      ctx.lineTo(x + 1.3 * u, y - 1.3 * u);
      ctx.stroke();

      const ele = metric ? `${L.e} m` : `${Math.round(L.e * FT)} ft`;
      const dist = metric ? `${(L.d / 1000).toFixed(1)} km` : `${(L.d / 1852).toFixed(1)} NM`;
      const name = L.n;
      const ty = y - 2.2 * u;
      // leader tick
      ctx.beginPath(); ctx.moveTo(x, y - 1.3 * u); ctx.lineTo(x, ty + 0.6 * u); ctx.stroke();

      ctx.font = `700 ${(2.2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      const w1 = ctx.measureText(name).width;
      ctx.font = `600 ${(1.8 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      const w2 = ctx.measureText(`${ele} · ${dist}`).width;
      const bw = Math.max(w1, w2) + 1.6 * u;
      let bx = x - bw / 2;
      bx = clamp(bx, 1 * u, this.w - bw - 1 * u);

      ctx.globalAlpha = L.alpha * 0.85;
      ctx.fillStyle = 'rgba(6,10,16,0.6)';
      ctx.fillRect(bx, ty - 4.4 * u, bw, 4.6 * u);
      ctx.globalAlpha = L.alpha;

      ctx.textAlign = 'left';
      ctx.fillStyle = col;
      ctx.font = `700 ${(2.2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(name, bx + 0.8 * u, ty - 2.9 * u);
      ctx.fillStyle = near ? '#ffe08a' : 'rgba(210,222,235,0.95)';
      ctx.font = `600 ${(1.8 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`${ele} · ${dist}`, bx + 0.8 * u, ty - 0.9 * u);
    }
    ctx.globalAlpha = 1;
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  // Persistent "OVERFLYING <peak>" banner when a summit is very close.
  _overflying(o) {
    if (!o) return;
    const ctx = this.ctx, u = this.u, w = this.w;
    ctx.textAlign = 'center';
    ctx.font = `700 ${(2.4 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const metric = this.units === 'metric';
    const ele = metric ? `${o.e} m` : `${Math.round(o.e * FT)} ft`;
    const txt = `▲ ${o.n}  ${ele}`;
    const tw = ctx.measureText(txt).width + 3 * u;
    const y = this.h * 0.235;
    ctx.fillStyle = 'rgba(6,10,16,0.66)';
    ctx.fillRect(w / 2 - tw / 2, y - 2.2 * u, tw, 4.4 * u);
    ctx.strokeStyle = AMBER; ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.strokeRect(w / 2 - tw / 2, y - 2.2 * u, tw, 4.4 * u);
    ctx.fillStyle = AMBER;
    ctx.fillText(txt, w / 2, y);
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  // --- conformal pitch ladder --------------------------------------------

  _ladder(s, opt) {
    const ctx = this.ctx, w = this.w, h = this.h, u = this.u;
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-s.roll * DEG);                 // ladder rides with the horizon

    const yFor = d => -this.pxPerRad * Math.tan((d - s.pitch) * DEG);
    ctx.lineWidth = Math.max(1, 0.25 * u);
    ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE;
    ctx.textAlign = 'right';

    // Horizon line
    const y0 = yFor(0);
    if (Math.abs(y0) < h * 2.5) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1.4, 0.32 * u);
      ctx.beginPath(); ctx.moveTo(-w * 0.9, y0); ctx.lineTo(w * 0.9, y0); ctx.stroke();
      ctx.lineWidth = Math.max(1, 0.25 * u);
    }

    ctx.globalAlpha = 0.85;
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const y = yFor(d);
      if (y < -h * 0.75 || y > h * 0.75) continue;
      const major = d % 10 === 0;
      const half = (major ? 11 : 5.5) * u;
      const gap = 2.6 * u;
      ctx.setLineDash(d < 0 ? [3 * u, 1.8 * u] : []);
      ctx.beginPath();
      ctx.moveTo(-half, y); ctx.lineTo(-gap, y);
      ctx.moveTo(gap, y); ctx.lineTo(half, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major) {
        // Small down-ticks toward the horizon, as on a real ladder.
        const t = Math.sign(-d) * 1.8 * u;
        ctx.beginPath();
        ctx.moveTo(-half, y); ctx.lineTo(-half, y + t);
        ctx.moveTo(half, y); ctx.lineTo(half, y + t);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.abs(d)), -half - 1.2 * u, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(Math.abs(d)), half + 1.2 * u, y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- roll scale (fixed) + pointer (rides with the horizon) --------------

  _rollScale(s) {
    const ctx = this.ctx, w = this.w, h = this.h, u = this.u;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE; ctx.lineWidth = Math.max(1, 0.22 * u);

    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const len = (a === 0 ? 0 : Math.abs(a) % 30 === 0 ? 2.6 : 1.6) * u;
      const t = (-90 + a) * DEG;              // 0 deg at the top of the arc
      const c = Math.cos(t), si = Math.sin(t);
      if (a === 0) {                          // fixed zero-bank triangle
        ctx.beginPath();
        ctx.moveTo(0, -R); ctx.lineTo(-1.5 * u, -R - 2.6 * u); ctx.lineTo(1.5 * u, -R - 2.6 * u);
        ctx.closePath(); ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(c * R, si * R); ctx.lineTo(c * (R + len), si * (R + len));
      ctx.stroke();
    }

    // Pointer: bank angle, moving opposite the bank like every attitude gyro.
    ctx.rotate(-s.roll * DEG);
    ctx.fillStyle = Math.abs(s.roll) > 45 ? AMBER : WHITE;
    ctx.beginPath();
    ctx.moveTo(0, -R + 0.3 * u);
    ctx.lineTo(-1.6 * u, -R + 3.2 * u);
    ctx.lineTo(1.6 * u, -R + 3.2 * u);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Numeric bank, so there is never any doubt about which way is which.
    if (Math.abs(s.roll) > 5) {
      ctx.fillStyle = Math.abs(s.roll) > 45 ? AMBER : WHITE;
      ctx.textAlign = 'center';
      ctx.font = `600 ${(2.2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`${s.roll > 0 ? 'R' : 'L'}${Math.abs(s.roll).toFixed(0)}°`,
        cx, cy - R + 6.2 * u);
      ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    }
  }

  _aircraft() {
    const ctx = this.ctx, u = this.u, cx = this.w / 2, cy = this.h / 2;
    ctx.save();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.1 * u;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(cx - 14 * u, cy); ctx.lineTo(cx - 5 * u, cy);
      ctx.lineTo(cx - 2.4 * u, cy + 2.6 * u);
      ctx.moveTo(cx + 14 * u, cy); ctx.lineTo(cx + 5 * u, cy);
      ctx.lineTo(cx + 2.4 * u, cy + 2.6 * u);
      ctx.stroke();
      ctx.strokeStyle = AMBER; ctx.lineWidth = 0.62 * u;
    }
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.arc(cx, cy, 0.55 * u, 0, 7); ctx.fill();
    ctx.restore();
  }

  // --- flight path marker (velocity vector) -------------------------------

  _fpm(s, opt) {
    if (s.gs < 3) return;
    const gamma = Math.atan2(s.vs, Math.max(s.gs, 1)) * RAD;
    // Angles of the velocity vector relative to the nose, in the display frame.
    const dHead = ((s.track - s.heading + 540) % 360) - 180;
    const dPitch = gamma - s.pitch;
    if (Math.abs(dHead) > 45) return;

    const ctx = this.ctx, u = this.u, cx = this.w / 2, cy = this.h / 2;
    const r = -s.roll * DEG;
    let x = this.pxPerRad * Math.tan(dHead * DEG);
    let y = -this.pxPerRad * Math.tan(dPitch * DEG);
    const rx = x * Math.cos(r) - y * Math.sin(r);
    const ry = x * Math.sin(r) + y * Math.cos(r);
    if (Math.abs(ry) > this.h * 0.42) return;

    ctx.save();
    ctx.translate(cx + rx, cy + ry);
    ctx.strokeStyle = GREEN; ctx.lineWidth = Math.max(1.2, 0.3 * u);
    const R = 1.8 * u;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R, 0); ctx.lineTo(-R - 2.6 * u, 0);
    ctx.moveTo(R, 0); ctx.lineTo(R + 2.6 * u, 0);
    ctx.moveTo(0, -R); ctx.lineTo(0, -R - 1.8 * u);
    ctx.stroke();
    ctx.restore();
  }

  // --- tapes ---------------------------------------------------------------

  _tapeFrame(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,12,18,0.42)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(242,245,248,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  _readout(x, y, w, hh, text, color) {
    const ctx = this.ctx, u = this.u;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(x, y - hh / 2, w, hh);
    ctx.strokeStyle = color || WHITE; ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.strokeRect(x + 0.5, y - hh / 2 + 0.5, w - 1, hh - 1);
    ctx.fillStyle = color || WHITE;
    ctx.textAlign = 'center';
    ctx.font = `700 ${(3.2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(text, x + w / 2, y);
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  _speedTape(s) {
    const ctx = this.ctx, u = this.u, h = this.h;
    const metric = this.units === 'metric';
    const v = s.gs * (metric ? KMH : KT);
    const step = metric ? 20 : 10;
    const pxPerUnit = (2.4 * u) / step * 2;
    const x = 2 * u, tw = 12 * u, ty = h * 0.22, th = h * 0.56;

    this._tapeFrame(x, ty, tw, th);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, ty, tw, th); ctx.clip();
    ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE;
    ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.textAlign = 'right';
    ctx.font = `600 ${(2.3 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const cy = ty + th / 2;
    const base = Math.floor(v / step) * step;
    for (let k = -8; k <= 8; k++) {
      const val = base + k * step;
      if (val < 0) continue;
      const y = cy + (v - val) * pxPerUnit;
      if (y < ty || y > ty + th) continue;
      const major = (val / step) % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(x + tw, y); ctx.lineTo(x + tw - (major ? 2.4 : 1.4) * u, y); ctx.stroke();
      if (major) ctx.fillText(String(val), x + tw - 3.2 * u, y);
    }
    ctx.restore();
    this._readout(x, ty + th / 2, tw + 1.5 * u, 5 * u, v.toFixed(0), WHITE);
    ctx.textAlign = 'center'; ctx.fillStyle = CYAN;
    ctx.font = `600 ${(2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(metric ? 'km/h GS' : 'kt GS', x + tw / 2, ty - 1.8 * u);
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  _altTape(s) {
    const ctx = this.ctx, u = this.u, h = this.h, w = this.w;
    const metric = this.units === 'metric';
    const a = s.alt * (metric ? 1 : FT);
    const step = metric ? 50 : 200;
    const pxPerUnit = (2.4 * u) / step * 2;
    const tw = 14 * u, x = w - tw - 2 * u, ty = h * 0.22, th = h * 0.56;

    this._tapeFrame(x, ty, tw, th);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, ty, tw, th); ctx.clip();
    ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE;
    ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.textAlign = 'left';
    ctx.font = `600 ${(2.3 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const cy = ty + th / 2;
    const base = Math.floor(a / step) * step;
    for (let k = -8; k <= 8; k++) {
      const val = base + k * step;
      const y = cy + (a - val) * pxPerUnit;
      if (y < ty || y > ty + th) continue;
      const major = (val / step) % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + (major ? 2.4 : 1.4) * u, y); ctx.stroke();
      if (major) ctx.fillText(String(val), x + 3.2 * u, y);
    }
    ctx.restore();
    this._readout(x - 1.5 * u, cy, tw + 1.5 * u, 5 * u, a.toFixed(0), WHITE);

    ctx.textAlign = 'center'; ctx.fillStyle = CYAN;
    ctx.font = `600 ${(2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(metric ? 'm MSL' : 'ft MSL', x + tw / 2, ty - 1.8 * u);

    // Vertical speed, drawn as a bar hanging off the altitude tape.
    const vs = s.vs * (metric ? 1 : FT * 60);
    const full = metric ? 10 : 2000;
    const bh = th * 0.42;
    const bx = x + tw + 0.6 * u, by = cy;
    ctx.strokeStyle = 'rgba(242,245,248,0.4)';
    ctx.beginPath(); ctx.moveTo(bx, by - bh / 2); ctx.lineTo(bx, by + bh / 2); ctx.stroke();
    const vy = by - clamp(vs / full, -1, 1) * (bh / 2);
    ctx.strokeStyle = Math.abs(vs) > full * 0.75 ? AMBER : GREEN;
    ctx.lineWidth = Math.max(2, 0.55 * u);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, vy); ctx.stroke();
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  _headingTape(s) {
    const ctx = this.ctx, u = this.u, w = this.w, h = this.h;
    const th = 5.6 * u, ty = h - th - 7.5 * u;
    const pxPerDeg = w / 90;
    const hd = normDeg(s.heading);

    ctx.fillStyle = 'rgba(8,12,18,0.5)';
    ctx.fillRect(0, ty, w, th);
    ctx.strokeStyle = 'rgba(242,245,248,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ty + 0.5); ctx.lineTo(w, ty + 0.5); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(0, ty, w, th); ctx.clip();
    ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE;
    ctx.textAlign = 'center';
    ctx.font = `600 ${(2.2 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const start = Math.floor((hd - 45) / 5) * 5;
    for (let d = start; d <= hd + 50; d += 5) {
      const x = w / 2 + (((d - hd + 540) % 360) - 180) * pxPerDeg;
      if (x < -20 || x > w + 20) continue;
      const major = d % 10 === 0;
      ctx.lineWidth = Math.max(1, 0.2 * u);
      ctx.beginPath();
      ctx.moveTo(x, ty); ctx.lineTo(x, ty + (major ? 2.2 : 1.2) * u); ctx.stroke();
      if (major) {
        const dd = normDeg(d);
        const lbl = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W'
          : String(dd / 10);
        ctx.fillText(lbl, x, ty + 3.9 * u);
      }
    }
    // Ground track bug.
    if (isFinite(s.track)) {
      const x = w / 2 + (((s.track - hd + 540) % 360) - 180) * pxPerDeg;
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(x, ty + th); ctx.lineTo(x - 1.4 * u, ty + th - 2 * u);
      ctx.lineTo(x + 1.4 * u, ty + th - 2 * u); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // Fixed lubber line + boxed heading.
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(w / 2, ty - 0.2 * u);
    ctx.lineTo(w / 2 - 1.5 * u, ty - 2.6 * u);
    ctx.lineTo(w / 2 + 1.5 * u, ty - 2.6 * u);
    ctx.closePath(); ctx.fill();
    this._readout(w / 2 - 6 * u, ty + th + 3.4 * u, 12 * u, 4.6 * u,
      String(Math.round(hd)).padStart(3, '0') + '°', WHITE);
  }

  _dataBlock(s, opt) {
    const ctx = this.ctx, u = this.u, h = this.h;
    const metric = this.units === 'metric';
    ctx.textAlign = 'left';
    ctx.font = `600 ${(2.1 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;

    const agl = opt.agl;
    let aglTxt = '---';
    if (isFinite(agl)) aglTxt = metric ? `${agl.toFixed(0)} m` : `${(agl * FT).toFixed(0)} ft`;
    const aglCol = !isFinite(agl) ? WHITE : agl < 100 ? RED : agl < 300 ? AMBER : GREEN;

    const rows = [
      ['AGL', aglTxt, aglCol],
      ['TRK', isFinite(s.track) ? String(Math.round(normDeg(s.track))).padStart(3, '0') + '°' : '---', WHITE],
      ['VS', metric ? `${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(1)} m/s`
        : `${s.vs >= 0 ? '+' : ''}${(s.vs * FT * 60).toFixed(0)} fpm`, WHITE],
      ['SRC', opt.status || s.source.toUpperCase(), s.source === 'gps' ? GREEN : CYAN],
    ];
    let y = h - 5.6 * u;
    for (let i = rows.length - 1; i >= 0; i--) {
      ctx.fillStyle = 'rgba(150,170,190,0.9)';
      ctx.fillText(rows[i][0], 2.2 * u, y);
      ctx.fillStyle = rows[i][2];
      ctx.fillText(rows[i][1], 9 * u, y);
      y -= 2.9 * u;
    }
    ctx.font = `600 ${(2.6 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
  }

  _alert(opt) {
    if (!opt.alert || opt.alert === 'none') return;
    const ctx = this.ctx, u = this.u, w = this.w, h = this.h;
    const warn = opt.alert === 'warning';
    const blink = warn && (performance.now() % 900 < 450);
    const txt = warn ? 'TERRAIN  PULL UP' : 'TERRAIN AHEAD';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `800 ${(3.4 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
    const tw = ctx.measureText(txt).width + 4 * u;
    const y = h * 0.135;
    ctx.fillStyle = warn ? (blink ? '#ff2015' : '#8b0f0a') : '#8a6b00';
    ctx.fillRect(w / 2 - tw / 2, y - 2.7 * u, tw, 5.4 * u);
    ctx.strokeStyle = warn ? RED : AMBER; ctx.lineWidth = Math.max(1.5, 0.3 * u);
    ctx.strokeRect(w / 2 - tw / 2, y - 2.7 * u, tw, 5.4 * u);
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, w / 2, y);
    ctx.restore();
  }
}
