// formations.js — target-point generators for the scroll story. Pure: no DOM, no state.
//
// Each generator returns [[x, y], …] in physics-box coords (viewport CSS px), inside the
// word band (y ≈ 0.26–0.58·H) and centred on (0.5W, 0.42H). physics.js caps the list at
// 0.88·N = 598 sites, so TARGET sits just under that; the leftover beads stay ambient gas.
//
// Geometry note: the literal spacings in the brief (lattice 26 px, 11 wire chains, 14 px
// gel strands at 26 nodes) all under-fill the ~540-point budget by roughly 2×, so the
// budget wins and the spacing/chain-count is derived from it. Footprints are unchanged —
// those are what keeps the formation off the copy and inside the frame.

const TARGET = 540;

// Box–Muller. Math.random is fine here: the page is the only consumer and the structure
// (footprint, spacing, count) is fixed — only the jitter is random.
let spare = null;
function randn() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m;
  return u * m;
}
const jit = a => (Math.random() - 0.5) * 2 * a;

// ---------------------------------------------------------------- JOURNEY
// The path itself, as a constellation: four star-clusters on a rising diagonal, wired by
// thin bead chains. The page reads the same table to pin its DOM labels, so the labels and
// the stars can never drift apart: [name, x·W, y·H, relative brightness].
export const JOURNEY_NODES = [
  ['USTC', 0.22, 0.55, 1],
  ['BERKELEY', 0.40, 0.46, 1],
  ['BROWN', 0.58, 0.40, 1],
  ['UT AUSTIN', 0.78, 0.30, 1.45],   // the current node, and the brightest
];

export function journey(W, H) {
  const S = H / 900;                       // same viewport scaling as focus()
  const CHAIN = 16 * S, CJIT = 2 * S;      // constellation lines: one bead every ~16 px
  const nd = JOURNEY_NODES.map(([, fx, fy]) => [fx * W, fy * H]);
  const pts = [];

  // the chains have a fixed pitch, so they are laid first and the clusters take the rest of
  // the budget. Endpoints are left to the clusters — a chain must not double up on a core.
  for (let k = 1; k < nd.length; k++) {
    const a = nd[k - 1], b = nd[k];
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / CHAIN));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t + jit(CJIT), a[1] + (b[1] - a[1]) * t + jit(CJIT)]);
    }
  }

  // gaussian cores. The brief's literal 55/80 beads fill barely half the budget and leave
  // 40% of the swarm as ambient noise around the constellation, so — as everywhere else in
  // this file — the budget sets the count and the brief's ratio (UT Austin 1.45×) sets the
  // split. σ stays 14 / 18 px, which is what gives the clusters their density.
  const wsum = JOURNEY_NODES.reduce((a, n) => a + n[3], 0);
  const per = (TARGET - pts.length) / wsum;
  const cl3 = v => (v < -3 ? -3 : v > 3 ? 3 : v);
  JOURNEY_NODES.forEach(([, , , w], k) => {
    const n = Math.round(per * w), sg = (w > 1 ? 18 : 14) * S;
    for (let i = 0; i < n; i++) pts.push([nd[k][0] + cl3(randn()) * sg, nd[k][1] + cl3(randn()) * sg]);
  });
  return pts;
}

// ---------------------------------------------------------------- LIGHT
// An optical focus: a dense gaussian core plus two diffraction rings.
export function focus(W, H) {
  const cx = 0.5 * W, cy = 0.42 * H;
  // 22 / 95 / 150 px at the 900 px design height, scaled so the figure keeps its
  // proportion to the sheet (and the outer ring stays inside the word band) on any viewport
  const S = H / 900, CORE_SIGMA = 22 * S, R1 = 95 * S, R2 = 150 * S;
  const pts = [];
  const nCore = Math.round(TARGET * 0.45);
  const cl3 = v => (v < -3 ? -3 : v > 3 ? 3 : v);   // no 5σ stragglers out in the dark
  for (let i = 0; i < nCore; i++) pts.push([cx + cl3(randn()) * CORE_SIGMA, cy + cl3(randn()) * CORE_SIGMA]);

  // remaining points split between the rings by circumference, so both read equally bright
  const rest = TARGET - nCore;
  for (const [R, n] of [[R1, Math.round(rest * R1 / (R1 + R2))], [R2, rest - Math.round(rest * R1 / (R1 + R2))]]) {
    const ph = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * Math.PI * 2 + jit(0.004 * Math.PI);
      const r = R + jit(4 * S);                   // 2–3 beads thick: an annulus, not a wire
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// ---------------------------------------------------------------- HEAT
// The PS-sphere monolayer: a hexagonal close-packed patch on an elliptical footprint.
export function lattice(W, H) {
  const cx = 0.5 * W, cy = 0.42 * H, rx = 0.23 * W, ry = 0.15 * H;
  // hex packing puts one site per a²·√3/2 of area, so the budget fixes the spacing
  // (≈17 px at 1440×900) and the patch stays the same size on every viewport.
  const a = Math.sqrt(Math.PI * rx * ry / (TARGET * Math.sqrt(3) / 2));
  const rowH = a * Math.sqrt(3) / 2;
  const pts = [];
  const jRange = Math.ceil(ry / rowH), iRange = Math.ceil(rx / a) + 1;
  for (let j = -jRange; j <= jRange; j++) {
    const dy = j * rowH, off = (j & 1) ? a / 2 : 0;
    for (let i = -iRange; i <= iRange; i++) {
      const dx = i * a + off;
      if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1) continue;
      pts.push([cx + dx + jit(1.2), cy + dy + jit(1.2)]);
    }
  }
  return pts;
}

// ---------------------------------------------------------------- ELECTRIC
// Field-aligned particle chains: beads pearl-string along the field lines.
export function wires(W, H) {
  const yTop = 0.26 * H, yBot = 0.58 * H, span = 0.62 * W;
  const BEAD_DY = 11;
  const per = Math.round((yBot - yTop) / BEAD_DY) + 1;
  // 13 chains, NOT budget-driven: packing chains until every bead is employed turned the
  // array into a solid block — the chain identity needs visible gaps between chains, and
  // the unassigned beads just stay ambient gas (which reads more physical anyway)
  const n = 13;
  const x0 = 0.5 * W - span / 2, dx = span / (n - 1), dy = (yBot - yTop) / (per - 1);
  const pts = [];
  for (let c = 0; c < n; c++) {
    const x = x0 + c * dx;
    for (let k = 0; k < per; k++) pts.push([x + jit(3.5), yTop + k * dy + jit(1.5)]);
  }
  return pts;
}

// ---------------------------------------------------------------- SOLVATION
// A percolating gel: blue-noise nodes, each wired to its nearest neighbours, then the
// components stitched together so the web always spans (union-find, shortest cross edge).
export function network(W, H) {
  const cx = 0.5 * W, cy = 0.42 * H, rx = 0.29 * W, ry = 0.16 * H;
  const NODES = 56, MIN_D = 0.030 * W, PER_NODE = 2;

  // blue-noise-ish nodes by rejection sampling inside the elliptical footprint
  const nd = [];
  for (let tries = 0; nd.length < NODES && tries < 6000; tries++) {
    const u = Math.random() * 2 - 1, v = Math.random() * 2 - 1;
    if (u * u + v * v > 1) continue;
    const x = cx + u * rx, y = cy + v * ry;
    if (nd.every(p => (p[0] - x) ** 2 + (p[1] - y) ** 2 > MIN_D * MIN_D)) nd.push([x, y]);
  }

  // each node -> its 2–3 nearest neighbours, deduped by the ordered pair key
  const seen = new Set(), edges = [];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const addEdge = (i, j) => {
    const k = i < j ? i + ':' + j : j + ':' + i;
    if (i === j || seen.has(k)) return;
    seen.add(k); edges.push([i, j]);
  };
  for (let i = 0; i < nd.length; i++) {
    const near = nd.map((p, j) => [j, d2(nd[i], p)]).sort((a, b) => a[1] - b[1]);
    const k = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let m = 1; m <= k && m < near.length; m++) addEdge(i, near[m][0]);
  }

  // union-find, then bridge the leftover components by their shortest cross edge:
  // "2–3 nearest" alone happily leaves islands, and a gel that does not percolate is a sol
  const par = nd.map((_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  const uni = (i, j) => { const a = find(i), b = find(j); if (a !== b) { par[a] = b; return true; } return false; };
  for (const [i, j] of edges) uni(i, j);
  for (;;) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < nd.length; i++) for (let j = i + 1; j < nd.length; j++) {
      if (find(i) === find(j)) continue;
      const d = d2(nd[i], nd[j]);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    if (bi < 0) break;
    uni(bi, bj); addEdge(bi, bj);
  }

  // Distribute beads along the strands, then a small halo on every crosslink. The strand
  // pitch comes from the budget rather than a literal 14 px: total edge length scales with
  // the viewport, so a fixed pitch swings the point count from 300 to 690 across 1000→2560
  // px. Lands at ~12 px on a 1440×900 screen.
  const len = edges.map(([i, j]) => Math.hypot(nd[j][0] - nd[i][0], nd[j][1] - nd[i][1]));
  const total = len.reduce((a, b) => a + b, 0);
  const STRAND = total / Math.max(1, TARGET - nd.length * PER_NODE + edges.length);
  const pts = [];
  for (const [i, j] of edges) {
    const a = nd[i], b = nd[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / STRAND));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      pts.push([a[0] + (b[0] - a[0]) * t + jit(2.5), a[1] + (b[1] - a[1]) * t + jit(2.5)]);
    }
  }
  for (const [x, y] of nd) for (let k = 0; k < PER_NODE; k++) pts.push([x + jit(5), y + jit(5)]);
  return pts;
}
