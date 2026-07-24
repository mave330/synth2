# Porting SynthVis to the ESP32-S3

This web app was structured so the hard parts move to your AMOLED boards with
minimal rethinking. The math (`geo.js`), the mesh topology (`mesh.js`), and the
shading *formula* (`render.js`) are the reusable core; the browser-only parts
(WMS fetch, WebGL, DOM) get replaced. This is the plan, matched to the boards in
your memory notes (Waveshare ESP32-S3-Touch-AMOLED-2.06 / 2.41, Arduino_GFX).

## The one hard constraint

The ESP32-S3 has **no GPU**. You rasterise triangles in software into the PSRAM
canvas you already use for the AHRS/radar builds. Budget accordingly:

| | web (this app) | ESP32-S3 target |
|---|---|---|
| Mesh | 6-level clipmap ≈ 21k tri | **4-level, 24-cell ≈ 4k tri** |
| Range | 45 km | 15–25 km |
| Shading | per-fragment | **per-triangle (flat)** |
| Depth | z-buffer | painter's: draw far→near rings |
| DEM | WMS float32 | **pre-baked int16 tiles on SD/flash** |
| Target | 60 fps | 12–20 fps is fine for SVT |

A flat-shaded, back-to-front radial mesh needs **no z-buffer** — rings are
already sorted by distance, so drawing outer rings first and filling triangles
gives correct occlusion for a heightfield. That alone saves the RAM a depth
buffer would cost.

## What ports as-is (rewrite JS → C, same logic)

- **`geo.js`** → `geo.c`. `mPerDegLat/Lon`, `curvatureDrop`, the 4×4 matrix
  helpers, and `viewMatrix()` are plain float math. Use the same ENU frame
  (E,N,U) and the same heading/pitch/roll convention as your Mahony AHRS output
  so the horizon matches the artificial-horizon build.
- **`mesh.js`** → `mesh.c`. It's a **world-anchored geometry clipmap**: nested
  square rings on a fixed world lattice. Build the index list **once** at boot
  (topology never changes); a rebuild only rewrites vertex Z + normals, and only
  for the levels whose snapped centre moved — typically nothing on most frames.
  This world-anchoring is what stops the terrain swimming; keep it on the ESP32
  (it also means you resample the SD-card DEM ~once a second, not every frame).
  Drop to ~4 levels of a 24-cell grid.
- **`render.js` shading** → your triangle fill. `terrainColor()` only needs a
  triangle's centroid elevation, its face normal, and its distance — all of
  which you have per-triangle. Precompute the hypsometric ramp as a 256-entry
  `uint16_t` RGB565 LUT indexed by elevation; do the `dot(n,sun)` in fixed point.
- **TAWS bands** — identical: compare centroid elevation to own-altitude.

## What gets replaced

| Web piece | ESP32 replacement |
|---|---|
| `dem.js` WMS fetch | Reader over pre-baked tiles on **SD card** (or SPIFFS/LittleFS for a small home area). Store `int16` metres, same 65×65 lattice. |
| WebGL2 | Software triangle rasteriser into the `Arduino_Canvas` PSRAM buffer you already use. RGB565. |
| `nav.js` GPS source | The **NMEA feed you already parse** (phone UDP / F4 Wing MSP). |
| `nav.js` IMU source | Your **Mahony AHRS** — feed its heading/pitch/roll straight into `viewMatrix()`. |
| `hud.js` 2D canvas | Reuse your existing `Arduino_GFX` PFD drawing from the AHRS build. |
| Service worker / IndexedDB | Not needed — the SD card *is* the offline store. |

## Pre-baking DEM tiles (do it once, on the desktop)

Pull the same IGN WMS this app uses and write compact tiles for your region:

```python
# baker.py — one tile: 65x65 int16 metres, little-endian, row 0 = north.
import struct, urllib.request
WMS = "https://data.geopf.fr/wms-r/wms"
def tile(level_deg, tx, ty, out):
    S, half = 65, level_deg/64/2
    la0, lo0 = ty*level_deg-half, tx*level_deg-half
    la1, lo1 = (ty+1)*level_deg+half, (tx+1)*level_deg+half
    url = (f"{WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES="
           f"&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&CRS=EPSG:4326"
           f"&FORMAT=image/x-bil;bits=32&WIDTH={S}&HEIGHT={S}"
           f"&BBOX={la0},{lo0},{la1},{lo1}")
    f = struct.unpack(f"<{S*S}f", urllib.request.urlopen(url).read())
    with open(out, "wb") as o:
        o.write(struct.pack(f"<{S*S}h",
                *[max(-500, min(9000, int(v if v > -9000 else 0))) for v in f]))
```

Name tiles `L{level}_{tx}_{ty}.bin`, mirror the `levelDeg()` addressing from
`dem.js`, and the on-device sampler is the same bilinear lookup as
`DemCache._bilinear()`. int16 halves the storage vs float; a 1° box at level 0
is a few MB — trivial on SD.

## Suggested milestones

1. **Static horizon** — one flat tile, fixed attitude, prove the rasteriser +
   hypsometric LUT in the PSRAM canvas.
2. **AHRS attitude** — wire in `viewMatrix()` from your Mahony output; the
   terrain horizon should track the artificial-horizon build exactly.
3. **NMEA position** — recentre the mesh on GPS; add ring-scroll rebuild.
4. **SD tiles + LOD** — multi-level tiles, `levelForDistance()` per ring.
5. **TAWS colours + PFD overlay** — reuse the AHRS PFD, add the terrain bands.

The web app is your reference implementation and test bench: when the ESP32 view
looks wrong, put the same lat/lon/attitude into SynthVis and compare.
