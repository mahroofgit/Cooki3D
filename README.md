# Cookie Cutter Forge

Turn a drawing, silhouette or SVG into a print-ready 3D cookie cutter (`.stl`), entirely in the browser. There's no server, no build step and nothing is uploaded. It's a static site made for GitHub Pages.

## Deploy to GitHub Pages

1. Create a repository and push these files to the root of the `main` branch.
2. Open **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick `main` and `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

All libraries are vendored in `lib/`, so the site works offline and keeps working if a CDN changes. Only the Google Fonts stylesheet loads from outside, and the page falls back to system fonts without it.

To run it locally you need a static server, because ES modules don't load from `file://`:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Use it on your phone as an app

After the site is live on GitHub Pages:

- **iPhone / iPad (Safari):** open the site, tap **Share → Add to Home Screen → Add**. The app's **Install app** button shows these steps.
- **Android (Chrome):** tap **Install app** in the header, or use **⋮ → Install app / Add to Home screen**.

Launched from its icon, it runs full-screen with no browser bars. It also works offline, because `sw.js` caches every file on the first visit. On a phone, **Download STL** opens the share sheet when the browser supports it (iOS Safari does), so you can pick **Save to Files** or send the STL straight to a printer app. Otherwise the STL goes to your Downloads folder.

**After changing any file, bump `VERSION` in `sw.js`.** Installed copies then fetch the new files. Because the app shows its cached copy first and refreshes in the background, the change appears on the next launch.

## How it works

| Stage | File | What happens |
|---|---|---|
| 1. Preprocess | `js/app.js`, `js/trace.js` | Draws the image onto a canvas at the trace resolution, composites transparency over white, and applies brightness/contrast, box blur and a threshold (Otsu auto-pick). Invert is detected from the image border. |
| 2. Contours | `js/trace.js` | Traces every shape/background boundary as closed pixel-corner loops (holes wind the opposite way), then removes specks, converts the staircase to edge midpoints, simplifies with Douglas-Peucker, and smooths with Chaikin corner cutting. |
| 3. Shape | `js/geometry.js` → `analyzeShape` | Unions the loops with Clipper, scales to the requested size in mm, and mirrors for printing. It rounds tight corners with a morphological close and open, and extracts inner details. |
| 4. Mesh | `js/geometry.js` → `buildCutter`, `slabMesh` | Offsets the outline outward for each wall level (lip, thick wall, taper steps, tip), stacks the levels as slabs, and triangulates walls and caps into **one watertight solid**. |
| 5. Export | `js/app.js` | Uses Three.js `STLExporter` to write a binary STL, downloaded straight from the browser. |

I used Clipper (polygon offsets and booleans, 1 µm integer precision) instead of OpenCV.js. OpenCV.js is about 8 MB, and the contour step only needs a small tracer. Offsetting in 2D and then extruding gives exact wall thicknesses and avoids self-intersecting meshes.

### Inner detail detection

- **Light marks inside a dark shape**: white areas inside a filled silhouette, like the eyes and buttons on a gingerbread figure.
- **Dark lines inside an outline drawing**: interior strokes of line art, like the veins of a leaf. The outline stroke width is estimated automatically, and that band is ignored so the stamp doesn't duplicate the blade.
- **Detect automatically** chooses between the two by how much of the outline is filled.

Each detail region becomes a stamp line of the chosen thickness, running along its boundary. Thin strokes merge into a single rib.

## Parameters (all in mm)

| Group | Setting | Default | Notes |
|---|---|---|---|
| Shape | Cookie size | 80 | Longest side of the cutting edge (the cookie itself). |
| | Round off tight corners | 0.8 | Removes notches and spikes narrower than about 2× this. |
| | Mirror for printing | on | The cutter prints blade-up and is flipped to use, so the print is mirrored to give a cookie that matches the drawing. |
| Blade | Total height | 12 | From the bed to the cutting tip. |
| | Tip thickness | 0.9 | Keep ≥ 0.8 for a 0.4 mm nozzle. |
| Wall | Wall thickness | 2.0 | |
| | Thick wall height | 6 | From the bed. Above this the wall steps down to the tip. |
| | Taper to tip over | 2 | Four-step chamfer from wall to tip. 0 gives a single step. |
| Lip | Flange width | 5 | Extends beyond the wall. 0 removes the lip. |
| | Lip thickness | 2.4 | Also used for the stamp backing plate. |
| Stamp | Height offset | −3 | Stamp lines end this far below the blade tip. |
| | Line thickness | 1.2 | |
| | Keep clear of the edge | 1.5 | Ignores details this close to the outline. |
| | Stamp build | one piece | *One piece* adds a backing plate inside the cutter that the stamp lines stand on. *Separate* makes a loose press-in stamp that is smaller than the cutter by the fit clearance. |

## Printing tips

- Print blade-up, as exported, with no supports. PLA or PETG, 0.2 mm layers, and at least 2 perimeters.
- Food safety: FDM prints have crevices that trap dough. Use food-safe filament, keep the cutter for short contact with dough only, and hand-wash it. Many people clear-coat cutters with a food-safe sealant.

## Development

```sh
npm install          # three + clipper-lib (only needed for tests / re-vendoring)
node test/pipeline.test.js
```

The test builds cutters from synthetic silhouettes and line art. For each one it checks that every mesh edge is shared by exactly two triangles in opposite directions (watertight, manifold) and that the volume is positive.

## Credits

[Three.js](https://threejs.org) (MIT) and [Clipper](http://www.angusj.com/clipper2/) by Angus Johnson, JS port `clipper-lib` (Boost Software License).
