// places.js — towns, cities and notable landmarks, so the display can name what
// you are flying over.
//
// {n: name, la, lo, p: approximate population in thousands (urban area), and
//  optional k:'poi' for a landmark rather than a settlement}
//
// `p` is only used to decide how far away a place is worth naming — a city of
// a million shows from 60 km, a small town only when you are nearly on top of
// it. Coordinates are town-centre positions, good to ~1 km, which is all a
// label needs. Not survey data.

export const PLACES = [
  // --- major cities ---
  { n: 'Paris',            la: 48.8566, lo:  2.3522, p: 2100 },
  { n: 'Marseille',        la: 43.2965, lo:  5.3698, p: 870 },
  { n: 'Lyon',             la: 45.7640, lo:  4.8357, p: 520 },
  { n: 'Toulouse',         la: 43.6047, lo:  1.4442, p: 490 },
  { n: 'Nice',             la: 43.7102, lo:  7.2620, p: 340 },
  { n: 'Nantes',           la: 47.2184, lo: -1.5536, p: 320 },
  { n: 'Montpellier',      la: 43.6108, lo:  3.8767, p: 300 },
  { n: 'Strasbourg',       la: 48.5734, lo:  7.7521, p: 290 },
  { n: 'Bordeaux',         la: 44.8378, lo: -0.5792, p: 260 },
  { n: 'Lille',            la: 50.6292, lo:  3.0573, p: 235 },
  { n: 'Rennes',           la: 48.1173, lo: -1.6778, p: 220 },
  { n: 'Reims',            la: 49.2583, lo:  4.0317, p: 180 },
  { n: 'Saint-Étienne',    la: 45.4397, lo:  4.3872, p: 172 },
  { n: 'Toulon',           la: 43.1242, lo:  5.9280, p: 170 },
  { n: 'Le Havre',         la: 49.4944, lo:  0.1079, p: 168 },
  { n: 'Grenoble',         la: 45.1885, lo:  5.7245, p: 158 },
  { n: 'Dijon',            la: 47.3220, lo:  5.0415, p: 157 },
  { n: 'Angers',           la: 47.4784, lo: -0.5632, p: 155 },
  { n: 'Nîmes',            la: 43.8367, lo:  4.3601, p: 148 },
  { n: 'Clermont-Ferrand', la: 45.7772, lo:  3.0870, p: 147 },
  { n: 'Le Mans',          la: 48.0061, lo:  0.1996, p: 145 },
  { n: 'Aix-en-Provence',  la: 43.5297, lo:  5.4474, p: 143 },
  { n: 'Brest',            la: 48.3904, lo: -4.4861, p: 140 },
  { n: 'Tours',            la: 47.3941, lo:  0.6848, p: 137 },
  { n: 'Amiens',           la: 49.8941, lo:  2.2958, p: 134 },
  { n: 'Limoges',          la: 45.8336, lo:  1.2611, p: 130 },
  { n: 'Perpignan',        la: 42.6887, lo:  2.8948, p: 120 },
  { n: 'Metz',             la: 49.1193, lo:  6.1757, p: 118 },
  { n: 'Besançon',         la: 47.2378, lo:  6.0241, p: 117 },
  { n: 'Orléans',          la: 47.9029, lo:  1.9093, p: 116 },
  { n: 'Rouen',            la: 49.4432, lo:  1.0999, p: 112 },
  { n: 'Mulhouse',         la: 47.7508, lo:  7.3359, p: 109 },
  { n: 'Caen',             la: 49.1829, lo: -0.3707, p: 106 },
  { n: 'Nancy',            la: 48.6921, lo:  6.1844, p: 105 },
  { n: 'Avignon',          la: 43.9493, lo:  4.8055, p: 93 },
  { n: 'Poitiers',         la: 46.5802, lo:  0.3404, p: 90 },
  { n: 'Versailles',       la: 48.8014, lo:  2.1301, p: 85 },
  { n: 'Pau',              la: 43.2951, lo: -0.3708, p: 77 },
  { n: 'La Rochelle',      la: 46.1591, lo: -1.1520, p: 77 },
  { n: 'Calais',           la: 50.9513, lo:  1.8587, p: 73 },
  { n: 'Cannes',           la: 43.5528, lo:  7.0174, p: 74 },
  { n: 'Colmar',           la: 48.0794, lo:  7.3585, p: 70 },
  { n: 'Ajaccio',          la: 41.9192, lo:  8.7386, p: 71 },
  { n: 'Bourges',          la: 47.0810, lo:  2.3988, p: 65 },
  { n: 'Antibes',          la: 43.5808, lo:  7.1251, p: 73 },
  { n: 'Valence',          la: 44.9334, lo:  4.8924, p: 64 },
  { n: 'Quimper',          la: 47.9960, lo: -4.1024, p: 63 },
  { n: 'Chambéry',         la: 45.5646, lo:  5.9178, p: 60 },
  { n: 'Lorient',          la: 47.7477, lo: -3.3702, p: 57 },
  { n: 'Troyes',           la: 48.2973, lo:  4.0744, p: 61 },
  { n: 'Bastia',           la: 42.7028, lo:  9.4508, p: 48 },
  { n: 'Annecy',           la: 45.8992, lo:  6.1294, p: 130 },
  { n: 'Chartres',         la: 48.4439, lo:  1.4894, p: 39 },
  { n: 'Tarbes',           la: 43.2328, lo:  0.0714, p: 41 },
  { n: 'Bayonne',          la: 43.4929, lo: -1.4748, p: 52 },
  { n: 'Biarritz',         la: 43.4832, lo: -1.5586, p: 25 },
  { n: 'Carcassonne',      la: 43.2130, lo:  2.3491, p: 47 },
  { n: 'Béziers',          la: 43.3442, lo:  3.2158, p: 78 },
  { n: 'Narbonne',         la: 43.1839, lo:  3.0036, p: 55 },
  { n: 'Arles',            la: 43.6768, lo:  4.6280, p: 52 },
  { n: 'Vienne',           la: 45.5256, lo:  4.8747, p: 30 },
  { n: 'Belfort',          la: 47.6379, lo:  6.8628, p: 47 },
  { n: 'Épinal',           la: 48.1744, lo:  6.4494, p: 32 },
  { n: 'Chalon-sur-Saône', la: 46.7806, lo:  4.8536, p: 45 },
  { n: 'Mâcon',            la: 46.3069, lo:  4.8283, p: 33 },
  { n: 'Bourg-en-Bresse',  la: 46.2051, lo:  5.2256, p: 42 },
  { n: 'Roanne',           la: 46.0367, lo:  4.0689, p: 34 },
  { n: 'Vichy',            la: 46.1278, lo:  3.4267, p: 25 },
  { n: 'Nevers',           la: 46.9896, lo:  3.1590, p: 33 },
  { n: 'Auxerre',          la: 47.7981, lo:  3.5731, p: 35 },
  { n: 'Beauvais',         la: 49.4295, lo:  2.0807, p: 56 },
  { n: 'Saint-Malo',       la: 48.6493, lo: -2.0257, p: 46 },
  { n: 'Cherbourg',        la: 49.6386, lo: -1.6164, p: 37 },
  { n: 'Dunkerque',        la: 51.0344, lo:  2.3768, p: 87 },
  { n: 'Arras',            la: 50.2910, lo:  2.7778, p: 41 },
  { n: 'Angoulême',        la: 45.6484, lo:  0.1562, p: 42 },
  { n: 'Périgueux',        la: 45.1840, lo:  0.7211, p: 30 },
  { n: 'Agen',             la: 44.2032, lo:  0.6222, p: 33 },
  { n: 'Niort',            la: 46.3239, lo: -0.4644, p: 59 },
  { n: 'Vannes',           la: 47.6587, lo: -2.7603, p: 54 },
  { n: 'Saint-Brieuc',     la: 48.5136, lo: -2.7653, p: 44 },
  { n: 'Montauban',        la: 44.0181, lo:  1.3550, p: 60 },
  { n: 'Albi',            la: 43.9298, lo:  2.1480, p: 49 },
  { n: 'Rodez',            la: 44.3495, lo:  2.5751, p: 24 },
  { n: 'Le Puy-en-Velay',  la: 45.0430, lo:  3.8850, p: 19 },
  { n: 'Aurillac',         la: 44.9264, lo:  2.4400, p: 26 },
  { n: 'Gap',              la: 44.5594, lo:  6.0793, p: 41 },
  { n: 'Digne-les-Bains',  la: 44.0921, lo:  6.2358, p: 16 },
  { n: 'Manosque',         la: 43.8286, lo:  5.7869, p: 22 },
  { n: 'Draguignan',       la: 43.5375, lo:  6.4664, p: 40 },
  { n: 'Fréjus',           la: 43.4331, lo:  6.7370, p: 54 },
  { n: 'Hyères',           la: 43.1204, lo:  6.1286, p: 56 },
  { n: 'Menton',           la: 43.7765, lo:  7.5000, p: 29 },
  { n: 'Monaco',           la: 43.7384, lo:  7.4246, p: 39 },

  // --- alpine towns (the flying country for the presets) ---
  { n: 'Chamonix',         la: 45.9237, lo:  6.8694, p: 9 },
  { n: 'Sallanches',       la: 45.9367, lo:  6.6317, p: 16 },
  { n: 'Cluses',           la: 46.0603, lo:  6.5789, p: 17 },
  { n: 'Megève',           la: 45.8569, lo:  6.6175, p: 3 },
  { n: 'Saint-Gervais',    la: 45.8925, lo:  6.7139, p: 6 },
  { n: 'Albertville',      la: 45.6759, lo:  6.3925, p: 19 },
  { n: 'Moûtiers',         la: 45.4856, lo:  6.5314, p: 4 },
  { n: 'Bourg-Saint-Maurice', la: 45.6186, lo: 6.7697, p: 8 },
  { n: 'Val d\'Isère',     la: 45.4489, lo:  6.9797, p: 2 },
  { n: 'Tignes',           la: 45.4686, lo:  6.9058, p: 2 },
  { n: 'Courchevel',       la: 45.4147, lo:  6.6347, p: 2 },
  { n: 'Briançon',         la: 44.8994, lo:  6.6350, p: 12 },
  { n: 'Thonon-les-Bains', la: 46.3708, lo:  6.4794, p: 35 },
  { n: 'Évian-les-Bains',  la: 46.4009, lo:  6.5876, p: 9 },
  { n: 'Annemasse',        la: 46.1958, lo:  6.2364, p: 36 },
  { n: 'Voiron',           la: 45.3667, lo:  5.5906, p: 21 },
  { n: 'Romans-sur-Isère', la: 45.0450, lo:  5.0500, p: 34 },
  { n: 'Die',              la: 44.7539, lo:  5.3706, p: 5 },
  { n: 'Sisteron',         la: 44.1958, lo:  5.9464, p: 8 },
  { n: 'Barcelonnette',    la: 44.3869, lo:  6.6519, p: 3 },

  // --- landmarks ---
  { n: 'Mont-Saint-Michel', la: 48.6361, lo: -1.5115, p: 40, k: 'poi' },
  { n: 'Pont du Gard',     la: 43.9475, lo:  4.5350, p: 30, k: 'poi' },
  { n: 'Viaduc de Millau', la: 44.0797, lo:  3.0225, p: 35, k: 'poi' },
  { n: 'Carcassonne (Cité)', la: 43.2061, lo: 2.3639, p: 30, k: 'poi' },
  { n: 'Lac d\'Annecy',    la: 45.8500, lo:  6.1700, p: 35, k: 'poi' },
  { n: 'Lac du Bourget',   la: 45.7300, lo:  5.8600, p: 35, k: 'poi' },
  { n: 'Lac Léman',        la: 46.4000, lo:  6.5000, p: 60, k: 'poi' },
  { n: 'Gorges du Verdon', la: 43.7500, lo:  6.3300, p: 35, k: 'poi' },
  { n: 'Dune du Pilat',    la: 44.5883, lo: -1.2119, p: 30, k: 'poi' },
  { n: 'Cirque de Gavarnie', la: 42.6950, lo: -0.0092, p: 25, k: 'poi' },
  { n: 'Chambord',         la: 47.6161, lo:  1.5170, p: 25, k: 'poi' },
];

/**
 * Places worth naming from (lat, lon). A place is only offered once you are
 * inside a radius that scales with its size, so cities appear from far away and
 * villages only when you are nearly overhead.
 */
export function nearbyPlaces(lat, lon, maxM) {
  const cl = Math.cos(lat * Math.PI / 180);
  const out = [];
  for (const p of PLACES) {
    const dy = (p.la - lat) * 111320;
    const dx = (p.lo - lon) * 111320 * cl;
    const d = Math.hypot(dx, dy);
    // 2 km per 1000 inhabitants, clamped: a village ~8 km, a big city ~60 km.
    const visible = Math.min(Math.max(p.p * 2000, 8000), 60000);
    if (d <= Math.min(visible, maxM)) out.push({ p, d });
  }
  out.sort((a, b) => (a.d / Math.max(a.p.p, 1)) - (b.d / Math.max(b.p.p, 1)));
  return out;
}
