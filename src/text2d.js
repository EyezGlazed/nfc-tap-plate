// Text -> 2D outlines with opentype.js.
// "size" is the CAP HEIGHT in mm (height of a capital H), the same meaning as FreeCAD's
// ShapeString Size with ScaleToSize, so sizes match the CAD model.

function capHeightUnits(font) {
  const os2 = font.tables.os2;
  if (os2 && os2.sCapHeight > 0) return os2.sCapHeight;
  const g = font.charToGlyph('H');
  const bb = g.getBoundingBox();
  return bb.y2 > 0 ? bb.y2 : font.unitsPerEm * 0.7;
}

function flattenPath(cmds, tol) {
  const polys = [];
  let cur = null, x = 0, y = 0;
  for (const c of cmds) {
    if (c.type === 'M') { cur = [[c.x, c.y]]; polys.push(cur); x = c.x; y = c.y; }
    else if (c.type === 'L') { cur.push([c.x, c.y]); x = c.x; y = c.y; }
    else if (c.type === 'Q') {
      const len = Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x - c.x1, c.y - c.y1);
      const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(len / tol) * 1.5)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'C') {
      const len = Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2);
      const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(len / tol) * 1.5)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y]);
      }
      x = c.x; y = c.y;
    }
    // 'Z' closes implicitly
  }
  return polys.filter((p) => p.length > 2).map((p) => p.map(([px, py]) => [px, -py]));
}

/**
 * One line of text, baseline at y = 0, horizontally centred on x = 0 (by ink bounds).
 * Returns null for blank text.
 */
export function textLine(wasm, font, text, capHeight, letterSpacing = 0) {
  if (!text || !text.trim()) return null;
  const fontSize = (capHeight * font.unitsPerEm) / capHeightUnits(font);
  const path = font.getPath(text, 0, 0, fontSize, { kerning: true, letterSpacing });
  const polys = flattenPath(path.commands, capHeight / 400);
  if (!polys.length) return null;
  let cs = new wasm.CrossSection(polys, 'NonZero');
  const b = cs.bounds();
  return cs.translate([-(b.min[0] + b.max[0]) / 2, 0]);
}

/**
 * A block of lines. Baselines are spaced by capHeight * (1 + lineGap), so the gap between
 * the bottom of one row's capitals and the top of the next is capHeight * lineGap.
 * Returned with the first baseline at y = 0; the caller positions it by its bounds.
 */
export function textBlock(wasm, font, lines, capHeight, lineGap) {
  let acc = null;
  const pitch = capHeight * (1 + lineGap);
  let row = 0;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const cs = textLine(wasm, font, line, capHeight);
    if (cs) {
      const placed = cs.translate([0, -row * pitch]);
      acc = acc ? acc.add(placed) : placed;
    }
    row++;
  }
  // nominal box (capitals only, ignores descenders): used for intuitive alignment
  const nominal = row ? { top: capHeight, bottom: -(row - 1) * pitch } : null;
  return { cs: acc, rows: row, nominal };
}
