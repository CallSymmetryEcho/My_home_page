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
  kTrap: 28,          // harmonic trap stiffness [1/s^2]
  repelR: 6,          // pair soft-repulsion radius [px]
  repelE: 600,        // pair repulsion strength [px/s^2]
  mouseR: 45,         // pointer field-source range [px] (v1 had 80 — too wide to aim)
  // V_cursor = A exp(-r^2/R^2) with A < 0: an attractive well, i.e. an optical trap
  // (光镊). Beads are pulled in and gather at the cursor, and the spacetime fabric
  // dips under it. Sign propagates for free: step()'s force is the exact -grad V and
  // fillPotential() adds the same term, so flipping A flips both.
  // |-grad V| peaks at r = R/sqrt(2) with magnitude sqrt(2)·e^(-1/2)·|A|/R (~24k px/s^2).
  mouseA: -1.3e6,     // gaussian well amplitude A [px^2/s^2] — negative = attractive
  pesVref: 2.5e4,     // V normalisation for the fabric relief (v1 5e4 — wells too shallow)

  // --- field ramp λ(t): the potential fades IN and matter follows it.
  // gas (flat sheet, λ=0) -> ramp (λ 0->1, smoothstep) -> text (λ=1)
  // click -> melt (λ decays, τ=meltTau) -> ramp again, faster.
  gasTime: 1.2,       // s of Brownian gas on a dead-flat sheet before the field appears
  rampTime: 1.8,      // s of the first λ: 0 -> 1 ramp
  rampTime2: 1.0,     // s of the re-ramp after a melt (recrystallisation is quicker)
  meltTime: 2.6,      // s of field-off after a click
  meltTau: 0.25,      // λ decay time constant during melt [s]
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

  // --- renderer knobs (the GR "rubber sheet"), parked here so every tunable lives in one place
  fabricRelief: 0.085, // dip depth of a letter well, as a fraction of viewport H
  fabricSpan: 1.35,    // sheet lattice span / viewport, symmetric about the viewport centre
  fabricU0: 0.8,       // well width: dip ∝ exp(-u/U0) with u = V/pesVref
  fabricClamp: 2.3,    // a cursor well may dip up to this × a letter well
  // every bead has mass: each one splats a small gaussian dimple into the sheet, so the
  // gas phase reads as a flat sheet crawling with dents and the cursor is just a bigger one
  beadDent: 0.13,      // per-bead dimple depth, as a fraction of a letter well
  beadDentR: 17,       // per-bead dimple gaussian radius [px]
};

const N = CONFIG.N;
const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
const tx = new Float32Array(N), ty = new Float32Array(N);
const hasT = new Uint8Array(N);       // 1 = assigned a glyph site
const tracer = new Uint8Array(N);     // 1 = amber tracer particle

export const state = { px, py, pz, vx, vy, vz, hasT, tracer };

// Where fillPotential() samples: world x of column gx is x0 + gx*dx, y of row gy is
// y0 + gy*dy. The lattice spans fabricSpan·(W by H), centred on the viewport box, so the
// renderer's fabric line lattice lines up with it vertex for vertex.
export const grid = { w: 0, h: 0, x0: 0, y0: 0, dx: 0, dy: 0 };

let W = 0, H = 0;
let mode = 'gas';                     // gas -> ramp -> text; click: melt -> ramp -> text
let modeT = 0;                        // s spent in current mode
let lambda = 0;                       // field ramp: 0 = no potential, 1 = full traps
let rampT = CONFIG.rampTime;          // duration of the ramp we are in / heading into
let meltL0 = 0;                       // λ at the moment of the melt click
let pulse = 0;                        // decaying laser-pulse heat
let mx = -1e9, my = -1e9;             // pointer, physics coords
let glyphPts = [];
let distF = new Float32Array(0);      // squared distance to the nearest glyph site, per grid cell

const smoothstep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

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
  const sw = W * CONFIG.fabricSpan, sh = H * CONFIG.fabricSpan;
  grid.dx = sw / (grid.w - 1); grid.dy = sh / (grid.h - 1);
  grid.x0 = (W - sw) / 2; grid.y0 = (H - sh) / 2;   // symmetric about the viewport box
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
  // field ramp: the potential appears first, matter answers it.
  if (mode === 'gas') {
    lambda = 0;
    if (modeT > CONFIG.gasTime) { mode = 'ramp'; modeT = 0; }
  } else if (mode === 'ramp') {
    lambda = smoothstep(modeT / rampT);
    if (modeT >= rampT) { mode = 'text'; modeT = 0; lambda = 1; }
  } else if (mode === 'melt') {
    lambda = meltL0 * Math.exp(-modeT / CONFIG.meltTau);
    if (modeT > CONFIG.meltTime) { mode = 'ramp'; modeT = 0; rampT = CONFIG.rampTime2; lambda = 0; }
  } else {
    lambda = 1;                  // 'text'
  }
  pulse *= Math.exp(-dt / 0.45); // laser pulse cools off

  fx.fill(0); fy.fill(0);

  // harmonic traps (the "field"), scaled by the ramp — same λ the sheet's wells use
  if (lambda > 0) {
    const k = CONFIG.kTrap * lambda;
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
  if (mode !== 'text' && mode !== 'ramp') return;
  meltL0 = lambda;
  mode = 'melt'; modeT = 0;
  pulse = CONFIG.pulseKT;          // laser pulse-heating, and λ collapses -> melts
}

export function setKT(v) { CONFIG.kT = v; }
export function getMode() { return mode; }
export function getLambda() { return lambda; }

// The exact V the forces above see, sampled on the grid lattice.
// out must be Float32Array(grid.w * grid.h), row-major.
export function fillPotential(out) {
  const trap = CONFIG.kTrap * lambda / 2;   // V_trap = 1/2 (λk) d^2 — same λ as the force
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
