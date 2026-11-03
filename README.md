# NFC Tap Plate

A browser customizer for a 3D-printed light switch frame with a magnetic NFC tag plate.
Put your own logo, icon and text on the plate, then download one print-ready 3MF with all
parts laid out on the bed. Everything runs in the browser; nothing is uploaded.

## What you print

| Part | Prints | Notes |
| --- | --- | --- |
| Frame (two halves + latch) | Wall side down, print-in-place hinges | Clamps around an 83 × 82.2 mm switch cover |
| Plate base | Back down | Holds the NFC sticker (44 × 28 mm) in a pocket; slides onto the frame with dovetails |
| Cover + motif | Face down, one colour per element | Your design, inlaid 0.4 mm (2 layers) into the front |

The cover is held by four 6 × 2 mm disc magnets (Ø 6.2 × 2.2 mm press-fit pockets). Pair
the polarity before pressing them in: stick each base magnet to a cover magnet first.

## Using the customizer

- **Light switch cover**: enter its width and height (55–200 × 64–200 mm). The frame
  stretches or shrinks along the straight parts of its bars; the hinge, latch and dovetails
  are the same print-tested parts. Choose the step near the wall: *narrower* (the frame
  hooks in with a lip, the default 1 × 3.65 mm), *wider rim* (the frame gets a recess to
  clear it) or *none*.
- **NFC sticker**: pick a common size (card labels, squares, round Ø25–38, credit card)
  or enter your own, rectangular or round. The plate stays the same size, since it is
  shaped for a phone; only the pocket under the cover changes. The frame ring around the
  logo follows the sticker by default.

- **Colours**: the frame, plate, logo, frame around the logo, icon and each text block have
  their own colour (default: grey #adadad frame and plate, black motif). Every distinct
  colour becomes one filament.
- **Logo**: any SVG. Dark shapes print in the logo colour, white shapes cut holes,
  strokes are thickened automatically (line icons work as they are). `<text>` in an SVG
  is ignored; convert it to paths first.
- **Frame and icon**: an optional rounded frame around the logo (default: the size of the
  NFC tag) and an icon centred above it.
- **Text**: up to three rows below and three above. Size is the capital letter height in
  mm. Rows are centred in the free space between the logo group and the plate edge, or
  placed close to the logo or the edge.
- **Export**: one 3MF. With "Bambu / Orca / Creality extras" on, the file also assigns the
  filaments (one per colour, numbered as listed in the Export section) and adds a 0–0.4 mm
  height range with 0 wall loops on the cover, so all colours in the first layers print in
  the same line direction.
- **Links**: any setting can go in the address, e.g.
  `#settings.sticker.shape=round&settings.sticker.d=30&view=3d`.
- **Save design** writes a small JSON file (including your SVGs) that **Open design**
  reads back.

## Run locally

```
npm install      # test dependencies only; the page itself loads its libraries from jsDelivr
npm test         # Node tests: geometry against the CAD model, layout, SVG import, 3MF
npm run serve    # http://localhost:8137
```

The page is static: host the folder on GitHub Pages (or any static host) as it is.

## Where the geometry comes from

The frame, latch and plate base are fixed meshes exported from the FreeCAD master model
by `tools/export_from_freecad.py` (`assets/parts/*.stl`, `assets/model.json`). The cover is
rebuilt in the browser with [manifold-3d](https://github.com/elalish/manifold) from the
dimensions in `assets/model.json`, so it always matches the base.

## Licence

- Code: [MIT](LICENSE).
- Printable models and generated 3MF files: [CC BY-NC 4.0](LICENSE-MODELS.md). Print,
  share and remix them with credit, but not commercially.
- Default N-mark logo: traced from
  [NFC_logo.svg](https://commons.wikimedia.org/wiki/File:NFC_logo.svg) (CC0). The
  N-Mark is a trademark of the NFC Forum.
- Fonts: OFL / Apache 2.0, licences in `assets/fonts`.

## Credits

Libraries: manifold-3d, three.js, opentype.js, svgpath, clipper-lib, fflate.
