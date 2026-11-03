// Frame resizing, switch-cover indent options and the NFC sticker pocket.
//
// The frame is never rebuilt from scratch: the CAD meshes (with the print-tested hinges,
// latch and dovetail grooves) are STRETCHED. Each bar is cut by a plane where its
// cross-section is constant; the far piece moves, and the gap is filled by stretching a
// 1 mm slab of the bar itself (exact, because the bar is prismatic there). Shrinking
// removes a slice instead. Width first shrinks outside the dovetail grooves (up to
// shrink_max.x per side); below that, a slice comes out of the middle of the top and
// bottom bars (between the grooves, |x| < mid_x), which moves both grooves toward the
// centre, and buildBase moves the plate's tongues to match. Height shrinks by ONE slice
// taken from the middle of band_y, where both side bars are prismatic (above the latch
// window, below the top corners), so almost all of the side bars can go.
// See model.frame.cut / shrink_max / band_y.
//
// Coordinates: the model's assembled coordinates (mm, z = 0 wall, frame centred on 0,0).

export const STICKER_PRESETS = [
  { id: 'rect-44x28', label: 'Card label 44 × 28', shape: 'rect', w: 44, h: 28 },
  { id: 'rect-25x25', label: 'Square 25 × 25', shape: 'rect', w: 25, h: 25 },
  { id: 'rect-50x50', label: 'Square 50 × 50', shape: 'rect', w: 50, h: 50 },
  { id: 'rect-card', label: 'Credit card 54 × 85.6 (portrait)', shape: 'rect', w: 54, h: 85.6, t: 0.8 },
  { id: 'round-25', label: 'Round Ø25', shape: 'round', d: 25 },
  { id: 'round-30', label: 'Round Ø30', shape: 'round', d: 30 },
  { id: 'round-35', label: 'Round Ø35', shape: 'round', d: 35 },
  { id: 'round-38', label: 'Round Ø38', shape: 'round', d: 38 },
];

export function toManifold(wasm, mesh) {
  const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.pos, triVerts: mesh.tri });
  m.merge();
  return new wasm.Manifold(m);
}

const BIG = 1000;
function slabBox(wasm, axis, a, b) {
  const lo = [-BIG, -BIG, -BIG], size = [2 * BIG, 2 * BIG, 2 * BIG];
  lo[axis] = a; size[axis] = b - a;
  return wasm.Manifold.cube(size).translate(lo);
}

/**
 * Move everything beyond the plane coord[axis] = c (in direction dir = +1 or -1) by
 * dir * d, keeping the solid connected. d > 0 grows, d < 0 shrinks.
 */
export function stretch(wasm, man, axis, c, d, dir) {
  if (Math.abs(d) < 1e-6 || man.isEmpty()) return man;
  const { Manifold } = wasm;
  const n = [0, 0, 0]; n[axis] = dir;
  const t = [0, 0, 0]; t[axis] = dir * d;
  const ov = 0.05; // overlap inside the prismatic zone, so pieces fuse into one solid
  if (d > 0) {
    const [mov, stay] = man.splitByPlane(n, dir * c);
    // 1 mm slab centred on c, scaled along the axis to span the gap (+ overlap both ends)
    const slab = man.intersect(slabBox(wasm, axis, c - 0.5, c + 0.5));
    const k = [1, 1, 1]; k[axis] = d + 2 * ov;
    const a0 = [0, 0, 0]; a0[axis] = -(c - 0.5);
    const a1 = [0, 0, 0]; a1[axis] = dir > 0 ? c - ov : c - d - ov;
    const fill = slab.translate(a0).scale(k).translate(a1);
    return Manifold.union([stay, mov.translate(t), fill]);
  }
  const s = -d;
  const stay = man.splitByPlane(n, dir * c)[1];
  const mov = man.splitByPlane(n, dir * (c + dir * (s - ov)))[0];
  return Manifold.union([stay, mov.translate(t)]);
}

const rect = (CS, w, h) => CS.square([w, h], true);
const LATCH_OPEN = 45; // degrees the latch can swing open (its print pose); the plate notch clears all of it
const FRAME_OPEN = 20; // degrees half B swings open about T when fitting the frame; the plate notch clears it
const cornerName = ([sx, sy]) => `${sy > 0 ? 'top' : 'bottom'}-${sx > 0 ? 'right' : 'left'}`;

/**
 * @param parts  { frame_a, frame_b, latch, plate_base? } manifolds (with plate_base, plateNotch is computed)
 *               (CAD geometry, 83 x 82.2 opening)
 * @param F      model.frame
 * @param latchM model.latch: { pivot, print_angle } (the sign of print_angle is the opening direction)
 * @param sw     { w, h, indent: 'none'|'inside'|'outside', iw, ih }  switch cover
 * @returns { frame_a, frame_b, latch, dW, dH, dtShift, plateNotch, pivot, warnings, notes }
 */
export function buildFrame(wasm, parts, F, latchM, sw) {
  const latchPivot = latchM.pivot, ls = Math.sign(latchM.print_angle) || 1;
  const { CrossSection: CS } = wasm;
  const warnings = [], notes = []; // warnings: something to fix; notes: good to know
  const dW = sw.w - F.open_w, dH = sw.h - F.open_h;
  // middle slice limit: keep dt_web_min between the inner edges of the two grooves
  const midMax = Math.min(2 * F.mid_x - 0.2, 2 * (F.mid_x + 0.5) - F.dt_web_min);
  const minW = Math.ceil((F.open_w - 2 * F.shrink_max.x - midMax) * 10) / 10;
  if (sw.w < minW) throw new Error(`Switch cover width: the frame can't go below ${minW.toFixed(1)} mm (the two dovetails need the room).`);
  const sOut = dW < 0 ? Math.min(-dW / 2, F.shrink_max.x) : 0; // per side, outside the grooves
  const sMid = dW < 0 ? -dW - 2 * sOut : 0; // total, from the middle
  const [b0, b1] = F.band_y, minH = Math.ceil((F.open_h - (b1 - b0) + 0.5) * 10) / 10;
  if (sw.h < minH) throw new Error(`Switch cover height: the frame can't go below ${minH.toFixed(1)} mm (hinge and latch need the room).`);
  const cx = F.cut.x, cy = F.cut.y;
  const grow = (m) => {
    const dx = dW >= 0 ? dW / 2 : -sOut;
    m = stretch(wasm, m, 0, cx, dx, 1);
    m = stretch(wasm, m, 0, -cx, dx, -1);
    // the middle slice comes out after the outer cuts, which leave |x| < cx where it was
    if (sMid > 0) m = stretch(wasm, m, 0, -sMid / 2, -sMid, 1).translate([sMid / 2, 0, 0]);
    if (dH >= 0) {
      m = stretch(wasm, m, 1, cy, dH / 2, 1);
      return stretch(wasm, m, 1, -cy, dH / 2, -1);
    }
    // remove one slice of height -dH centred in the band, then re-centre the opening
    return stretch(wasm, m, 1, (b0 + b1) / 2 + dH / 2, dH, 1).translate([0, -dH / 2, 0]);
  };
  let A = grow(parts.frame_a), B = grow(parts.frame_b);
  // the latch moves with its corner (Q)
  const [qsx, qsy] = F.Q, [tsx, tsy] = F.T;
  const latch = parts.latch.translate([qsx * dW / 2, qsy * dH / 2, 0]);

  // ---- indent near the wall
  const W = sw.w, H = sw.h;
  // hinge axes: T (open hinge) and Q (latch pivot), hinge_inset inside the outer corners;
  // the knuckles (radius kn_r) are kept as they are
  const ax = W / 2 + F.wall - F.hinge_inset, ay = H / 2 + F.wall - F.hinge_inset;
  const T = [tsx * ax, tsy * ay], Q = [qsx * ax, qsy * ay];
  const disc = (r) => CS.compose([CS.circle(r, 96).translate(T), CS.circle(r, 96).translate(Q)]);
  const corners = `${cornerName(F.T)} and ${cornerName(F.Q)}`;
  const zcut = (cs, h) => cs.extrude(h + 0.05).translate([0, 0, -0.05]);
  // remove the CAD lip (1 x 3.65) everywhere except inside the knuckles
  const oldLip = rect(CS, W + 0.02, H + 0.02).subtract(rect(CS, W - 2 * F.lip_w - 0.02, H - 2 * F.lip_w - 0.02)).subtract(disc(F.kn_r));
  A = A.subtract(zcut(oldLip, F.lip_h + 0.02));
  B = B.subtract(zcut(oldLip, F.lip_h + 0.02));
  if (sw.indent === 'inside' && sw.iw > 0 && sw.ih > 0) {
    if (sw.ih > F.depth - 1) throw new Error(`Indent height can be at most ${F.depth - 1} mm.`);
    // new lip keeps the hinge clearance (kn_rc) from the knuckles of the other half
    const ring = rect(CS, W + 0.1, H + 0.1).subtract(rect(CS, W - 2 * sw.iw, H - 2 * sw.iw)).subtract(disc(F.kn_rc));
    // A and B meet only at the two hinge corners. The corners are moved, not rotated, when the
    // frame is resized, so at each corner the split runs through that axis at the CAD angle
    // (not along the resized diagonal), with a hinge_clear gap. A owns the horizontal bar at
    // T and the vertical (left) bar at Q; each corner rules the half of the ring nearer to it.
    const ax0 = F.open_w / 2 + F.wall - F.hinge_inset, ay0 = F.open_h / 2 + F.wall - F.hinge_inset;
    const len = Math.hypot(ax0, ay0), g = F.hinge_clear / 2, L = 1000;
    const ux = (tsx * ax0) / len, uy = (tsy * ay0) / len; // CAD split direction (Q -> T)
    const poly = (pts) => new CS([pts], 'NonZero');
    const halfAt = (c, ref, s) => { // half-plane through corner c, on the side of ref (s = +1) or away from it (s = -1), g off the line
      let nx = -uy, ny = ux;
      if ((ref[0] - c[0]) * nx + (ref[1] - c[1]) * ny < 0) { nx = -nx; ny = -ny; }
      const p = (t, k) => [c[0] + t * ux + s * (g + k) * nx, c[1] + t * uy + s * (g + k) * ny];
      return poly([p(-L, 0), p(L, 0), p(L, L), p(-L, L)]);
    };
    // away from the hinge corners each bar's lip goes to the half that owns the bar
    const ownA = poly([[Math.sign(Q[0]) * (W / 2 - sw.iw - 0.5), -L], [Math.sign(Q[0]) * L, -L], [Math.sign(Q[0]) * L, L], [Math.sign(Q[0]) * (W / 2 - sw.iw - 0.5), L]])
      .add(poly([[-L, Math.sign(T[1]) * (H / 2 - sw.iw - 0.5)], [L, Math.sign(T[1]) * (H / 2 - sw.iw - 0.5)], [L, Math.sign(T[1]) * L], [-L, Math.sign(T[1]) * L]]));
    // corner boxes (opening corner at T and at Q, reaching s inward and past the knuckles)
    const s = Math.min(Math.max(sw.iw, F.kn_rc) + 1, W / 2 - 0.1, H / 2 - 0.1);
    const box = (c) => { const x = Math.sign(c[0]) * W / 2, y = Math.sign(c[1]) * H / 2, dx = -Math.sign(c[0]), dy = -Math.sign(c[1]);
      return poly([[x - dx * 10, y - dy * 10], [x + dx * s, y - dy * 10], [x + dx * s, y + dy * s], [x - dx * 10, y + dy * s]]); };
    const bT = box(T), bQ = box(Q), rest = ring.subtract(bT).subtract(bQ);
    const refT = [0, T[1]], refQ = [Q[0], 0];
    const ringA = rest.intersect(ownA).add(ring.intersect(bT).intersect(halfAt(T, refT, 1))).add(ring.intersect(bQ).intersect(halfAt(Q, refQ, 1)));
    const ringB = rest.subtract(ownA).add(ring.intersect(bT).intersect(halfAt(T, refT, -1))).add(ring.intersect(bQ).intersect(halfAt(Q, refQ, -1)));
    A = A.add(ringA.extrude(sw.ih));
    B = B.add(ringB.extrude(sw.ih));
    if (sw.iw > 3) warnings.push('Indent wider than 3 mm: check that the switch rocker still has room.');
  } else if (sw.indent === 'outside' && sw.iw > 0 && sw.ih > 0) {
    if (sw.ih > F.depth - 1.5) throw new Error(`Recess height can be at most ${F.depth - 1.5} mm.`);
    const left = F.wall - F.dt_d - sw.iw;
    if (sw.iw > F.wall - 1) throw new Error(`Recess width can be at most ${F.wall - 1} mm (the walls are ${F.wall} mm).`);
    if (left < 0.8) warnings.push(`Recess ${sw.iw} mm leaves only ${Math.max(0, left).toFixed(1)} mm of wall behind the dovetail grooves in the bottom bar.`);
    const recess = rect(CS, W + 2 * sw.iw, H + 2 * sw.iw).subtract(rect(CS, W - 0.1, H - 0.1)).subtract(disc(F.kn_r + 0.6));
    A = A.subtract(zcut(recess, sw.ih));
    B = B.subtract(zcut(recess, sw.ih));
    notes.push(`The recess goes around the two hinge knuckles in the ${corners} corners. A rim with rounded corners fits there.`);
  }
  if (sw.indent !== 'inside') {
    const d = F.wall - F.hinge_inset, nib = Math.sqrt(F.kn_r ** 2 - d ** 2) - d; // along each edge
    notes.push(`Check your switch cover's corners: the hinge knuckles take a small rounded nib (about ${nib.toFixed(1)} × ${nib.toFixed(1)} mm) out of the ${corners} corners of the opening. A cover with corners rounded 1.5 mm or more fits.`);
  }
  // booleans on touching faces can leave zero-volume specks: keep only real solids
  const clean = (m) => wasm.Manifold.compose(m.decompose().filter((p) => p.volume() > 0.01));
  A = clean(A); B = clean(B);

  // Narrow frames (below about 73 wide) bring a corner hinge over the plate's top edge. The
  // plate and cover then get a notch: whatever of either half reaches below the plate's top
  // edge, B swinging open about T, and the latch from closed to swung fully open, all with
  // print-in-place clearance. (With the latch at the top, only the T knuckle matters.)
  const pivot = [latchPivot[0] + qsx * dW / 2, latchPivot[1] + qsy * dH / 2];
  let plateNotch = null;
  const pbb = parts.plate_base && parts.plate_base.boundingBox();
  // nothing reaches the plate while the frame is clearly wider than it (default size): skip (speed)
  if (pbb && W / 2 + F.wall < pbb.max[0] + 8) {
    const plateTop = -(F.open_h / 2 + F.wall) - dH / 2; // assembled
    // the base's top corners are square (it butts against the frame): use its bounding box
    const pb = pbb;
    const plate2d = CS.square([pb.max[0] - pb.min[0], pb.max[1] - pb.min[1]]).translate([pb.min[0], pb.min[1] - dH / 2]);
    const low = slabBox(wasm, 1, -BIG, plateTop - 0.01); // only what reaches past the plate's top edge
    const sweep = [A.intersect(low).project(), B.intersect(low).project()];
    // only B's corner near T can swing below the plate's top edge: crop it first (speed)
    const R = 15, near = wasm.Manifold.cube([2 * R, 2 * R, 100]).translate([T[0] - R, T[1] - R, -50]);
    const bAtT = B.intersect(near).translate([-T[0], -T[1], 0]);
    const openDir = -Math.sign(T[0] * T[1]) || 1; // B opens away from A: clockwise when T is bottom-right
    for (let a = 2.5; a <= FRAME_OPEN + 0.01; a += 2.5) {
      const r = bAtT.rotate([0, 0, openDir * a]).translate([T[0], T[1], 0]).intersect(low);
      if (!r.isEmpty()) sweep.push(r.project());
    }
    const lat = latch.project().translate([-pivot[0], -pivot[1]]);
    for (let a = -5; a <= LATCH_OPEN + 0.01; a += 2.5) sweep.push(lat.rotate(ls * a).translate(pivot));
    const reach = CS.union(sweep).offset(F.hinge_clear, 'Round', 2, 48);
    if (reach.intersect(plate2d).area() > 1e-3) {
      plateNotch = reach.intersect(plate2d.offset(1, 'Miter')).translate([0, dH / 2]).simplify(0.01); // plate coords
      notes.push('The frame is narrower than the plate, so the plate and its cover get a small notch at the top corner where the hinge sits.');
    }
  }
  return {
    frame_a: A, frame_b: B, latch, dW, dH, plateNotch,
    dtShift: sMid / 2, // each dovetail groove moved this far toward the centre
    pivot, warnings, notes,
  };
}

/**
 * Magnet positions (plate coords, relative to the plate centre). A magnet the corner notch
 * would come within wallMin of moves straight down until it has that wall again.
 * @returns { pos, moved: [{ i, dy }] }
 */
export function magnetPositions(wasm, model, notch, wallMin = 1.2) {
  const M = model.magnets, cy = model.plate.cy, r = (M.dia + M.fit) / 2;
  const pos = M.pos.map((p) => [...p]), moved = [];
  if (!notch) return { pos, moved };
  const hits = (x, y) => wasm.CrossSection.circle(r + wallMin, 48).translate([x, y + cy]).intersect(notch).area() > 1e-6;
  pos.forEach((p, i) => {
    const y0 = p[1];
    while (hits(p[0], p[1]) && y0 - p[1] < 20) p[1] -= 0.25;
    if (p[1] !== y0) moved.push({ i, dy: y0 - p[1] });
  });
  return { pos, moved };
}

/** Sticker outline (plate coords, centred), including the fit clearance. */
export function stickerOutline(CS, st, extra = 0) {
  if (st.shape === 'round') return CS.circle((st.d + st.clear) / 2 + extra, 128);
  return rect(CS, st.w + st.clear + 2 * extra, st.h + st.clear + 2 * extra);
}
export const stickerHalf = (st) => (st.shape === 'round' ? [(st.d + st.clear) / 2, (st.d + st.clear) / 2] : [(st.w + st.clear) / 2, (st.h + st.clear) / 2]);

/**
 * Plate base with a pocket for the sticker. The CAD pocket and scoop are filled first.
 * @param base  manifold of the CAD plate base
 * @param st    { shape: 'rect'|'round', w, h, d, t, clear }
 */
export function buildBase(wasm, base, model, st, dtShift = 0, notch = null, magPos = null) {
  const { Manifold, CrossSection: CS } = wasm;
  const P = model.plate, B = model.base, cy = P.cy;
  const warnings = [];
  const f = B.fill;
  const fill = Manifold.cube([f.x1 - f.x0, f.y1 - f.y0, P.split_z - f.z0]).translate([f.x0, cy + f.y0, f.z0]);
  let m = base.add(fill);
  if (dtShift > 1e-6) {
    // the dovetail tongues are the only part of the plate above its top edge: cut them off
    // (with 0.3 mm of the solid plate under them, so they fuse back) and move them inward
    const yTop = cy + P.h / 2, F = model.frame, half = F.dt_w1 / 2 + 4;
    const tongue = (s) => {
      const box = Manifold.cube([2 * half, 20, 50]).translate([s * F.dt_x - half, yTop - 0.3, -10]);
      return m.intersect(box).translate([-s * dtShift, 0, 0]);
    };
    m = Manifold.union([m.splitByPlane([0, 1, 0], yTop)[1], tongue(1), tongue(-1)]);
  }
  const MG = model.magnets, mr = (MG.dia + MG.fit) / 2, md = MG.t + MG.fit;
  magPos = magPos || MG.pos;
  MG.pos.forEach(([x, y], i) => {
    const [nx, ny] = magPos[i];
    if (Math.abs(nx - x) < 1e-9 && Math.abs(ny - y) < 1e-9) return;
    // moved magnet: refill the CAD pocket, cut it at the new place
    m = m.add(Manifold.cylinder(md + 0.02, mr + 0.02, mr + 0.02, 64).translate([x, cy + y, P.split_z - md - 0.02]));
    m = m.subtract(Manifold.cylinder(md + 0.01, mr, mr, 64).translate([nx, cy + ny, P.split_z - md]));
  });
  if (notch) m = m.subtract(notch.extrude(100).translate([0, 0, -50])); // after the magnet refill
  const depth = st.t + B.pocket.extra_depth;
  if (depth > P.split_z - 1) throw new Error(`Sticker too thick: the pocket can be at most ${(P.split_z - 1 - B.pocket.extra_depth).toFixed(1)} mm.`);
  const [hx, hy] = stickerHalf(st);
  const pocket = stickerOutline(CS, st).extrude(depth + 1).translate([0, cy, P.split_z - depth]);
  const scoop = CS.circle(B.scoop_r, 64).translate([hx, 0]).extrude(depth + 2).translate([0, cy, P.split_z - depth - 1]);
  m = m.subtract(pocket).subtract(scoop);
  // checks: plate edges, magnets, pry notch
  const halfW = P.w / 2, halfH = P.h / 2;
  if (hx + B.scoop_r > halfW - 1.2 || hy > halfH - 3) warnings.push('The sticker pocket comes within about 1 mm of the plate edge.');
  const r = (model.magnets.dia + model.magnets.fit) / 2;
  const outline = stickerOutline(CS, st, 0.8).add(CS.circle(B.scoop_r + 0.8, 64).translate([hx, 0]));
  const mags = CS.compose(magPos.map(([x, y]) => CS.circle(r, 48).translate([x, y])));
  if (!outline.intersect(mags).isEmpty()) warnings.push('The sticker pocket runs into the magnet pockets. Use a smaller sticker.');
  if (notch && !notch.offset(0.8, 'Round', 2, 32).intersect(mags.translate([0, cy])).isEmpty()) warnings.push('The corner notch for the latch comes within 0.8 mm of a magnet pocket.');
  return { base: m, warnings };
}
