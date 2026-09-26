import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.ClipperLib = require('clipper-lib');
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { maskToLoops } from '../js/trace.js';
import { analyzeShape, buildCutter } from '../js/geometry.js';

const P = { size: 80, mirror: true, largestOnly: false, rounding: 0.5, detailEnabled: true, detailMode: 'auto',
  detailEdge: 1.5, detailLine: 1.2, detailOffset: -3, bladeHeight: 12, bladeThickness: 1.0,
  wallThickness: 2.0, wallHeight: 6, taper: 2, lipWidth: 5, lipThickness: 2.5,
  stampMode: 'integrated', stampClearance: 0.5 };

function mask(w, h, f) { const m = new Uint8Array(w*h); for (let y=0;y<h;y++) for (let x=0;x<w;x++) m[y*w+x]=f(x,y)?1:0; return m; }
const d = (x,y,cx,cy)=>Math.hypot(x-cx,y-cy);
const W=400,H=400;
const silhouette = mask(W,H,(x,y)=> (d(x,y,200,210)<150 || d(x,y,90,80)<50 || d(x,y,310,80)<50) && d(x,y,150,180)>18 && d(x,y,250,180)>18 && !(Math.abs(y-280)<6 && Math.abs(x-200)<60));
const lineart = mask(W,H,(x,y)=> { const r=d(x,y,200,200); return (r<160 && r>150) || (Math.abs(y-200)<4 && Math.abs(x-200)<80) || (Math.abs(x-200)<4 && y>60 && y<200); });

function checkWatertight(g) {
  const p = g.attributes.position.array, key = i => `${p[i].toFixed(4)},${p[i+1].toFixed(4)},${p[i+2].toFixed(4)}`;
  const edges = new Map(); let degenerate = 0;
  for (let t=0;t<p.length;t+=9) {
    const k=[key(t),key(t+3),key(t+6)];
    if (k[0]===k[1]||k[1]===k[2]||k[0]===k[2]) { degenerate++; continue; }
    for (let e=0;e<3;e++){ const a=k[e], b=k[(e+1)%3]; const id=a+'|'+b; edges.set(id,(edges.get(id)||0)+1); }
  }
  let unmatched=0, dup=0;
  for (const [id,c] of edges) { const [a,b]=id.split('|'); const r=edges.get(b+'|'+a)||0; if (r!==c) unmatched++; if (c>1) dup++; }
  // signed volume
  let vol=0; for (let t=0;t<p.length;t+=9){ const [ax,ay,az,bx,by,bz,cx,cy,cz]=p.slice(t,t+9); vol += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6; }
  return { tris: p.length/9, unmatched, dup, degenerate, vol: vol.toFixed(1) };
}

for (const [name, m, mode] of [['silhouette',silhouette,'integrated'],['lineart',lineart,'integrated'],['silhouette-sep',silhouette,'separate'],['no-detail',silhouette,'integrated']]) {
  const t0=performance.now();
  const loops = maskToLoops(m, W, H, { speck: 3, simplify: 0.8, smooth: 2 });
  const p = { ...P, stampMode: mode, detailEnabled: name!=='no-detail' };
  const shape = analyzeShape(loops, p);
  const { cutter, stamp } = buildCutter(shape, p);
  const ms = (performance.now()-t0).toFixed(0);
  console.log(name, 'loops', loops.length, 'mode', shape.detailMode, 'outline', shape.outline.length, 'details', shape.details.length, ms+'ms');
  console.log('  cutter', checkWatertight(cutter)); if (stamp) console.log('  stamp', checkWatertight(stamp));
  cutter.computeBoundingBox(); console.log('  bbox', cutter.boundingBox.min.toArray().map(v=>v.toFixed(1)), cutter.boundingBox.max.toArray().map(v=>v.toFixed(1)));
  const stl = new STLExporter().parse(new THREE.Mesh(cutter), { binary: true });
  console.log('  stl bytes', stl.byteLength ?? stl.buffer.byteLength);
}
