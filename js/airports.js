// airports.js — French airfields, so the display can draw runways on the
// terrain the way a Garmin SVT / Dynon SynVis picture does.
//
// {c: ICAO, n: name, la, lo, e: field elevation (m), r: [{h: runway true
// heading deg, l: length m, w: width m}]}
//
// ACCURACY: positions and field elevations are good to ~100 m; runway headings
// are taken from the designator (x10), which is MAGNETIC — French declination
// is ~1-2 deg E, i.e. visually irrelevant here. Lengths are nominal. This is a
// hand-kept subset for display purposes and is NOT for navigation. To build a
// complete, authoritative table, regenerate from the OurAirports CSVs
// (airports.csv + runways.csv, public domain) exactly as the ESP32
// traffic-radar airports_db.h was generated.

export const AIRPORTS = [
  // --- majors ---
  { c: 'LFPG', n: 'Paris CDG',        la: 49.0097, lo:  2.5479, e: 119, r: [{ h:  90, l: 4200, w: 60 }] },
  { c: 'LFPO', n: 'Paris Orly',       la: 48.7233, lo:  2.3794, e:  89, r: [{ h:  70, l: 3320, w: 45 }] },
  { c: 'LFPB', n: 'Le Bourget',       la: 48.9694, lo:  2.4414, e:  66, r: [{ h:  70, l: 3000, w: 45 }] },
  { c: 'LFML', n: 'Marseille',        la: 43.4393, lo:  5.2214, e:  22, r: [{ h: 130, l: 3500, w: 45 }] },
  { c: 'LFLL', n: 'Lyon St-Exupéry',  la: 45.7256, lo:  5.0811, e: 250, r: [{ h: 170, l: 4000, w: 45 }] },
  { c: 'LFMN', n: 'Nice',             la: 43.6584, lo:  7.2159, e:   4, r: [{ h:  40, l: 2960, w: 45 }] },
  { c: 'LFBO', n: 'Toulouse Blagnac', la: 43.6291, lo:  1.3638, e: 152, r: [{ h: 140, l: 3500, w: 45 }] },
  { c: 'LFBD', n: 'Bordeaux',         la: 44.8283, lo: -0.7156, e:  49, r: [{ h:  50, l: 3100, w: 45 }] },
  { c: 'LFST', n: 'Strasbourg',       la: 48.5383, lo:  7.6282, e: 154, r: [{ h:  50, l: 2400, w: 45 }] },
  { c: 'LFRS', n: 'Nantes',           la: 47.1532, lo: -1.6107, e:  27, r: [{ h:  30, l: 2900, w: 45 }] },
  { c: 'LFRB', n: 'Brest',            la: 48.4479, lo: -4.4185, e:  99, r: [{ h:  70, l: 3100, w: 45 }] },
  { c: 'LFSB', n: 'Basel-Mulhouse',   la: 47.5896, lo:  7.5299, e: 270, r: [{ h: 150, l: 3900, w: 60 }] },
  { c: 'LFMT', n: 'Montpellier',      la: 43.5762, lo:  3.9630, e:   5, r: [{ h: 120, l: 2600, w: 45 }] },
  { c: 'LFLC', n: 'Clermont-Ferrand', la: 45.7867, lo:  3.1692, e: 332, r: [{ h:  80, l: 3015, w: 45 }] },
  { c: 'LFQQ', n: 'Lille',            la: 50.5619, lo:  3.0894, e:  47, r: [{ h:  80, l: 2825, w: 45 }] },
  { c: 'LFJL', n: 'Metz-Nancy',       la: 48.9821, lo:  6.2513, e: 265, r: [{ h:  20, l: 2650, w: 45 }] },
  { c: 'LFOB', n: 'Beauvais',         la: 49.4544, lo:  2.1128, e: 110, r: [{ h: 120, l: 2430, w: 45 }] },
  { c: 'LFOT', n: 'Tours',            la: 47.4322, lo:  0.7276, e: 108, r: [{ h:  20, l: 2400, w: 45 }] },
  { c: 'LFSD', n: 'Dijon',            la: 47.2689, lo:  5.0900, e: 219, r: [{ h: 180, l: 2400, w: 45 }] },

  // --- Alps / Savoie (the preset country) ---
  { c: 'LFLS', n: 'Grenoble Alpes',   la: 45.3629, lo:  5.3294, e: 397, r: [{ h:  90, l: 3050, w: 45 }] },
  { c: 'LFLB', n: 'Chambéry Savoie',  la: 45.6381, lo:  5.8800, e: 235, r: [{ h: 180, l: 2000, w: 45 }] },
  { c: 'LFLP', n: 'Annecy',           la: 45.9291, lo:  6.1064, e: 460, r: [{ h:  40, l: 1170, w: 30 }] },
  { c: 'LFLJ', n: 'Courchevel',       la: 45.3968, lo:  6.6347, e: 2008, r: [{ h:  40, l: 537, w: 25 }] },
  { c: 'LFHM', n: 'Megève',           la: 45.8208, lo:  6.6522, e: 1458, r: [{ h: 180, l: 535, w: 25 }] },
  { c: 'LFHU', n: 'Alpe d\'Huez',     la: 45.0883, lo:  6.0847, e: 1860, r: [{ h:  50, l: 585, w: 25 }] },
  { c: 'LFLG', n: 'Grenoble Versoud', la: 45.2189, lo:  5.8497, e: 220, r: [{ h:  90, l: 900, w: 25 }] },
  { c: 'LFLI', n: 'Annemasse',        la: 46.1919, lo:  6.2681, e: 500, r: [{ h: 120, l: 800, w: 25 }] },
  { c: 'LFKA', n: 'Albertville',      la: 45.6419, lo:  6.3297, e: 350, r: [{ h: 180, l: 850, w: 25 }] },
  { c: 'LFLY', n: 'Lyon Bron',        la: 45.7272, lo:  4.9444, e: 198, r: [{ h: 160, l: 1820, w: 45 }] },
  { c: 'LFLU', n: 'Valence',          la: 44.9216, lo:  4.9699, e: 160, r: [{ h:  10, l: 1850, w: 30 }] },
  { c: 'LFNA', n: 'Gap-Tallard',      la: 44.4550, lo:  6.0378, e: 612, r: [{ h:  30, l: 900, w: 25 }] },
  { c: 'LFMX', n: 'St-Auban',         la: 44.0603, lo:  5.9906, e: 458, r: [{ h:  20, l: 1000, w: 30 }] },

  // --- south / Provence / Pyrenees ---
  { c: 'LFMD', n: 'Cannes Mandelieu', la: 43.5420, lo:  6.9535, e:   4, r: [{ h: 170, l: 1600, w: 30 }] },
  { c: 'LFMV', n: 'Avignon',          la: 43.9073, lo:  4.9018, e:  37, r: [{ h: 170, l: 1880, w: 45 }] },
  { c: 'LFTH', n: 'Hyères',           la: 43.0973, lo:  6.1460, e:   3, r: [{ h:  50, l: 2120, w: 45 }] },
  { c: 'LFBZ', n: 'Biarritz',         la: 43.4684, lo: -1.5311, e:  75, r: [{ h:  90, l: 2250, w: 45 }] },
  { c: 'LFBP', n: 'Pau',              la: 43.3800, lo: -0.4186, e: 188, r: [{ h: 130, l: 2500, w: 45 }] },
  { c: 'LFBT', n: 'Tarbes Lourdes',   la: 43.1787, lo: -0.0064, e: 384, r: [{ h:  20, l: 3000, w: 45 }] },
  { c: 'LFBL', n: 'Limoges',          la: 45.8628, lo:  1.1794, e: 396, r: [{ h:  30, l: 2500, w: 45 }] },
  { c: 'LFBH', n: 'La Rochelle',      la: 46.1792, lo: -1.1953, e:  23, r: [{ h:  90, l: 2255, w: 45 }] },

  // --- west / north ---
  { c: 'LFRK', n: 'Caen',             la: 49.1733, lo: -0.4500, e:  78, r: [{ h: 130, l: 1750, w: 45 }] },
  { c: 'LFRD', n: 'Dinard',           la: 48.5877, lo: -2.0800, e:  66, r: [{ h: 170, l: 2200, w: 45 }] },
  { c: 'LFAT', n: 'Le Touquet',       la: 50.5174, lo:  1.6206, e:  11, r: [{ h: 130, l: 1850, w: 45 }] },

  // --- Corsica ---
  { c: 'LFKJ', n: 'Ajaccio',          la: 41.9236, lo:  8.8029, e:   5, r: [{ h:  20, l: 2400, w: 45 }] },
  { c: 'LFKC', n: 'Calvi',            la: 42.5244, lo:  8.7931, e:  64, r: [{ h: 170, l: 2100, w: 45 }] },
  { c: 'LFKB', n: 'Bastia',           la: 42.5527, lo:  9.4837, e:   8, r: [{ h: 160, l: 2520, w: 45 }] },
  { c: 'LFKF', n: 'Figari',           la: 41.5006, lo:  9.0978, e:  26, r: [{ h:  50, l: 2200, w: 45 }] },
];

/** Airfields within `maxM` metres of (lat, lon), nearest first. */
export function nearbyAirports(lat, lon, maxM = 40000) {
  const cl = Math.cos(lat * Math.PI / 180);
  const out = [];
  for (const a of AIRPORTS) {
    const dy = (a.la - lat) * 111320;
    const dx = (a.lo - lon) * 111320 * cl;
    const d = Math.hypot(dx, dy);
    if (d <= maxM) out.push({ a, d });
  }
  out.sort((p, q) => p.d - q.d);
  return out;
}
