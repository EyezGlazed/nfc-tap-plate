// SVG -> 2D outlines for manifold's CrossSection.
//
// Reads <path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon> inside any
// nesting of <g>/<svg>, with transforms, presentation attributes, style="" and simple
// <style> class/element rules.
//
// Paint order is honoured: dark fills/strokes ADD to the shape, light ones (white-ish,
// luminance above LIGHT) ERASE what was painted before them. That handles knock-out
// logos (white details on a coloured shape) and white background rectangles.
//
// Strokes become filled outlines (Clipper offset), so line-art icons work without an
// Inkscape "Stroke to Path" step.
//
// Output: { cs: CrossSection (y up, SVG user units), warnings: [] }.
import svgpath from 'svgpath';
import ClipperLib from 'clipper-lib';

const LIGHT = 0.85;

// ---------- matrices: [a, b, c, d, e, f] maps (x, y) -> (a x + c y + e, b x + d y + f)
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export function parseTransform(str) {
  let m = I;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const v = t[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let n = I;
    switch (t[1]) {
      case 'matrix': n = v.slice(0, 6); break;
      case 'translate': n = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale': n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]; break;
      case 'rotate': {
        const a = (v[0] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        n = [c, s, -s, c, 0, 0];
        if (v.length > 2) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

// ---------- colours
const NAMED = { black: '#000', white: '#fff', red: '#f00', green: '#008000', blue: '#00f', gray: '#808080', grey: '#808080', silver: '#c0c0c0', yellow: '#ff0', orange: '#ffa500' };
export function luminance(col) {
  if (!col) return 0;
  col = col.trim().toLowerCase();
  if (NAMED[col]) col = NAMED[col];
  let r, g, b;
  let m;
  if ((m = col.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else if ((m = col.match(/^rgba?\(([^)]*)\)$/))) {
    [r, g, b] = m[1].split(/[\s,/]+/).map((x) => (x.endsWith('%') ? 2.55 * parseFloat(x) : parseFloat(x)));
  } else return 0; // unknown (gradient url(...), currentColor, ...): treat as dark
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------- styles
const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility', 'opacity', 'fill-opacity', 'stroke-opacity'];
const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'visibility']);

function parseDecl(text) {
  const out = {};
  for (const d of text.split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim(), v = d.slice(i + 1).replace(/!important/, '').trim();
    if (STYLE_PROPS.includes(k)) out[k] = v;
  }
  return out;
}

function parseStyleSheets(root) {
  const rules = [];
  for (const st of root.getElementsByTagName('style')) {
    const css = (st.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const decl = parseDecl(m[2]);
      for (const sel of m[1].split(',')) rules.push({ sel: sel.trim(), decl });
    }
  }
  return rules;
}

function matches(el, sel) {
  // supports: tag, .class, tag.class, #id
  const m = sel.match(/^([a-zA-Z]*)((?:\.[\w-]+)*)(#[\w-]+)?$/);
  if (!m) return false;
  if (m[1] && el.localName !== m[1]) return false;
  if (m[3] && el.getAttribute('id') !== m[3].slice(1)) return false;
  if (m[2]) {
    const cls = (el.getAttribute('class') || '').split(/\s+/);
    for (const c of m[2].split('.').filter(Boolean)) if (!cls.includes(c)) return false;
  }
  return !!(m[1] || m[2] || m[3]);
}

function ownStyle(el, rules) {
  const s = {};
  for (const p of STYLE_PROPS) if (el.hasAttribute && el.hasAttribute(p)) s[p] = el.getAttribute(p).trim();
  for (const r of rules) if (matches(el, r.sel)) Object.assign(s, r.decl);
  if (el.getAttribute && el.getAttribute('style')) Object.assign(s, parseDecl(el.getAttribute('style')));
  return s;
}

// ---------- shapes -> path data
const num = (el, a, d = 0) => {
  const v = el.getAttribute(a);
  return v == null || v === '' ? d : parseFloat(v);
};

function shapeToD(el) {
  switch (el.localName) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
      if (w <= 0 || h <= 0) return '';
      let rx = el.hasAttribute('rx') ? num(el, 'rx') : NaN, ry = el.hasAttribute('ry') ? num(el, 'ry') : NaN;
      if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry;
      if (isNaN(ry)) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
        `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
        `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(el, 'cx'), cy = num(el, 'cy');
      const rx = el.localName === 'circle' ? num(el, 'r') : num(el, 'rx');
      const ry = el.localName === 'circle' ? rx : num(el, 'ry');
      if (rx <= 0 || ry <= 0) return '';
      return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
    }
    case 'line':
      return `M${num(el, 'x1')},${num(el, 'y1')}L${num(el, 'x2')},${num(el, 'y2')}`;
    case 'polyline':
    case 'polygon': {
      const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      if (v.length < 4) return '';
      let d = `M${v[0]},${v[1]}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]},${v[i + 1]}`;
      return el.localName === 'polygon' ? d + 'Z' : d;
    }
  }
  return '';
}

// ---------- flatten path data (after matrix) into subpaths of points
function flatten(d, m, tol) {
  const p = svgpath(d).abs().unarc().unshort().matrix(m);
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0;
  const seg = (n) => Math.max(1, Math.min(200, Math.ceil(n)));
  p.iterate((s) => {
    const c = s[0];
    if (c === 'M') {
      cur = { pts: [[s[1], s[2]]], closed: false }; subs.push(cur);
      x = sx = s[1]; y = sy = s[2];
      return;
    }
    if (!cur) { cur = { pts: [[x, y]], closed: false }; subs.push(cur); }
    if (c === 'L') { x = s[1]; y = s[2]; cur.pts.push([x, y]); }
    else if (c === 'H') { x = s[1]; cur.pts.push([x, y]); }
    else if (c === 'V') { y = s[1]; cur.pts.push([x, y]); }
    else if (c === 'C') {
      const [x1, y1, x2, y2, x3, y3] = s.slice(1);
      const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = seg(Math.sqrt(len / tol) * 1.5);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
      x = x3; y = y3;
    } else if (c === 'Q') {
      const [x1, y1, x2, y2] = s.slice(1);
      const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1);
      const n = seg(Math.sqrt(len / tol) * 1.5);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.pts.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]);
      }
      x = x2; y = y2;
    } else if (c === 'Z') {
      cur.closed = true; x = sx; y = sy;
      cur = null;
    }
  });
  return subs.filter((s) => s.pts.length > 1);
}

// ---------- strokes -> polygons with Clipper
function strokeOutline(subs, width, cap, join, scale) {
  const co = new ClipperLib.ClipperOffset(4, 0.25);
  const J = join === 'miter' ? ClipperLib.JoinType.jtMiter : join === 'bevel' ? ClipperLib.JoinType.jtSquare : ClipperLib.JoinType.jtRound;
  for (const s of subs) {
    const path = s.pts.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }));
    const E = s.closed ? ClipperLib.EndType.etClosedLine
      : cap === 'round' ? ClipperLib.EndType.etOpenRound
        : cap === 'square' ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenButt;
    co.AddPath(path, J, E);
  }
  const sol = new ClipperLib.Paths();
  co.ArcTolerance = Math.max(1, 0.01 * width * scale);
  co.Execute(sol, (width / 2) * scale);
  return sol.map((pp) => pp.map((q) => [q.X / scale, q.Y / scale]));
}

/**
 * @param {object} wasm   manifold module (needs CrossSection)
 * @param {string} text   SVG source
 * @param {typeof DOMParser} DOMParserImpl  window.DOMParser in browsers, xmldom in Node
 */
export function svgToCrossSection(wasm, text, DOMParserImpl) {
  const { CrossSection } = wasm;
  const warnings = [];
  const docu = new DOMParserImpl().parseFromString(text, 'image/svg+xml');
  const root = docu.documentElement;
  if (!root || root.localName !== 'svg') throw new Error('Not an SVG file');

  // size for tolerance
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const W = vb.length === 4 ? vb[2] : parseFloat(root.getAttribute('width')) || 100;
  const H = vb.length === 4 ? vb[3] : parseFloat(root.getAttribute('height')) || 100;
  const diag = Math.hypot(W, H) || 100;
  const tol = diag / 4000;
  const scale = 1e6 / diag;
  const rules = parseStyleSheets(root);

  let acc = null;
  let counts = { add: 0, erase: 0, text: 0, image: 0 };
  const paint = (polys, rule, erase) => {
    if (!polys.length) return;
    const pts = polys.map((pp) => pp.map(([x, y]) => [x, -y]));
    let cs = new CrossSection(pts, rule === 'evenodd' ? 'EvenOdd' : 'NonZero');
    if (erase) { if (acc) acc = acc.subtract(cs); counts.erase++; }
    else { acc = acc ? acc.add(cs) : cs; counts.add++; }
  };

  const walk = (el, m, inh) => {
    if (el.nodeType !== 1) return;
    const name = el.localName;
    if (['defs', 'clipPath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'filter'].includes(name)) return;
    const own = ownStyle(el, rules);
    if (own.display === 'none') return;
    const st = {};
    for (const k of Object.keys(inh)) if (INHERITED.has(k)) st[k] = inh[k];
    Object.assign(st, own);
    let mm = el.getAttribute('transform') ? mul(m, parseTransform(el.getAttribute('transform'))) : m;
    if (name === 'svg' && el !== root) mm = mul(mm, [1, 0, 0, 1, num(el, 'x'), num(el, 'y')]);
    if (name === 'g' || name === 'svg' || name === 'a') {
      for (const c of Array.from(el.childNodes)) walk(c, mm, st);
      return;
    }
    if (name === 'text') { counts.text++; return; }
    if (name === 'image') { counts.image++; return; }
    const d = shapeToD(el);
    if (!d || st.visibility === 'hidden' || parseFloat(st.opacity ?? '1') === 0) return;
    const subs = flatten(d, mm, tol);
    if (!subs.length) return;
    const fill = st.fill ?? '#000';
    const isLine = name === 'line' || name === 'polyline';
    if (fill !== 'none' && !isLine && parseFloat(st['fill-opacity'] ?? '1') > 0) {
      paint(subs.map((s) => s.pts), st['fill-rule'], luminance(fill) > LIGHT);
    }
    const stroke = st.stroke;
    const sw = parseFloat(st['stroke-width'] ?? '1');
    if (stroke && stroke !== 'none' && sw > 0 && parseFloat(st['stroke-opacity'] ?? '1') > 0) {
      const k = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
      paint(strokeOutline(subs, sw * k, st['stroke-linecap'], st['stroke-linejoin'], scale), 'nonzero', luminance(stroke) > LIGHT);
    }
  };
  walk(root, I, {});
  if (counts.text) warnings.push(`${counts.text} <text> element(s) ignored: convert text to paths in your editor first.`);
  if (counts.image) warnings.push(`${counts.image} embedded bitmap(s) ignored: only vector shapes are used.`);
  if (!acc || acc.isEmpty()) throw new Error('No dark filled or stroked shapes found in the SVG.');
  return { cs: acc, warnings };
}
