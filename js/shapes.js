// Basic cutter shapes generated at exact dimensions (mm).
// Loops use image-style coordinates (y down) so they go through the same pipeline as traced drawings.

const TAU = Math.PI * 2;

function ring(n, f) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(f((i / n) * TAU, i));
  return pts;
}

/** Scale a loop so its bounding box is exactly w × h, centred on the origin. */
function fit(loop, w, h) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of loop) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const sx = w / (maxX - minX), sy = h / (maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return loop.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}

// Each shape: which dimensions it uses, and a unit outline (any scale; fit() sizes it).
export const SHAPES = [
  { id: 'circle', name: 'Circle', dims: 'd', make: () => ring(240, a => [Math.cos(a), Math.sin(a)]) },
  { id: 'oval', name: 'Oval', dims: 'wh', icon: [1.4, 1], make: () => ring(240, a => [Math.cos(a), Math.sin(a)]) },
  { id: 'square', name: 'Square', dims: 'd', make: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]] },
  { id: 'rectangle', name: 'Rectangle', dims: 'wh', icon: [1.45, 1], make: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]] },
  { id: 'triangle', name: 'Triangle', dims: 'wh', icon: [1, 0.87], make: () => [[0, -1], [1, 1], [-1, 1]] },
  { id: 'polygon', name: 'Polygon', dims: 'wh', sides: { label: 'Number of sides', min: 5, max: 12, def: 6 },
    make: n => ring(n, a => [Math.sin(a), -Math.cos(a)]) },
  { id: 'star', name: 'Star', dims: 'wh', sides: { label: 'Number of points', min: 4, max: 12, def: 5 },
    make: n => ring(2 * n, (a, i) => { const r = i % 2 ? 0.45 : 1; return [r * Math.sin(a), -r * Math.cos(a)]; }) },
  { id: 'heart', name: 'Heart', dims: 'wh', make: () => ring(240, a => {
      const x = 16 * Math.sin(a) ** 3;
      const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      return [x, -y];
    }) },
  { id: 'fluted', name: 'Fluted circle', dims: 'd', sides: { label: 'Number of scallops', min: 6, max: 30, def: 14 },
    make: n => ring(Math.max(240, n * 24), a => { const r = 1 + 0.07 * Math.abs(Math.cos((n * a) / 2)) * 2 - 0.07; return [r * Math.cos(a), r * Math.sin(a)]; }) },
];

export const shapeById = id => SHAPES.find(s => s.id === id) ?? SHAPES[0];

/** Outline loop in mm for the chosen shape. */
export function shapeLoop(id, w, h, sides) {
  const s = shapeById(id);
  const n = s.sides ? Math.round(Math.min(s.sides.max, Math.max(s.sides.min, sides || s.sides.def))) : 0;
  const H = s.dims === 'd' ? w : h;
  return fit(s.make(n), w, H);
}

/** Small SVG path for the shape picker (24 × 24 box). */
export function shapeIcon(s) {
  const [iw, ih] = s.icon ?? [1, 1];
  const k = 18 / Math.max(iw, ih);
  const loop = fit(s.make(s.sides?.def ?? 0), iw * k, ih * k);
  return 'M' + loop.map(([x, y]) => `${(x + 12).toFixed(2)} ${(y + 12).toFixed(2)}`).join('L') + 'Z';
}
