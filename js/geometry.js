// Parametric cookie-cutter geometry.
// 2D work uses Clipper (integer micrometres); 3D output is a Three.js BufferGeometry.
import * as THREE from 'three';

const S = 1000; // Clipper units per mm (1 unit = 1 µm)
const CL = () => globalThis.ClipperLib;

// ---------- 2D helpers (paths are arrays of {X,Y} in µm) ----------

export function loopsToPaths(loops) {
  return loops.map(l => l.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
}

function execute(type, subj, clip = [], fill = null) {
  const C = CL();
  const c = new C.Clipper();
  c.PreserveCollinear = true;
  if (subj.length) c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  const ft = fill ?? C.PolyFillType.pftNonZero;
  c.Execute(type, out, ft, ft);
  return out;
}
export const union = (a, b = []) => execute(CL().ClipType.ctUnion, a, b);
export const diff = (a, b) => (a.length ? execute(CL().ClipType.ctDifference, a, b) : []);
export const intersect = (a, b) => (a.length && b.length ? execute(CL().ClipType.ctIntersection, a, b) : []);

export function offset(paths, mm, join = 'round') {
  if (!paths.length) return [];
  if (Math.abs(mm) < 1e-6) return paths;
  const C = CL();
  const co = new C.ClipperOffset(2, 0.01 * S); // arc tolerance 10 µm
  const jt = join === 'round' ? C.JoinType.jtRound : join === 'square' ? C.JoinType.jtSquare : C.JoinType.jtMiter;
  co.AddPaths(paths, jt, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, mm * S);
  return out;
}

export function area(paths) {
  let a = 0;
  for (const p of paths) a += CL().Clipper.Area(p);
  return a / (S * S);
}

export function bounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const q of p) {
    if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X;
    if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y;
  }
  return { minX: minX / S, minY: minY / S, maxX: maxX / S, maxY: maxY / S };
}

/** Perimeter in mm. */
function perimeter(paths) {
  let L = 0;
  for (const p of paths) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    L += Math.hypot(a.X - b.X, a.Y - b.Y);
  }
  return L / S;
}

/** Split a union into its top-level islands with holes filled. */
function outerIslands(paths) {
  const C = CL();
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return tree.Childs().map(n => n.Contour());
}

function removeSmall(paths, minArea) {
  // Works on a union result: drop outers (and their holes) smaller than minArea.
  const C = CL();
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const out = [];
  const walk = node => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole() && Math.abs(C.Clipper.Area(ch.Contour())) / (S * S) < minArea) continue;
      if (ch.IsHole() && Math.abs(C.Clipper.Area(ch.Contour())) / (S * S) < minArea) {
        // tiny hole: drop it but keep its island children
        walk(ch);
        continue;
      }
      out.push(ch.Contour());
      walk(ch);
    }
  };
  walk(tree);
  return union(out);
}

// ---------- Shape analysis ----------

/**
 * Turn traced pixel loops into cutter outline + optional inner detail regions (all in mm).
 * loopsPx: loops in pixel coordinates (y down). p: parameters (see DEFAULTS in app.js).
 */
export function analyzeShape(loopsPx, p) {
  // Scale pixels -> mm so the outline's longest side equals p.size.
  const pxPaths = union(loopsToPaths(loopsPx.map(l => l.map(([x, y]) => [x, -y]))));
  if (!pxPaths.length) return null;
  let islands = outerIslands(pxPaths);
  if (p.largestOnly && islands.length > 1) {
    islands.sort((a, b) => Math.abs(CL().Clipper.Area(b)) - Math.abs(CL().Clipper.Area(a)));
    islands = [islands[0]];
  }
  const b = bounds(islands);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (!(span > 0)) return null;
  const k = p.size / span;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const sx = p.mirror ? -1 : 1; // printed blade-up, then flipped over to cut
  const xf = paths => paths.map(path => path.map(q => ({
    X: Math.round(sx * (q.X / S - cx) * k * S),
    Y: Math.round((q.Y / S - cy) * k * S),
  })));

  let outline = union(xf(islands));
  const region = union(xf(pxPaths)); // full shape including holes, in mm (union normalises winding after mirroring)
  const mmPerPx = k;

  // Corner rounding: close (fills notches) then open (rounds spikes).
  if (p.rounding > 0) {
    const r = p.rounding;
    outline = offset(offset(outline, r), -r);
    outline = offset(offset(outline, -r), r);
  }
  outline = removeSmall(outline, 1);

  let details = [];
  let detailMode = null;
  if (p.detailEnabled && outline.length) {
    const fill = area(region) / Math.max(1e-9, area(outline));
    detailMode = p.detailMode === 'auto' ? (fill > 0.55 ? 'holes' : 'lines') : p.detailMode;
    let clearance = p.detailEdge;
    let src;
    if (detailMode === 'holes') {
      src = diff(outline, region); // light features inside a dark silhouette
    } else {
      // Line art: estimate the outline stroke width and ignore the outline band.
      const outerBand = intersect(region, diff(outline, offset(outline, -8)));
      const w = Math.min(8, (2 * area(outerBand)) / Math.max(1e-9, perimeter(outerBand)));
      clearance += Number.isFinite(w) ? w : 0;
      src = region;
    }
    src = intersect(src, offset(outline, -clearance));
    src = removeSmall(union(src), Math.max(0.5, p.detailLine * p.detailLine));
    if (src.length) {
      const t = p.detailLine / 2;
      details = diff(offset(src, t), offset(src, -t));
      // Keep ribs clear of the blade so they never fuse with the wall.
      details = intersect(details, offset(outline, -0.4));
      details = removeSmall(details, 0.2);
    }
  }

  return { outline, details, detailMode, mmPerPx, bounds: bounds(outline), xf: { k, cx, cy, sx } };
}

// ---------- 3D: slab mesher ----------

/**
 * Build a single closed mesh from "features": {paths, z0, z1} extruded regions.
 * The stack is split at every z breakpoint, each slab region is the union of the
 * active features, and horizontal faces are the differences between neighbouring
 * slabs. Result: a watertight, non-self-overlapping solid.
 */
export function slabMesh(features) {
  const zs = [...new Set(features.flatMap(f => [f.z0, f.z1]))].sort((a, b) => a - b);
  const slabs = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], b = zs[i + 1];
    if (b - a < 1e-6) continue;
    const act = features.filter(f => f.z0 <= a + 1e-9 && f.z1 >= b - 1e-9 && f.paths.length);
    const paths = act.length ? union(act.flatMap(f => f.paths)) : [];
    slabs.push({ z0: a, z1: b, paths });
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);

  // Vertical walls: material is on the left of each Clipper path.
  for (const s of slabs) {
    for (const path of s.paths) {
      const n = path.length;
      for (let i = 0; i < n; i++) {
        const P = path[i], Q = path[(i + 1) % n];
        const p0 = [P.X / S, P.Y / S, s.z0], q0 = [Q.X / S, Q.Y / S, s.z0];
        const p1 = [P.X / S, P.Y / S, s.z1], q1 = [Q.X / S, Q.Y / S, s.z1];
        tri(p0, q0, q1); tri(p0, q1, p1);
      }
    }
  }
  // Horizontal faces between consecutive slabs (and the empty space above/below).
  for (let i = 0; i <= slabs.length; i++) {
    const below = i > 0 ? slabs[i - 1] : null;
    const above = i < slabs.length ? slabs[i] : null;
    const z = below ? below.z1 : above.z0;
    const bp = below && Math.abs(below.z1 - z) < 1e-9 ? below.paths : [];
    const ap = above && Math.abs(above.z0 - z) < 1e-9 ? above.paths : [];
    capFaces(diff(bp, ap), z, +1, tri); // top of material below
    capFaces(diff(ap, bp), z, -1, tri); // bottom of material above
    if (below && above && Math.abs(below.z1 - above.z0) > 1e-9) {
      capFaces(below.paths, below.z1, +1, tri);
      capFaces(above.paths, above.z0, -1, tri);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function capFaces(paths, z, dir, tri) {
  if (!paths.length) return;
  const C = CL();
  const c = new C.Clipper();
  c.PreserveCollinear = true;
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const toV = path => path.map(q => new THREE.Vector2(q.X / S, q.Y / S));
  const visit = node => {
    for (const outer of node.Childs()) {
      // outer is never a hole at this level
      const contour = toV(outer.Contour());
      const holes = outer.Childs().map(h => toV(h.Contour()));
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = contour.concat(...holes);
      for (const [ia, ib, ic] of faces) {
        const A = all[ia], B = all[ib], Cc = all[ic];
        const cross = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
        const a = [A.x, A.y, z], b = [B.x, B.y, z], cc = [Cc.x, Cc.y, z];
        if ((cross > 0) === (dir > 0)) tri(a, b, cc); else tri(a, cc, b);
      }
      for (const h of outer.Childs()) visit(h); // islands inside holes
    }
  };
  visit(tree);
}

// ---------- Cutter assembly ----------

/** Wall profile: [{t, z}] = offset distance t used from the bed up to height z. */
export function wallProfile(p) {
  const H = p.bladeHeight;
  const tip = p.bladeThickness;
  // Wall thickness / height of 0 mean "no reinforced wall": the wall is the tip thickness all the way up.
  const wallT = Math.max(p.wallThickness, tip);
  const levels = [];
  const lipT = Math.min(p.lipThickness, H - 0.5);
  const wallTop = Math.max(lipT, Math.min(p.wallHeight, H - 0.5));
  if (p.lipWidth > 0 && lipT > 0) levels.push({ t: wallT + p.lipWidth, z: lipT });
  if (wallT > tip + 1e-6 && wallTop > 0) {
    levels.push({ t: wallT, z: wallTop });
    const steps = p.taper > 0 ? 4 : 0;
    const taperLen = Math.min(p.taper, H - wallTop - 0.4);
    for (let i = 1; i < steps && taperLen > 0; i++) {
      levels.push({ t: wallT - (wallT - tip) * (i / steps), z: wallTop + (taperLen * i) / steps });
    }
  }
  levels.push({ t: tip, z: H });
  return { levels, lipT, wallTop };
}

/**
 * Returns { cutter, stamp } BufferGeometries (stamp may be null) plus stats.
 */
export function buildCutter(shape, p) {
  const { outline, details } = shape;
  const { levels, lipT } = wallProfile(p);
  const cutterFeatures = levels.map(L => ({ paths: diff(offset(outline, L.t), outline), z0: 0, z1: L.z }));

  const hasStamp = p.detailEnabled && details.length > 0;
  const ribTop = Math.max(lipT + 0.4, p.bladeHeight + p.detailOffset);
  const plateT = Math.max(1, lipT);
  let stamp = null;

  if (hasStamp && p.stampMode === 'integrated') {
    cutterFeatures.push({ paths: outline, z0: 0, z1: plateT });
    cutterFeatures.push({ paths: details, z0: 0, z1: ribTop });
  }
  const cutter = slabMesh(cutterFeatures);

  if (hasStamp && p.stampMode === 'separate') {
    const plate = offset(outline, -p.stampClearance);
    const ribs = intersect(details, offset(plate, -0.3));
    if (plate.length) {
      stamp = slabMesh([
        { paths: plate, z0: 0, z1: plateT },
        { paths: ribs, z0: 0, z1: ribTop },
      ]);
    }
  }
  return { cutter, stamp, ribTop, plateT };
}
