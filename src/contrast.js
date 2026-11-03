// WCAG 2.x contrast helpers, used to colour the NFC tag outline in the preview.

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Outline colour that reads against the plate colour (where the line mostly runs) and the
 * motif colour (where it crosses the logo). Goes for WCAG AAA (7:1) and drops to AA (4.5:1)
 * only where AAA can't be reached (mid tones: even black or white give about 4.6:1 there).
 * Tiers, best first: AAA on both, AAA on plate + AA on motif, AAA on plate, AA on both,
 * AA on plate, else the most contrast on the plate. Within a tier it keeps the blue hue and
 * the lightness closest to the original (#3fa7ff); black and white are the ends of the range.
 * @returns { color, plate, motif } with the two contrast ratios
 */
export function outlineColor(plate, motif, hue = 210, baseL = 0.62) {
  const cands = [];
  for (let i = 0; i <= 100; i++) {
    const c = hsl(hue, 1, i / 100);
    cands.push({ color: c, l: i / 100, plate: contrast(c, plate), motif: contrast(c, motif) });
  }
  const tiers = [[7, 7], [7, 4.5], [7, 0], [4.5, 4.5], [4.5, 0]];
  for (const [p, m] of tiers) {
    const ok = cands.filter((c) => c.plate >= p && c.motif >= m);
    if (ok.length) return pick(ok.sort((a, b) => Math.abs(a.l - baseL) - Math.abs(b.l - baseL))[0]);
  }
  return pick(cands.sort((a, b) => b.plate - a.plate)[0]);
}
const pick = ({ color, plate, motif }) => ({ color, plate, motif });
