// physics.js — Langevin swarm engine, renderer-agnostic.
// Ported from hero-prototype.html (canvas-2D) with a z axis bolted on.
// Units: CSS px, seconds. The only DOM touch is document.createElement('canvas')
// inside sampleWord(), reached from init()/resize() only — never from step().

export const CONFIG = {
  N: 680,             // total particles (unassigned ones stay as ambient gas)
  dt: 1 / 60,         // fixed integration step
  kT: 1.2,            // temperature (slider units, scaled by kTScale internally)
  kTScale: 60,        // slider-unit -> px^2/s^2
  gamma: 2.5,         // Langevin drag [1/s]
  kTrap: 18,          // harmonic trap stiffness [1/s^2]
  repelR: 6,          // pair soft-repulsion radius [px]
  repelE: 600,        // pair repulsion strength [px/s^2]
  mouseR: 45,         // pointer field-source range [px] (v1 had 80 — too wide to aim)
  // V_cursor = A exp(-r^2/R^2); |-grad V| peaks at r = R/sqrt(2) with magnitude
  // sqrt(2)·e^(-1/2)·A/R. A was rescaled with R to hold that peak at ~21k px/s^2.
  mouseA: 1.12e6,     // gaussian bump amplitude A [px^2/s^2]
  pesVref: 2.5e4,     // V normalisation for the terrain (v1 5e4 — wells read too shallow)
  meltTime: 2.6,      // s of trap-off after a click
  pulseKT: 9,         // laser-pulse heating factor on melt (decays)
  word: 'BIN LIAN',
  wordY: 0.36,        // word center, fraction of viewport height
  sampleStep: 5,      // px between sampled glyph points
  injectV: 130,       // initial injection speed [px/s]
  tracerFrac: 0.05,   // fraction of amber "tracer" particles

  // --- z (out of the text plane): a soft spring, so the swarm bobs thermally in 3D
  kZ: 6,              // z spring stiffness [1/s^2]
  zNoiseScale: 0.6,   // z thermal noise, as a fraction of the xy sigma
  zInit: 20,          // |z| spread at injection [px]

  // --- renderer knobs, parked here so every tunable lives in one place
  terrainRelief: 55,  // world units from canyon floor to far-field plateau
  terrainSpan: 1.15,  // terrain sheet size / viewport size
  canyonSharpen: 1,   // u -> u^this before the log; drop to ~0.85 to sharpen walls
  hover: 11,          // bead centre height above the terrain surface [px]
};

const N = CONFIG.N;
const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
const tx = new Float32Array(N), ty = new Float32Array(N);
const hasT = new Uint8Array(N);       // 1 = assigned a glyph site
const tracer = new Uint8Array(N);     // 1 = amber tracer particle

export const state = { px, py, pz, vx, vy, vz, hasT, tracer };

// Where fillPotential() samples: world x of column gx is x0 + gx*dx, y of row gy is
// y0 + gy*dy. The lattice spans the viewport scaled by terrainSpan, edge to edge, so
// a PlaneGeometry(W*span, H*span, w-1, h-1) lines up with it vertex for vertex.
export const grid = { w: 0, h: 0, x0: 0, y0: 0, dx: 0, dy: 0 };

let W = 0, H = 0;
let mode = 'gas';                     // gas -> text; click: melt -> text
let modeT = 0;                        // s spent in current mode
let pulse = 0;                        // decaying laser-pulse heat
let mx = -1e9, my = -1e9;             // pointer, physics coords
let glyphPts = [];
let distF = new Float32Array(0);      // squared distance to the nearest glyph site, per grid cell

// Box-Muller gaussian
let spare = null;
function randn() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m;
  return u * m;
}

// ---------------------------------------------------------------- glyph targets
function sampleWord() {
  const ow = Math.max(1, Math.round(W)), oh = Math.max(1, Math.round(H));
  const off = document.createElement('canvas');
  off.width = ow; off.height = oh;
  const o = off.getContext('2d', { willReadFrequently: true });
  const fs = Math.min(oh * 0.30, (ow * 0.9) / (CONFIG.word.length * 0.62));
  o.font = `900 ${fs}px "Avenir Next", system-ui, sans-serif`;
  if ('letterSpacing' in o) o.letterSpacing = `${fs * 0.04}px`;
  o.textAlign = 'center'; o.textBaseline = 'middle';
  o.fillStyle = '#fff';
  o.fillText(CONFIG.word, ow / 2, oh * CONFIG.wordY);
  const img = o.getImageData(0, 0, ow, oh).data;
  const pts = [];
  const s = CONFIG.sampleStep;
  for (let y = 0; y < oh; y += s)
    for (let x = 0; x < ow; x += s)
      if (img[(y * ow + x) * 4 + 3] > 128) pts.push([x + (Math.random() - .5) * s * .5, y + (Math.random() - .5) * s * .5]);
  // cap so ~12% of particles remain ambient gas
  const cap = Math.floor(N * 0.88);
  while (pts.length > cap) pts.splice((Math.random() * pts.length) | 0, 1);
  return pts;
}

function assignTargets() {
  const pts = sampleWord();
  hasT.fill(0);
  // greedy nearest-free-particle per site; O(T*N) once, fine at this scale
  const free = new Uint8Array(N);
  for (const [gx, gy] of pts) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (free[i]) continue;
      const dx = px[i] - gx, dy = py[i] - gy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { free[best] = 1; hasT[best] = 1; tx[best] = gx; ty[best] = gy; }
  }
  glyphPts = pts;
  buildDistField();
}

// squared distance from each lattice point to the nearest glyph site -> the static half of V
function buildDistField() {
  for (let gy = 0; gy < grid.h; gy++) {
    const y = grid.y0 + gy * grid.dy, row = gy * grid.w;
    for (let gx = 0; gx < grid.w; gx++) {
      const x = grid.x0 + gx * grid.dx;
      let best = Infinity;
      for (let p = 0; p < glyphPts.length; p += 2) {   // every 2nd site is plenty at this resolution
        const dx = x - glyphPts[p][0], dy = y - glyphPts[p][1];
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
      distF[row + gx] = best === Infinity ? 0 : best;
    }
  }
}

// ---------------------------------------------------------------- spatial hash (pair repulsion)
let cols = 0, rows = 0, head = new Int32Array(0);
const nxt = new Int32Array(N);
function buildHash() {
  const cell = CONFIG.repelR;
  cols = Math.max(1, Math.ceil(W / cell));
  rows = Math.max(1, Math.ceil(H / cell));
  head = new Int32Array(cols * rows);
}
function hashPairs(forceFn) {
  const cell = CONFIG.repelR;
  head.fill(-1);
  for (let i = 0; i < N; i++) {
    let cx = (px[i] / cell) | 0, cy = (py[i] / cell) | 0;
    cx = cx < 0 ? 0 : cx >= cols ? cols - 1 : cx;
    cy = cy < 0 ? 0 : cy >= rows ? rows - 1 : cy;
    const h = cy * cols + cx;
    nxt[i] = head[h]; head[h] = i;
  }
  const R2 = CONFIG.repelR * CONFIG.repelR;
  for (let i = 0; i < N; i++) {
    const cx = Math.min(cols - 1, Math.max(0, (px[i] / cell) | 0));
    const cy = Math.min(rows - 1, Math.max(0, (py[i] / cell) | 0));
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      for (let j = head[gy * cols + gx]; j >= 0; j = nxt[j]) {
        if (j <= i) continue;
        const dx = px[i] - px[j], dy = py[i] - py[j];
        const d2 = dx * dx + dy * dy;
        if (d2 > R2 || d2 === 0) continue;
        forceFn(i, j, dx, dy, Math.sqrt(d2));
      }
    }
  }
}

// ---------------------------------------------------------------- public API
export function init(w, h, gridW, gridH) {
  grid.w = Math.max(2, gridW | 0); grid.h = Math.max(2, gridH | 0);
  distF = new Float32Array(grid.w * grid.h);
  const vth = Math.sqrt(CONFIG.kT * CONFIG.kTScale) * CONFIG.zNoiseScale;
  for (let i = 0; i < N; i++) {
    px[i] = Math.random() * w; py[i] = Math.random() * h;
    pz[i] = (Math.random() * 2 - 1) * CONFIG.zInit;
    const a = Math.random() * Math.PI * 2, v = CONFIG.injectV * (0.3 + Math.random());
    vx[i] = Math.cos(a) * v; vy[i] = Math.sin(a) * v; vz[i] = randn() * vth;
    tracer[i] = Math.random() < CONFIG.tracerFrac ? 1 : 0;
  }
  resize(w, h);
}

export function resize(w, h) {
  W = Math.max(1, w); H = Math.max(1, h);
  const sw = W * CONFIG.terrainSpan, sh = H * CONFIG.terrainSpan;
  grid.dx = sw / (grid.w - 1); grid.dy = sh / (grid.h - 1);
  grid.x0 = (W - sw) / 2; grid.y0 = (H - sh) / 2;   // sheet centred on the viewport
  for (let i = 0; i < N; i++) {                     // a shrink can leave particles outside the box
    if (px[i] < 0 || px[i] > W) px[i] = Math.random() * W;
    if (py[i] < 0 || py[i] > H) py[i] = Math.random() * H;
  }
  buildHash();
  assignTargets();
}

const fx = new Float32Array(N), fy = new Float32Array(N);

export function step(dt) {
  modeT += dt;
  if (mode === 'gas' && modeT > 2.2) { mode = 'text'; modeT = 0; }
  if (mode === 'melt' && modeT > CONFIG.meltTime) { mode = 'text'; modeT = 0; }
  pulse *= Math.exp(-dt / 0.45); // laser pulse cools off

  fx.fill(0); fy.fill(0);

  // harmonic traps (the "field"): only in text mode
  if (mode === 'text') {
    const k = CONFIG.kTrap;
    for (let i = 0; i < N; i++) if (hasT[i]) {
      fx[i] -= k * (px[i] - tx[i]);
      fy[i] -= k * (py[i] - ty[i]);
    }
  }

  // pointer: gaussian potential bump; force is its exact -grad V (matches the formula panel)
  if (mx > -1e8) {
    const R2 = CONFIG.mouseR * CONFIG.mouseR, c = 2 * CONFIG.mouseA / R2;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - mx, dy = py[i] - my;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2 * 9) continue;
      const f = c * Math.exp(-d2 / R2);
      fx[i] += f * dx; fy[i] += f * dy;
    }
  }

  // short-range soft pair repulsion
  const E = CONFIG.repelE, R = CONFIG.repelR;
  hashPairs((i, j, dx, dy, d) => {
    const f = E * (1 - d / R) / d;
    fx[i] += f * dx; fy[i] += f * dy;
    fx[j] -= f * dx; fy[j] -= f * dy;
  });

  // Langevin: dv = (-gamma v + F)dt + sqrt(2 gamma kT dt) eta   (semi-implicit Euler)
  const g = CONFIG.gamma, kZ = CONFIG.kZ;
  const kT = CONFIG.kT * CONFIG.kTScale * (1 + pulse);
  const sig = Math.sqrt(2 * g * kT * dt), sigZ = sig * CONFIG.zNoiseScale;
  for (let i = 0; i < N; i++) {
    vx[i] += (fx[i] - g * vx[i]) * dt + sig * randn();
    vy[i] += (fy[i] - g * vy[i]) * dt + sig * randn();
    vz[i] += (-kZ * pz[i] - g * vz[i]) * dt + sigZ * randn();
    px[i] += vx[i] * dt;
    py[i] += vy[i] * dt;
    pz[i] += vz[i] * dt;
    // reflecting walls in the text plane; z needs none, the spring confines it
    if (px[i] < 0) { px[i] = -px[i]; vx[i] = -vx[i]; }
    else if (px[i] > W) { px[i] = 2 * W - px[i]; vx[i] = -vx[i]; }
    if (py[i] < 0) { py[i] = -py[i]; vy[i] = -vy[i]; }
    else if (py[i] > H) { py[i] = 2 * H - py[i]; vy[i] = -vy[i]; }
  }
}

export function setPointer(x, y) { mx = x; my = y; }
export function clearPointer() { mx = -1e9; my = -1e9; }

export function melt() {
  if (mode !== 'text') return;
  mode = 'melt'; modeT = 0;
  pulse = CONFIG.pulseKT;          // laser pulse-heating, then traps off -> melts
}

export function setKT(v) { CONFIG.kT = v; }
export function getMode() { return mode; }

// The exact V the forces above see, sampled on the grid lattice.
// out must be Float32Array(grid.w * grid.h), row-major.
export function fillPotential(out) {
  const trap = mode === 'text' ? CONFIG.kTrap / 2 : 0;   // V_trap = 1/2 k d^2
  const live = mx > -1e8, R2 = CONFIG.mouseR * CONFIG.mouseR, A = CONFIG.mouseA;
  for (let gy = 0; gy < grid.h; gy++) {
    const y = grid.y0 + gy * grid.dy, row = gy * grid.w;
    for (let gx = 0; gx < grid.w; gx++) {
      let V = trap * distF[row + gx];
      if (live) {
        const dx = grid.x0 + gx * grid.dx - mx, dy = y - my;
        V += A * Math.exp(-(dx * dx + dy * dy) / R2);
      }
      out[row + gx] = V;
    }
  }
  return out;
}
