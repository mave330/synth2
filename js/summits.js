// summits.js — a compact database of major French summits, so the display can
// name the peak you're flying over / toward.
//
// Curated "named" summits across the French ranges (Alps, Pyrenees, Massif
// Central, Corsica, Vosges, Jura). Coordinates are apex positions to ~100 m,
// which is plenty to drop a label on the right peak. Kept deliberately small
// and static so it costs nothing and ports straight to the ESP32 as a PROGMEM
// table (same idea as your airports_db.h).
//
// {n: name, la: lat, lo: lon, e: elevation m}.

export const SUMMITS = [
  // --- Mont Blanc massif & Haute-Savoie ---
  { n: 'Mont Blanc',            la: 45.8326, lo: 6.8652, e: 4808 },
  { n: 'Mont Maudit',           la: 45.8433, lo: 6.8760, e: 4465 },
  { n: 'Dôme du Goûter',        la: 45.8422, lo: 6.8497, e: 4304 },
  { n: 'Grandes Jorasses',      la: 45.8672, lo: 6.9853, e: 4208 },
  { n: 'Aiguille Verte',        la: 45.9339, lo: 6.9583, e: 4122 },
  { n: 'Aiguille de Bionnassay', la: 45.8386, lo: 6.8189, e: 4052 },
  { n: 'Aiguille du Géant',     la: 45.8636, lo: 6.9525, e: 4013 },
  { n: 'Aiguille d\'Argentière', la: 45.9636, lo: 7.0114, e: 3900 },
  { n: 'Aiguille du Midi',      la: 45.8785, lo: 6.8873, e: 3842 },
  { n: 'Mont Dolent',           la: 45.9294, lo: 7.0206, e: 3823 },
  { n: 'Les Drus',              la: 45.9331, lo: 6.9497, e: 3754 },
  { n: 'Mont Buet',             la: 46.0197, lo: 6.8506, e: 3096 },
  { n: 'Pointe Percée',         la: 45.9469, lo: 6.5406, e: 2750 },
  { n: 'La Tournette',          la: 45.8172, lo: 6.2464, e: 2351 },
  { n: 'Dent d\'Oche',          la: 46.3556, lo: 6.7256, e: 2222 },

  // --- Vanoise / Tarentaise ---
  { n: 'Grande Casse',          la: 45.4014, lo: 6.8506, e: 3855 },
  { n: 'Mont Pourri',           la: 45.5306, lo: 6.9019, e: 3779 },
  { n: 'Dent Parrachée',        la: 45.2497, lo: 6.7331, e: 3697 },
  { n: 'Grande Motte',          la: 45.3639, lo: 6.9319, e: 3653 },

  // --- Écrins / Oisans / Belledonne ---
  { n: 'Barre des Écrins',      la: 44.9239, lo: 6.3617, e: 4102 },
  { n: 'Dôme de Neige',         la: 44.9264, lo: 6.3567, e: 4015 },
  { n: 'La Meije',              la: 44.9997, lo: 6.3131, e: 3984 },
  { n: 'Ailefroide',            la: 44.8992, lo: 6.4217, e: 3954 },
  { n: 'Mont Pelvoux',          la: 44.9169, lo: 6.4103, e: 3943 },
  { n: 'Le Rateau',             la: 45.0181, lo: 6.2892, e: 3809 },
  { n: 'Grand Pic de Belledonne', la: 45.1531, lo: 6.0286, e: 2977 },

  // --- Queyras / Southern Alps ---
  { n: 'Mont Viso',             la: 44.6675, lo: 7.0906, e: 3841 },
  { n: 'Mont Thabor',           la: 45.1197, lo: 6.5589, e: 3178 },
  { n: 'Pic de Bure',           la: 44.6939, lo: 5.9183, e: 2709 },

  // --- Mercantour ---
  { n: 'Cime du Gélas',         la: 44.1078, lo: 7.3172, e: 3143 },
  { n: 'Mont Bégo',             la: 44.0847, lo: 7.4436, e: 2872 },
  { n: 'Mont Mounier',          la: 44.1281, lo: 6.9664, e: 2817 },

  // --- Vercors / Chartreuse / Ventoux ---
  { n: 'Grand Veymont',         la: 44.8831, lo: 5.5681, e: 2341 },
  { n: 'Chamechaude',           la: 45.2939, lo: 5.7739, e: 2082 },
  { n: 'Mont Aiguille',         la: 44.8397, lo: 5.5453, e: 2086 },
  { n: 'Mont Ventoux',          la: 44.1741, lo: 5.2786, e: 1909 },

  // --- Pyrenees ---
  { n: 'Vignemale',             la: 42.7728, lo: -0.1436, e: 3298 },
  { n: 'Pic Long',              la: 42.8161, lo: 0.1303, e: 3192 },
  { n: 'Balaïtous',             la: 42.8464, lo: -0.2864, e: 3144 },
  { n: 'Pique d\'Estats',       la: 42.6683, lo: 1.3969, e: 3143 },
  { n: 'Pic de Néouvielle',     la: 42.8472, lo: 0.1339, e: 3091 },
  { n: 'Pic Carlit',            la: 42.5706, lo: 1.9264, e: 2921 },
  { n: 'Pic du Midi d\'Ossau',  la: 42.8436, lo: -0.4381, e: 2884 },
  { n: 'Pic du Midi de Bigorre', la: 42.9369, lo: 0.1411, e: 2877 },
  { n: 'Mont Valier',           la: 42.8017, lo: 1.0872, e: 2838 },
  { n: 'Canigou',               la: 42.5194, lo: 2.4567, e: 2784 },

  // --- Massif Central ---
  { n: 'Puy de Sancy',          la: 45.5286, lo: 2.8139, e: 1885 },
  { n: 'Plomb du Cantal',       la: 45.0503, lo: 2.7644, e: 1855 },
  { n: 'Puy Mary',              la: 45.1097, lo: 2.6706, e: 1783 },
  { n: 'Mont Mézenc',           la: 44.9169, lo: 4.1889, e: 1753 },
  { n: 'Mont Aigoual',          la: 44.1214, lo: 3.5814, e: 1567 },
  { n: 'Puy de Dôme',           la: 45.7722, lo: 2.9644, e: 1465 },

  // --- Corsica ---
  { n: 'Monte Cinto',           la: 42.3814, lo: 8.9228, e: 2706 },
  { n: 'Monte Rotondo',         la: 42.2231, lo: 9.0561, e: 2622 },
  { n: 'Paglia Orba',           la: 42.3419, lo: 8.8878, e: 2525 },
  { n: 'Monte d\'Oro',          la: 42.1300, lo: 9.1131, e: 2389 },

  // --- Vosges / Jura ---
  { n: 'Crêt de la Neige',      la: 46.2775, lo: 5.9581, e: 1720 },
  { n: 'Grand Ballon',          la: 47.9017, lo: 7.0975, e: 1424 },
  { n: 'Hohneck',               la: 48.0361, lo: 7.0006, e: 1363 },
];

// Nearest summit to a position (flat-earth, fine at these ranges), plus the
// horizontal distance in metres. Used for the "overflying" readout.
export function nearestSummit(lat, lon, maxM = 8000) {
  let best = null, bestD = maxM;
  const cl = Math.cos(lat * Math.PI / 180);
  for (const s of SUMMITS) {
    const dy = (s.la - lat) * 111320;
    const dx = (s.lo - lon) * 111320 * cl;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { summit: best, dist: bestD } : null;
}
