// Layout of the front design and the cover/motif solids.
//
// 2D layout is in PLATE coordinates: origin at the plate centre, x right, y up, mm.
// Solids are in the model's ASSEMBLED coordinates (same as the FreeCAD model and the
// fixed STL parts): plate centre at (0, plate.cy), z = 0 at the wall, front at z = depth.
import { textBlock } from './text2d.js';

export const DEFAULT_SETTINGS = {
  logo: { height: 24, x: 0, y: 0 },
  frame: { on: true, match: true, margin: 2, w: 48.3, h: 32.3, r: 2, line: 2.4 },
  icon: { on: true, height: 13.986, gap: 3.214 },
  groupY: 0,
  textBelow: { lines: ['Tap here', 'for WiFi'], size: 10, lineGap: 0.5, align: 'center', gap: 3 },
  textAbove: { lines: [], size: 8, lineGap: 0.5, align: 'center', gap: 3 },
  edgeMargin: 1.5,
  sticker: { preset: 'rect-44x28', shape: 'rect', w: 44, h: 28, d: 30, t: 1, clear: 0.3 },
  switch: { w: 83, h: 82.2, indent: 'inside', iw: 1, ih: 3.65 },
};

const roundedRect = (CS, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3));
  const core = CS.square([Math.max(w - 2 * r, 1e-3), Math.max(h - 2 * r, 1e-3)], true);
  return r > 0 ? core.offset(r, 'Round', 2, 64) : core;
};

const bnds = (cs) => {
  const b = cs.bounds();
  return { x0: b.min[0], y0: b.min[1], x1: b.max[0], y1: b.max[1] };
};

/** Fit a CrossSection to a height (mm) and centre it on (x, y). */
export function placeAt(cs, height, x, y) {
  const b = bnds(cs);
  const k = height / (b.y1 - b.y0);
  return cs.translate([-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2]).scale([k, k]).translate([x, y]);
}

/**
 * @param wasm      manifold module
 * @param model     assets/model.json
 * @param s         settings (see DEFAULT_SETTINGS)
 * @param shapes    { logo: CrossSection|null, icon: CrossSection|null } raw, any units
 * @param font      opentype Font
 * @returns { motif2d, parts: {...}, flat: {halfW, halfH}, warnings }
 */
export function layoutFront(wasm, model, s, shapes, font) {
  const CS = wasm.CrossSection;
  const P = model.plate;
  const halfW = P.w / 2 - P.chamfer, halfH = P.h / 2 - P.chamfer;
  const m = s.edgeMargin;
  const warnings = [];
  const parts = {};
  let group = null;
  const grow = (b) => {
    group = group ? { x0: Math.min(group.x0, b.x0), y0: Math.min(group.y0, b.y0), x1: Math.max(group.x1, b.x1), y1: Math.max(group.y1, b.y1) } : { ...b };
  };

  // logo
  if (shapes.logo) {
    parts.logo = placeAt(shapes.logo, s.logo.height, s.logo.x, s.groupY + s.logo.y);
    grow(bnds(parts.logo));
  }
  // frame ring
  let topEdge = group ? group.y1 : s.groupY;
  if (s.frame.on) {
    const st = s.sticker, f = s.frame;
    let inner, outer, halfH;
    if (f.match && st && st.shape === 'round') {
      const ri = (st.d + st.clear) / 2 + f.margin;
      inner = CS.circle(ri, 128); outer = CS.circle(ri + f.line, 128); halfH = ri;
    } else {
      const w = f.match && st ? st.w + st.clear + 2 * f.margin : f.w;
      const h = f.match && st ? st.h + st.clear + 2 * f.margin : f.h;
      inner = roundedRect(CS, w, h, f.r);
      outer = roundedRect(CS, w + 2 * f.line, h + 2 * f.line, f.r + f.line);
      halfH = h / 2;
    }
    parts.frame = outer.subtract(inner).translate([0, s.groupY]);
    grow(bnds(parts.frame));
    topEdge = s.groupY + halfH + f.line;
  }
  // icon above the frame/logo
  if (s.icon.on && shapes.icon) {
    parts.icon = placeAt(shapes.icon, s.icon.height, 0, topEdge + s.icon.gap + s.icon.height / 2);
    grow(bnds(parts.icon));
  }
  if (!group) group = { x0: 0, y0: s.groupY, x1: 0, y1: s.groupY };

  // text blocks
  const placeText = (cfg, where) => {
    const tb = textBlock(wasm, font, cfg.lines.slice(0, 3), cfg.size, cfg.lineGap);
    if (!tb.cs) return null;
    const nomTop = tb.nominal.top, nomBot = tb.nominal.bottom; // relative to first baseline
    const ink = bnds(tb.cs);
    let dy;
    if (where === 'below') {
      const zTop = group.y0, zBot = -halfH;
      if (cfg.align === 'logo') dy = zTop - cfg.gap - nomTop;
      else if (cfg.align === 'edge') dy = zBot + cfg.gap - ink.y0;
      else dy = (zTop + zBot) / 2 - (nomTop + nomBot) / 2;
    } else {
      const zBot = group.y1, zTop = halfH;
      if (cfg.align === 'logo') dy = zBot + cfg.gap - ink.y0;
      else if (cfg.align === 'edge') dy = zTop - cfg.gap - ink.y1;
      else dy = (zTop + zBot) / 2 - (nomTop + nomBot) / 2;
    }
    const cs = tb.cs.translate([0, dy]);
    const b = bnds(cs);
    if (b.x1 - b.x0 > 2 * (halfW - m)) warnings.push(`Text ${where}: a row is ${(b.x1 - b.x0).toFixed(1)} mm wide; the flat face fits ${(2 * (halfW - m)).toFixed(1)} mm. Use a smaller size or shorter words.`);
    if (where === 'below' && b.y1 > group.y0 - 0.8) warnings.push('Text below: it touches the logo area. Lower the size or line count, or move the logo up.');
    if (where === 'above' && b.y0 < group.y1 + 0.8) warnings.push('Text above: it touches the logo area. Lower the size or line count, or move the logo down.');
    return cs;
  };
  parts.textBelow = placeText(s.textBelow, 'below');
  parts.textAbove = placeText(s.textAbove, 'above');

  let motif2d = null;
  for (const k of ['frame', 'logo', 'icon', 'textBelow', 'textAbove']) {
    if (parts[k]) motif2d = motif2d ? motif2d.add(parts[k]) : parts[k];
  }
  if (motif2d) {
    motif2d = motif2d.simplify(0.01); // drop points closer than 0.01 mm to the outline
    const b = bnds(motif2d);
    if (b.x0 < -halfW + m || b.x1 > halfW - m || b.y0 < -halfH + m || b.y1 > halfH - m) {
      warnings.push(`Part of the design is within ${m} mm of the chamfer or over it; it gets clipped there.`);
    }
  }
  return { motif2d, parts, group, flat: { halfW, halfH }, warnings };
}

/** Cover body with chamfer, magnet pockets and the inlay cut; and the motif solid. */
export function buildCover(wasm, model, motif2d, yShift = 0) {
  const { Manifold, CrossSection: CS } = wasm;
  const P = model.plate, M = model.magnets;
  const outline = roundedRect(CS, P.w, P.h, P.corner_r);
  const lower = outline.extrude(P.cover_t - P.chamfer);
  const top = outline.offset(-P.chamfer, 'Round', 2, 64).extrude(1e-3).translate([0, 0, P.cover_t - 1e-3]);
  let body = Manifold.hull([lower, top]).translate([0, P.cy, P.split_z]);
  const r = (M.dia + M.fit) / 2, d = M.t + M.fit;
  const pockets = Manifold.union(M.pos.map(([x, y]) =>
    Manifold.cylinder(d + 0.01, r, r, 64).translate([x, P.cy + y, P.split_z - 0.01])));
  let cover = body.subtract(pockets);
  let motif = null;
  if (motif2d && !motif2d.isEmpty()) {
    const z0 = P.depth - P.motif_d;
    const shifted = motif2d.translate([0, P.cy]);
    motif = shifted.extrude(P.motif_d).translate([0, 0, z0]).intersect(body);
    cover = cover.subtract(shifted.extrude(P.motif_d + 1).translate([0, 0, z0]));
    if (motif.isEmpty()) motif = null;
  }
  if (yShift) { cover = cover.translate([0, yShift, 0]); motif = motif && motif.translate([0, yShift, 0]); }
  return { cover, motif };
}
