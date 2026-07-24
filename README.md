# SynthVis — Synthetic Vision Terrain Display

A Garmin-SVT-style synthetic vision display for the web. It draws a shaded 3D
terrain mesh around you from **real French elevation data** (IGN / Géoplateforme,
free, no API key) with a full primary-flight-display overlay: pitch ladder,
speed/altitude tapes, heading tape, flight-path marker, and TAWS terrain
colouring. Fly the built-in simulator, or feed it your iPhone's GPS and motion
sensors. Works on land too (drive mode). Installs as a home-screen PWA and runs
**offline** once you've cached an area.

> ⚠️ Advisory only. This is an experimental display, **not** certified for
> navigation. Do not use it to avoid terrain.

![hero](docs/hero.jpg)

---

## Quick start (local)

Any static file server works — it's plain ES modules, no build step:

```bash
cd synthvis
python3 -m http.server 8777
# open http://localhost:8777
```

Tap **Start**, then fly with:

- **Drag the lower-left of the screen** = stick (pitch + roll)
- **＋ / －** buttons = throttle
- Keyboard: arrows = stick, `W`/`S` = throttle, space = pause, `H` = hide HUD
- **☰** menu → switch **Simulator / GPS / GPS+IMU**, pick a location preset,
  range, mesh quality, units, FOV, and preload/clear the offline cache.

## Deploy to GitHub Pages

1. Put the contents of `synthvis/` at the repo root (or in `/docs`).
2. Repo **Settings → Pages →** deploy from branch, `main`, `/ (root)` or `/docs`.
3. Open `https://<user>.github.io/<repo>/`.

That's it — everything is static. HTTPS (which Pages gives you) is **required**
for Geolocation and the iOS motion sensors. On iPhone: open in Safari → Share →
**Add to Home Screen** for a full-screen, offline-capable app.

### Before a flight (offline use)

Open the menu, set your range, and tap **Preload this area**. Tiles are stored
in IndexedDB *and* the service-worker cache, so you can then fly the same area
with the phone in airplane mode.

---

## How it works

```
 GPS / IMU / Sim ──► NavState ──► TerrainMesh.rebuild() ──► Renderer (WebGL2)
   (js/nav.js)                      (js/mesh.js)              (js/render.js)
                          ▲              │                         │
                          │        DemCache.sample()          HUD overlay
                    js/geo.js         (js/dem.js)              (js/hud.js)
                                          │
                              IGN Géoplateforme WMS (float32 BIL)
```

- **Elevation** (`js/dem.js`) — the IGN `wms-r` endpoint serves raw `float32`
  heightfields (`FORMAT=image/x-bil;bits=32`). CORS is open (`*`), no key.
  `HIGHRES` (RGE ALTI, 1–25 m) covers France; where it stops at the border,
  tiles are auto-filled from `SRTM3` so Alpine/Pyrenean views stay seamless.
  Tiles are a quadtree of `(64+1)²`-sample grids on an exact lat/lon lattice
  (shared edges ⇒ no seams), cached in RAM + IndexedDB.
- **Mesh** (`js/mesh.js`) — a **world-anchored geometry clipmap**: nested square
  rings, each twice the spacing and extent of the one inside it, with vertices
  pinned to a fixed world lattice. Because the vertices don't move with the
  aircraft, terrain can't "swim" or reshape as you approach — you fly *through*
  stable geometry, and a level only re-samples in discrete steps that reuse the
  same world points (so no popping). Earth curvature is subtracted, so distant
  terrain correctly drops below the horizon.
- **Renderer** (`js/render.js`) — WebGL2. A sky-dome shader, then the terrain:
  hypsometric base tint by absolute elevation, hillshade from a fixed NW sun,
  a lat/lon reference grid, distance haze, logarithmic depth (60 m → 80 km in
  one pass), and TAWS red/amber banding by height **relative to the aircraft**.
- **HUD** (`js/hud.js`) — a conformal PFD on a 2D canvas; the pitch ladder uses
  the same vertical FOV as the 3D scene, so ladder lines land on the terrain.
- **Nav** (`js/nav.js`) — three interchangeable sources, all producing the same
  `NavState`:
  - **Simulator** — a small flight / drive model (drive mode sticks to the road
    and reads pitch from the DEM slope).
  - **GPS** — Geolocation. With no AHRS, attitude is *derived*: pitch from climb
    angle, bank from turn rate — exactly what a real SVT box does.
  - **GPS + IMU** — full device attitude from the iPhone's motion sensors
    (`deviceorientation` + compass), camera looking out the back.

## Data source & attribution

Elevation © **IGN / Géoplateforme** — `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`
(RGE ALTI®) and `…SRTM3`, served from `https://data.geopf.fr/wms-r/wms`. Open
licence (Etalab / public data), no account or key required. Please keep the
attribution in the app.

## Tuning

Everything lives in the `cfg` object and `QUALITY` table in `js/main.js`:
range (15–80 km), mesh density, FOV, units (ft/kt or m/km-h), TAWS on/off,
lat-lon grid, GPS altitude offset (geoid vs ellipsoid trim).

If you edit the JS and don't see changes, it's the service worker serving the
cached shell — bump the version in `sw.js` (`synthvis-shell-v1` → `-v2`) or
un-register it in DevTools → Application.

## Roadmap → ESP32

The renderer, mesh, and geo math were written to transliterate to C for an
ESP32-S3 board. See **[PORTING.md](PORTING.md)** for the plan (pre-baked DEM
tiles on SD/flash, a fixed-topology mesh, and a flat-shaded software
rasteriser).

## Browser support

WebGL2 + ES modules: iOS Safari 15+, and any current Chrome/Firefox/Edge/Safari.
Motion sensors need the iOS permission prompt (handled on the GPS+IMU button).
