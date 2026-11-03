// End-to-end checks in Node with the same modules the page uses.
// Reference values come from the FreeCAD master model (NFC Wifi plate.FCStd, 2026-11-03).
// The cover body is checked against the exact formula instead: FreeCAD's Chamfer_CoverFront
// only cones two of the four rounded corners (+14.9 mm3), the JS hull cones all four.
const P0 = { w: 71, h: 108, r: 4, t: 3, c: 2 };
const A0 = P0.w * P0.h - (4 - Math.PI) * P0.r ** 2;
const L0 = 2 * (P0.w + P0.h) - (8 - 2 * Math.PI) * P0.r;
const BODY = A0 * (P0.t - P0.c) + (P0.c * A0 - (L0 * P0.c ** 2) / 2 + (Math.PI * P0.c ** 3) / 3);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import Module from 'manifold-3d';
import opentype from 'opentype.js';
import { unzipSync, strFromU8 } from 'fflate';
import { svgToCrossSection } from '../src/svg2d.js';
import { layoutFront, buildCover, DEFAULT_SETTINGS, placeAt } from '../src/build.js';
import { parseBinarySTL, fromManifold, printPlate, write3MF, bbox } from '../src/export3mf.js';

const root = new URL('../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, root));
const wasm = await Module();
wasm.setup?.();
const model = JSON.parse(rd('assets/model.json'));
const font = opentype.parse(rd('assets/fonts/open-sans-latin-700-normal.woff').buffer.slice(0));
const svg = (p) => svgToCrossSection(wasm, rd(p).toString(), DOMParser);

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('default logos import with the CAD areas', () => {
  const n = svg('assets/logos/n-mark.svg').cs;
  const a = svg('assets/logos/signal-arcs.svg').cs;
  // motif is 0.4 deep: area = volume / 0.4
  near(placeAt(n, 24, 0, 0).area(), 168.874 / 0.4, 4, 'N-mark area');
  near(placeAt(a, model.defaults.icon.height, 0, 0).area(), 51.145 / 0.4, 2, 'arcs area');
});

test('cover body matches the FreeCAD cover', () => {
  const { cover } = buildCover(wasm, model, null);
  const pockets = 4 * Math.PI * 3.1 ** 2 * 2.2;
  near(cover.volume(), BODY - pockets, 2, 'cover volume without motif');
  assert.equal(cover.genus(), 0);
});

test('default design: motif inlay is flush and frame ring matches CAD', () => {
  const shapes = { logo: svg('assets/logos/n-mark.svg').cs, icon: svg('assets/logos/signal-arcs.svg').cs };
  const lay = layoutFront(wasm, model, DEFAULT_SETTINGS, shapes, font);
  near(lay.parts.frame.area(), 158.694 / 0.4, 1.5, 'frame ring area');
  const { cover, motif } = buildCover(wasm, model, lay.motif2d);
  assert.ok(motif && motif.volume() > 400, 'motif has volume');
  near(cover.add(motif).volume(), BODY - 4 * Math.PI * 3.1 ** 2 * 2.2, 3, 'cover + motif fill the body');
  near(cover.intersect(motif).volume(), 0, 1e-3, 'no overlap');
  const bb = motif.boundingBox();
  near(bb.max[2], model.plate.depth, 1e-6, 'motif flush with the front');
  assert.deepEqual(lay.warnings, []);
});

test('text rows centre in the zone under the logo for any size and count', () => {
  const shapes = { logo: svg('assets/logos/n-mark.svg').cs, icon: null };
  for (const size of [6, 8, 10]) {
    for (const lines of [['One'], ['One', 'Two'], ['One', 'Two', 'Three']]) {
      const s = { ...DEFAULT_SETTINGS, icon: { ...DEFAULT_SETTINGS.icon, on: false }, textBelow: { ...DEFAULT_SETTINGS.textBelow, lines, size } };
      const lay = layoutFront(wasm, model, s, shapes, font);
      const b = lay.parts.textBelow.bounds();
      const gapTop = lay.group.y0 - b.max[1];
      const gapBot = b.min[1] - -lay.flat.halfH;
      near(gapTop, gapBot, 0.6, `size ${size}, ${lines.length} rows: centred`);
    }
  }
});

test('svg features: transforms, strokes, white knock-outs', () => {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <style>.k{fill:#fff}</style>
    <rect width="100" height="100" fill="white"/>
    <g transform="translate(50 50) scale(2)"><circle r="20" fill="#123"/><rect class="k" x="-5" y="-5" width="10" height="10"/></g>
    <path d="M10 96 L90 96" stroke="black" stroke-width="4" fill="none" stroke-linecap="butt"/>
  </svg>`;
  const { cs } = svgToCrossSection(wasm, s, DOMParser);
  near(cs.area(), Math.PI * 40 ** 2 - 20 * 20 + 80 * 4, 6, 'area');
});

test('3MF: plate layout fits and slicer metadata references the right ids', () => {
  const fixed = {};
  for (const [k, v] of Object.entries(model.parts)) fixed[k] = parseBinarySTL(k, rd(v.file));
  const shapes = { logo: svg('assets/logos/n-mark.svg').cs, icon: svg('assets/logos/signal-arcs.svg').cs };
  const lay = layoutFront(wasm, model, DEFAULT_SETTINGS, shapes, font);
  const { cover, motif } = buildCover(wasm, model, lay.motif2d);
  const plate = printPlate(model, fixed, fromManifold('Plate_Cover', cover), fromManifold('Plate_Motif', motif), { bed: 256 });
  assert.ok(plate.fits, `footprint ${plate.footprint}`);
  near(plate.footprint[0], 218.4, 0.6, 'same layout width as the CAD export');
  near(plate.footprint[1], 148.0, 0.6, 'same layout depth as the CAD export');
  for (const g of plate.groups) near(bbox(g.parts).z0, 0, 1e-4, `${g.name} on the bed`);
  const zip = unzipSync(write3MF(plate.groups, { filament: { base: 2, motif: 1 } }));
  const ms = strFromU8(zip['Metadata/model_settings.config']);
  const lr = strFromU8(zip['Metadata/layer_config_ranges.xml']);
  const coverId = lr.match(/object id="(\d+)"/)[1];
  assert.match(ms, new RegExp(`<object id="${coverId}">\\s*<metadata key="name" value="Cover \\+ motif`));
  assert.match(ms, /Plate_Motif"\/>\s*<metadata key="matrix"[^>]*>\s*<metadata key="extruder" value="1"/);
  assert.ok(zip[`3D/Objects/object_${coverId}.model`], 'sub-model file present');
  const plain = unzipSync(write3MF(plate.groups, { slicerExtras: false }));
  assert.ok(plain['3D/3dmodel.model'] && !plain['Metadata/model_settings.config']);
});

test('line-art icon (Feather/Lucide style: inherited stroke, currentColor, no fill)', () => {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
  const { cs } = svgToCrossSection(wasm, s, DOMParser);
  assert.ok(cs.area() > 40, `stroked area ${cs.area()}`);
  assert.ok(cs.numContour() >= 4, 'three arcs and a dot');
});

test('text above the logo centres between the logo group and the top edge', () => {
  const shapes = { logo: svg('assets/logos/n-mark.svg').cs, icon: svg('assets/logos/signal-arcs.svg').cs };
  const s = { ...DEFAULT_SETTINGS, groupY: -6, textBelow: { ...DEFAULT_SETTINGS.textBelow, lines: [] }, textAbove: { ...DEFAULT_SETTINGS.textAbove, lines: ['Guest network'], size: 6 } };
  const lay = layoutFront(wasm, model, s, shapes, font);
  const b = lay.parts.textAbove.bounds();
  near(lay.flat.halfH - b.max[1], b.min[1] - lay.group.y1, 1.2, 'centred above');
  assert.deepEqual(lay.warnings, []);
});
