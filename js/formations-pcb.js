// formations-pcb.js — chapter ③ "From Physics to Machines".
//
// One closed PCB control loop: Manhattan traces with 45° chamfered corners (the classic
// printed-circuit bend), a plated via at every corner and every branch, four IC footprints
// straddling the trace (sense → decide → actuate → matter → back), and four branch stubs
// that leave the loop and terminate in a pad. The loop is geometrically closed, which is
// the whole point of the chapter.
//
// Same contract as formations.js: pure (no DOM, no state), returns [[x, y], …] in
// physics-box coords (viewport CSS px). physics.js caps a formation at 0.88·N = 598 sites;
// the leftover beads stay ambient gas.
//
// Pitch is derived from the point budget, not from the brief's literal ~12 px — same call
// formations.js already makes. At 12 px this footprint yields ~360 points, under the 450
// floor, which would leave ~320 beads as ambient gas smeared across the board. Budget wins:
// the pitch lands at ~7 px on 1440×900 and the traces read as continuous copper.

const TARGET = 500;      // total sites; well under the 598 cap
const JIT = 0.8;         // ≤2 px — a trace that wanders is not a trace
const VIA_R = 7;         // plated-via ring radius [px]
const VIA_N = 5;         // beads per via ring
const PAD_GAP = 15;      // IC pin row offset from the trace centreline [px]
const PAD_PITCH = 8;     // IC pin pitch [px]
const PAD_PINS = 8;      // pins per row, two rows per IC
const STUB_DIAG = 0.045; // 45° run of a branch stub, as a fraction of H (path length)

const jit = () => (Math.random() - 0.5) * 2 * JIT;

const pathLen = p => {
  let L = 0;
  for (let i = 0; i + 1 < p.length; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return L;
};

// Beads every `pitch` px along a polyline. The arc-length carry crosses vertices, so a
// corner gets no bead pile-up and no gap.
function walk(path, pitch, out) {
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    for (; s < L; s += pitch) {
      const t = s / L;
      out.push([ax + (bx - ax) * t + jit(), ay + (by - ay) * t + jit()]);
    }
    s -= L;
  }
}

// a plated via: a tight ring around the path point
function via(x, y, out) {
  for (let i = 0; i < VIA_N; i++) {
    const a = 0.4 + (i / VIA_N) * Math.PI * 2;
    out.push([x + Math.cos(a) * VIA_R + jit(), y + Math.sin(a) * VIA_R + jit()]);
  }
}

// an IC footprint: two parallel pin rows straddling the trace at (x, y).
// (dx, dy) is the unit trace direction; the rows sit on its normal.
function ic(x, y, dx, dy, out) {
  const nx = -dy, ny = dx;
  for (const side of [-1, 1]) {
    for (let i = 0; i < PAD_PINS; i++) {
      const t = (i - (PAD_PINS - 1) / 2) * PAD_PITCH;
      out.push([
        x + dx * t + nx * side * PAD_GAP + jit(),
        y + dy * t + ny * side * PAD_GAP + jit(),
      ]);
    }
  }
}

// the 6-bead pad a branch stub dies into: a 3×2 SMD land, oriented along the stub
function pad(x, y, dx, dy, out) {
  const nx = -dy, ny = dx;
  for (let c = -1; c <= 1; c++) {
    for (const r of [-1, 1]) {
      out.push([
        x + dx * c * 7 + nx * r * 3.5 + jit(),
        y + dy * c * 7 + ny * r * 3.5 + jit(),
      ]);
    }
  }
}

export function pcb(W, H) {
  const cx = 0.5 * W, cy = 0.42 * H;
  const hw = 0.28 * W, hh = 0.15 * H;          // footprint 0.56W × 0.30H
  const ch = Math.min(0.32 * hh, 0.12 * hw);   // chamfer leg

  // the closed loop: a chamfered rectangle, 8 vertices, clockwise from the top-left chamfer
  const V = [
    [cx - hw + ch, cy - hh], [cx + hw - ch, cy - hh],
    [cx + hw, cy - hh + ch], [cx + hw, cy + hh - ch],
    [cx + hw - ch, cy + hh], [cx - hw + ch, cy + hh],
    [cx - hw, cy + hh - ch], [cx - hw, cy - hh + ch],
  ];
  const loop = [...V, V[0]];

  // Branch stubs leave the two vertical edges: a Manhattan run out, then one 45° bend
  // away from the loop. Leaving sideways keeps them inside the y band on short viewports,
  // where the vertical margin above/below the loop is only ~0.05H.
  // [edge sign, start y as a fraction of hh, horizontal run as a fraction of W]
  const D = STUB_DIAG * H / Math.SQRT2;        // per-axis travel of the 45° run
  const stubs = [[1, -0.50, 0.050], [1, 0.50, 0.050], [-1, -0.60, 0.046], [-1, 0.60, 0.046]]
    .map(([s, q, l1]) => {
      const x0 = cx + s * hw, y0 = cy + q * hh;
      const x1 = x0 + s * l1 * W, dirY = Math.sign(q);
      return {
        path: [[x0, y0], [x1, y0], [x1 + s * D, y0 + dirY * D]],
        dx: s / Math.SQRT2, dy: dirY / Math.SQRT2,      // unit direction of the diagonal
      };
    });

  const traces = [loop, ...stubs.map(s => s.path)];
  const fixed = (V.length + stubs.length) * VIA_N + stubs.length * 6 + 4 * 2 * PAD_PINS;
  const pitch = traces.reduce((a, p) => a + pathLen(p), 0) / Math.max(1, TARGET - fixed);

  const pts = [];
  for (const p of traces) walk(p, pitch, pts);
  for (const [x, y] of V) via(x, y, pts);
  for (const s of stubs) {
    via(s.path[0][0], s.path[0][1], pts);
    const [ex, ey] = s.path[2];
    pad(ex, ey, s.dx, s.dy, pts);
  }
  // The four stages: sense · decide · actuate · matter. All four ride the horizontal edges.
  // The scene tilts the sheet 55°, so physics y is foreshortened ~0.74 on screen: an IC on
  // a vertical edge collapses into a blob, and that edge already carries the branch vias.
  for (const s of [-1, 1]) {
    ic(cx + s * 0.45 * hw, cy - hh, 1, 0, pts);
    ic(cx + s * 0.45 * hw, cy + hh, 1, 0, pts);
  }
  return pts;
}
