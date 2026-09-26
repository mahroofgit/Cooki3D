// Image preprocessing and contour tracing.
// Pure functions: work on plain arrays so they can run in the browser or in Node tests.

/** Luminance (0-255) from RGBA data, compositing transparency over white. */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const l = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    g[i] = l * a + 255 * (1 - a);
  }
  return g;
}

/** Brightness (-100..100) and contrast (-100..100) adjustment, in place. */
export function adjust(gray, brightness = 0, contrast = 0) {
  const c = Math.tan(((contrast + 100) / 200) * (Math.PI / 2)); // 0 -> 1x
  const b = brightness * 1.28;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.max(0, Math.min(255, (gray[i] - 128) * c + 128 + b));
  }
  return gray;
}

/** Separable box blur, radius r pixels. Returns a new array. */
export function boxBlur(src, w, h, r) {
  r = Math.round(r);
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Otsu's automatic threshold. */
export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr + 0.5;
}

/** Binary mask: 1 = shape (dark pixels unless inverted). */
export function threshold(gray, t, invert = false) {
  const m = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) m[i] = (gray[i] < t) !== invert ? 1 : 0;
  return m;
}

/**
 * Trace every boundary between shape and background as closed loops of pixel corners.
 * Outer boundaries and hole boundaries wind in opposite directions, so a non-zero
 * fill of all loops reproduces the mask exactly.
 */
export function traceLoops(mask, w, h) {
  const W = w + 1;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Each vertex can have at most 2 outgoing boundary edges. Store edge target vertex.
  const out1 = new Int32Array(W * (h + 1)).fill(-1);
  const out2 = new Int32Array(W * (h + 1)).fill(-1);
  const add = (x0, y0, x1, y1) => {
    const a = y0 * W + x0, b = y1 * W + x1;
    if (out1[a] < 0) out1[a] = b; else out2[a] = b;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== 1) continue;
      // Clockwise on screen (y down): the shape stays on the right-hand side.
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (let start = 0; start < out1.length; start++) {
    while (out1[start] >= 0 || out2[start] >= 0) {
      const pts = [];
      let prev = -1, v = start;
      for (let guard = 0; guard < 4 * out1.length; guard++) {
        let next;
        if (out1[v] >= 0 && out2[v] >= 0 && prev >= 0) {
          // Saddle vertex: turn right (relative to the incoming direction) so
          // diagonal-touching pixels become separate loops.
          const dx = (v % W) - (prev % W), dy = Math.floor(v / W) - Math.floor(prev / W);
          const c1 = out1[v], ex = (c1 % W) - (v % W), ey = Math.floor(c1 / W) - Math.floor(v / W);
          const cross = dx * ey - dy * ex; // >0 = right turn on a y-down screen
          if (cross > 0) { next = out1[v]; out1[v] = out2[v]; out2[v] = -1; }
          else { next = out2[v]; out2[v] = -1; }
        } else if (out1[v] >= 0) {
          next = out1[v]; out1[v] = out2[v]; out2[v] = -1;
        } else if (out2[v] >= 0) {
          next = out2[v]; out2[v] = -1;
        } else break;
        pts.push(v % W, Math.floor(v / W));
        prev = v; v = next;
        if (v === start && out1[v] < 0 && out2[v] < 0) break;
        if (v === start) break;
      }
      if (pts.length >= 6) {
        const loop = [];
        for (let i = 0; i < pts.length; i += 2) loop.push([pts[i], pts[i + 1]]);
        loops.push(loop);
      }
    }
  }
  return loops;
}

export function signedArea(loop) {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    a += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
  }
  return a / 2;
}

/** Replace the pixel staircase by edge midpoints: gives 45° diagonals like marching squares. */
function midpoints(loop) {
  const n = loop.length, r = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    r[i] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return r;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function dpOpen(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker for a closed loop. */
export function simplifyLoop(loop, eps) {
  if (eps <= 0 || loop.length < 8) return loop;
  let far = 0, fd = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dpOpen(loop.slice(0, far + 1), eps);
  const b = dpOpen(loop.slice(far).concat([loop[0]]), eps);
  const r = a.slice(0, -1).concat(b.slice(0, -1));
  return r.length >= 3 ? r : loop;
}

/** Chaikin corner cutting, closed loop. */
export function chaikin(loop, iterations) {
  let p = loop;
  for (let k = 0; k < iterations; k++) {
    const n = p.length, r = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      r.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      r.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = r;
  }
  return p;
}

/**
 * Mask -> smoothed loops in pixel units.
 * opts: { speck (px, loops with area below speck² are dropped), simplify (px), smooth (Chaikin passes) }
 */
export function maskToLoops(mask, w, h, opts = {}) {
  const { speck = 3, simplify = 0.8, smooth = 2 } = opts;
  const raw = traceLoops(mask, w, h);
  const minArea = speck * speck;
  const result = [];
  for (const loop of raw) {
    if (Math.abs(signedArea(loop)) < minArea) continue;
    let p = midpoints(loop);
    p = simplifyLoop(p, simplify);
    p = chaikin(p, smooth);
    if (p.length >= 3) result.push(p);
  }
  return result;
}
