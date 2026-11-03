// Frame stretching, indent options and the sticker pocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { parseBinarySTL } from '../src/export3mf.js';
import { toManifold, buildFrame, buildBase, stretch } from '../src/frame.js';

const root = new URL('../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root));
const wasm = await Module();
wasm.setup?.();
const model = JSON.parse(rd('assets/model.json'));
const parts = {};
for (const [k, v] of Object.entries(model.parts)) parts[k] = toManifold(wasm, parseBinarySTL(k, rd(v.file)));
const F = model.frame;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const one = (m, msg) => { assert.equal(m.status(), 'NoError', msg); assert.equal(m.decompose().length, 1, `${msg}: one solid`); };
const DEF = { w: F.open_w, h: F.open_h, indent: 'inside', iw: F.lip_w, ih: F.lip_h };

test('stretch moves the far side and keeps one solid', () => {
  const box = wasm.Manifold.cube([10, 2, 2]);
  const g = stretch(wasm, box, 0, 5, 3, 1);
  near(g.volume(), 13 * 4, 1e-6, 'grown');
  near(g.boundingBox().max[0], 13, 1e-9, 'far end moved');
  const s = stretch(wasm, box, 0, 5, -3, -1);
  near(s.volume(), 7 * 4, 1e-6, 'shrunk');
  near(s.boundingBox().min[0], 3, 1e-9, 'near end moved (dir -1)');
});

test('default switch cover reproduces the CAD frame', () => {
  const r = buildFrame(wasm, parts, F, model.latch.pivot, DEF);
  // the regenerated lip differs from CAD only next to the knuckles (gap kept at kn_rc)
  near(r.frame_a.volume(), parts.frame_a.volume(), 3, 'A volume');
  near(r.frame_b.volume(), parts.frame_b.volume(), 3, 'B volume');
  near(r.frame_a.subtract(parts.frame_a).volume() + parts.frame_a.subtract(r.frame_a).volume(), 0, 4, 'A nearly unchanged');
  one(r.frame_a, 'A'); one(r.frame_b, 'B');
});

for (const [w, h] of [[110, 120], [83 - 27, 82.2 - 17], [95, 70], [83, 60], [56, 12]]) {
  test(`switch cover ${w} x ${h}: valid, hinge and latch clearances kept`, () => {
    const r = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, w, h });
    one(r.frame_a, 'A'); one(r.frame_b, 'B');
    assert.ok(r.frame_a.minGap(r.frame_b, 1) >= 0.39, `A-B gap ${r.frame_a.minGap(r.frame_b, 1)}`);
    // latch as printed: swung open about its pivot (closed, it sits 0.07 from A by design)
    const [px, py] = r.pivot;
    const lp = r.latch.translate([-px, -py, 0]).rotate([0, 0, model.latch.print_angle]).translate([px, py, 0]);
    assert.ok(lp.minGap(r.frame_a, 1) >= 0.39, `latch-A gap ${lp.minGap(r.frame_a, 1)}`);
    assert.ok(lp.minGap(r.frame_b, 1) >= 0.39, `latch-B gap ${lp.minGap(r.frame_b, 1)}`);
    const [ox, oy] = model.latch.pivot;
    const l0 = parts.latch.translate([-ox, -oy, 0]).rotate([0, 0, model.latch.print_angle]).translate([ox, oy, 0]);
    near(lp.minGap(r.frame_a, 1), l0.minGap(parts.frame_a, 1), 0.02, 'same latch gap as the CAD frame');
    // the opening is w x h above the lip
    const probe = wasm.CrossSection.square([w - 0.02, h - 0.02], true).extrude(1).translate([0, 0, F.lip_h + 1]);
    near(r.frame_a.intersect(probe).volume() + r.frame_b.intersect(probe).volume(), 0, 0.5, 'opening clear');
    const outer = r.frame_b.boundingBox();
    assert.ok(outer.max[0] > w / 2 + F.wall - 0.1, 'outer wall follows');
  });
}

test('too small is refused with a clear message', () => {
  assert.throws(() => buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, w: 50 }), /can't go below/);
});

test('no step: only the knuckle nibs stay in the opening (no leftover lip)', () => {
  const r = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, indent: 'none' });
  const open = wasm.CrossSection.square([F.open_w - 0.02, F.open_h - 0.02], true).extrude(F.depth); // inset: skip touching faces
  for (const [k, m] of [['A', r.frame_a], ['B', r.frame_b], ['latch', r.latch]]) {
    const inside = m.intersect(open);
    for (const piece of inside.isEmpty() ? [] : inside.decompose()) {
      const b = piece.boundingBox();
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
      assert.ok(w < 1.0 && h < 1.0, `${k}: piece ${w.toFixed(2)} x ${h.toFixed(2)} mm inside the opening`);
    }
  }
});

test('inside lip of any width keeps the hinge gap and splits cleanly', () => {
  for (const iw of [0.5, 1, 2, 3]) {
    const r = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, iw, ih: 4 });
    one(r.frame_a, `A iw ${iw}`); one(r.frame_b, `B iw ${iw}`);
    assert.ok(r.frame_a.minGap(r.frame_b, 1) >= 0.39, `iw ${iw}: A-B gap ${r.frame_a.minGap(r.frame_b, 1)}`);
  }
});

test('indent options: none, wider inside lip, outside recess', () => {
  const none = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, indent: 'none' });
  const ins = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, iw: 2, ih: 5 });
  const out = buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, indent: 'outside', iw: 0.6, ih: 2 });
  for (const r of [none, ins, out]) { one(r.frame_a, 'A'); one(r.frame_b, 'B'); assert.ok(r.frame_a.minGap(r.frame_b, 1) >= 0.39); }
  const v = (r) => r.frame_a.volume() + r.frame_b.volume();
  const base = buildFrame(wasm, parts, F, model.latch.pivot, DEF);
  assert.ok(v(none) < v(base) - 250, 'lip removed');
  assert.ok(v(ins) > v(base) + 500, 'wider, taller lip');
  assert.ok(v(out) < v(none) - 100, 'recess cut');
});

test('sticker pocket: default matches CAD, round and other sizes cut cleanly', () => {
  const def = buildBase(wasm, parts.plate_base, model, { shape: 'rect', w: 44, h: 28, t: 1, clear: 0.3 });
  near(def.base.volume(), parts.plate_base.volume(), 0.6, 'default pocket = CAD pocket');
  one(def.base, 'base');
  assert.deepEqual(def.warnings, []);
  const r30 = buildBase(wasm, parts.plate_base, model, { shape: 'round', d: 30, t: 1, clear: 0.3 });
  one(r30.base, 'round');
  assert.deepEqual(r30.warnings, []);
  const card = buildBase(wasm, parts.plate_base, model, { shape: 'rect', w: 54, h: 85.6, t: 0.8, clear: 0.3 });
  one(card.base, 'credit card');
  const big = buildBase(wasm, parts.plate_base, model, { shape: 'rect', w: 60, h: 95, t: 1, clear: 0.3 });
  assert.ok(big.warnings.length > 0, 'warns when too big');
});

test('height limit: one slice from the side-bar band, clear error below it', () => {
  const minH = F.open_h - (F.band_y[1] - F.band_y[0]) + 0.5;
  assert.ok(minH < 15, `min height ${minH}`);
  assert.throws(() => buildFrame(wasm, parts, F, model.latch.pivot, { ...DEF, h: minH - 1 }), /can't go below/);
});
