// Tag outline colour: WCAG AAA where possible, AA otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, outlineColor } from '../src/contrast.js';

test('WCAG contrast ratio matches the reference values', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
});

test('outline is AAA on the plate for any plate colour where AAA exists, else AA', () => {
  for (let v = 0; v <= 255; v += 5) {
    const g = '#' + v.toString(16).padStart(2, '0').repeat(3);
    for (const motif of ['#d6402f', '#ffffff', '#000000', '#2050ff', g]) {
      const o = outlineColor(g, motif);
      const best = Math.max(contrast(g, '#000000'), contrast(g, '#ffffff'));
      assert.ok(o.plate >= (best >= 7 ? 7 : 4.5), `plate ${g} motif ${motif}: ${o.color} ${o.plate.toFixed(2)}`);
    }
  }
  // default colours: AAA on the dark plate, and on the red motif too if it can be had
  const d = outlineColor('#26262a', '#d6402f');
  assert.ok(d.plate >= 7, `default plate ${d.plate}`);
  assert.ok(d.motif >= 4.5, `default motif ${d.motif}`);
});
