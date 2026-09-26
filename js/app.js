import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { toGray, adjust, boxBlur, otsu, threshold, maskToLoops } from './trace.js';
import { analyzeShape, buildCutter, offset, area, wallProfile } from './geometry.js';
import { SAMPLES } from './samples.js';
import { makeZip } from './zip.js';
import { initPWA } from './pwa.js';
import { SHAPES, shapeById, shapeLoop, shapeIcon } from './shapes.js';

// Pipeline stages: a change re-runs its stage and everything after it.
const IMG = 0, TRACE = 1, SHAPE = 2, MESH = 3;

// Control definitions. Every length is in millimetres.
// tab: where the control lives. 'main' controls use the compact one-line layout.
const CONTROLS = [
  // Main tab: the settings most people change
  { id: 'size', tab: 'main', label: 'Longest side', min: 20, max: 250, step: 1, unit: 'mm', stage: SHAPE, def: 80, mode: 'image' },
  { id: 'shapeW', tab: 'main', label: 'Width', min: 15, max: 250, step: 1, unit: 'mm', stage: SHAPE, def: 70, mode: 'shape' },
  { id: 'shapeH', tab: 'main', label: 'Height', min: 15, max: 250, step: 1, unit: 'mm', stage: SHAPE, def: 50, mode: 'shape' },
  { id: 'rounding', tab: 'main', label: 'Round corners', min: 0, max: 15, step: 0.1, unit: 'mm', stage: SHAPE, def: 0.8 },
  { id: 'bladeHeight', tab: 'main', label: 'Total height', min: 6, max: 30, step: 0.5, unit: 'mm', stage: MESH, def: 12 },
  { id: 'bladeThickness', tab: 'main', label: 'Tip thickness', min: 0.4, max: 2, step: 0.05, unit: 'mm', stage: MESH, def: 1.0 },
  { id: 'lipThickness', tab: 'main', label: 'Lip thickness', min: 1, max: 5, step: 0.1, unit: 'mm', stage: MESH, def: 2.0 },
  { id: 'mirror', tab: 'main', label: 'Mirror for printing', type: 'check', stage: SHAPE, def: true },

  // Image tab
  { id: 'threshold', tab: 'image', label: 'Threshold', min: 1, max: 254, step: 1, stage: IMG, def: 128, auto: true,
    hint: 'Pixels darker than this become the shape.' },
  { id: 'invert', tab: 'image', label: 'Invert (light shape on dark background)', type: 'check', stage: IMG, def: false },
  { id: 'contrast', tab: 'image', label: 'Contrast', min: -100, max: 100, step: 1, stage: IMG, def: 0 },
  { id: 'brightness', tab: 'image', label: 'Brightness', min: -100, max: 100, step: 1, stage: IMG, def: 0 },
  { id: 'blur', tab: 'image', label: 'Blur before threshold', min: 0, max: 6, step: 1, unit: 'px', stage: IMG, def: 1 },
  { id: 'resolution', tab: 'image', label: 'Trace resolution', min: 200, max: 1200, step: 50, unit: 'px', stage: IMG, def: 600,
    hint: 'Longest side of the traced image. Higher keeps small details and takes longer.' },
  { id: 'speck', tab: 'image', label: 'Ignore specks under', min: 0, max: 20, step: 1, unit: 'px', stage: TRACE, def: 4 },
  { id: 'simplify', tab: 'image', label: 'Path simplify', min: 0, max: 3, step: 0.1, unit: 'px', stage: TRACE, def: 0.8 },
  { id: 'smooth', tab: 'image', label: 'Curve smoothing passes', min: 0, max: 4, step: 1, stage: TRACE, def: 2 },
  { id: 'largestOnly', tab: 'image', label: 'Keep only the largest shape', type: 'check', stage: SHAPE, def: true },

  // Shapes tab
  { id: 'shapeSides', tab: 'shape', label: 'Number of sides', min: 4, max: 30, step: 1, stage: SHAPE, def: 6 },

  // Advanced tab
  { id: 'wallThickness', tab: 'advanced', group: 'Wall', label: 'Wall thickness', min: 0.8, max: 4, step: 0.1, unit: 'mm', stage: MESH, def: 2.0 },
  { id: 'wallHeight', tab: 'advanced', group: 'Wall', label: 'Thick wall height', min: 1, max: 25, step: 0.5, unit: 'mm', stage: MESH, def: 6,
    hint: 'Measured from the bed. Above this the wall thins to the tip.' },
  { id: 'taper', tab: 'advanced', group: 'Wall', label: 'Taper to tip over', min: 0, max: 8, step: 0.5, unit: 'mm', stage: MESH, def: 2,
    hint: 'Stepped chamfer between wall and tip. 0 gives a single step.' },
  { id: 'lipWidth', tab: 'advanced', group: 'Holding lip', label: 'Flange width (beyond wall)', min: 0, max: 12, step: 0.5, unit: 'mm', stage: MESH, def: 5,
    hint: '0 removes the lip.' },
  { id: 'detailEnabled', tab: 'advanced', group: 'Inner detail stamp', label: 'Add stamp lines for inner details', type: 'check', stage: SHAPE, def: true,
    hint: 'Uses marks inside an uploaded drawing. Basic shapes have none.' },
  { id: 'detailMode', tab: 'advanced', group: 'Inner detail stamp', label: 'Detail source', type: 'select', stage: SHAPE, def: 'auto', options: [
    ['auto', 'Detect automatically'],
    ['holes', 'Light marks inside a dark shape'],
    ['lines', 'Dark lines inside an outline drawing'],
  ]},
  { id: 'stampMode', tab: 'advanced', group: 'Inner detail stamp', label: 'Stamp build', type: 'select', stage: MESH, def: 'integrated', options: [
    ['integrated', 'One piece, with backing plate'],
    ['separate', 'Separate press-in stamp'],
  ]},
  { id: 'detailOffset', tab: 'advanced', group: 'Inner detail stamp', label: 'Height offset from blade', min: -8, max: 0, step: 0.5, unit: 'mm', stage: MESH, def: -3,
    hint: 'Negative values keep the stamp lines shorter than the blade so they imprint without cutting.' },
  { id: 'detailLine', tab: 'advanced', group: 'Inner detail stamp', label: 'Stamp line thickness', min: 0.6, max: 3, step: 0.1, unit: 'mm', stage: SHAPE, def: 1.2 },
  { id: 'detailEdge', tab: 'advanced', group: 'Inner detail stamp', label: 'Keep clear of the edge', min: 0, max: 6, step: 0.5, unit: 'mm', stage: SHAPE, def: 1.5 },
  { id: 'stampClearance', tab: 'advanced', group: 'Inner detail stamp', label: 'Stamp fit clearance', min: 0.2, max: 1.5, step: 0.05, unit: 'mm', stage: MESH, def: 0.5,
    hint: 'Gap between a separate stamp and the cutter wall.' },
];
const DEFAULTS = { ...Object.fromEntries(CONTROLS.map(c => [c.id, c.def])), source: 'image', shapeType: 'circle' };
const STORE_KEY = 'cooki3d-params-v2';

const params = { ...DEFAULTS };
try { Object.assign(params, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { /* storage unavailable */ }

const $ = s => document.querySelector(s);
const state = { source: null, name: 'cookie', gray: null, mask: null, w: 0, h: 0, loops: null, shape: null, parts: null };
let dirty = IMG;
let timer = 0;

// ---------- Controls ----------

function fmt(c, v) {
  if (c.step >= 1) return String(Math.round(v));
  const d = String(c.step).split('.')[1]?.length ?? 1;
  return Number(v).toFixed(d);
}

function controlRow(c) {
  const row = document.createElement('div');
  const compact = c.tab === 'main';
  row.className = 'row' + (c.type ? ' row-' + c.type : '') + (compact ? ' compact' : '');
  row.dataset.id = c.id;
  if (c.type === 'check') {
    row.innerHTML = `<label class="check"><input type="checkbox" id="p-${c.id}"><span>${c.label}</span></label>`;
  } else if (c.type === 'select') {
    row.innerHTML = `<label for="p-${c.id}">${c.label}</label><select id="p-${c.id}">${c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
  } else {
    const num = `<span class="num">${c.auto ? '<button type="button" class="mini" id="auto-threshold" title="Pick a threshold automatically">Auto</button>' : ''}<input type="number" inputmode="decimal" id="n-${c.id}" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label} value">${c.unit ? `<i>${c.unit}</i>` : ''}</span>`;
    const range = `<input type="range" id="p-${c.id}" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label}">`;
    row.innerHTML = compact
      ? `<label for="n-${c.id}" id="l-${c.id}">${c.label}</label>${range}${num}`
      : `<div class="row-head"><label for="p-${c.id}" id="l-${c.id}">${c.label}</label>${num}</div>${range}`;
  }
  if (c.hint && !compact) row.insertAdjacentHTML('beforeend', `<p class="hint">${c.hint}</p>`);
  return row;
}

function buildControls() {
  const groups = new Map();
  for (const c of CONTROLS) {
    let host = $('#controls-' + c.tab);
    if (c.group) {
      if (!groups.has(c.group)) {
        const sec = document.createElement('section');
        sec.className = 'adv-group';
        sec.innerHTML = `<h3>${c.group}</h3><div class="rows"></div>`;
        host.appendChild(sec);
        groups.set(c.group, sec.querySelector('.rows'));
      }
      host = groups.get(c.group);
    }
    host.appendChild(controlRow(c));
  }
  for (const c of CONTROLS) {
    const el = $('#p-' + c.id), num = $('#n-' + c.id);
    const onChange = v => {
      params[c.id] = v;
      if (num) num.value = fmt(c, v);
      schedule(c.stage);
    };
    if (c.type === 'check') el.addEventListener('change', () => onChange(el.checked));
    else if (c.type === 'select') el.addEventListener('change', () => onChange(el.value));
    else {
      el.addEventListener('input', () => onChange(parseFloat(el.value)));
      num.addEventListener('change', () => {
        let v = parseFloat(num.value);
        if (!Number.isFinite(v)) v = params[c.id];
        v = Math.min(c.max, Math.max(c.min, v));
        el.value = v;
        onChange(v);
      });
      num.addEventListener('focus', () => num.select());
    }
  }
  $('#auto-threshold').addEventListener('click', () => {
    if (!state.gray) return;
    setParam('threshold', Math.round(otsu(state.gray)));
    schedule(IMG);
  });
  syncControls();
}

function setParam(id, v) {
  params[id] = v;
  const c = CONTROLS.find(x => x.id === id);
  const el = $('#p-' + id), num = $('#n-' + id);
  if (c.type === 'check') el.checked = v; else el.value = v;
  if (num) num.value = fmt(c, v);
}

function syncControls() {
  for (const c of CONTROLS) setParam(c.id, params[c.id]);
  updateVisibility();
}

function setLimits(id, min, max, label) {
  const el = $('#p-' + id), num = $('#n-' + id);
  el.min = num.min = min; el.max = num.max = max;
  if (label) $('#l-' + id).textContent = label;
  const c = CONTROLS.find(x => x.id === id);
  c.min = min; c.max = max;
  if (params[id] < min || params[id] > max) setParam(id, Math.min(max, Math.max(min, params[id])));
}

function updateVisibility() {
  const shapeMode = params.source === 'shape';
  const s = shapeById(params.shapeType);
  const row = id => document.querySelector(`.row[data-id="${id}"]`);
  row('size').hidden = shapeMode;
  row('shapeW').hidden = !shapeMode;
  row('shapeH').hidden = !shapeMode || s.dims === 'd';
  $('#l-shapeW').textContent = s.dims === 'd' ? (s.id === 'square' ? 'Side length' : 'Diameter') : 'Width';
  row('shapeSides').hidden = !s.sides;
  if (s.sides) setLimits('shapeSides', s.sides.min, s.sides.max, s.sides.label);
  const on = params.detailEnabled;
  for (const id of ['detailMode', 'stampMode', 'detailOffset', 'detailLine', 'detailEdge']) row(id).hidden = !on;
  row('stampClearance').hidden = !(on && params.stampMode === 'separate');
  document.querySelectorAll('.shape-btn').forEach(b => b.setAttribute('aria-pressed', String(shapeMode && b.dataset.id === params.shapeType)));
  document.querySelectorAll('.sample').forEach(b => b.setAttribute('aria-pressed', String(!shapeMode && b.dataset.id === state.name)));
  $('#source-label').textContent = shapeMode ? `${s.name}` : (state.name === 'cookie' ? 'Your image' : state.name);
}

function schedule(stage) {
  dirty = Math.min(dirty, stage);
  updateVisibility();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch { /* ignore */ }
  setBusy(true);
  clearTimeout(timer);
  timer = setTimeout(run, stage <= TRACE ? 120 : 60);
}

// ---------- Tabs ----------

function initTabs() {
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const select = t => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      $('#' + x.getAttribute('aria-controls')).hidden = !on;
    }
    try { localStorage.setItem('cooki3d-tab', t.id); } catch { /* ignore */ }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      select(n); n.focus();
    });
  });
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.goto).click()));
  select(tabs[0]);
}

// ---------- Basic shapes ----------

/** Build a basic shape whose finished (corner-rounded) outline measures exactly w × h. */
function buildShape(s, w, h) {
  let gw = w, gh = h, shape = null;
  for (let i = 0; i < 3; i++) {
    const loop = shapeLoop(s.id, gw, gh, params.shapeSides);
    shape = analyzeShape([loop], { ...params, size: Math.max(gw, gh), detailEnabled: false, largestOnly: true });
    if (!shape) return null;
    const b = shape.bounds, aw = b.maxX - b.minX, ah = b.maxY - b.minY;
    if (Math.abs(aw - w) < 0.05 && Math.abs(ah - h) < 0.05) break;
    gw *= w / aw; gh *= h / ah; // corner rounding trims pointed tips: grow and retry
  }
  return shape;
}

function initShapes() {
  const grid = $('#shape-grid');
  for (const s of SHAPES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'shape-btn'; b.dataset.id = s.id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shapeIcon(s)}"/></svg><span>${s.name}</span>`;
    b.addEventListener('click', () => selectShape(s));
    grid.appendChild(b);
  }
}

function selectShape(s) {
  if (params.shapeType !== s.id && s.sides) params.shapeSides = s.sides.def;
  params.shapeType = s.id;
  params.source = 'shape';
  state.fit = true;
  if (s.sides) setParam('shapeSides', params.shapeSides);
  schedule(SHAPE);
}

// ---------- Image input ----------

async function loadFile(file) {
  if (!file) return;
  const okType = /^image\/(png|jpe?g|svg\+xml|webp|gif|bmp)$/.test(file.type) || /\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(file.name);
  if (!okType) { showError(`“${file.name}” is not an image. Use a PNG, JPG or SVG file.`); return; }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    state.name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').toLowerCase() || 'cookie';
    setSource(img, true);
  } catch {
    showError(`Could not read “${file.name}”. The file may be damaged or in an unsupported format.`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function setSource(img, autoTune) {
  state.source = img;
  state.autoTune = autoTune;
  state.fit = true;
  params.source = 'image';
  schedule(IMG);
}

function loadSample(s) {
  state.name = s.id;
  setSource(s.make(), true);
}

// ---------- Pipeline ----------

function processImage() {
  const img = state.source;
  let w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
  if (!w || !h) { w = h = 1024; } // SVG without intrinsic size
  const s = params.resolution / Math.max(w, h);
  const W = Math.max(8, Math.round(w * s)), H = Math.max(8, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = W + 4; c.height = H + 4; // 2 px white margin so shapes touching the edge still close
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 2, 2, W, H);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  let gray = toGray(data, c.width, c.height);
  state.grayRaw = gray;
  gray = adjust(Float32Array.from(gray), params.brightness, params.contrast);
  gray = boxBlur(gray, c.width, c.height, params.blur);
  state.gray = gray;
  if (state.autoTune) {
    state.autoTune = false;
    setParam('threshold', Math.round(otsu(gray)));
    setParam('invert', isDarkBackground(gray, c.width, c.height, params.threshold));
  }
  state.w = c.width; state.h = c.height;
  const mask = threshold(gray, params.threshold, params.invert);
  // The added margin is always background, whichever way the image is inverted.
  for (let x = 0; x < c.width; x++) for (const y of [0, 1, c.height - 2, c.height - 1]) mask[y * c.width + x] = 0;
  for (let y = 0; y < c.height; y++) for (const x of [0, 1, c.width - 2, c.width - 1]) mask[y * c.width + x] = 0;
  state.mask = mask;
  state.preview = c;
}

function isDarkBackground(gray, w, h, t) {
  // Sample a ring 3 px inside the image edge (inside the white margin).
  let dark = 0, n = 0;
  for (let x = 3; x < w - 3; x++) { dark += (gray[3 * w + x] < t) + (gray[(h - 4) * w + x] < t); n += 2; }
  for (let y = 3; y < h - 3; y++) { dark += (gray[y * w + 3] < t) + (gray[y * w + w - 4] < t); n += 2; }
  return dark / n > 0.6;
}

function run() {
  const shapeMode = params.source === 'shape';
  if (!shapeMode && !state.source) return;
  const t0 = performance.now();
  try {
    if (shapeMode) {
      if (dirty <= SHAPE) {
        const s = shapeById(params.shapeType);
        const w = params.shapeW, h = s.dims === 'd' ? params.shapeW : params.shapeH;
        state.shape = buildShape(s, w, h);
      }
    } else {
      if (dirty <= IMG) processImage();
      if (dirty <= TRACE) state.loops = maskToLoops(state.mask, state.w, state.h, params);
      if (dirty <= SHAPE) state.shape = state.loops.length ? analyzeShape(state.loops, params) : null;
    }
    if (dirty <= MESH) {
      state.parts = state.shape && state.shape.outline.length ? buildCutter(state.shape, params) : null;
      updateScene();
    }
    draw2D();
    updateStats();
    hideError();
  } catch (err) {
    console.error(err);
    showError(shapeMode ? 'Could not build this shape. Try a smaller corner rounding or larger dimensions.' : 'Could not build the cutter from this image. Try raising the threshold, adding blur, or rounding corners.');
  }
  dirty = MESH + 1;
  setBusy(false);
}

// ---------- 2D trace preview ----------

function draw2D() {
  const cv = $('#trace');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const box = cv.getBoundingClientRect();
  cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--trace-bg').trim();
  g.fillRect(0, 0, cv.width, cv.height);
  const shape = state.shape;
  if (params.source === 'shape') {
    if (!shape) return;
    const b = shape.bounds;
    const s = Math.min(cv.width / (b.maxX - b.minX), cv.height / (b.maxY - b.minY)) * 0.8;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const sx = shape.xf.sx;
    const p = new Path2D();
    for (const path of shape.outline) {
      path.forEach((q, i) => (i ? p.lineTo : p.moveTo).call(p, cv.width / 2 + sx * (q.X / 1000 - cx) * s, cv.height / 2 - (q.Y / 1000 - cy) * s));
      p.closePath();
    }
    g.fillStyle = css.getPropertyValue('--trace-ink').trim();
    g.fill(p);
    g.lineWidth = 2 * dpr;
    g.strokeStyle = css.getPropertyValue('--accent').trim();
    g.stroke(p);
    return;
  }
  if (!state.mask) return;
  const { w, h, mask } = state;
  const s = Math.min(cv.width / w, cv.height / h) * 0.94;
  const ox = (cv.width - w * s) / 2, oy = (cv.height - h * s) / 2;
  // mask
  const mc = document.createElement('canvas');
  mc.width = w; mc.height = h;
  const mg = mc.getContext('2d');
  const id = mg.createImageData(w, h);
  const ink = hexToRgb(css.getPropertyValue('--trace-ink').trim());
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    id.data[i * 4] = ink[0]; id.data[i * 4 + 1] = ink[1]; id.data[i * 4 + 2] = ink[2]; id.data[i * 4 + 3] = 255;
  }
  mg.putImageData(id, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(mc, ox, oy, w * s, h * s);
  if (!shape) return;
  const { k, cx, cy, sx } = shape.xf;
  const tx = x => ox + ((sx * x) / k + cx) * s, ty = y => oy + (-(y / k + cy)) * s;
  const pathOf = paths => {
    const p = new Path2D();
    for (const path of paths) path.forEach((q, i) => (i ? p.lineTo : p.moveTo).call(p, tx(q.X / 1000), ty(q.Y / 1000)));
    for (const path of paths) { if (path.length) p.closePath(); }
    return p;
  };
  if (shape.details.length) {
    g.fillStyle = css.getPropertyValue('--stamp').trim();
    g.fill(pathOf(shape.details), 'nonzero');
  }
  g.lineWidth = 2 * dpr;
  g.strokeStyle = css.getPropertyValue('--accent').trim();
  g.stroke(pathOf(shape.outline));
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16));
}

// ---------- 3D viewer ----------

let renderer, scene, camera, controls, group, grid;
const cutterMat = new THREE.MeshStandardMaterial({ color: 0xe8672a, roughness: 0.55, metalness: 0.05 });
const stampMat = new THREE.MeshStandardMaterial({ color: 0x2f7fb8, roughness: 0.55, metalness: 0.05 });

function initViewer() {
  const host = $('#viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(90, -150, 130);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(80, -120, 200);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-150, 100, 60);
  scene.add(rim);
  group = new THREE.Group();
  scene.add(group);
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

function resize() {
  const host = $('#viewport');
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (state.shape) draw2D();
}

function setGrid(size) {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
  const css = getComputedStyle(document.documentElement);
  const n = Math.ceil(size / 10) * 10 + 40;
  grid = new THREE.GridHelper(n, n / 10, new THREE.Color(css.getPropertyValue('--grid-major').trim()), new THREE.Color(css.getPropertyValue('--grid').trim()));
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.01;
  scene.add(grid);
}

function updateScene() {
  for (const m of [...group.children]) { group.remove(m); m.geometry.dispose(); }
  const parts = state.parts;
  if (!parts) return;
  const c = new THREE.Mesh(parts.cutter, cutterMat);
  group.add(c);
  parts.cutter.computeBoundingBox();
  const bb = parts.cutter.boundingBox.clone();
  if (parts.stamp) {
    const s = new THREE.Mesh(parts.stamp, stampMat);
    s.position.x = bb.max.x - bb.min.x + 10;
    group.add(s);
    parts.stamp.computeBoundingBox();
    bb.union(parts.stamp.boundingBox.clone().translate(s.position));
  }
  group.position.x = -(bb.min.x + bb.max.x) / 2;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
  if (state.fit || !grid) {
    state.fit = false;
    setGrid(span);
    const d = (span * 1.9 + 40) / Math.min(1, camera.aspect * 1.15); // back off on tall, narrow screens
    camera.position.set(d * 0.45, -d * 0.8, d * 0.72);
    controls.target.set(0, 0, 3);
  }
}

// ---------- Stats, warnings, export ----------

function volume(g) {
  const p = g.attributes.position.array;
  let v = 0;
  for (let t = 0; t < p.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(t, t + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function updateStats() {
  const out = $('#stats'), warn = $('#warnings'), notes = $('#notes');
  const parts = state.parts, shape = state.shape;
  const W = [];
  $('#export-btn').disabled = !parts;
  if (!parts) {
    out.textContent = params.source === 'shape' ? 'No shape' : 'No shape found. Adjust the threshold or try Invert (Image tab).';
    warn.innerHTML = notes.innerHTML = '';
    return;
  }
  const bb = parts.cutter.boundingBox;
  const vol = volume(parts.cutter) + (parts.stamp ? volume(parts.stamp) : 0);
  const grams = (vol / 1000) * 1.24;
  const cookie = shape.bounds;
  out.innerHTML = `<b>${(cookie.maxX - cookie.minX).toFixed(0)} × ${(cookie.maxY - cookie.minY).toFixed(0)} mm</b> cookie · ` +
    `<span class="print">${(bb.max.x - bb.min.x).toFixed(0)} × ${(bb.max.y - bb.min.y).toFixed(0)} × ${bb.max.z.toFixed(0)} mm print · </span>≈ ${grams.toFixed(0)} g`;
  out.title = `Print size ${(bb.max.x - bb.min.x).toFixed(1)} × ${(bb.max.y - bb.min.y).toFixed(1)} × ${bb.max.z.toFixed(1)} mm`;

  if (params.bladeThickness < 0.8) W.push(['warn', 'Tip under 0.8 mm may not print with a 0.4 mm nozzle.']);
  if (Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) > 220) W.push(['warn', 'Over 220 mm. Check that it fits your printer bed.']);
  const narrow = area(offset(offset(shape.outline, -1.6), 1.6)) < area(shape.outline) * 0.985;
  if (narrow) W.push(['warn', 'Some parts are narrower than 3 mm. Raise “Round corners” to smooth them.']);
  const N = [];
  const { wallTop } = wallProfile(params);
  if (params.wallHeight > params.bladeHeight - 0.5) N.push(`Thick wall is capped at ${wallTop.toFixed(1)} mm so a thinner tip remains.`);
  if (params.source === 'image' && params.detailEnabled && !shape.details.length) N.push('No inner details found, so no stamp lines were added. Try switching the detail source.');
  if (params.source === 'image' && params.detailEnabled && shape.details.length) N.push(`Stamp lines come from ${shape.detailMode === 'holes' ? 'light marks inside the shape' : 'inner lines of the drawing'}, ${Math.abs(params.detailOffset)} mm below the blade.`);
  warn.innerHTML = W.map(([k, t]) => `<li class="${k}">${t}</li>`).join('');
  notes.innerHTML = N.map(t => `<li class="info">${t}</li>`).join('');
}

function stlBytes(geometries) {
  const g = new THREE.Group();
  let x = 0;
  for (const geo of geometries) {
    geo.computeBoundingBox();
    const m = new THREE.Mesh(geo);
    m.position.x = x - geo.boundingBox.min.x;
    x += geo.boundingBox.max.x - geo.boundingBox.min.x + 10;
    g.add(m);
  }
  g.updateMatrixWorld(true);
  const res = new STLExporter().parse(g, { binary: true });
  return new Uint8Array(res.buffer ?? res);
}

let downloadsCap = null;
if (window.claude?.use) window.claude.use('downloads').then(d => { downloadsCap = d; }).catch(() => {});

async function save(filename, bytes) {
  if (downloadsCap) {
    // Hosts that restrict file types get the STL inside a zip.
    try {
      await downloadsCap.save({ filename: filename.replace(/\.stl$/, '.zip'), data: makeZip([{ name: filename, data: bytes }]) });
      toast(`Saved ${filename.replace(/\.stl$/, '.zip')}`);
    } catch (e) {
      if (e?.code !== 'declined') toast('This view cannot save files. Open the app from its own page to download.');
    }
    return;
  }
  // Phones: open the share sheet (Save to Files, printer apps) when the browser can share STL files.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
    const file = new File([bytes], filename, { type: 'model/stl' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // closed the share sheet
      }
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Downloaded ${filename}`);
}

function exportName(suffix) {
  if (params.source === 'shape') {
    const sh = shapeById(params.shapeType);
    const dims = sh.dims === 'd' ? `${Math.round(params.shapeW)}mm` : `${Math.round(params.shapeW)}x${Math.round(params.shapeH)}mm`;
    return `cooki3d-${sh.id}-${dims}.stl`;
  }
  return `cooki3d-${state.name}-${suffix}-${Math.round(params.size)}mm.stl`;
}

function initExport() {
  const btn = $('#export-btn'), menu = $('#export-menu');
  const all = () => {
    const p = state.parts; if (!p) return;
    save(exportName(p.stamp ? 'cutter-and-stamp' : 'cutter'), stlBytes(p.stamp ? [p.cutter, p.stamp] : [p.cutter]));
  };
  btn.addEventListener('click', e => {
    if (!state.parts) return;
    if (!state.parts.stamp) { all(); return; } // one part: export straight away
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', e => {
    const which = e.target.closest('button')?.dataset.part;
    if (!which) return;
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    const p = state.parts;
    if (which === 'all') all();
    if (which === 'cutter') save(exportName('cutter'), stlBytes([p.cutter]));
    if (which === 'stamp' && p.stamp) save(exportName('stamp'), stlBytes([p.stamp]));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });
}

// ---------- UI helpers ----------

function setBusy(b) { $('#busy').hidden = !b; }
function showError(t) { const e = $('#error'); e.textContent = t; e.hidden = false; setBusy(false); }
function hideError() { $('#error').hidden = true; }
let toastTimer = 0;
function toast(t) {
  const e = $('#toast'); e.textContent = t; e.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.hidden = true; }, 2600);
}

function initInput() {
  const file = $('#file');
  file.addEventListener('change', () => { loadFile(file.files[0]); file.value = ''; });
  $('#open-image').addEventListener('click', () => file.click());
  const drop = document.body;
  drop.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  drop.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  drop.addEventListener('drop', e => {
    e.preventDefault(); document.body.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });
  const list = $('#samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sample'; b.dataset.id = s.id; b.textContent = s.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => loadSample(s));
    list.appendChild(b);
  }
  $('#reset').addEventListener('click', () => {
    const keep = { source: params.source, shapeType: params.shapeType };
    Object.assign(params, DEFAULTS, keep);
    syncControls();
    state.autoTune = true;
    schedule(IMG);
    toast('Settings reset to defaults');
  });
  $('#view-top').addEventListener('click', () => {
    const d = camera.position.distanceTo(controls.target);
    camera.position.set(controls.target.x, controls.target.y - 0.001, controls.target.z + d);
  });
  $('#view-fit').addEventListener('click', () => { state.fit = true; updateScene(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { state.fit = true; updateScene(); draw2D(); });
}

buildControls();
initTabs();
initShapes();
initViewer();
initInput();
initExport();
initPWA({ onFile: loadFile });
if (params.source === 'shape') { state.fit = true; schedule(SHAPE); }
else loadSample(SAMPLES[0]);
