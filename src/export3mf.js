// Meshes, print-plate layout and 3MF writing.
// A mesh here is { name, pos: Float32Array (xyz...), tri: Uint32Array (abc...) }.
import { zipSync, strToU8 } from 'fflate';

// ---------- mesh helpers
export function fromManifold(name, man) {
  const m = man.getMesh();
  const n = m.numProp;
  const cnt = m.vertProperties.length / n;
  const pos = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    pos[3 * i] = m.vertProperties[n * i];
    pos[3 * i + 1] = m.vertProperties[n * i + 1];
    pos[3 * i + 2] = m.vertProperties[n * i + 2];
  }
  return { name, pos, tri: new Uint32Array(m.triVerts) };
}

/** Binary STL -> welded indexed mesh. */
export function parseBinarySTL(name, buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const nTri = dv.getUint32(80, true);
  if (84 + nTri * 50 !== dv.byteLength) throw new Error(`${name}: not a binary STL`);
  const map = new Map();
  const pos = [];
  const tri = new Uint32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(o + 12 * k, true), y = dv.getFloat32(o + 12 * k + 4, true), z = dv.getFloat32(o + 12 * k + 8, true);
      const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      let idx = map.get(key);
      if (idx === undefined) { idx = pos.length / 3; map.set(key, idx); pos.push(x, y, z); }
      tri[3 * t + k] = idx;
    }
  }
  return { name, pos: new Float32Array(pos), tri };
}

/** Apply a 3x4 affine [r00 r01 r02 tx; r10 r11 r12 ty; r20 r21 r22 tz] (row-major array of 12). */
export function transform(mesh, A) {
  const p = mesh.pos, q = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    q[i] = A[0] * x + A[1] * y + A[2] * z + A[3];
    q[i + 1] = A[4] * x + A[5] * y + A[6] * z + A[7];
    q[i + 2] = A[8] * x + A[9] * y + A[10] * z + A[11];
  }
  const det = A[0] * (A[5] * A[10] - A[6] * A[9]) - A[1] * (A[4] * A[10] - A[6] * A[8]) + A[2] * (A[4] * A[9] - A[5] * A[8]);
  let tri = mesh.tri;
  if (det < 0) { // mirrored: keep outward normals
    tri = new Uint32Array(mesh.tri);
    for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
  }
  return { ...mesh, pos: q, tri };
}

const rotZ = (deg, cx = 0, cy = 0) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, cx - c * cx + s * cy, s, c, 0, cy - s * cx - c * cy, 0, 0, 1, 0];
};
const FLIP_X = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0]; // 180 deg about X: face down
const compose = (A, B) => { // A after B
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[4 * i + j] = A[4 * i] * B[j] + A[4 * i + 1] * B[4 + j] + A[4 * i + 2] * B[8 + j];
    r[4 * i + 3] = A[4 * i] * B[3] + A[4 * i + 1] * B[7] + A[4 * i + 2] * B[11] + A[4 * i + 3];
  }
  return r;
};
const translateM = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

export function bbox(meshes) {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const m of meshes) {
    const p = m.pos;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < b.x0) b.x0 = p[i]; if (p[i] > b.x1) b.x1 = p[i];
      if (p[i + 1] < b.y0) b.y0 = p[i + 1]; if (p[i + 1] > b.y1) b.y1 = p[i + 1];
      if (p[i + 2] < b.z0) b.z0 = p[i + 2]; if (p[i + 2] > b.z1) b.z1 = p[i + 2];
    }
  }
  return b;
}

/**
 * Print plate, same as tools/export_print_plate.py in the CAD repo:
 *   frame A + B + latch (swung open about the pivot), wall side down, as modelled
 *   plate base: back down, turned 90 deg about Z
 *   cover + motif: face down, turned 90 deg
 * Groups are packed with `gap` and centred on a `bed` x `bed` plate.
 * @returns [{ name, parts: [mesh...], role }]
 */
export function printPlate(model, fixed, cover, motif, { gap = 6, bed = 256, include = { frame: true, base: true, cover: true }, pivot = model.latch.pivot } = {}) {
  const [qx, qy] = pivot;
  const groups = [];
  if (include.frame) groups.push({ role: 'frame', name: 'Frame (print-in-place)', parts: [fixed.frame_a, fixed.frame_b, transform(fixed.latch, rotZ(model.latch.print_angle, qx, qy))] });
  if (include.cover) groups.push({ role: 'cover', name: 'Cover + motif (face down)', parts: [cover, motif].filter(Boolean).map((m) => transform(m, compose(rotZ(90), FLIP_X))) });
  if (include.base) groups.push({ role: 'base', name: 'Plate base (back down)', parts: [transform(fixed.plate_base, rotZ(90))] });
  for (const g of groups) {
    const b = bbox(g.parts);
    g.parts = g.parts.map((m) => transform(m, translateM(-b.x0, -b.y0, -b.z0)));
  }
  // pack: frame at origin; cover to its right; base right of frame, above the cover
  const by = (r) => groups.find((g) => g.role === r);
  const fr = by('frame'), cv = by('cover'), bs = by('base');
  const fx = fr ? bbox(fr.parts).x1 + gap : 0;
  if (cv) cv.parts = cv.parts.map((m) => transform(m, translateM(fx, 0, 0)));
  if (bs) {
    const cy = cv ? bbox(cv.parts).y1 + gap : 0;
    bs.parts = bs.parts.map((m) => transform(m, translateM(fx, cy, 0)));
  }
  const all = bbox(groups.flatMap((g) => g.parts));
  const c = translateM(bed / 2 - (all.x0 + all.x1) / 2, bed / 2 - (all.y0 + all.y1) / 2, 0);
  for (const g of groups) g.parts = g.parts.map((m) => transform(m, c));
  const fin = bbox(groups.flatMap((g) => g.parts));
  return { groups, footprint: [fin.x1 - fin.x0, fin.y1 - fin.y0], fits: fin.x0 >= 0 && fin.y0 >= 0 && fin.x1 <= bed && fin.y1 <= bed };
}

// ---------- 3MF
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v) => (Math.round(v * 1e5) / 1e5).toString();

function meshXml(id, m, uuid) {
  const parts = [`<object id="${id}"${uuid ? ` p:UUID="${uuid}"` : ''} type="model"><mesh><vertices>`];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) parts.push(`<vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>`);
  parts.push('</vertices><triangles>');
  const t = m.tri;
  for (let i = 0; i < t.length; i += 3) parts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  parts.push('</triangles></mesh></object>');
  return parts.join('');
}

const uuid = (a, b) => `${a.toString(16).padStart(8, '0')}-${b.toString(16).padStart(4, '0')}-4000-8000-6e6663706c74`; // deterministic, valid form

const CT = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';

/**
 * @param groups   from printPlate(): each group becomes one object with one part per mesh
 * @param opts.slicerExtras  write Bambu/Orca/Creality metadata (filament per part, height range)
 * @param opts.filament      { base: 1, motif: 2 } 1-based filament numbers
 * @param opts.firstLayers   { top: 0.4, wallLoops: 0 } height-range modifier on the cover object
 */
export function write3MF(groups, { slicerExtras = true, filament = { base: 1, motif: 2 }, firstLayers = { top: 0.4 }, title = 'NFC Tap Plate' } = {}) {
  const files = { '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(RELS) };
  let id = 1;
  const objs = groups.map((g, gi) => {
    const parts = g.parts.map((m, pi) => ({ id: id++, mesh: m, uuid: uuid(gi + 1, pi), motif: g.role === 'cover' && pi === 1 }));
    return { ...g, id: id++, uuid: uuid(0x100 + gi + 1, 0), parts };
  });
  if (!slicerExtras) {
    const res = [];
    for (const o of objs) {
      for (const p of o.parts) res.push(meshXml(p.id, { ...p.mesh }).replace('type="model">', `name="${esc(p.mesh.name)}" type="model">`));
      res.push(`<object id="${o.id}" name="${esc(o.name)}" type="model"><components>${o.parts.map((p) => `<component objectid="${p.id}"/>`).join('')}</components></object>`);
    }
    files['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>` +
      `<metadata name="Title">${esc(title)}</metadata><resources>${res.join('')}</resources><build>` +
      objs.map((o) => `<item objectid="${o.id}"/>`).join('') + '</build></model>');
    return zipSync(files, { level: 6 });
  }
  // Bambu-style production layout (what Bambu Studio / OrcaSlicer / Creality Print write)
  const PNS = `${NS} xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"`;
  const rels = [];
  const res = [];
  for (const o of objs) {
    const path = `/3D/Objects/object_${o.id}.model`;
    rels.push(`<Relationship Target="${path}" Id="rel-${o.id}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`);
    files[path.slice(1)] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${PNS}>` +
      '<metadata name="BambuStudio:3mfVersion">1</metadata><resources>' +
      o.parts.map((p) => meshXml(p.id, p.mesh, p.uuid)).join('') + '</resources><build/></model>');
    res.push(`<object id="${o.id}" p:UUID="${o.uuid}" type="model"><components>` +
      o.parts.map((p) => `<component p:path="${path}" objectid="${p.id}" p:UUID="${uuid(0x200 + o.id, p.id)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join('') +
      '</components></object>');
  }
  files['3D/_rels/3dmodel.model.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>');
  files['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${PNS}>` +
    `<metadata name="Application">${esc(title)}</metadata><metadata name="BambuStudio:3mfVersion">1</metadata>` +
    `<metadata name="Title">${esc(title)}</metadata><resources>${res.join('')}</resources>` +
    `<build p:UUID="${uuid(0x300, 0)}">` + objs.map((o) => `<item objectid="${o.id}" p:UUID="${uuid(0x400 + o.id, 0)}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`).join('') + '</build></model>');
  const I4 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';
  files['Metadata/model_settings.config'] = strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + objs.map((o) =>
    `  <object id="${o.id}">\n    <metadata key="name" value="${esc(o.name)}"/>\n    <metadata key="extruder" value="${filament.base}"/>\n` +
    o.parts.map((p) => `    <part id="${p.id}" subtype="normal_part">\n      <metadata key="name" value="${esc(p.mesh.name)}"/>\n      <metadata key="matrix" value="${I4}"/>\n` +
      `      <metadata key="extruder" value="${p.motif ? filament.motif : filament.base}"/>\n    </part>\n`).join('') +
    '  </object>\n').join('') + '</config>\n');
  const cover = objs.find((o) => o.role === 'cover');
  if (cover && firstLayers) {
    files['Metadata/layer_config_ranges.xml'] = strToU8('<?xml version="1.0" encoding="utf-8"?>\n<objects>\n' +
      ` <object id="${cover.id}">\n  <range min_z="0" max_z="${firstLayers.top}">\n` +
      '   <option opt_key="bottom_surface_pattern">monotonicline</option>\n   <option opt_key="extruder">0</option>\n' +
      `   <option opt_key="layer_height">${firstLayers.layer ?? 0.2}</option>\n   <option opt_key="wall_loops">0</option>\n  </range>\n </object>\n</objects>\n`);
  }
  files['_rels/.rels'] = strToU8(RELS);
  return zipSync(files, { level: 6 });
}
