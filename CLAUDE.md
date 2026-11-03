# NFC Tap Plate (web customizer)

A static web page that designs the front (cover + motif) of the NFC tag plate and exports
the full print plate as one 3MF. The name is deliberately generic: users can put any logo
for any NFC function on it (the user asked for "wifi" not to be in the name).

The CAD master is a FreeCAD model (`NFC Wifi plate.FCStd`) kept privately by the author.
This repo is public (GitHub Pages): keep personal files (photos, screenshots, the FCStd,
the Fusion STEP) and local paths out of it.

## Layout
- `index.html`: import map (pinned CDN versions) + shell.
- `src/app.js`: UI generated from `SCHEMA`, three.js preview (Front / 3D / Print plate),
  state in localStorage (`nfc-tap-plate:v1`), save/open design JSON, 3MF download.
  `#view=3d` or `#view=print` in the URL opens that view. Any `settings.*`, `view.*` or
  `out.*` key can be set the same way (arrays separated by `|`). This is handy for
  headless screenshots: Chrome `--headless=new --use-angle=swiftshader
  --enable-unsafe-swiftshader --screenshot`.
- `src/build.js`: `layoutFront` (2D layout in plate coordinates) and `buildCover`
  (manifold solids in the model's assembled coordinates).
- `src/svg2d.js`: SVG to CrossSection. Paint order: dark adds, light (luminance > 0.85)
  erases. Strokes are offset with clipper-lib.
- `src/frame.js`: switch cover size, indent and sticker pocket.
  - `buildFrame` STRETCHES the CAD frame meshes at x = +-25 and y = +-25. The bars are
    prismatic there (measured). Growing fills the gap with a 1 mm slab of the bar scaled
    along the axis. Shrinking removes a slice: in x first up to model.frame.shrink_max.x per
    side outside the dovetail grooves; below 55 wide (user request) a slice from the middle
    of the top and bottom bars (|x| < mid_x) moves both grooves inward, and `buildBase`
    moves the plate's tongues (the only plate geometry above its top edge) to match,
    keeping dt_web_min between the grooves (min width about 28). In y ONE slice from
    the middle of model.frame.band_y, where both side bars are prismatic (min about
    28 x 10.2). The old two-cut y shrink stopped at 64.2, which the user called out as far
    too much.
  - The latch, plate and cover move with their corner (base/cover by -dH/2 in y).
  - Below about 73 wide the bottom-left knuckle and the latch reach over the plate's
    (square) top-left corner. `buildFrame` then returns `plateNotch` (2D, plate coords):
    the frame B parts below the plate's top edge plus the latch swept from -5 to 45 deg
    open, offset by hinge_clear. Base and cover subtract it. `magnetPositions` moves any
    magnet down until it has a 1.2 mm wall to the notch (base pocket refilled and recut,
    cover pockets follow). Before this fix the knuckle dug into the plate below ~73 wide.
  - Indent: the CAD lip is removed everywhere except inside the knuckle circles (kn_r
    around the hinge axes T and Q, hinge_inset in from the outer corners). The knuckles
    reach about 0.9 x 0.9 mm into those two opening corners; this is inherent to the
    hinge position and the page warns about it.
    - An earlier version kept 3 mm squares of the old lip there. The user saw them as
      "hinges protruding" with no step. Don't go back to that.
    - Then either a new lip ring is added, minus kn_rc circles so the hinge gap is kept,
      and split along the T-Q diagonal with a hinge_clear gap (A gets top and left, B
      gets right and bottom), or an outward recess is cut (minus kn_r + 0.6 circles). The recess warns when the wall
    behind the dovetail grooves gets thin.
  - Zero-volume specks from the booleans are dropped (`clean`).
  - `buildBase` refills the CAD pocket + scoop (model.base.fill), then cuts the sticker
    pocket (rect or round, + clear, depth t + 0.3) and an R6 scoop at its right edge. The
    plate itself never changes size: the user wants it to stay phone-sized.
- `src/contrast.js`: WCAG contrast. The preview's dashed tag outline picks its colour
  against the plate colour (AAA 7:1 first, the motif colour as a second priority) and drops
  to AA 4.5:1 only where AAA is impossible (mid greys). User request.
- Colours are print settings (`settings.colors`: frame, plate, logo, ring, icon, textBelow,
  textAbove; user defaults: #adadad frame + plate, black motif). Each colour picker sits in
  its own section. `motifLayers` splits the motif into one CrossSection per distinct colour
  (earlier parts win overlaps); `buildCover` returns `motifs` (one solid each) and the 3MF
  gets one part per colour. Filament slots: one per distinct colour, in the order frame,
  plate, motif parts (listed in the Export section); `write3MF` takes `filament` as a
  function (role, partIndex, mesh) => slot.
- `src/text2d.js`: opentype.js text. Size = cap height (same as FreeCAD ShapeString with
  ScaleToSize).
- `src/export3mf.js`: STL parsing, the print-plate layout (port of
  `tools/export_print_plate.py` from the CAD repo) and the 3MF writer.
- `assets/`: `model.json` + `parts/*.stl` + `logos/*.svg`, all written by
  `tools/export_from_freecad.py` (run it inside FreeCAD with the CAD model open; set
  `__file__` before exec, see the script header).
  `fonts/`: OFL/Apache fonts (woff) from Fontsource 5.1.0, with licences.

## Rules
- Library versions are pinned in both `index.html` (import map) and `package.json`
  (devDependencies for the Node tests). Keep them in sync. Use versions at least two weeks
  old.
- `npm test` must pass before committing. The tests compare against the CAD model:
  - N-mark, signal arcs and the frame ring areas match the FreeCAD pads.
  - The cover volume matches the exact formula for a 71 x 108 R4 plate with a 2 mm 45°
    chamfer. FreeCAD's own `Chamfer_CoverFront` only cones 2 of the 4 corners (+14.9 mm3),
    so it is not used as the reference.
  - The plate layout footprint matches the CAD export (218.4 x 148).
- The 3MF "extras" mimic what Creality Print 7.3 (Orca/Bambu family) writes:
  - `3D/Objects/object_N.model` sub-models with `p:path` components;
  - `Metadata/model_settings.config`, where part ids = component object ids, each with an
    extruder;
  - `Metadata/layer_config_ranges.xml` keyed by the cover's composite object id.
  The reference file was the user's
  `NFC Wifi plate - print plate - Sliced.3mf` in the CAD repo's `test/` folder.
- `tests/frame.test.mjs` checks:
  - the default cover reproduces the CAD frame;
  - 56x65, 95x70 and 110x120 each give one solid per half, an A-B gap >= 0.39, and the
    same latch gap at the 45° print pose as CAD (closed, the latch sits 0.07 from A by
    design);
  - all indent modes;
  - the default sticker pocket is identical to CAD, and round / credit-card pockets cut
    cleanly.
- Rebuild budget: about 75 ms for the default design (motif2d is simplified at 0.01 mm).
  Keep it interactive.

## Status (2026-11-03)
- v0.2: adjustable switch cover (size + indent inside/outside/none) and sticker
  pocket (presets, rect/round). Round frames are a possible later, separate design.
- v0.1 built and tested in Node and headless Chrome; not yet tested in the user's
  slicer.
- Licences (user decision, 2026-11-03): MIT for the code (`LICENSE`), CC BY-NC 4.0 for the
  models and generated 3MFs (`LICENSE-MODELS.md`). The copyright holder is EyezGlazed
  (the user's GitHub name).
- The default N-mark comes from Wikimedia Commons `File:NFC_logo.svg` (CC0, by
  Eg0rk0t323). It is credited, with an NFC Forum trademark note.
