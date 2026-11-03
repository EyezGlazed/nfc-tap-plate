# Exports the fixed parts, default logos and dimensions from the FreeCAD master model
# ("NFC Wifi plate.FCStd", which must be the open document NFC_Wifi_plate).
# Run inside FreeCAD (exec does not set __file__, so pass it):
#   __file__ = r'<this repo>\tools\export_from_freecad.py'; exec(open(__file__).read())
#
# Writes (all in the model's assembled coordinates, mm, z=0 is the wall):
#   assets/parts/frame_a.stl, frame_b.stl, latch.stl, plate_base.stl   (binary STL)
#   assets/logos/n-mark.svg, signal-arcs.svg                           (filled outlines)
#   assets/model.json                                                  (dimensions + defaults)
import FreeCAD, Part, Mesh, MeshPart, json, os, math

if '__file__' not in globals():
    raise SystemExit("Set __file__ to this script's path before exec() (see the header).")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
doc = FreeCAD.getDocument('NFC_Wifi_plate')
P = doc.Params
g = P.get


def write_stl(obj_name, fname):
    shape = doc.getObject(obj_name).Shape
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.01, AngularDeflection=0.1, Relative=False)
    path = os.path.join(REPO, 'assets', 'parts', fname)
    m.write(path)
    return {'file': 'assets/parts/' + fname, 'facets': m.CountFacets}


def front_faces(feature_names, z):
    faces = []
    for n in feature_names:
        sh = doc.getObject(n).AddSubShape
        faces += [f for f in sh.Faces if abs(f.BoundBox.ZMin - z) < 1e-6 and abs(f.BoundBox.ZMax - z) < 1e-6]
    return faces


def wire_pts(w, step=0.05):
    pts = []
    for e in Part.__sortEdges__(w.Edges):
        n = max(2, int(math.ceil(e.Length / step)) + 1)
        ps = e.discretize(n)
        if pts and (ps[0] - pts[-1]).Length > 1e-6:
            ps = list(reversed(ps))
        pts += ps if not pts else ps[1:]
    return pts


def write_svg(faces, fname, cx, cy):
    """Outlines relative to (cx, cy), SVG y down, units mm."""
    paths, xs, ys = [], [], []
    for f in faces:
        for w in f.Wires:
            pts = [(p.x - cx, -(p.y - cy)) for p in wire_pts(w)]
            xs += [p[0] for p in pts]
            ys += [p[1] for p in pts]
            paths.append('M' + ' L'.join('%.3f,%.3f' % p for p in pts) + ' Z')
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%.3fmm" height="%.3fmm" viewBox="%.3f %.3f %.3f %.3f">\n'
           '<path fill="#000" fill-rule="evenodd" d="%s"/>\n</svg>\n'
           % (x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0, ' '.join(paths)))
    with open(os.path.join(REPO, 'assets', 'logos', fname), 'w', newline='\n') as fh:
        fh.write(svg)
    return {'file': 'assets/logos/' + fname, 'w': round(x1 - x0, 3), 'h': round(y1 - y0, 3),
            'cx': round((x0 + x1) / 2, 3), 'cy': round(-(y0 + y1) / 2, 3)}


cy = g('plate_cy')
zf = g('depth')
parts = {
    'frame_a': write_stl('Frame_A', 'frame_a.stl'),
    'frame_b': write_stl('Frame_B', 'frame_b.stl'),
    'latch': write_stl('Latch', 'latch.stl'),
    'plate_base': write_stl('Plate', 'plate_base.stl'),
}
nmark = write_svg(front_faces(['Pad_Motif_NMark'], zf), 'n-mark.svg', 0, cy)
arcs = write_svg(front_faces(['Pad_Motif_WiFi'], zf), 'signal-arcs.svg', 0, cy)
card = doc.getObject('Pocket_CardPocket').AddSubShape.BoundBox

frame_outer_top = g('mf_in_h') / 2 + g('mf_line')
model = {
    'source': 'NFC Wifi plate.FCStd (FreeCAD master model), exported by tools/export_from_freecad.py',
    'units': 'mm; assembled coordinates, z = 0 is the wall, +z is the front, plate centre at (0, plate_cy)',
    'plate': {'w': g('plate_w'), 'h': g('plate_h'), 'corner_r': g('plate_corner_r'), 'cy': cy,
              'depth': g('depth'), 'split_z': g('split_z'), 'cover_t': g('cover_t'),
              'chamfer': g('front_round'), 'motif_d': g('motif_d')},
    'magnets': {'dia': g('mag_dia'), 't': g('mag_t'), 'fit': g('mag_fit'),
                'pos': [[sx * g('px'), g('py_top') - cy - k * g('py_span')] for k in (0, 1) for sx in (-1, 1)]},
    'card_pocket': {'x0': card.XMin, 'x1': card.XMax, 'y0': card.YMin - cy, 'y1': card.YMax - cy},
    'latch': {'pivot': [-g('hx'), -g('hy')], 'print_angle': 45},
    # Frame stretching (src/frame.js). The bars have a constant cross-section between the
    # cut planes and the stretch limits below. These were measured on the exported meshes:
    # top bar -40..39.5, bottom bar +-24.5..+-39.5 (outside the dovetail grooves),
    # left bar -34.5..39.5 (above the latch window), right bar -39.5..39.
    'frame': {'open_w': g('open_w'), 'open_h': g('open_h'), 'wall': g('wall'), 'depth': g('depth'),
              'lip_w': g('lip'), 'lip_h': g('lip_depth'), 'hinge_clear': g('hinge_clear'),
              'dt_d': g('dt_d'), 'dt_x': g('dt_x'), 'dt_w1': g('dt_w1'),
              'cut': {'x': 25, 'y': 25}, 'shrink_max': {'x': 14, 'y': 9},
              # hinge axes sit hinge_inset inside the outer corners (T top right, Q bottom left);
              # knuckles have radius kn_r, the clearance groove in the other half kn_rc
              'hinge_inset': g('hinge_inset'), 'kn_r': g('kn_r'), 'kn_rc': g('kn_rc')},
    'base': {'pocket': {'w': g('card_w'), 'h': g('card_h'), 't': g('card_t'), 'clear': g('card_clear'),
                        'extra_depth': round(g('slot_t') - g('card_t'), 3)},
             'scoop_r': g('scoop_r'),
             # old pocket + scoop region, refilled before the new pocket is cut (plate coords)
             'fill': {'x0': g('card_x0') - 0.05, 'x1': g('card_x1') + g('scoop_r') + 0.05,
                      'y0': -g('slot_hy') - 0.05, 'y1': g('slot_hy') + 0.05,
                      'z0': g('split_z') - g('slot_t') - 1 - 0.05}},
    'parts': parts,
    'defaults': {
        'logo': {'svg': nmark['file'], 'height': round(g('nmark_h'), 3), 'x': nmark['cx'], 'y': nmark['cy']},
        'frame': {'on': True, 'w': g('mf_in_w'), 'h': g('mf_in_h'), 'r': g('mf_in_r'), 'line': g('mf_line')},
        'icon': {'svg': arcs['file'], 'height': arcs['h'],
                 'gap': round(arcs['cy'] - arcs['h'] / 2 - frame_outer_top, 3)},
        'text_below': {'lines': ['Tap here', 'for WiFi'], 'size': g('text_size')},
        'text_above': {'lines': []},
    },
}
with open(os.path.join(REPO, 'assets', 'model.json'), 'w', newline='\n') as fh:
    json.dump(model, fh, indent=2)
print(json.dumps({k: model[k] for k in ('parts', 'defaults', 'card_pocket', 'magnets')}, indent=1))
