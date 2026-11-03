import Module from 'manifold-3d';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { svgToCrossSection } from './svg2d.js';
import { layoutFront, buildCover, DEFAULT_SETTINGS } from './build.js';
import { parseBinarySTL, fromManifold, printPlate, write3MF, transform } from './export3mf.js';
import { toManifold, buildFrame, buildBase, STICKER_PRESETS } from './frame.js';

const FONTS = [
  { id: 'open-sans-700', label: 'Open Sans Bold', file: 'assets/fonts/open-sans-latin-700-normal.woff' },
  { id: 'open-sans-700i', label: 'Open Sans Bold Italic', file: 'assets/fonts/open-sans-latin-700-italic.woff' },
  { id: 'open-sans-800', label: 'Open Sans ExtraBold', file: 'assets/fonts/open-sans-latin-800-normal.woff' },
  { id: 'atkinson-700', label: 'Atkinson Hyperlegible Bold', file: 'assets/fonts/atkinson-hyperlegible-latin-700-normal.woff' },
  { id: 'montserrat-700', label: 'Montserrat Bold', file: 'assets/fonts/montserrat-latin-700-normal.woff' },
  { id: 'nunito-800', label: 'Nunito ExtraBold (rounded)', file: 'assets/fonts/nunito-latin-800-normal.woff' },
  { id: 'roboto-700', label: 'Roboto Bold', file: 'assets/fonts/roboto-latin-700-normal.woff' },
  { id: 'roboto-slab-700', label: 'Roboto Slab Bold', file: 'assets/fonts/roboto-slab-latin-700-normal.woff' },
];
const STORE = 'nfc-tap-plate:v1';
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
const setStatus = (t, err = false) => { statusEl.textContent = t; statusEl.classList.toggle('err', err); };

// ---------------- state
const clone = (o) => JSON.parse(JSON.stringify(o));
let state = {
  settings: clone(DEFAULT_SETTINGS),
  logoSvg: null, logoName: null, // null = default N-mark
  iconSvg: null, iconName: null, // null = default signal arcs
  fontId: 'open-sans-700', customFont: null, customFontName: null, // customFont: base64
  view: { plate: '#26262a', motif: '#d6402f', showTag: true, showFrame: true },
  out: { baseFil: 1, motifFil: 2, extras: true, bed: 256, frame: true, base: true, cover: true },
};
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved && saved.settings) state = merge(state, saved);
} catch { /* storage blocked: defaults */ }
function merge(a, b) {
  if (Array.isArray(a) || typeof a !== 'object' || a === null) return b === undefined ? a : b;
  const o = { ...a };
  for (const k of Object.keys(b || {})) o[k] = k in a ? merge(a[k], b[k]) : b[k];
  return o;
}
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* quota or blocked */ }
}
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
// link parameters: #settings.switch.w=90&settings.sticker.shape=round&view=3d
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
  if (!/^(settings|view|out)\./.test(k) || getPath(state, k) === undefined || typeof getPath(state, k) === 'object' && !Array.isArray(getPath(state, k))) continue;
  const cur = getPath(state, k);
  setPath(state, k, Array.isArray(cur) ? v.split('|') : typeof cur === 'number' ? parseFloat(v) : typeof cur === 'boolean' ? v === 'true' : v);
}

// ---------------- panel (generated from a schema)
const num = (key, label, unit = 'mm', step = 0.1, min, max) => ({ t: 'num', key, label, unit, step, min, max });
const chk = (key, label) => ({ t: 'chk', key, label });
const sel = (key, label, options) => ({ t: 'sel', key, label, options });
const ALIGN = [['center', 'Centred in the space'], ['logo', 'Close to the logo'], ['edge', 'Close to the edge']];
const textFields = (z) => [
  { t: 'lines', key: `settings.${z}.lines`, label: 'One row per line, up to 3. Leave empty for none.' },
  num(`settings.${z}.size`, 'Capital letter height', 'mm', 0.5, 3, 20),
  { t: 'pct', key: `settings.${z}.lineGap`, label: 'Space between rows', unit: '%', step: 5, min: 0, max: 200 },
  sel(`settings.${z}.align`, 'Placement', ALIGN),
  num(`settings.${z}.gap`, 'Distance (for “close to”)', 'mm', 0.5, 0, 30),
];
const isRound = () => state.settings.sticker.shape === 'round';
const indentOn = () => state.settings.switch.indent !== 'none';
const SCHEMA = [
  { title: 'Light switch cover', hint: 'Measure the switch cover the frame clamps around. The hinges and latch stay the same; the bars get longer or shorter.', fields: [
    num('settings.switch.w', 'Width', 'mm', 0.1, 55, 200),
    num('settings.switch.h', 'Height', 'mm', 0.1, 64, 200),
    sel('settings.switch.indent', 'Step near the wall', [['inside', 'Narrower: frame hooks in'], ['outside', 'Wider rim: frame clears it'], ['none', 'None: straight sides']]),
    { ...num('settings.switch.iw', 'Step width (per side)', 'mm', 0.1, 0.2, 5), show: indentOn },
    { ...num('settings.switch.ih', 'Step height from the wall', 'mm', 0.1, 0.5, 8.5), show: indentOn },
  ] },
  { title: 'NFC sticker', hint: 'The plate stays the same size (it fits a phone); only the pocket under the cover changes.', fields: [
    { t: 'preset' },
    sel('settings.sticker.shape', 'Shape', [['rect', 'Rectangle'], ['round', 'Round']]),
    { ...num('settings.sticker.w', 'Width', 'mm', 0.5, 5, 66), show: () => !isRound() },
    { ...num('settings.sticker.h', 'Height', 'mm', 0.5, 5, 100), show: () => !isRound() },
    { ...num('settings.sticker.d', 'Diameter', 'mm', 0.5, 5, 66), show: isRound },
    num('settings.sticker.t', 'Thickness', 'mm', 0.1, 0.1, 4),
    num('settings.sticker.clear', 'Fit clearance (total)', 'mm', 0.05, 0, 2),
  ] },
  { title: 'Logo', open: true, hint: 'Sits over the NFC tag. Any SVG: dark shapes print in the motif colour, white shapes cut holes.', fields: [
    { t: 'file', which: 'logo', label: 'Logo SVG' },
    num('settings.logo.height', 'Height', 'mm', 0.5, 2, 90),
    num('settings.logo.x', 'Move right', 'mm', 0.5, -30, 30),
    num('settings.logo.y', 'Move up', 'mm', 0.5, -40, 40),
  ] },
  { title: 'Frame around the logo', hint: 'Marks where to hold the phone. By default it follows the sticker.', fields: [
    chk('settings.frame.on', 'Show frame'),
    chk('settings.frame.match', 'Follow the sticker shape and size'),
    { ...num('settings.frame.margin', 'Space around the sticker', 'mm', 0.5, 0, 15), show: () => state.settings.frame.match },
    { ...num('settings.frame.w', 'Inside width', 'mm', 0.5, 5, 65), show: () => !state.settings.frame.match },
    { ...num('settings.frame.h', 'Inside height', 'mm', 0.5, 5, 100), show: () => !state.settings.frame.match },
    { ...num('settings.frame.r', 'Corner radius', 'mm', 0.5, 0, 30), show: () => !(state.settings.frame.match && isRound()) },
    num('settings.frame.line', 'Line width', 'mm', 0.2, 0.4, 8),
  ] },
  { title: 'Icon above', hint: 'Centred above the frame (or the logo when the frame is off).', fields: [
    chk('settings.icon.on', 'Show icon'),
    { t: 'file', which: 'icon', label: 'Icon SVG' },
    num('settings.icon.height', 'Height', 'mm', 0.5, 2, 60),
    num('settings.icon.gap', 'Gap to frame', 'mm', 0.2, 0, 30),
  ] },
  { title: 'Position', hint: 'Logo, frame and icon move together. 0 puts the logo over the middle of the tag.', fields: [
    num('settings.groupY', 'Move group up', 'mm', 0.5, -50, 50),
    num('settings.edgeMargin', 'Warn closer than this to the edge', 'mm', 0.5, 0, 10),
  ] },
  { title: 'Text below', open: true, fields: textFields('textBelow') },
  { title: 'Text above', fields: textFields('textAbove') },
  { title: 'Font', fields: [{ t: 'font' }] },
  { title: 'Preview', fields: [
    { t: 'colors' },
    chk('view.showTag', 'Show NFC tag outline'),
    chk('view.showFrame', 'Show light switch frame and base'),
  ] },
  { title: 'Export', hint: 'One 3MF with the parts laid out for printing: frame (print-in-place), plate base back down, cover face down.', fields: [
    chk('out.frame', 'Include frame'), chk('out.base', 'Include plate base'), chk('out.cover', 'Include cover + motif'),
    num('out.baseFil', 'Filament for plate', '#', 1, 1, 16),
    num('out.motifFil', 'Filament for motif', '#', 1, 1, 16),
    num('out.bed', 'Bed size', 'mm', 1, 120, 500),
    chk('out.extras', 'Bambu / Orca / Creality extras'),
    { t: 'note', text: 'Extras pre-assign the filaments above and add a 0–0.4 mm height range with 0 walls on the cover, so both colours print in the same line direction. Turn off for PrusaSlicer, Cura and others.' },
  ] },
];

const panel = $('#panel');
const fileInputs = {};
const openSecs = new Set(SCHEMA.filter((s) => s.open).map((s) => s.title));
const shown = [];
function updateVisibility() { for (const [el, fn] of shown) el.hidden = !fn(); }
function buildPanel() {
  panel.innerHTML = '';
  shown.length = 0;
  for (const sec of SCHEMA) {
    const d = document.createElement('details');
    if (openSecs.has(sec.title)) d.open = true;
    d.addEventListener('toggle', () => { if (d.open) openSecs.add(sec.title); else openSecs.delete(sec.title); });
    d.innerHTML = `<summary>${sec.title}</summary>`;
    const body = document.createElement('div');
    body.className = 'sec';
    if (sec.hint) body.insertAdjacentHTML('beforeend', `<p class="hint">${sec.hint}</p>`);
    for (const f of sec.fields) {
      const el = field(f);
      if (f.show) shown.push([el, f.show]);
      body.append(el);
    }
    d.append(body);
    panel.append(d);
  }
  updateVisibility();
}
let uid = 0;
function field(f) {
  const id = `f${uid++}`;
  const wrap = document.createElement('div');
  if (f.t === 'num' || f.t === 'pct') {
    wrap.className = 'row';
    const v = getPath(state, f.key);
    const shown = f.t === 'pct' ? Math.round(v * 100) : v;
    wrap.innerHTML = `<label for="${id}">${f.label}</label><div class="unit"><input id="${id}" type="number" step="${f.step}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} value="${shown}"><span>${f.unit}</span></div>`;
    wrap.querySelector('input').addEventListener('input', (e) => {
      const x = parseFloat(e.target.value);
      if (!Number.isFinite(x)) return;
      setPath(state, f.key, f.t === 'pct' ? x / 100 : x);
      changed(f.key);
    });
  } else if (f.t === 'chk') {
    wrap.innerHTML = `<label class="check"><input id="${id}" type="checkbox" ${getPath(state, f.key) ? 'checked' : ''}> ${f.label}</label>`;
    wrap.querySelector('input').addEventListener('change', (e) => { setPath(state, f.key, e.target.checked); changed(f.key); });
  } else if (f.t === 'sel') {
    wrap.className = 'row wide';
    wrap.innerHTML = `<label for="${id}">${f.label}</label><select id="${id}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    const s = wrap.querySelector('select');
    s.value = getPath(state, f.key);
    s.addEventListener('change', () => { setPath(state, f.key, s.value); changed(f.key); });
  } else if (f.t === 'lines') {
    wrap.innerHTML = `<label class="hint" for="${id}">${f.label}</label><textarea id="${id}" rows="3" spellcheck="false"></textarea>`;
    const ta = wrap.querySelector('textarea');
    ta.value = getPath(state, f.key).join('\n');
    ta.addEventListener('input', () => {
      const lines = ta.value.split('\n');
      if (lines.length > 3) { ta.value = lines.slice(0, 3).join('\n'); }
      setPath(state, f.key, ta.value.split('\n').slice(0, 3));
      changed(f.key);
    });
  } else if (f.t === 'file') {
    wrap.className = 'file';
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.svg,image/svg+xml'; input.hidden = true;
    const nm = () => state[`${f.which}Name`] || (f.which === 'logo' ? 'Default: NFC N-mark' : 'Default: signal arcs');
    wrap.innerHTML = `<button type="button">Choose SVG…</button><button type="button" class="ghost">Default</button><span class="name"></span>`;
    const [pick, reset] = wrap.querySelectorAll('button');
    const name = wrap.querySelector('.name');
    name.textContent = nm();
    pick.addEventListener('click', () => input.click());
    reset.addEventListener('click', () => { state[`${f.which}Svg`] = null; state[`${f.which}Name`] = null; name.textContent = nm(); shapes[f.which] = null; changed(f.which); });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      state[`${f.which}Svg`] = await file.text();
      state[`${f.which}Name`] = file.name;
      name.textContent = file.name;
      shapes[f.which] = null;
      input.value = '';
      changed(f.which);
    });
    wrap.append(input);
    fileInputs[f.which] = { name, nm };
  } else if (f.t === 'font') {
    wrap.className = 'sec';
    wrap.style.padding = '0';
    wrap.innerHTML = `<select id="${id}">${FONTS.map((x) => `<option value="${x.id}">${x.label}</option>`).join('')}<option value="custom">Your own font…</option></select>
      <div class="file"><button type="button">Upload font…</button><span class="name"></span></div>
      <p class="hint">TTF, OTF or WOFF. Bold fonts print best at 0.4 mm nozzle size.</p>`;
    const s = wrap.querySelector('select');
    const name = wrap.querySelector('.name');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff'; input.hidden = true;
    wrap.append(input);
    const refresh = () => { s.value = state.fontId === 'custom' && !state.customFont ? 'open-sans-700' : state.fontId; name.textContent = state.customFontName ? `Uploaded: ${state.customFontName}` : ''; };
    refresh();
    s.addEventListener('change', () => {
      if (s.value === 'custom' && !state.customFont) { input.click(); refresh(); return; }
      state.fontId = s.value; font = null; changed('font');
    });
    wrap.querySelector('button').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      try { opentype.parse(buf); } catch (e) { setStatus(`Font not readable: ${e.message}`, true); return; }
      state.customFont = b64(buf); state.customFontName = file.name; state.fontId = 'custom';
      input.value = ''; font = null; refresh(); changed('font');
    });
  } else if (f.t === 'colors') {
    wrap.className = 'colors';
    wrap.innerHTML = `<label><input type="color" value="${state.view.plate}"> Plate</label><label><input type="color" value="${state.view.motif}"> Motif</label>`;
    const [a, b] = wrap.querySelectorAll('input');
    a.addEventListener('input', () => { state.view.plate = a.value; persist(); paintColors(); });
    b.addEventListener('input', () => { state.view.motif = b.value; persist(); paintColors(); });
  } else if (f.t === 'preset') {
    wrap.className = 'row wide';
    wrap.innerHTML = `<label for="${id}">Common sizes</label><select id="${id}" data-preset><option value="">Custom</option>${STICKER_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>`;
    const s = wrap.querySelector('select');
    s.value = state.settings.sticker.preset || '';
    s.addEventListener('change', () => {
      const p = STICKER_PRESETS.find((x) => x.id === s.value);
      const st = state.settings.sticker;
      st.preset = s.value;
      if (p) { st.shape = p.shape; if (p.w) st.w = p.w; if (p.h) st.h = p.h; if (p.d) st.d = p.d; st.t = p.t ?? 1; }
      buildPanel();
      changed('settings.sticker');
    });
  } else if (f.t === 'note') {
    wrap.innerHTML = `<p class="hint">${f.text}</p>`;
  }
  return wrap;
}
const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

// ---------------- three.js view
const wrapEl = $('#canvas-wrap');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
wrapEl.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(28, 1, 1, 5000);
// Mouse: left drag rotates, Shift + middle drag pans, middle drag / wheel zooms.
// Right button does nothing here (users may have mouse gestures on it).
function makeControls() {
  const c = new OrbitControls(camera, renderer.domElement);
  c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
  c.addEventListener('change', () => { sun.position.copy(camera.position).add(new THREE.Vector3(60, 120, 80)); render(); });
  return c;
}
// decide pan vs zoom before OrbitControls sees the press (capture phase on the parent)
wrapEl.addEventListener('pointerdown', (e) => {
  if (e.button === 1) controls.mouseButtons.MIDDLE = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY;
}, true);
wrapEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no auto-scroll
let controls = makeControls();
const mats = {
  plate: new THREE.MeshStandardMaterial({ color: state.view.plate, roughness: 0.75, metalness: 0, flatShading: true }),
  motif: new THREE.MeshStandardMaterial({ color: state.view.motif, roughness: 0.6, metalness: 0, flatShading: true }),
  fixed: new THREE.MeshStandardMaterial({ color: state.view.plate, roughness: 0.8, metalness: 0, flatShading: true }),
};
function paintColors() {
  mats.plate.color.set(state.view.plate); mats.fixed.color.set(state.view.plate); mats.motif.color.set(state.view.motif);
  render();
}
const groupAssembled = new THREE.Group();
const groupPrint = new THREE.Group();
scene.add(groupAssembled, groupPrint);
let viewMode = 'front';

function meshObj(m, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.tri, 1));
  return new THREE.Mesh(g, mat);
}
function clearGroup(g) {
  for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose(); }
}
function render() { renderer.render(scene, camera); }
function resize() {
  const r = wrapEl.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  render();
}
new ResizeObserver(resize).observe(wrapEl);

function frameCamera(fit = true) {
  const front = viewMode !== 'print';
  groupAssembled.visible = front; groupPrint.visible = !front;
  if (!fit) return render();
  const box = new THREE.Box3().setFromObject(front ? (state.view.showFrame ? groupAssembled : coverOnly) : groupPrint);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y) / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.18 + size.z;
  controls.dispose();
  if (viewMode === 'front') {
    camera.up.set(0, 1, 0); camera.position.set(c.x, c.y, c.z + dist);
  } else if (viewMode === '3d') {
    camera.up.set(0, 1, 0); camera.position.set(c.x + dist * 0.55, c.y - dist * 0.35, c.z + dist * 0.8);
  } else {
    camera.up.set(0, 0, 1); camera.position.set(c.x, c.y - dist * 0.75, c.z + dist * 0.75);
  }
  sun.position.copy(camera.position).add(new THREE.Vector3(60, 120, 80));
  controls = makeControls();
  controls.target.copy(c);
  controls.update();
  render();
}
let coverOnly = new THREE.Group();
document.querySelectorAll('#view-seg button').forEach((b) => b.addEventListener('click', () => {
  viewMode = b.dataset.view;
  document.querySelectorAll('#view-seg button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  if (viewMode === 'print') updatePrintPreview();
  frameCamera();
}));

// ---------------- loading
let wasm, model, fixedSrc = {}, font = null;
const fixedMan = {};
let fixed = {}; // current meshes after resizing: frame_a, frame_b, latch, plate_base
let frameRes = null, frameKey = '', baseKey = '';
const shapes = { logo: null, icon: null };
const defaultSvg = {};
async function boot() {
  try {
    wasm = await Module();
    wasm.setup?.();
    model = await (await fetch('assets/model.json')).json();
    const parts = await Promise.all(Object.entries(model.parts).map(async ([k, v]) => [k, parseBinarySTL(k, await (await fetch(v.file)).arrayBuffer())]));
    fixedSrc = Object.fromEntries(parts);
    for (const [k, m] of parts) fixedMan[k] = toManifold(wasm, m);
    defaultSvg.logo = await (await fetch(model.defaults.logo.svg)).text();
    defaultSvg.icon = await (await fetch(model.defaults.icon.svg)).text();
    buildPanel();
    resize();
    await rebuild();
    const hv = new URLSearchParams(location.hash.slice(1)).get('view');
    const vb = hv && document.querySelector(`#view-seg button[data-view="${hv}"]`);
    if (vb) vb.click(); else frameCamera();
  } catch (e) {
    console.error(e);
    setStatus(`Could not start: ${e.message}`, true);
  }
}

async function getFont() {
  if (font) return font;
  let buf;
  if (state.fontId === 'custom' && state.customFont) buf = unb64(state.customFont);
  else buf = await (await fetch((FONTS.find((f) => f.id === state.fontId) || FONTS[0]).file)).arrayBuffer();
  font = opentype.parse(buf);
  return font;
}
function getShape(which) {
  if (shapes[which]) return { cs: shapes[which], warnings: [] };
  const src = state[`${which}Svg`] || defaultSvg[which];
  const r = svgToCrossSection(wasm, src, DOMParser);
  shapes[which] = r.cs;
  return r;
}

// ---------------- rebuild
let timer = null, building = false, again = false, current = null;
function changed(key) {
  if (/^settings\.sticker\.(shape|w|h|d|t)$/.test(key) && state.settings.sticker.preset) {
    const p = STICKER_PRESETS.find((x) => x.id === state.settings.sticker.preset);
    const st = state.settings.sticker;
    if (!p || p.shape !== st.shape || (p.w && (p.w !== st.w || p.h !== st.h)) || (p.d && p.d !== st.d)) {
      st.preset = '';
      const ps = panel.querySelector('select[data-preset]');
      if (ps) ps.value = '';
    }
  }
  updateVisibility();
  persist();
  if (key.startsWith('view.') || key.startsWith('out.')) {
    if (key === 'view.showFrame') { for (const o of groupAssembled.children) if (o.userData.fixed) o.visible = state.view.showFrame; frameCamera(); }
    if (key === 'view.showTag') { tagLines.visible = state.view.showTag; render(); }
    if (key.startsWith('out.') && viewMode === 'print') { updatePrintPreview(); frameCamera(); }
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(rebuild, 120);
}
let tagLines = new THREE.Group();
async function rebuild() {
  if (building) { again = true; return; }
  building = true;
  const t0 = performance.now();
  setStatus('Building…');
  const warnings = [], notes = [];
  try {
    const f = await getFont();
    const lg = getShape('logo'); warnings.push(...lg.warnings.map((w) => `Logo: ${w}`));
    let icon = null;
    if (state.settings.icon.on) { const ic = getShape('icon'); icon = ic.cs; warnings.push(...ic.warnings.map((w) => `Icon: ${w}`)); }
    // frame and base only rebuild when their inputs change
    const S = state.settings;
    const fk = JSON.stringify(S.switch), bk = JSON.stringify(S.sticker) + fk;
    if (fk !== frameKey) {
      frameKey = '';
      frameRes = buildFrame(wasm, fixedMan, model.frame, model.latch.pivot, S.switch);
      for (const k of ['frame_a', 'frame_b', 'latch']) fixed[k] = fromManifold(k, frameRes[k]);
      frameKey = fk;
    }
    const yShift = -frameRes.dH / 2;
    if (bk !== baseKey) {
      baseKey = '';
      const b = buildBase(wasm, fixedMan.plate_base, model, S.sticker);
      fixed.plate_base = transform(fromManifold('plate_base', b.base), [1, 0, 0, 0, 0, 1, 0, yShift, 0, 0, 1, 0]);
      fixed.baseWarnings = b.warnings;
      baseKey = bk;
    }
    warnings.push(...frameRes.warnings, ...(fixed.baseWarnings || []));
    notes.push(...frameRes.notes);
    const lay = layoutFront(wasm, model, S, { logo: lg.cs, icon }, f);
    warnings.push(...lay.warnings);
    const { cover, motif } = buildCover(wasm, model, lay.motif2d, yShift);
    current = { cover: fromManifold('Plate_Cover', cover), motif: motif ? fromManifold('Plate_Motif', motif) : null, lay };
    // assembled view
    clearGroup(groupAssembled);
    for (const k of ['frame_a', 'frame_b', 'latch', 'plate_base']) {
      const o = meshObj(fixed[k], mats.fixed);
      o.userData.fixed = true;
      o.visible = state.view.showFrame;
      groupAssembled.add(o);
    }
    coverOnly = new THREE.Group();
    const co = meshObj(current.cover, mats.plate);
    groupAssembled.add(co);
    if (current.motif) groupAssembled.add(meshObj(current.motif, mats.motif));
    coverOnly.add(co.clone());
    tagLines = makeOutlines(yShift);
    tagLines.visible = state.view.showTag;
    groupAssembled.add(tagLines);
    if (viewMode === 'print') updatePrintPreview();
    render();
    setStatus(`Updated in ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    console.error(e);
    setStatus(e.message, true);
  }
  showWarnings(warnings, notes);
  building = false;
  if (again) { again = false; rebuild(); }
}
function makeOutlines(yShift) {
  const g = new THREE.Group();
  const z = model.plate.depth + 0.05, cy = model.plate.cy + yShift;
  const st = state.settings.sticker;
  let pts;
  if (st.shape === 'round') {
    const r = st.d / 2;
    pts = Array.from({ length: 97 }, (_, i) => { const a = (i / 96) * Math.PI * 2; return new THREE.Vector3(r * Math.cos(a), cy + r * Math.sin(a), z); });
  } else {
    const x = st.w / 2, y = st.h / 2;
    pts = [[-x, -y], [x, -y], [x, y], [-x, y], [-x, -y]].map(([a, b]) => new THREE.Vector3(a, b + cy, z));
  }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x3fa7ff, dashSize: 1.6, gapSize: 1.2 }));
  l.computeLineDistances();
  g.add(l);
  return g;
}
function showWarnings(list, notes = []) {
  const ul = $('#warnings');
  ul.innerHTML = '';
  for (const [items, cls] of [[list, 'warn'], [notes, 'note']]) {
    for (const w of items) { const li = document.createElement('li'); li.className = cls; li.textContent = w; ul.append(li); }
  }
}
function plate() {
  return printPlate(model, fixed, current.cover, current.motif, {
    bed: state.out.bed, include: { frame: state.out.frame, base: state.out.base, cover: state.out.cover }, pivot: frameRes.pivot,
  });
}
function updatePrintPreview() {
  if (!current) return;
  clearGroup(groupPrint);
  const pl = plate();
  const bed = state.out.bed;
  const bedMesh = new THREE.Mesh(new THREE.PlaneGeometry(bed, bed), new THREE.MeshStandardMaterial({ color: 0x9a9aa0, roughness: 1 }));
  bedMesh.position.set(bed / 2, bed / 2, -0.05);
  groupPrint.add(bedMesh);
  const grid = new THREE.GridHelper(bed, bed / 16, 0x777777, 0x888888);
  grid.rotation.x = Math.PI / 2; grid.position.set(bed / 2, bed / 2, 0);
  groupPrint.add(grid);
  for (const g of pl.groups) g.parts.forEach((m) => groupPrint.add(meshObj(m, m.name === 'Plate_Motif' ? mats.motif : mats.plate)));
  if (!pl.fits) showWarnings([`The parts need ${pl.footprint.map((x) => x.toFixed(0)).join(' × ')} mm and don't fit a ${bed} mm bed. Export fewer parts at once.`]);
}

// ---------------- buttons
const download = (data, name, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#btn-export').addEventListener('click', () => {
  if (!current) return;
  const pl = plate();
  if (!pl.groups.length) return setStatus('Nothing selected to export.', true);
  const data = write3MF(pl.groups, {
    slicerExtras: state.out.extras,
    filament: { base: state.out.baseFil, motif: state.out.motifFil },
    firstLayers: { top: model.plate.motif_d, layer: 0.2 },
  });
  download(data, 'nfc-tap-plate.3mf', 'model/3mf');
  setStatus(`3MF saved (${(data.length / 1e6).toFixed(1)} MB)`);
});
$('#btn-save').addEventListener('click', () => {
  download(JSON.stringify({ app: 'nfc-tap-plate', version: 1, ...state }, null, 1), 'nfc-tap-plate-design.json', 'application/json');
});
$('#btn-load').addEventListener('click', () => $('#file-design').click());
$('#file-design').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'nfc-tap-plate') throw new Error('not an NFC Tap Plate design file');
    const { app, version, ...rest } = d;
    void app; void version;
    state = merge(state, rest);
    shapes.logo = shapes.icon = null; font = null;
    persist(); buildPanel(); paintColors(); rebuild();
  } catch (err) { setStatus(`Could not open: ${err.message}`, true); }
  e.target.value = '';
});

boot();
