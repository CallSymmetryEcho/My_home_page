// scene3d.js — Three.js layer over physics.js: deep space + ONE general-relativity
// "rubber sheet" that everything lives on. There is no separate name plane any more:
// the potential surface IS the world, tilted toward the camera at the classic GR-demo
// table angle so the word stays readable while normal-direction dips still project.
//
//   SHEET FRAME — û = (1,0,0), up-slope ŵ = (0, sinφ, −cosφ), normal n̂ = (0, cosφ, sinφ)
//   (n̂ points up and toward the camera; û × ŵ = n̂).
//     sheet(x, y) = Cs + û·(x − W/2)·S + ŵ·(H/2 − y)·S
//   with Cs = (0, SHEET_Y·H, 0). Height h (always ≤ 0) displaces along n̂, i.e. INTO
//   the sheet, away from the camera.
//
//   FABRIC   — the lattice itself, drawn as quad grid lines. h = −(field wells + bead
//              dents); the curvature of the lines IS the data.
//   BEADS    — roll ON the sheet: sheet(x,y) + n̂·(h_local + r + 0.5·pz). Every bead
//              also dents the sheet under itself, so mass and curvature are one object.

import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import * as PHY from 'physics';   // bare: resolved by index.html's importmap so PHY stays a singleton across versioned URLs

const GW = 121, GH = 61;                  // potential grid == fabric line lattice
const SHEET_TILT = 55 * Math.PI / 180;    // sheet tilt from horizontal (55°: more face-on, word reads)
const SINP = Math.sin(SHEET_TILT), COSP = Math.cos(SHEET_TILT);
const PLANE_S = 0.66;                     // physics px -> world units; word ≈ 70% frame width
const SHEET_Y = 0.16;                     // sheet centre height [·H]
const CAM_Y = 0.52, CAM_Z = 1.30;         // camera position [·H], looking at the sheet centre
const FOV = 34;
const FADE0 = 0.45;                       // sheet edge fade starts at this normalised radius
const C = PHY.CONFIG;

// ------------------------------------------------------------ quality tiers
// ONE resolve, ONE table. Everything that differs between a desktop GPU and a phone is a
// field of Q — there is no second place a tier decision may be made. `?tier=lite|high`
// overrides the probe, for testing either tier on any machine.
//   glass      MeshPhysicalMaterial transmission renders the whole scene a SECOND time.
//              That single flag is the biggest fill-rate item on the page.
//   bloomRes   scale applied to what EffectComposer hands UnrealBloomPass (see below).
//   fabStride  draw every Nth lattice line — the potential keeps its full resolution.
const TIER = (() => {
  const q = new URLSearchParams(location.search).get('tier');
  return q === 'lite' || q === 'high' ? q
    : (matchMedia('(pointer: coarse)').matches || innerWidth < 900
      || (navigator.deviceMemory && navigator.deviceMemory <= 4)) ? 'lite' : 'high';
})();
//   beadR      bead geometry radius multiplier. LITE runs 15% fatter — with no transmission
//              the droplets read by their highlight alone, and a bigger one holds it.
const Q = TIER === 'lite' ? {
  tier: 'lite', beads: 520, glass: false, beadCol: 0xc4d8dc, envI: 2.8, seg: [14, 10],
  msaa: 0, bloomRes: 0.5, bloomK: 0.9, dpr: 1.5, stars: 650, fabStride: 3, beadR: 1.15,
} : {
  tier: 'high', beads: C.N, glass: true, beadCol: 0xf2feff, envI: 3.2, seg: [24, 16],
  msaa: 4, bloomRes: 0.5, bloomK: 1.0, dpr: 2, stars: 1300, fabStride: 2, beadR: 1,
};
// bead geometry radius [world units]. The tier scales the GEOMETRY, not the instance
// baseline: `scl` still carries the per-bead size spread, and every reader of BEAD_R (the
// rest height in placeBeads, project()'s offset) picks the new size up for free.
const BEAD_R = 2.6 * Q.beadR;

// opts (all optional, all for the board morph — see setMorph):
//   board     already-parsed board JSON; skips the fetch entirely
//   boardUrl  where to fetch it from instead (default './js/data/board-hswb.json')
//   logoUrl   silkscreen logo sprite (default 'image/logo-bin-mono.png')
export function createHero(canvas, opts = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = canvas.clientWidth || innerWidth, H = canvas.clientHeight || innerHeight;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('WebGL2 unavailable: ' + (e && e.message));
  }
  renderer.setPixelRatio(Math.min(Q.dpr, devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000004, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  PHY.init(W, H, GW, GH, Q.beads);   // …which rewrites C.N to the tier's count

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 40000);
  const look = new THREE.Vector3();
  let baseY = 0;

  // ------------------------------------------------------------ environment + lights
  // dark-studio environment: a black void with a few small hot panels, so the glass
  // picks up crisp point highlights on a dark body (RoomEnvironment's big gray walls
  // wash the beads into matte cotton balls instead)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new THREE.Scene();
  {
    const mk = (w, h, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); studio.add(m);
    };
    mk(5, 5, new THREE.Color(6, 6, 6), 4, 6, 4);          // hot key
    mk(9, 2.5, new THREE.Color(2.5, 3.0, 3.2), -6, 2, -4); // cool rim strip
    mk(3, 3, new THREE.Color(2.2, 2.2, 2.2), 1, -5, 5);    // low fill
  }
  const envRT = pmrem.fromScene(studio, 0.02);
  scene.environment = envRT.texture;
  studio.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();

  // no ambient: deep space. The glass reads through env reflection + these two.
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  const glint = new THREE.PointLight(0x8de9ec, 1, 1, 2);   // intensity/range scale with H
  scene.add(key, glint);

  // ------------------------------------------------------------ starfield
  const STARS = Q.stars;
  const starGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(STARS * 3), col = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const r = (3 + Math.random() * 5) * H;
      pos[i * 3] = r * s * Math.cos(th); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(th);
      const b = 0.2 + Math.random() * 0.6;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = b;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const starMat = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ------------------------------------------------------------ the spacetime fabric
  // Quad grid only: row segments (i,j)-(i+1,j) and column segments (i,j)-(i,j+1).
  // No diagonals — a triangulated wireframe reads as torn cloth, a quad grid reads as GR.
  const fabGeo = new THREE.BufferGeometry();
  fabGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3));
  fabGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3));
  fabGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  fabGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);
  {
    // draw every Nth lattice line: big sparse GR cells, while the potential keeps the
    // full lattice resolution so each drawn line still bends smoothly through the wells
    const st = Q.fabStride, ix = [];
    for (let j = 0; j < GH; j += st) for (let i = 0; i < GW - 1; i++) { ix.push(j * GW + i, j * GW + i + 1); }
    for (let i = 0; i < GW; i += st) for (let j = 0; j < GH - 1; j++) { ix.push(j * GW + i, (j + 1) * GW + i); }
    fabGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(ix), 1));
  }
  const fabMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fabric = new THREE.LineSegments(fabGeo, fabMat);
  fabric.frustumCulled = false;   // positions are authored, bounds are stale
  scene.add(fabric);

  const vbuf = new Float32Array(GW * GH);   // V from physics
  const dent = new Float32Array(GW * GH);   // per-bead dimples, in letter-well units
  const hgt = new Float32Array(GW * GH);    // current height along n̂, eased toward the target
  const fade = new Float32Array(GW * GH);   // static edge fade, rebuilt on resize
  // a whisper of ice-cyan (#bfeeee) in the deepest wells, linear-light
  const ICE = new THREE.Color().setRGB(0xbf / 255, 0xee / 255, 0xee / 255, THREE.SRGBColorSpace);

  // ------------------------------------------------------------ bead dents ("every bead has mass")
  // One k×k gaussian kernel, built on resize and splatted at each bead's nearest lattice
  // point. Cut off at 1.5R (the gaussian is down to e^-2.25 there) so the dimple base
  // does not show the kernel's square edge. O(N·k²), allocation-free.
  let kern = new Float32Array(0), kx = 1, ky = 1, kw = 3;
  function buildKernel() {
    const g = PHY.grid, R2 = C.beadDentR * C.beadDentR;
    kx = Math.max(1, Math.ceil(1.5 * C.beadDentR / g.dx));
    ky = Math.max(1, Math.ceil(1.5 * C.beadDentR / g.dy));
    kw = 2 * kx + 1;
    kern = new Float32Array(kw * (2 * ky + 1));
    for (let j = -ky; j <= ky; j++) for (let i = -kx; i <= kx; i++) {
      const dx = i * g.dx, dy = j * g.dy;
      kern[(j + ky) * kw + (i + kx)] = C.beadDent * Math.exp(-(dx * dx + dy * dy) / R2);
    }
  }
  function splatDents() {
    dent.fill(0);
    const g = PHY.grid, px = PHY.state.px, py = PHY.state.py;
    for (let n = 0; n < C.N; n++) {
      const cx = Math.round((px[n] - g.x0) / g.dx), cy = Math.round((py[n] - g.y0) / g.dy);
      for (let j = -ky; j <= ky; j++) {
        const gy = cy + j;
        if (gy < 0 || gy >= GH) continue;
        const row = gy * GW, krow = (j + ky) * kw + kx;
        for (let i = -kx; i <= kx; i++) {
          const gx = cx + i;
          if (gx < 0 || gx >= GW) continue;
          dent[row + gx] += kern[krow + i];
        }
      }
    }
  }

  // …and once the sheet has faded out entirely (the board materialized, the journey, the
  // writing, the outro) nothing on screen reads any of it, so the whole 7.4k-vertex pass —
  // potential, dents and all — is skipped. hgt goes stale while it is off; the first frame
  // back SNAPS the ease (rate 1 instead of 0.12) so a scrub back in is exact rather than
  // thirty frames behind. `fabric.visible` is written by updateMorph, one frame ahead.
  let fabStale = false;

  function updateFabric() {
    if (!fabric.visible) { fabStale = true; return; }
    const rate = fabStale ? 1 : 0.12;
    fabStale = false;
    PHY.fillPotential(vbuf);
    splatDents();
    const lam = PHY.getLambda();
    const relief = C.fabricRelief * H, cl = C.fabricClamp;
    const inv = 1 / (C.pesVref * C.fabricU0);
    // fillPotential's trap term already carries λ. Dividing it back out of the exponent
    // keeps the well's WIDTH fixed while λ scales only its DEPTH — the wells fade in
    // where the letters are instead of growing outward from points.
    const wellInv = lam > 1e-3 ? inv / lam : 0;
    // the trap is ~50x pesVref deep, so exp(-V/…) saturates and punches a flat-bottomed
    // cylinder. Log-compress the V<0 side instead, normalised so the trap centre lands
    // exactly on the clamp: a round funnel, and the clamp is touched, never ridden.
    const kNeg = (cl - 1) / Math.log1p(Math.abs(C.mouseA) / C.pesVref);
    const g = PHY.grid, cy0 = SHEET_Y * H;
    const p = fabGeo.attributes.position.array, col = fabGeo.attributes.color.array;
    for (let gy = 0; gy < GH; gy++) {
      // the sheet's own frame: up-slope offset is constant along a lattice row
      const w = (H / 2 - (g.y0 + gy * g.dy)) * PLANE_S;
      const rowY = cy0 + w * SINP, rowZ = -w * COSP, row = gy * GW;
      for (let gx = 0; gx < GW; gx++) {
        const k = row + gx, V = vbuf[k];
        // letter wells: dip = λ·exp(-u/U0), 1 on a glyph -> 0 in the far field (asymptotically
        // FLAT, no bathtub). λ=0 in the gas phase, so this half is simply absent then.
        // cursor well: the attractive trap drives V negative, and only that adds depth —
        // which makes the far field flat in every mode with no baseline bookkeeping.
        // bead dents: every particle's own little mass.
        let e = (lam > 1e-3 ? lam * Math.exp(-(V > 0 ? V : 0) * wellInv) : 0)
              + (V < 0 ? kNeg * Math.log1p(-V / C.pesVref) : 0)
              + dent[k];
        if (e > cl) e = cl;
        // ease, so λ steps and mode switches grow the wells instead of popping
        const h = hgt[k] += (-relief * e - hgt[k]) * rate;
        p[k * 3 + 1] = rowY + h * COSP;    // displace along n̂ = (0, cosφ, sinφ)
        p[k * 3 + 2] = rowZ + h * SINP;

        const d = -h / relief;                       // 0 flat · 1 letter well · up to cl in the trap
        const b = 0.38 * fade[k] * (1 + 0.7 * d);    // wells glow gently — the beads carry the word
        const t = 0.5 * (d < 1 ? d : 1);
        col[k * 3] = b * (1 + (ICE.r - 1) * t);
        col[k * 3 + 1] = b * (1 + (ICE.g - 1) * t);
        col[k * 3 + 2] = b * (1 + (ICE.b - 1) * t);
      }
    }
    fabGeo.attributes.position.needsUpdate = true;
    fabGeo.attributes.color.needsUpdate = true;
  }

  // physics (x, y) -> CSS px inside the canvas. The sheet is tilted, the camera dollies and
  // parallaxes, so anything in the DOM that has to sit ON a bead (the journey labels) must
  // ask for the real projection — a viewport percentage lands next to the wrong star.
  // n = the n̂ offset to project at; omitted, it is the one a bead rides at.
  const pj3 = new Float32Array(3), pjv = new THREE.Vector3();
  function project(x, y, n) {
    sheetXYZ(x, y, n === undefined ? heightAt(x, y) * 0.35 + BEAD_R : n, pj3, 0);
    return projectWorld(pj3[0], pj3[1], pj3[2]);
  }
  // …and the raw one. project() is the SHEET-frame version, which is what a bead or a star
  // needs; the machine beat's labels hang off world anchors (the arm's column, the nano node)
  // that were never on the sheet at all, so they project straight.
  function projectWorld(x, y, z) {
    pjv.set(x, y, z).project(camera);
    return [(pjv.x * 0.5 + 0.5) * W, (0.5 - pjv.y * 0.5) * H];
  }

  // bilinear sample of the eased height field, so a bead sits IN its own dimple
  function heightAt(x, y) {
    const g = PHY.grid;
    let fx = (x - g.x0) / g.dx, fy = (y - g.y0) / g.dy;
    fx = fx < 0 ? 0 : fx > GW - 1.001 ? GW - 1.001 : fx;
    fy = fy < 0 ? 0 : fy > GH - 1.001 ? GH - 1.001 : fy;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, r = j * GW + i;
    const a = hgt[r], b = hgt[r + 1], c2 = hgt[r + GW], d2 = hgt[r + GW + 1];
    return (a + (b - a) * u) * (1 - v) + (c2 + (d2 - c2) * u) * v;
  }

  // ------------------------------------------------------------ beads
  const N = C.N;
  const idxMain = [], idxTrac = [];
  for (let i = 0; i < N; i++) (PHY.state.tracer[i] ? idxTrac : idxMain).push(i);
  const scl = new Float32Array(N);
  for (let i = 0; i < N; i++) scl[i] = 0.85 + Math.random() * 0.30;

  const beadGeo = new THREE.SphereGeometry(BEAD_R, Q.seg[0], Q.seg[1]);
  // transmission is capped (on black it transmits black) and carried by clearcoat + env:
  // sparkling droplets that catch the bloom, not matte marbles. The thinner wall at 0.72
  // reads as glass rather than resin — push transmission much past this and they go invisible.
  // LITE: transmission off. Three renders the ENTIRE scene a second time into a transmission
  // target for it, which is a phone's whole frame budget; a hair of alpha plus the clearcoat
  // and the env reflection keep the droplet read at one render pass.
  const glassMat = new THREE.MeshPhysicalMaterial({
    metalness: 0, roughness: 0.04,
    transmission: Q.glass ? 0.72 : 0, thickness: 2.5,
    transparent: !Q.glass, opacity: Q.glass ? 1 : 0.92,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    // …and without transmission the beads stop transmitting black, so the tier that lost it
    // takes the same brightness out of the albedo instead (transmission 0.72 replaces ~72% of
    // the diffuse with the black behind it) — otherwise the word blows into one white slab.
    ior: 1.45, color: Q.beadCol, envMapIntensity: Q.envI,
  });
  const tracMat = glassMat.clone();
  tracMat.color.set(0xffd9a0);

  const meshMain = new THREE.InstancedMesh(beadGeo, glassMat, idxMain.length);
  const meshTrac = new THREE.InstancedMesh(beadGeo, tracMat, idxTrac.length);
  for (const m of [meshMain, meshTrac]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
  }

  // --- render overrides owned by the board morph (see setMorph below). Physics keeps
  // stepping either way; these only change where a bead is DRAWN.
  let beadScale = 1;                                // released beads shrink to a dim gas
  let pulseOn = false;                              // >= stage 3: some beads ride the traces
  const pulseSlot = new Int32Array(N).fill(-1);     // bead index -> pulse slot, -1 = normal
  let pulsePos = new Float32Array(0);               // [x, y] per pulse, physics px

  const M4 = new THREE.Matrix4();
  function placeBeads(mesh, idx) {
    const { px, py, pz } = PHY.state;
    const cy0 = SHEET_Y * H, cx = W / 2, cy = H / 2;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const slot = pulseOn ? pulseSlot[i] : -1;
      let s = scl[i], x, y, n;
      if (slot >= 0) {
        // a signal pulse: pinned to its trace, riding just above the copper
        x = pulsePos[slot * 2]; y = pulsePos[slot * 2 + 1]; n = PULSE_N;
      } else {
        s *= beadScale;
        x = px[i]; y = py[i];
        // along n̂: rest on the local sheet height, lifted by the bead's own radius, plus
        // the thermal z bob. Beads therefore ride their own dimples and roll into the wells.
        // ride the wells only partially: full ride drags the glyph shape down with the
        // fabric and smears the word; 0.35 keeps the visual coupling without the warp
        n = heightAt(x, y) * 0.35 + BEAD_R * s + 0.5 * pz[i];
      }
      const u = (x - cx) * PLANE_S;             // along û
      const w = (cy - y) * PLANE_S;             // along ŵ (screen-y is inverted)
      let X = u, Y = cy0 + w * SINP + n * COSP, Z = -w * COSP + n * SINP;
      // a pulse belongs to the board, so it rides the board group's own transform (rest
      // offset, and the dock shrink of the band stage) — beads are drawn in scene space.
      if (slot >= 0) {
        const g = boardGrp.position, gs = boardGrp.scale.x;
        s *= gs; X = g.x + X * gs; Y = g.y + Y * gs; Z = g.z + Z * gs;
      }
      M4.makeScale(s, s, s);
      M4.setPosition(X, Y, Z);
      mesh.setMatrixAt(k, M4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ the laser (the cursor, made physical)
  // The optical trap is an instrument, not a glow: a beam falls straight down out of the
  // sky (world −Y, NOT the sheet normal — an external source reads as external) and where
  // it lands the sheet dips and the beads gather. Click = melt = the laser fires a heating
  // pulse, so the same `pulse` the physics heats with drives the flash.
  const LASER_ON = false;     // ponytail: parked — Bin 觉得有点太过. Flip to re-enable; tone down the three opacities below if it returns.
  const BEAM_W = 26;          // beam plane width [world]
  const BEAM_LEN = 1.6;       // beam length [·H]
  const GLOW_R = 70, CORE_R = 24;  // impact sprites [world]
  const BEAM_LIFT = 4;        // n̂ offset off the sheet, so the sprites never z-fight
  const PULSE_GAIN = 1.2;

  // one texture, both crossed planes: hairline core across, fades to nothing at the top
  function makeBeamTex() {
    const w = 64, h = 256, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);                                 // 0 top (sky) -> 1 bottom (sheet)
      const vp = Math.pow(v, 1.7) * (0.72 + 0.28 * v);       // out of nowhere, hottest at impact
      for (let x = 0; x < w; x++) {
        const u = Math.abs((x + 0.5) / w * 2 - 1);           // 0 centre -> 1 edge
        const core = Math.exp(-((u / 0.08) ** 2));           // ~8% hairline
        const halo = Math.exp(-((u / 0.42) ** 2)) * 0.42;
        const t = core / (core + halo + 1e-6), k = (y * w + x) * 4;
        d[k]     = 155 + (234 - 155) * t;                    // #9beff0 halo -> #eaffff core
        d[k + 1] = 239 + (255 - 239) * t;
        d[k + 2] = 240 + (255 - 240) * t;
        d[k + 3] = Math.min(255, (core + halo) * vp * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function makeGlowTex() {
    const s = 128, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(234,255,255,1)');
    g.addColorStop(0.22, 'rgba(155,239,240,0.55)');
    g.addColorStop(1, 'rgba(155,239,240,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const beamTex = makeBeamTex(), glowTex = makeGlowTex();
  const beamGeo = new THREE.PlaneGeometry(1, 1);   // unit plane, scaled in relayout (H changes)
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const coreMat = glowMat.clone();
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI / 2;                  // billboard-style cross about the beam axis
  const glowSp = new THREE.Sprite(glowMat), coreSp = new THREE.Sprite(coreMat);
  glowSp.scale.set(GLOW_R, GLOW_R, 1);
  coreSp.scale.set(CORE_R, CORE_R, 1);
  const laser = new THREE.Group();
  laser.add(beamA, beamB, glowSp, coreSp);
  laser.visible = false;                           // starts off; fades in on first pointer
  scene.add(laser);

  const lpos = new THREE.Vector3();
  let lvis = 0, ltime = 0;
  function updateLaser(dt) {
    if (!LASER_ON) return;    // group stays invisible; zero per-frame cost
    ltime += dt;
    // per-frame rates (0.25 glide, 0.15 fade at 60 fps) made dt-exact, so one big
    // advance(2) from the QA hook lands where two seconds of rAF frames would
    const glide = 1 - Math.pow(0.75, dt * 60), fade = 1 - Math.pow(0.85, dt * 60);
    const p = PHY.getPointer();
    if (p) {
      // same map as placeBeads, but riding the deforming well via heightAt()
      const u = (p.x - W / 2) * PLANE_S, w = (H / 2 - p.y) * PLANE_S;
      const n = heightAt(p.x, p.y) + BEAM_LIFT;
      lpos.set(u, SHEET_Y * H + w * SINP + n * COSP, -w * COSP + n * SINP);
      if (lvis < 0.01) laser.position.copy(lpos);   // don't sweep in from the last hit point
      else laser.position.lerp(lpos, glide);
    }
    lvis += ((p ? 1 : 0) - lvis) * fade;
    laser.visible = lvis > 0.003;
    if (!laser.visible) return;
    // idle flicker × pulse flash — PHY.getPulse() is the very heat the melt runs on
    const k = lvis * (0.92 + 0.08 * Math.sin(ltime * 37)) * (1 + PULSE_GAIN * PHY.getPulse());
    beamMat.opacity = Math.min(1, 0.55 * k);
    glowMat.opacity = Math.min(1, 0.50 * k);
    coreMat.opacity = Math.min(1, 0.85 * k);
  }

  // ------------------------------------------------------------ the board morph (chapter ③)
  // The sheet does not GROW a circuit board — its own grid lines REROUTE into one. Every
  // trace vertex is born on the nearest DRAWN lattice line (a row line for horizontal-ish
  // traces, a column line for vertical-ish ones, the closer of the two for diagonals) and
  // slides to its board coordinate. The slide is staggered left → right, so the fabric
  // un-weaves as a ripple across the sheet instead of snapping as one block.
  //
  // setMorph(t) is the whole API and it is a PURE FUNCTION of t — no wall-clock tweens, so
  // scrubbing backwards undoes every stage exactly. Stages:
  //   .00 → .25  release    λ handed to the morph (PHY.holdRelease) — beads free, sheet flattens
  //   .25 → .60  un-weave   fabric lines fade out as the trace layer slides off the lattice
  //   .60 → .85  crystallise solder mask · outline · pads · silkscreen · logo fade in
  //   .80 → .97  land       the photoreal board fades in UNDER the lines; mask fades out
  //   .85 → 1    pull back  camera dollies out ×DOLLY; the board reads as one object
  const BOARD_URL = './js/data/board-hswb.json';
  const LOGO_URL = 'image/logo-bin-mono.png';
  const BOARD_ROT = 90;      // knob: board rotation on the sheet [deg]. 90° = portrait board -> landscape frame
  const BOARD_W = 0.52;      // board width AFTER rotation, as a fraction of the viewport W
  const TRACE_N = 0.9;       // trace layer lift along n̂ [world]
  const FACE_N = 0.2;        // solder-mask quad, just under the copper
  const PHOTO_N = 0.1;       // photoreal board, just under the mask it replaces
  const PHOTO_MAX = 0.92;    // photo opacity at t = 1
  const LINE_DIM = 0.55;     // the line layers step back to this once the photo has landed
  const SILK_N = 1.4;        // silkscreen sits on top of the mask
  const PULSE_N = 2.4;       // signal pulses ride above the traces
  const SILK_F = 0.024;      // silkscreen cap height, as a fraction of the board height
  const LOGO_F = 0.11;       // logo sprite size, ditto
  const PULSE_SPEED = 90;    // px/s along a trace
  const N_PULSE = 50;
  const STAGGER = 0.18;      // per-trace slide duration, inside the .25 → .60 stage
  const DOLLY = 1.6;         // camera distance multiplier at t = 1
  const SILK_EVERY = 3;      // draw every Nth reference designator (23 -> 8)
  const BOARD_DX = 0.09;     // board group's rest x-offset [·W world] — clears the chapter card

  const ss = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const stg = (t, a, b) => ss((t - a) / (b - a));

  // physics px -> the tilted sheet, n along n̂. Same map as placeBeads, written into a buffer.
  function sheetXYZ(x, y, n, out, o) {
    const w = (H / 2 - y) * PLANE_S;
    out[o] = (x - W / 2) * PLANE_S;
    out[o + 1] = SHEET_Y * H + w * SINP + n * COSP;
    out[o + 2] = -w * COSP + n * SINP;
  }

  let board = null, boardBusy = false, boardFail = false;
  let morphT = 0, held = false, dolly = 1, dollyM = 1, exitT = 0;
  const bC = new Float32Array(3);   // board centre in world (group-local) coords — the dock anchor

  const boardGrp = new THREE.Group();
  boardGrp.visible = false;
  scene.add(boardGrp);

  const emptyPos = () => new THREE.BufferAttribute(new Float32Array(0), 3);
  const lineMat = c => new THREE.LineBasicMaterial({
    color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const traceGeo = new THREE.BufferGeometry(); traceGeo.setAttribute('position', emptyPos());
  const traceMat = lineMat(0xffffff);
  const traceLines = new THREE.LineSegments(traceGeo, traceMat);

  const outGeo = new THREE.BufferGeometry(); outGeo.setAttribute('position', emptyPos());
  const outMat = lineMat(0xdfeef0);
  const outline = new THREE.Line(outGeo, outMat);

  const padGeo = new THREE.BufferGeometry(); padGeo.setAttribute('position', emptyPos());
  const padMat = lineMat(0xffffff);
  const padLines = new THREE.LineSegments(padGeo, padMat);

  // solder mask: barely lighter than the void, but enough that the board reads as a SOLID
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  faceGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0, depthWrite: false });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.renderOrder = -1;                       // under the copper, over the (faded) fabric

  // the physical board, photographed. Its uv attribute is fixed; the four corners move in
  // buildBoardGeom so that the image's photo.rect sub-region lands ON the drawn outline.
  // Board y and rect v both run top-down (PIL), three.js uv v runs bottom-up (flipY default),
  // hence uv.v = 1 − v_rect: the two TOP corners (rect v = v0 side) get uv.v = 1.
  const photoGeo = new THREE.BufferGeometry();
  photoGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  photoGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  photoGeo.setIndex([0, 1, 2, 0, 2, 3]);
  // DoubleSide: the quad's winding flips with the BOARD_ROT knob, and a culled photo is a
  // silent failure — this is the one word that survives any rotation.
  const photoMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  const photoMesh = new THREE.Mesh(photoGeo, photoMat);
  photoMesh.renderOrder = -2;                  // under the mask (-1), which is under the copper
  photoMesh.visible = false;
  let photoPx = [0, 0];

  const silkGrp = new THREE.Group();
  for (const o of [photoMesh, face, traceLines, outline, padLines, silkGrp]) { o.frustumCulled = false; boardGrp.add(o); }

  // per-trace source/target endpoints in PHYSICS px: [ax, ay, bx, by]
  let NT = 0, srcRows = 0;
  let tSrc = new Float32Array(0), tTgt = new Float32Array(0);
  let tOrd = new Float32Array(0), tLen = new Float32Array(0), srcLine = new Int32Array(0);
  const pSeg = new Int32Array(N_PULSE), pS = new Float32Array(N_PULSE);

  // board unit square -> physics px. Board units are (aspect × 1), so the rotation knob is
  // an honest rotation and BOARD_W measures the box the viewer actually sees.
  const RAD = BOARD_ROT * Math.PI / 180, CR = Math.cos(RAD), SR = Math.sin(RAD);
  let bs = 1, bcx = 0, bcy = 0, bw = 0, bh = 0;
  const t1 = [0, 0], t2 = [0, 0], v3 = new Float32Array(3);
  function b2p(bx, by, out) {
    const X = (bx - 0.5) * board.aspect, Y = by - 0.5;
    out[0] = bcx + (X * CR - Y * SR) * bs;
    out[1] = bcy + (X * SR + Y * CR) * bs;
  }
  // a fraction of the ROTATED board box — for things placed against what the viewer sees
  function box2p(fx, fy, out) { out[0] = bcx + (fx - 0.5) * bw; out[1] = bcy + (fy - 0.5) * bh; }

  function textSprite(txt) {
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 32;
    const c = cv.getContext('2d');
    c.font = '600 21px ui-monospace, Menlo, monospace';
    c.fillStyle = '#e6f2f4'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, 48, 17);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    }));
  }

  function setBoard(j) {
    board = j;
    NT = j.traces.length;
    tSrc = new Float32Array(NT * 4); tTgt = new Float32Array(NT * 4);
    tOrd = new Float32Array(NT); tLen = new Float32Array(NT); srcLine = new Int32Array(NT);
    traceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 6), 3));
    traceGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    outGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(j.outline[0].length * 3), 3));
    // rect/roundrect pads draw as a rectangle (4 segments), round ones as a cross (2)
    let pv = 0;
    for (const p of j.pads) pv += p.shape === 'oval' || p.shape === 'circle' ? 4 : 8;
    padGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pv * 3), 3));

    // silkscreen: a sample of the reference designators, plus the JAKIE mark on the mask
    for (let i = 0; i < j.silk.length; i += SILK_EVERY) {
      const sp = textSprite(j.silk[i].text);
      sp.userData.b = [j.silk[i].x, j.silk[i].y];
      silkGrp.add(sp);
    }
    const tex = new THREE.TextureLoader().load(opts.logoUrl || LOGO_URL, undefined, undefined,
      () => console.warn('board morph: silkscreen logo missing —', opts.logoUrl || LOGO_URL));
    tex.colorSpace = THREE.SRGBColorSpace;
    const logo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    logo.userData.box = [0.5, 0.84];             // centre-bottom of what the viewer sees
    silkGrp.add(logo);

    if (j.photo) {
      const pt = new THREE.TextureLoader().load(j.photo.url, undefined, undefined,
        () => console.warn('board morph: board photo missing —', j.photo.url));
      pt.colorSpace = THREE.SRGBColorSpace;
      photoMat.map = pt; photoMat.needsUpdate = true;
    }

    buildBoardGeom();
    // pulses: the amber tracers first, then the lowest indices. Phase = a random start.
    const pick = [...idxTrac, ...idxMain].slice(0, N_PULSE);
    pulsePos = new Float32Array(pick.length * 2);
    pick.forEach((i, k) => {
      pulseSlot[i] = k;
      pSeg[k] = (Math.random() * NT) | 0;
      pS[k] = Math.random() * tLen[pSeg[k]];
    });
    advancePulses(0);
    updateMorph();
  }

  function loadBoard() {
    if (opts.board) { setBoard(opts.board); return; }
    boardBusy = true;
    fetch(opts.boardUrl || BOARD_URL)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(setBoard)
      .catch(e => {
        boardFail = true; boardBusy = false;   // fail soft: the morph still releases the field, just no board
        console.warn('board morph: no board data, morph limited to the field release —', e.message);
      });
  }

  // Everything that depends on W/H lives here, so a resize is just a rebuild.
  function buildBoardGeom() {
    const g = PHY.grid;
    bw = BOARD_W * W;
    bs = bw / (Math.abs(board.aspect * CR) + Math.abs(SR));
    bh = bs * (Math.abs(board.aspect * SR) + Math.abs(CR));
    bcx = W / 2; bcy = C.wordY * H;              // centred on the word band

    // nearest DRAWN lattice line. The fabric draws every Q.fabStride-th index (see the index
    // build above), so the snap is to a multiple of it.
    const st = Q.fabStride;
    const jMax = (GH - 1) - ((GH - 1) % st), iMax = (GW - 1) - ((GW - 1) % st);
    const rowJ = y => Math.max(0, Math.min(jMax, st * Math.round((y - g.y0) / g.dy / st)));
    const colI = x => Math.max(0, Math.min(iMax, st * Math.round((x - g.x0) / g.dx / st)));

    srcRows = 0;
    for (let k = 0; k < NT; k++) {
      const tr = board.traces[k], o = k * 4;
      b2p(tr.a[0], tr.a[1], t1); b2p(tr.b[0], tr.b[1], t2);
      tTgt[o] = t1[0]; tTgt[o + 1] = t1[1]; tTgt[o + 2] = t2[0]; tTgt[o + 3] = t2[1];
      const dx = Math.abs(t2[0] - t1[0]), dy = Math.abs(t2[1] - t1[1]);
      // 4 px floor: a sub-pixel stub must never stall a pulse walking it
      tLen[k] = Math.max(4, Math.hypot(dx, dy));
      const mx = (t1[0] + t2[0]) / 2, my = (t1[1] + t2[1]) / 2;
      const j = rowJ(my), i = colI(mx);
      const ry = g.y0 + j * g.dy, rx = g.x0 + i * g.dx;
      // horizontal-ish -> a piece of the nearest ROW line, vertical-ish -> nearest COLUMN,
      // diagonal -> whichever line it already sits closer to.
      const useRow = dy < 0.4 * dx ? true : dx < 0.4 * dy ? false
        : Math.abs(my - ry) <= Math.abs(mx - rx);
      if (useRow) {
        tSrc[o] = t1[0]; tSrc[o + 1] = ry; tSrc[o + 2] = t2[0]; tSrc[o + 3] = ry;
        srcLine[k] = j; srcRows++;
      } else {
        tSrc[o] = rx; tSrc[o + 1] = t1[1]; tSrc[o + 2] = rx; tSrc[o + 3] = t2[1];
        srcLine[k] = -1 - i;
      }
    }
    // stagger left -> right across the sheet: the reroute reads as a wave, not a cut
    const ord = [...Array(NT).keys()].sort((a, b) => (tTgt[a * 4] + tTgt[a * 4 + 2]) - (tTgt[b * 4] + tTgt[b * 4 + 2]));
    ord.forEach((k, r) => { tOrd[k] = NT > 1 ? r / (NT - 1) : 0; });

    const op = outGeo.attributes.position.array;
    board.outline[0].forEach((p, i) => { b2p(p[0], p[1], t1); sheetXYZ(t1[0], t1[1], TRACE_N, op, i * 3); });
    outGeo.attributes.position.needsUpdate = true;

    const pp = padGeo.attributes.position.array;
    let n = 0;
    const seg = (x1, y1, x2, y2) => {
      b2p(x1, y1, t1); sheetXYZ(t1[0], t1[1], TRACE_N, pp, n); n += 3;
      b2p(x2, y2, t2); sheetXYZ(t2[0], t2[1], TRACE_N, pp, n); n += 3;
    };
    for (const p of board.pads) {
      const hx = p.sx / 2, hy = p.sy / 2;
      if (p.shape === 'oval' || p.shape === 'circle') {
        seg(p.x - hx, p.y, p.x + hx, p.y); seg(p.x, p.y - hy, p.x, p.y + hy);
      } else {
        seg(p.x - hx, p.y - hy, p.x + hx, p.y - hy); seg(p.x + hx, p.y - hy, p.x + hx, p.y + hy);
        seg(p.x + hx, p.y + hy, p.x - hx, p.y + hy); seg(p.x - hx, p.y + hy, p.x - hx, p.y - hy);
      }
    }
    padGeo.attributes.position.needsUpdate = true;

    const fp = faceGeo.attributes.position.array;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach((c, i) => {
      b2p(c[0], c[1], t1); sheetXYZ(t1[0], t1[1], FACE_N, fp, i * 3);
    });
    faceGeo.attributes.position.needsUpdate = true;

    // photo.rect = the outline's sub-rectangle inside the image, and the board unit square
    // IS that rectangle — so image u maps to board x as bx = (u − u0)/du, likewise v → by.
    // The image corners are therefore bx ∈ [−u0/du, (1 − u0)/du] (span 1/du board-x units,
    // i.e. aspect·bs/du px) and by ∈ [−v0/dv, (1 − v0)/dv]. Corner order matches the uv
    // attribute above: top-left, top-right, bottom-right, bottom-left.
    if (board.photo) {
      const [u0, v0, u1, v1] = board.photo.rect, du = u1 - u0, dv = v1 - v0;
      const pq = photoGeo.attributes.position.array;
      [[-u0 / du, -v0 / dv], [(1 - u0) / du, -v0 / dv],
        [(1 - u0) / du, (1 - v0) / dv], [-u0 / du, (1 - v0) / dv]].forEach((c, i) => {
        b2p(c[0], c[1], t1); sheetXYZ(t1[0], t1[1], PHOTO_N, pq, i * 3);
      });
      photoGeo.attributes.position.needsUpdate = true;
      photoPx = [board.aspect * bs / du, bs / dv];   // image u/v extents, in physics px
    }

    sheetXYZ(bcx, bcy, TRACE_N, bC, 0);          // where the board sits before it docks

    const sh = SILK_F * bh * PLANE_S, ls = LOGO_F * bh * PLANE_S;
    for (const sp of silkGrp.children) {
      if (sp.userData.box) { box2p(sp.userData.box[0], sp.userData.box[1], t1); sp.scale.set(ls, ls, 1); }
      else { b2p(sp.userData.b[0], sp.userData.b[1], t1); sp.scale.set(sh * 3, sh, 1); }
      sheetXYZ(t1[0], t1[1], SILK_N, v3, 0);
      sp.position.set(v3[0], v3[1], v3[2]);
    }
  }

  // Pulses walk one segment at a time; at its end they respawn at a random segment start.
  // ponytail: no net graph — jumps between disconnected nets read as flowing signals anyway.
  // Upgrade path: sort segments into nets and walk them if the jumps ever look wrong.
  function advancePulses(dt) {
    const d = PULSE_SPEED * Math.min(dt, 0.25);   // a big advance() must not spin this loop
    for (let k = 0; k < N_PULSE; k++) {
      let s = pS[k] + d, seg = pSeg[k];
      while (s > tLen[seg]) { s -= tLen[seg]; seg = (Math.random() * NT) | 0; }
      pSeg[k] = seg; pS[k] = s;
      const o = seg * 4, u = s / tLen[seg];
      pulsePos[k * 2] = tTgt[o] + (tTgt[o + 2] - tTgt[o]) * u;
      pulsePos[k * 2 + 1] = tTgt[o + 1] + (tTgt[o + 3] - tTgt[o + 1]) * u;
    }
  }

  function updateMorph() {
    const t = morphT;
    // stage 1 — hand λ to the morph and keep it down for as long as the morph is running,
    // and for the whole journey on top of it: the constellation is PLANETS now, so the beads
    // never re-crystallise after the exit — they simply hand the stage over. λ comes back
    // only when the morph is scrubbed all the way out (the page retargets the fields there).
    const want = t > 0.002 || jourT > 0;
    if (want !== held) { held = want; PHY.holdRelease(want); }
    // the EXIT stage (see setExit) undoes the morph on top of it: `inv` is 1 while the
    // machine story is on screen and 0 once it has been handed back to the fabric.
    const inv = 1 - ss(exitT);
    // …and the journey takes it from there: the fabric AND the beads bow out multiplicatively
    // (a multiplier, so it composes with the exit's restore instead of fighting it).
    const jh = ss(jourT / 0.45 < 1 ? jourT / 0.45 : 1);
    beadScale = (1 - 0.55 * stg(t, 0.05, 0.5) * inv) * (1 - jh);
    dollyM = 1 + (DOLLY - 1) * stg(t, 0.85, 1);
    // …and the ALGO beat pulls the whole physical stage back to a ghost, so the card's
    // equation is the only thing left lit. It is a multiplier like `inv`, and the exit
    // restores it (see algoDim), so the three of them compose instead of fighting.
    const gd = algoDim();
    updateBand();                                 // -> updateArm(): the later beats extend this frame's camera + board transform

    if (!board) {                                 // fail-soft path still owes the journey its fade
      fabMat.opacity = 1 - jh;
      fabric.visible = fabMat.opacity > 0.004;
      pulseOn = false;
      return;
    }

    // stage 2 — the fabric hands its lines over to the copper
    const s2 = stg(t, 0.25, 0.6), s3 = stg(t, 0.6, 0.85), s4 = stg(t, 0.8, 0.97);
    // lines step back once the photo lands — and again as the board shrinks into the berth
    const dim = (1 - (1 - LINE_DIM) * s4) * (1 - DOCK_DIM * dockU());
    // …and the exit hands them BACK. A multiplier cannot lift an opacity the morph drove to
    // 0, so the fabric's own term is a lerp toward 1; every board layer is multiplicative.
    fabMat.opacity = (1 - s2 * inv) * (1 - jh);
    fabric.visible = fabMat.opacity > 0.004;

    traceMat.opacity = stg(t, 0.25, 0.36) * dim * inv * gd;
    boardGrp.visible = traceMat.opacity > 0.002;
    // only the 150-vertex-pair rewrite is skipped when the layer is invisible; every
    // opacity below still tracks t, so scrubbing back leaves no flag lying about its state
    if (boardGrp.visible) {
      const p = traceGeo.attributes.position.array, span = (0.6 - 0.25) - STAGGER;
      for (let k = 0; k < NT; k++) {
        const u = ss((t - (0.25 + span * tOrd[k])) / STAGGER), o = k * 4;
        sheetXYZ(tSrc[o] + (tTgt[o] - tSrc[o]) * u,
          tSrc[o + 1] + (tTgt[o + 1] - tSrc[o + 1]) * u, TRACE_N, p, k * 6);
        sheetXYZ(tSrc[o + 2] + (tTgt[o + 2] - tSrc[o + 2]) * u,
          tSrc[o + 3] + (tTgt[o + 3] - tSrc[o + 3]) * u, TRACE_N, p, k * 6 + 3);
      }
      traceGeo.attributes.position.needsUpdate = true;
    }

    // stage 3 — the board becomes an object
    // stage 4 — the blueprint lands on the real thing: the photo fades in under the copper,
    // the stand-in mask fades out from under it, and the lines step back to LINE_DIM.
    faceMat.opacity = 0.92 * s3 * (1 - s4) * inv * gd;
    outMat.opacity = 0.50 * s3 * dim * inv * gd;
    padMat.opacity = 0.45 * s3 * dim * inv * gd;
    photoMat.opacity = PHOTO_MAX * s4 * inv * gd;
    for (const sp of silkGrp.children) sp.material.opacity = (sp.userData.box ? 0.20 : 0.42) * s3 * inv * gd;
    const on = s3 * inv * gd > 0.004;
    outline.visible = padLines.visible = silkGrp.visible = on;
    face.visible = faceMat.opacity > 0.004;
    photoMesh.visible = !!board.photo && photoMat.opacity > 0.004;

    pulseOn = t >= 0.6 && exitT <= 0.5;           // past half the exit the beads are beads again
  }

  // t ∈ [0, 1], scrub-safe in both directions. The board JSON is fetched lazily on the
  // first t > 0 (or taken from opts.board); until it lands only stage 1 runs.
  function setMorph(t) {
    morphT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (morphT > 0 && !board && !boardBusy && !boardFail) loadBoard();
    updateMorph();
  }

  // ------------------------------------------------------------ solo staging (phone)
  // A 390 px column cannot hold the desktop composition — hand left, arm right, cluster below,
  // all at once — so under the CSS breakpoint the chapter stages ONE ACTOR AT A TIME: whoever
  // the beat is about takes the upper half of the frame alone (the cards are bottom sheets down
  // there) and everyone else steps back to a corner ghost. Every number here is a target the
  // beat LERPS toward as a pure function of t2, so a scrub back up plays it in reverse exactly
  // like the desktop composition does. Desktop reads none of it.
  const SOLO_W = 760;        // the CSS breakpoint, in the one other file that knows it
  const QPOS = {
    bandSpan: 0.90,          // the hand's fit, centred [·W world]
    bandY: 0.42,             // …and its height: the middle of the upper half [·H world]
    ghostX: -0.40, ghostY: 0.60,   // the upper-left corner it retreats to [·W, ·H world]
    ghostS: 0.40, ghostO: 0.30,    // …at 40% the size and 30% the opacity
    armH: 0.38, armSpan: 0.86,     // the arm's fit, alone [·H, ·W world]
    armY: 0.43, armZ: -0.05,       // …centred on the same upper half, just behind the sheet
    armAim: 0.34,                  // where the signal lands on it [·H world]
    armGhost: 0.30,                // …and how far it dims once the cluster takes over
    nanoX: 0, nanoY: 0.40, nanoZ: 0.28, nanoK: 2.2,   // the cluster: centred, nearer, ×2.2
    lift: 0.10,                    // the arcs' bow: a short chord needs a small one
  };
  let solo = false;          // W <= SOLO_W, resolved in relayout

  // ------------------------------------------------------------ SENSE (chapter ③, beat 2)
  // The board is not a bench object — it is a WRISTBAND controller, and this is where it goes
  // home. A hand + strap edge-ghost comes up right of centre and the board (the same board the
  // sheet just became) shrinks and glides into its berth on the wrist. The berth is authored in
  // the band's OWN normalised frame (band-edges.json `dock` — the HS_WB bbox out of the source
  // Blender scene), so it survives any re-export, re-scale or knob change here.
  // setBand(tb) is a pure function of tb, same contract as setMorph.
  const BAND_URL = './js/data/band-edges.bin';
  const BAND_META = './js/data/band-edges.json';
  const BAND_SPAN = 0.60;    // knob: the hand's longest extent [·H world]
  // the hand sits just left of centre now, so the machine it commands has the whole right
  // half to itself and the signal line has real distance to cross (see ARM_X / NANO_X).
  const BAND_X = -0.05;      // knob: band centre [·W world]
  const BAND_Y = 0.16;       // …its height — the look point [·H world]
  const BAND_Z = 0.05;       // …and depth, just in front of the sheet [·H world]
  // the source pose runs wrist(−z) → fingertips(+z); yaw 90° swings that to screen-right and
  // the (negative) pitch lifts the fingertips to the up-right diagonal the composition wants.
  const BAND_YAW = 90;       // knob: yaw [deg]
  const BAND_PITCH = -14;    // knob: pitch [deg]
  const BAND_OP = 0.42;      // final line opacity
  const DOCK_FIT = 1.0;      // knob: board size in the berth, 1 = exactly the dock's X extent
  const DOCK_DIM = 0.72;     // knob: how far the copper steps back once the board is on the wrist

  let bandGeo = null, bandV = null, bandBusy = false, bandFail = false, bandT = 0, algoT = 0;
  let dockLen = 0;                                  // the berth's long (x) extent, band units
  const bandDock = new THREE.Vector3();             // …and its centre, in the same frame
  const dockW = new THREE.Vector3();                // …projected to world by placeBand
  // NormalBlending like the arm: knuckles and strap stitching stack edges and additive lines
  // blow those spots out into white orbs
  const bandMat = new THREE.LineBasicMaterial({
    color: 0xcfe4e6, transparent: true, opacity: 0, blending: THREE.NormalBlending, depthWrite: false,
  });

  // the ALGO beat's ghost dim, and the exit's restore of it. One multiplier, three readers
  // (updateMorph, updateBand, updateArm), so no layer can drift out of step with the others.
  const algoDim = () => 1 - 0.75 * ss(algoT) * (1 - ss(exitT));

  // how far the board has travelled into the berth. Read by updateBand (the transform) and by
  // updateMorph (the copper steps back with it — 1115 additive trace segments squeezed into a
  // 40 px rectangle is a white blob, not a circuit; the photo carries the board from here).
  const dockU = () => (bandV ? stg(bandT, 0.2, 0.85) : 0);

  // fit from the geometry's own bounds, same as placeArm
  let bandS = 1;
  function placeBand() {
    if (!bandV) return;
    const bb = bandGeo.boundingBox, d = bb.max.clone().sub(bb.min);
    bandS = (solo ? QPOS.bandSpan * W : BAND_SPAN * H) / Math.max(d.x, d.y, d.z);
    // YXZ, so the pitch tilts the hand along its OWN length and the yaw then swings it right
    bandV.rotation.set(BAND_PITCH * Math.PI / 180, BAND_YAW * Math.PI / 180, 0, 'YXZ');
    poseBand();
  }

  // where the hand STANDS. Fixed on the desktop; on the phone it starts centred on the upper
  // half and retreats to the corner ghost across the first half of the arm beat, so the arm
  // gets the frame to itself. Pure function of armT — and since the berth is re-derived here,
  // the board that docked into it rides along instead of being left behind.
  function poseBand() {
    const g = solo ? stg(armT, 0, 0.5) : 0;
    bandV.scale.setScalar(bandS * (1 + (QPOS.ghostS - 1) * g));
    if (solo) bandV.position.set(QPOS.ghostX * W * g,
      (QPOS.bandY + (QPOS.ghostY - QPOS.bandY) * g) * H, BAND_Z * H);
    else bandV.position.set(BAND_X * W, BAND_Y * H, BAND_Z * H);
    bandV.updateMatrixWorld();
    dockW.copy(bandDock).applyMatrix4(bandV.matrixWorld);
    return g;
  }

  // the board scale that puts its long axis exactly across the berth. Derived, not a constant:
  // bw/bh are rebuilt on every resize and the band's own fit scales with H.
  function dockScale() {
    const long = Math.max(bw, bh) * PLANE_S;
    return bandV && long > 0 ? DOCK_FIT * dockLen * bandV.scale.x / long : 1;
  }

  function loadBand() {
    bandBusy = true;
    Promise.all([
      fetch(opts.bandUrl || BAND_URL).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)))),
      fetch(opts.bandMetaUrl || BAND_META).then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))),
    ])
      .then(([buf, meta]) => {
        const d = meta && meta.dock;
        if (!d) throw new Error('band-edges.json has no dock box');
        bandGeo = new THREE.BufferGeometry();
        bandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3));
        bandGeo.computeBoundingBox();
        bandV = new THREE.LineSegments(bandGeo, bandMat);
        bandV.frustumCulled = false;                // authored positions, stale bounds
        scene.add(bandV);
        bandDock.set((d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2);
        dockLen = d.max[0] - d.min[0];
        bandBusy = false;
        placeBand(); updateBand();
      })
      .catch(e => {
        bandFail = true; bandBusy = false;          // fail soft: no hand, and the board simply
        console.warn('band stage: no wristband data —', e.message);   // stays where the morph left it
      });
  }

  function updateBand() {
    const t = bandT, inv = 1 - ss(exitT);
    const g = bandV ? poseBand() : 0;             // …and on the phone, its retreat to the corner
    bandMat.opacity = BAND_OP * stg(t, 0, 0.4) * inv * algoDim() * (1 + (QPOS.ghostO - 1) * g);
    if (bandV) bandV.visible = bandMat.opacity > 0.004;
    // the board shrinks and glides until its centre sits in the berth on the wrist. Same idiom
    // the arm used to own — and the ONLY place the board's group transform is written now, so
    // the arm beat cannot pull it away again.
    const u = dockU(), x0 = BOARD_DX * W;
    const sc = 1 + (dockScale() - 1) * u;
    boardGrp.scale.setScalar(sc);
    boardGrp.position.set(
      x0 + (dockW.x - sc * bC[0] - x0) * u,
      (dockW.y - sc * bC[1]) * u,
      (dockW.z - sc * bC[2]) * u,
    );
    updateArm();
  }

  // tb ∈ [0, 1], scrub-safe both ways. The edge dump + its dock box are fetched on the first tb > 0.
  function setBand(t) {
    bandT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (bandT > 0 && !bandV && !bandBusy && !bandFail) loadBand();
    updateBand();
  }

  // ta ∈ [0, 1]. The LEARN beat has no geometry of its own — it dims everything that HAS
  // geometry, so the card's PID → π_θ line is the last thing lit on the screen.
  function setAlgo(t) {
    algoT = t > 0 ? (t < 1 ? t : 1) : 0;
    updateMorph();               // the dim is a multiplier on every layer: re-derive the chain
  }

  // ------------------------------------------------------------ ACT (chapter ③, beat 3)
  // The band commands a machine. The arm is a raw edge dump (Float32 line segments, height-
  // normalised, centred) drawn in the same voice as the band — a schematic of a real machine,
  // not a render — and it sits further right and further back, BEHIND the hand that drives it.
  // The board does NOT come here: it is already on the wrist. What travels is the SIGNAL — and
  // it travels to TWO places. The hand does not just drive an arm; it steers the e-tweezers
  // nano stage as well, so the beat is a fan-out: one source, two scales, both in preparation.
  // setArm(t2) is a pure function of t2, same contract as setMorph.
  const ARM_URL = './js/data/arm-edges.bin';
  const ARM_H = 0.85;        // arm height cap [·H world]
  // …and a footprint cap: this SCARA reaches 2.5× further than it is tall, so height alone
  // would put half the machine outside the frustum (and its near links in the camera's lap).
  const ARM_SPAN = 0.55;     // knob: max horizontal extent [·W world]
  const ARM_X = 0.42;        // arm base, right of centre — clear of the band [·W world]
  const ARM_Y = 0.0;         // arm base height — sheet level [·H world]
  const ARM_Z = -0.30;       // arm base, behind the sheet and behind the band [·H world]
  const ARM_YAW = -25;       // knob: yaw [deg], so the profile reads instead of the front face
  // knob: stand it up. The dump's header claims "y-up", but the geometry says otherwise — its
  // x–y plane is the SCARA's PLAN view (both drive pulleys, the belt, the elbow and the wrist
  // all lie in it) and a plan view is HORIZONTAL. The machine's own up is therefore +z, which
  // the slice census confirms: a two-footed stance at low z, the arm beam and pulley stack
  // above it. −90° about X swings model +z onto world +y (world z picks up −model y), so the
  // rotated box measures TALL in y — which is exactly what the fit below wants.
  const ARM_ROT = -90;       // knob: roll about the arm's own X [deg]
  const ARM_OP = 0.38;       // final line opacity
  const DOLLY2 = 2.05;       // camera distance multiplier at t2 = 1 (extends DOLLY)
  const LOOK_DRIFT = 0.35;   // look-at drift toward the arm, as a fraction of its x

  // the intent stream, made visible — and it FANS OUT: one hand, many scales. Two accent
  // polylines leave the same berth on the wrist, one to the machine it commands (the SCARA,
  // the next paper) and one down to the nano stage it steers (e-tweezers, in preparation).
  // Both DRAW IN with t2 (setDrawRange, so a line grows a vertex at a time instead of fading
  // in as a whole) — the causal arrows of the chapter, out of a single source.
  const SIG_N = 40;          // points on each arc
  const SIG_LIFT = 0.16;     // the arm arc's bow, up and toward the camera [·H world].
                             // 0.13 -> 0.16: BAND_X/ARM_X now span ~0.47W, and a longer chord
                             // under the old bow reads as a slack cable instead of an arc.
  const SIG_TO_Y = 0.22;     // knob: aim above the arm's base, so it lands on the column [·H]
  const SIG_OP = 0.55;
  const NANO_LIFT = 0.09;    // the nano arc's bow — a shorter, flatter hop [·H world]
  // the nano end of the fan-out, drawn as what it actually is: a dozen particles held in a
  // field. A Points cloud, not a dozen sprites — one draw call, and it reuses the laser's own
  // glow texture, so the whole node costs zero network and one material.
  const NANO_X = 0.30, NANO_Y = -0.14, NANO_Z = 0.28;   // knobs: node centre [·W, ·H, ·H world]
  const NANO_N = 12;         // dots in the cluster
  const NANO_R = 0.045;      // …its radius [·H world]
  const NANO_PT = 0.030;     // …and a dot's own size [·H world]

  function mkSignal() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIG_N * 3), 3));
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.LineBasicMaterial({
      color: 0x8de9ec, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const l = new THREE.Line(g, m);
    l.frustumCulled = false;
    l.visible = false;
    scene.add(l);
    return { g, m, l };
  }
  const sigArm = mkSignal(), sigNano = mkSignal();
  let sigDrawn = 0;

  const nanoGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(NANO_N * 3);
    for (let i = 0; i < NANO_N; i++) {   // uniform inside a unit ball, scaled by NANO_R below
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.cbrt(Math.random()), s = Math.sqrt(1 - u * u);
      p[i * 3] = r * s * Math.cos(th); p[i * 3 + 1] = r * u; p[i * 3 + 2] = r * s * Math.sin(th);
    }
    nanoGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const nanoMat = new THREE.PointsMaterial({
    map: glowTex, color: 0x8de9ec, size: 1, sizeAttenuation: true,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const nano = new THREE.Points(nanoGeo, nanoMat);
  nano.frustumCulled = false;
  nano.visible = false;
  scene.add(nano);
  // same split as the stars: updateSignal writes the BASE opacity/size here and drawFrame
  // breathes them, so the pure function of t2 and the clock can never fight over one property.
  let nanoO = 0, nanoT = 0, nanoPt = 1;

  let armGeo = null, arm = null, armBusy = false, armFail = false, armT = 0;
  // NormalBlending, not additive: pulley teeth stack thousands of edges in one spot and
  // additive lines blow out into white orbs there — normal blending caps at the line color
  const armMat = new THREE.LineBasicMaterial({
    color: 0xcfe4e6, transparent: true, opacity: 0, blending: THREE.NormalBlending, depthWrite: false,
  });

  // fit from the geometry's own bounds, so a re-exported arm needs no new numbers here — but
  // from the bounds it has AFTER the rotation, not before: ARM_ROT stands the machine up, which
  // swaps which axis is the tall one, and fitting the un-rotated box would cap the wrong extent
  // and sink the base below ARM_Y. YXZ order, same as the band: roll it upright about its own
  // X first, then yaw the standing machine — 'XYZ' would apply the yaw first and tip it back over.
  const armRotM = new THREE.Matrix4();
  const armBox = new THREE.Box3(), armDim = new THREE.Vector3();
  function placeArm() {
    if (!arm) return;
    arm.rotation.set(ARM_ROT * Math.PI / 180, ARM_YAW * Math.PI / 180, 0, 'YXZ');
    armRotM.makeRotationFromEuler(arm.rotation);
    armBox.copy(armGeo.boundingBox).applyMatrix4(armRotM);   // the box the viewer actually sees
    armBox.getSize(armDim);
    const s = solo
      ? Math.min(QPOS.armH * H / armDim.y, QPOS.armSpan * W / Math.max(armDim.x, armDim.z))
      : Math.min(ARM_H * H / armDim.y, ARM_SPAN * W / Math.max(armDim.x, armDim.z));
    arm.scale.setScalar(s);
    // desktop: the base lands on ARM_Y, right of centre. phone: the machine is the only thing
    // on screen, so it is its MIDDLE that gets placed — dead centre of the upper half.
    if (solo) {
      arm.position.set(-(armBox.min.x + armDim.x / 2) * s,
        QPOS.armY * H - (armBox.min.y + armDim.y / 2) * s, QPOS.armZ * H);
    } else arm.position.set(ARM_X * W, ARM_Y * H - armBox.min.y * s, ARM_Z * H);
  }

  function loadArm() {
    armBusy = true;
    fetch(opts.armUrl || ARM_URL)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(b => {
        armGeo = new THREE.BufferGeometry();
        armGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b), 3));
        armGeo.computeBoundingBox();
        arm = new THREE.LineSegments(armGeo, armMat);
        arm.frustumCulled = false;                // authored positions, stale bounds
        scene.add(arm);
        armBusy = false;
        placeArm(); updateArm();
      })
      .catch(e => {
        armFail = true; armBusy = false;          // fail soft: the band still gets its board, just no machine
        console.warn('arm stage: no edge data —', e.message);
      });
  }

  function updateArm() {
    const t = armT, a = ss(t), inv = 1 - ss(exitT), gd = algoDim();
    // the exit walks the whole camera move back to 1×: the constellation has to read on the
    // sheet at hero framing, and the DOM labels project against this same camera.
    // …and the finale pulls the whole thing far back on top of that (chapter ⑤)
    // The phone keeps the framing it fitted its solo actor to: no second pull-back, and no
    // look drift toward an arm that is already dead centre.
    const d2 = solo ? DOLLY : DOLLY2;
    dolly = (1 + (dollyM + (d2 - DOLLY) * a - 1) * inv) * (1 + (FIN_DOLLY - 1) * ss(finT));
    look.x = solo ? 0 : ARM_X * W * LOOK_DRIFT * a * inv;
    const nu = solo ? stg(t, 0.5, 0.85) : 0;   // the beat's second half: the cluster's turn
    armMat.opacity = ARM_OP * stg(t, 0, 0.5) * inv * gd * (1 - (1 - QPOS.armGhost) * nu);
    if (arm) arm.visible = armMat.opacity > 0.004;
    updateSignal(t, inv * gd, nu);
    updateJourney();          // the planets and the ring are placed against this frame's dolly
  }

  // one arc, berth -> anywhere. Both endpoints come from the knobs (dockW is derived from
  // BAND_*, the targets from ARM_*/NANO_*), so moving a knob moves the line with it.
  function arcTo(sig, tx, ty, tz, lift, n) {
    const p = sig.g.attributes.position.array;
    for (let i = 0; i < SIG_N; i++) {
      const u = i / (SIG_N - 1), b = Math.sin(Math.PI * u) * lift;
      p[i * 3] = dockW.x + (tx - dockW.x) * u;
      p[i * 3 + 1] = dockW.y + (ty - dockW.y) * u + b;
      p[i * 3 + 2] = dockW.z + (tz - dockW.z) * u + b * 0.4;
    }
    sig.g.attributes.position.needsUpdate = true;
    sig.g.setDrawRange(0, n);
  }

  // the band commands the arm — so THAT line only exists when both ends do. Missing either bin
  // is a fail-soft: the beat still plays, just without its arrow. The nano line needs only the
  // hand, because its far end is procedural — one hand, many scales, and the smaller scale is
  // the one that never depended on an export.
  // …and on the phone it is not a fan-out at all but a RELAY: one line per half of the beat,
  // out of the same (now cornered) berth — first to the arm, then to the cluster that takes
  // its place. Same pure-function-of-t2 contract either way.
  function updateSignal(t, k, nu) {
    const dim = 1 - (1 - QPOS.armGhost) * nu;
    const draw = Math.round(SIG_N * ss(t / 0.85 < 1 ? t / 0.85 : 1));
    const drawA = solo ? Math.round(SIG_N * stg(t, 0.02, 0.45)) : draw;
    const drawN = solo ? Math.round(SIG_N * stg(t, 0.5, 0.9)) : draw;
    const o = SIG_OP * stg(t, 0.05, 0.35) * k;
    const A = armAnchor(), P = nanoAt(), lift = (solo ? QPOS.lift : SIG_LIFT) * H;

    sigDrawn = bandV && arm ? drawA : 0;
    sigArm.m.opacity = bandV && arm ? o * dim : 0;
    sigArm.l.visible = sigDrawn > 1 && sigArm.m.opacity > 0.004;
    if (sigArm.l.visible) arcTo(sigArm, A[0], A[1], A[2], lift, sigDrawn);

    const n2 = bandV ? drawN : 0;
    // the thinner of the two: a hint, not a cable — and on the phone it waits its turn
    sigNano.m.opacity = bandV ? (solo ? SIG_OP * stg(t, 0.5, 0.7) * k : o) * 0.85 : 0;
    sigNano.l.visible = n2 > 1 && sigNano.m.opacity > 0.004;
    if (sigNano.l.visible) arcTo(sigNano, P[0], P[1], P[2], (solo ? QPOS.lift : NANO_LIFT) * H, n2);

    nanoO = bandV ? (solo ? stg(t, 0.5, 0.8) : stg(t, 0.15, 0.6)) * k : 0;
    nanoMat.opacity = nanoO;                     // drawFrame breathes this while it is visible
    nano.visible = nanoO > 0.004;
  }

  // the two far ends of the fan-out, in WORLD — so the page's projected labels ride the knobs
  // instead of a copy of them, and follow every resize for free. `arm` is null until its bin
  // lands, the same gate updateSignal puts on the arm's line: a label naming a machine that is
  // not on screen is worse than no label, and this way the two can never disagree.
  // …which is why both ends are read from ONE pair of functions: the arcs, the labels and the
  // cluster's own placement all ask these, so no staging can move a machine and leave its
  // label (or its wire) on the desktop mark.
  const armAnchor = () => (solo
    ? [0, QPOS.armAim * H, QPOS.armZ * H]
    : [ARM_X * W, (ARM_Y + SIG_TO_Y) * H, ARM_Z * H]);
  const nanoAt = () => (solo
    ? [QPOS.nanoX * W, QPOS.nanoY * H, QPOS.nanoZ * H]
    : [NANO_X * W, NANO_Y * H, NANO_Z * H]);
  const anchors = () => ({ arm: arm ? armAnchor() : null, nano: nanoAt() });

  // t2 ∈ [0, 1], scrub-safe both ways. The edge dump is fetched lazily on the first t2 > 0.
  // updateBand, not updateArm: on the phone the hand's own pose (and the board docked to it)
  // is a function of t2 as well, and updateBand is what re-derives the berth.
  function setArm(t) {
    armT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (armT > 0 && !arm && !armBusy && !armFail) loadArm();
    updateBand();
  }

  // ------------------------------------------------------------ the exit (chapter ③ → ④)
  // The machine story closes and the beads come home. setExit(t3) does not undo the beats
  // underneath it — morphT/bandT/armT/algoT all stay pinned at 1 — it runs ON TOP of them,
  // fading the board, the hand, the arm, the signal line and the pulses out, LIFTING the algo
  // beat's ghost dim back off (see algoDim), growing the beads back to full size, handing the
  // fabric its opacity back and dollying the camera home. Pure function of t3, so scrubbing
  // back up re-lights the finale exactly as it was.
  function setExit(t) {
    exitT = t > 0 ? (t < 1 ? t : 1) : 0;
    updateMorph();               // -> updateArm(): every opacity and the camera are re-derived
  }

  // ------------------------------------------------------------ chapter ④ — Polaris
  // The constellation is not a bead swarm any more: one node = one STAR — a diffraction-spike
  // sprite, the way a real telescope draws a bright point. Thin lines wire them together like
  // the Big Dipper, and UT Austin is the Polaris of the chart: the brightest magnitude.
  //
  //   setJourney(t4)  .00 → .45  OVERVIEW: stars come up (staggered), the lines draw
  //                              themselves, the fabric and the beads hand the stage over.
  //                   .45 → 1    ZOOM: the star map converges on ONE star — it swells to
  //                              ~0.5H of SCREEN height, spikes and all, and glides to a
  //                              left-of-centre anchor (the detail card owns the right);
  //                              the rest recede, dim and unwire.
  //   setPlanet(i)    switches while zoomed. focusF *eases* toward i, so the view cruises
  //                   along the constellation line star-to-star instead of cutting.
  //   setFinale(t5)   camera pulls far back, the stars unwind and shrink to points drifting
  //                   up-right, and one orbit ring comes up around the contact block.
  //
  // Same contract as setMorph/setArm/setExit: pure functions of (t4, focusF, t5), so scrubbing
  // back undoes every stage exactly. The one non-pure thing is the breathing twinkle, which
  // lives in drawFrame off its own clock (and therefore shows up under advance() too).
  //   [name, x·W, y·H, n̂ offset ·H (depth stagger), magnitude]
  // TWO primaries — the two degrees. One line between them.
  const PLANETS = [
    ['USTC',      0.30, 0.50,  0.04, 1],
    ['UT AUSTIN', 0.72, 0.32, -0.03, 1.5],   // Polaris
  ];
  // …and the two stops that were never a chapter of their own — a summer and an internship.
  // They are SATELLITES of the school they hung off: the same star texture at a third the
  // size, in a slow circle around USTC, in the sheet's own plane (û / ŵ), opposite phases.
  // Their orbit is the only other clock in the chapter (see drawFrame) — everything else
  // here is a pure function of t4.  [label, parent index, phase]
  const SATS = [
    ["BERKELEY '19", 0, 0],
    ["BROWN '20", 0, Math.PI],
  ];
  const SAT_S = 0.35;        // satellite size, as a fraction of its parent's drawn size
  const SAT_R = 46;          // orbit radius at the overview [sheet px]
  const SAT_ZOOM = 7.0;      // …× that, once the parent is THE zoomed star (it grows ~9×)
  const SAT_R_MAX = 0.17;    // …but never further out than this [·W world]: on a phone the
                             // zoomed star is taller than the frame is WIDE, and an orbit
                             // scaled to the star would swing its satellites off the screen
  const SAT_HZ = 0.10;       // rad/s — a drift, not a spin
  // Both sizes are fractions of the SCREEN height, solved against each star's own distance —
  // a star has no true size, only a magnitude, so distance must not shrink it.
  const PL_BASE = 0.055;      // overview star size (spikes included)
  const PL_ZOOM_H = 0.5;      // …and the focused one, zoomed
  const PL_ANCHOR_X = -0.16;  // …parked left of centre [·W world]
  const PL_DIM = 0.25;        // unfocused stars' opacity multiplier once zoomed
  const PL_SHRINK = 0.8;      // …and their scale multiplier
  const PL_TW_HZ = 0.4;       // breathing twinkle: rate, and its scale / opacity swing
  const PL_TW_S = 0.05, PL_TW_O = 0.04;
  const FIN_DOLLY = 2.4;      // camera distance multiplier at t5 = 1
  const RING_R = 0.42;        // orbit ring semi-major axis [·H world], scaled with the dolly
  const RING_RY = 0.66;       // …minor/major axis: an ellipse, so its slow spin is visible
  const RING_TILT = 18 * Math.PI / 180;
  const RING_SPIN = 0.06;     // rad/s

  let planets = null, sats = null, jourT = 0, finT = 0, planetIdx = 0, focusF = 0, starT = 0;
  const starS = new Float32Array(PLANETS.length);   // per-star base scale / opacity, written by
  const starO = new Float32Array(PLANETS.length);   // updateJourney, twinkled in drawFrame
  const starK = new Float32Array(PLANETS.length);   // …and how zoomed-in on it we are (0…1)
  // the satellites' bases, same split: updateJourney writes where the parent IS and how big
  // the orbit is, drawFrame turns the clock into a position (and records it in satW, which is
  // what the page's two tiny labels project against).
  const satP = new Float32Array(SATS.length * 3), satW = new Float32Array(SATS.length * 3);
  const satR = new Float32Array(SATS.length), satS = new Float32Array(SATS.length);
  const satO = new Float32Array(SATS.length);
  const journeyGrp = new THREE.Group();
  journeyGrp.visible = false;
  scene.add(journeyGrp);

  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PLANETS.length - 1) * 6), 3));
  linkGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const linkMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  links.frustumCulled = false;
  journeyGrp.add(links);

  // The outro's one flourish. It is pinned to the LOOK point and scaled with the dolly, so it
  // stays a constant halo around the (screen-centred) contact block while the camera pulls
  // away from everything else — a world-fixed ring would just shrink out of the composition.
  const ringMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ringGeo = new THREE.BufferGeometry();
  {
    const n = 160, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      p[i * 3] = Math.cos(a); p[i * 3 + 1] = RING_RY * Math.sin(a);
    }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const ring = new THREE.LineLoop(ringGeo, ringMat);
  ring.rotation.x = RING_TILT;
  ring.frustumCulled = false;
  ring.visible = false;
  scene.add(ring);

  // One canvas texture for every star, satellites included — same idiom as makeBeamTex and
  // makeGlowTex, so the chapter costs zero network. A telescope's star: gaussian core, two long thin
  // spikes on the axes, two shorter fainter ones at 45°, and a soft halo holding it together.
  // S = 512, not 256: the focused star fills half the screen, and at 256 the spikes turn to
  // mush there. One texture at 512 is cheaper (and one less crossfade) than two at 256.
  const STAR_S = 512;
  function makeStarTex() {
    const S = STAR_S, c = (S - 1) / 2, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    const core = 0.016 * S;          // core σ
    const sw = 2 / 256 * S;          // spike width σ — the brief's 2px, held at any S
    const len = 0.40 * S;            // long spike falloff σ: reaches the rim
    const dlen = 0.40 * len;         // 45° spikes: 40% of the length…
    const dgain = 0.45;              // …and fainter
    const halo = 0.13 * S;
    const R2 = 0.7071067811865476;   // 1/√2, for the 45° rotation
    const e = (a, s) => Math.exp(-(a * a) / (s * s));
    // the long spikes run all the way to the rim, where a plain gaussian is still at ~21%
    // and gets CUT — a blunt rectangular tip, glaring once the focused star fills half the
    // screen. Shift and renormalise so the falloff reaches exactly 0 at the rim instead.
    const E = e(0.5 * S, len), EN = 1 / (1 - E);
    const el = a => { const q = (e(a, len) - E) * EN; return q > 0 ? q : 0; };
    for (let y = 0; y < S; y++) {
      const dy = y - c;
      for (let x = 0; x < S; x++) {
        const dx = x - c;
        const u = (dx + dy) * R2, v = (dx - dy) * R2;
        let i = e(Math.hypot(dx, dy), core)                        // core
              + e(dx, sw) * el(dy) + e(dy, sw) * el(dx)            // + and × spikes…
              + dgain * (e(u, sw) * e(v, dlen) + e(v, sw) * e(u, dlen))
              + 0.16 * e(Math.hypot(dx, dy), halo);                // halo
        if (i > 1) i = 1;
        // ice at the faint edges, near-white in the hot middle — the site's one accent
        const k = (y * S + x) * 4;
        d[k]     = 155 + (234 - 155) * i;
        d[k + 1] = 239 + (255 - 239) * i;
        d[k + 2] = 240 + (255 - 240) * i;
        d[k + 3] = Math.round(i * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  let starTex = null;
  function buildPlanets() {
    if (planets) return;
    starTex = makeStarTex();
    const mk = name => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: starTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sp.name = name;
      journeyGrp.add(sp);
      return sp;
    };
    planets = PLANETS.map(([name]) => mk(name));
    sats = SATS.map(([name]) => mk(name));   // same texture, same group — just smaller
    updateJourney();
  }

  const jp = new THREE.Vector3(), ja = new THREE.Vector3();
  const jxyz = new Float32Array(3);

  function updateJourney() {
    const t = jourT, fin = ss(finT);
    ringMat.opacity = 0.18 * fin;
    ring.visible = ringMat.opacity > 0.004;
    if (ring.visible) {
      ring.position.set(look.x, look.y, 0);
      ring.scale.set(RING_R * H * dolly, RING_R * H * dolly, 1);
    }
    if (!planets) { journeyGrp.visible = false; return; }

    const zoom = stg(t, 0.45, 1);
    const camY = look.y + (baseY - look.y) * dolly, camD = camZ * dolly;
    const lp = linkGeo.attributes.position.array;
    for (let i = 0; i < planets.length; i++) {
      const [, fx, fy, nOff, mag] = PLANETS[i];
      const born = stg(t, i * 0.07, i * 0.07 + 0.24);        // staggered forming
      // 1 on the focused star, ramping to 0 one node away: a fractional focusF therefore
      // has TWO stars half-grown and half-anchored — that is the cruise between them.
      const foc = Math.max(0, 1 - Math.abs(i - focusF));
      const k = zoom * foc * (1 - fin), away = zoom * (1 - foc) * (1 - fin);

      sheetXYZ(fx * W, fy * H, nOff * H, jxyz, 0);
      jp.set(jxyz[0], jxyz[1], jxyz[2]);
      ja.set(PL_ANCHOR_X * W, jxyz[1], jxyz[2]);             // its own sheet-frame height
      jp.lerp(ja, k);
      jp.x += 0.30 * W * fin; jp.y += 0.26 * H * fin;        // the finale flings them up-right

      // the frustum height in world units AT THIS STAR — both sizes below are fractions of
      // the screen, so a star reads by magnitude alone on any viewport and at any dolly
      const d = Math.hypot(jp.x, jp.y - camY, jp.z - camD);
      const sh = 2 * d * Math.tan(FOV * Math.PI / 360);
      const rZoom = PL_ZOOM_H * sh;
      const rBase = PL_BASE * sh * mag * born * (1 - (1 - PL_SHRINK) * away);
      const r = (rBase + (rZoom - rBase) * k) * (1 - 0.80 * fin);

      planets[i].position.copy(jp);
      starS[i] = r > 1e-4 ? r : 1e-4;
      starO[i] = born * (1 - (1 - PL_DIM) * away) * (1 - 0.45 * fin);
      starK[i] = k;
      planets[i].visible = starO[i] > 0.004;

      if (i > 0) { const o = (i - 1) * 6; lp[o + 3] = jp.x; lp[o + 4] = jp.y; lp[o + 5] = jp.z; }
      if (i < planets.length - 1) { const o = i * 6; lp[o] = jp.x; lp[o + 1] = jp.y; lp[o + 2] = jp.z; }
    }
    // the satellites hang off whatever their parent ended up doing — the zoom's glide to the
    // anchor, the unfocused shrink and the finale's fling are all already in these numbers,
    // so they follow their school through every one of them for free.
    for (let i = 0; i < SATS.length; i++) {
      const p = SATS[i][1], o = i * 3;
      satP[o] = planets[p].position.x; satP[o + 1] = planets[p].position.y; satP[o + 2] = planets[p].position.z;
      satR[i] = Math.min(SAT_R * PLANE_S * (1 + (SAT_ZOOM - 1) * starK[p]), SAT_R_MAX * W);
      satS[i] = SAT_S * starS[p];
      satO[i] = starO[p];
    }
    linkGeo.attributes.position.needsUpdate = true;
    linkMat.opacity = 0.45 * stg(t, 0.18, 0.45) * (1 - 0.75 * zoom) * (1 - fin);
    links.visible = linkMat.opacity > 0.004;
    journeyGrp.visible = t > 0.001;
  }

  // t4 ∈ [0, 1], scrub-safe. The star texture is built lazily on the first t4 > 0.
  function setJourney(t) {
    jourT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (jourT > 0) buildPlanets();
    updateMorph();               // -> updateArm() -> updateJourney(): fabric, beads, planets
  }

  // which planet the zoom is on. focusF eases toward it in the rAF loop (snapped in advance).
  function setPlanet(i) {
    i = Math.round(+i) || 0;
    planetIdx = i < 0 ? 0 : i > PLANETS.length - 1 ? PLANETS.length - 1 : i;
  }

  // t5 ∈ [0, 1], scrub-safe. Runs ON TOP of t4 = 1, the same way the exit runs on the morph.
  function setFinale(t) {
    finT = t > 0 ? (t < 1 ? t : 1) : 0;
    updateMorph();
  }

  // ------------------------------------------------------------ post
  const composer = new EffectComposer(renderer);   // picks up the renderer's size + DPR
  // the canvas `antialias` flag does nothing once we render into composer targets, and
  // 1px additive lines crawl badly without MSAA — so ask the targets for it directly
  composer.renderTarget1.samples = composer.renderTarget2.samples = Q.msaa;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55 * Q.bloomK, 0.3, 0.72);
  // …and the constructor's resolution is DEAD: addPass and composer.setSize both call
  // pass.setSize(effectiveW, effectiveH), which overwrites it. Scaling the numbers on the way
  // in is therefore the only bloom-resolution knob that survives a resize. Half-res costs the
  // glow nothing (UnrealBloom halves again internally and blurs five mip levels on top).
  bloom.setSize = (w, h) => UnrealBloomPass.prototype.setSize.call(bloom, w * Q.bloomRes, h * Q.bloomRes);
  const outPass = new OutputPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(outPass);

  // ------------------------------------------------------------ layout
  const plane = new THREE.Plane();   // the tilted sheet, for pointer picking
  const nrm = new THREE.Vector3(0, COSP, SINP);
  const ctr = new THREE.Vector3();
  let camZ = 0;

  function relayout() {
    solo = W <= SOLO_W;      // the phone's solo staging; everything below places against it
    // static half of the fabric: only the n̂ displacement animates, so x is fixed here
    // and the row's ŵ offset is recomputed cheaply per row in updateFabric.
    const g = PHY.grid, p = fabGeo.attributes.position.array;
    // the lattice is symmetric about the viewport centre, so ±half is the rim
    const halfU = (GW - 1) * g.dx * PLANE_S / 2, halfW = (GH - 1) * g.dy * PLANE_S / 2;
    for (let gy = 0; gy < GH; gy++) {
      const w = (H / 2 - (g.y0 + gy * g.dy)) * PLANE_S;
      for (let gx = 0; gx < GW; gx++) {
        const k = gy * GW + gx, u = (g.x0 + gx * g.dx - W / 2) * PLANE_S;
        p[k * 3] = u;
        const r = Math.hypot(u / halfU, w / halfW);
        const s = Math.min(1, Math.max(0, (r - FADE0) / (1 - FADE0)));
        fade[k] = 1 - s * s * (3 - 2 * s);   // smoothstep to 0 at the rim
      }
    }
    fabGeo.attributes.position.needsUpdate = true;
    buildKernel();

    // the sheet fills the frame; the word (physics y = wordY·H, up-slope of centre)
    // reads at ~70% frame width and sits in the upper half.
    baseY = CAM_Y * H; camZ = CAM_Z * H;
    look.set(0, SHEET_Y * H, 0);
    camera.position.set(0, baseY, camZ);
    camera.lookAt(look);
    ctr.set(0, SHEET_Y * H, 0);
    plane.setFromNormalAndCoplanarPoint(nrm, ctr);

    // the board is authored in viewport px and the arm is placed against W/H, so a resize is
    // simply a rebuild + a re-derive of both stages from (morphT, armT)
    if (board) buildBoardGeom();
    placeBand();                 // …and the berth's world point, which the board docks onto
    placeArm();
    const NP = nanoAt();         // …and on the phone the cluster is a solo actor: ×QPOS.nanoK
    nano.position.set(NP[0], NP[1], NP[2]);
    nano.scale.setScalar(NANO_R * H * (solo ? QPOS.nanoK : 1));
    nanoPt = NANO_PT * H * (solo ? QPOS.nanoK : 1);
                                 // sizeAttenuation: a point's size is in WORLD units, and
                                 // object scale does not reach it — so it is set here, not scaled
    updateMorph();               // -> updateBand() -> updateArm(): dolly, look drift, dock transform

    // beam hangs from the sky down to the group origin (the impact point)
    const bl = BEAM_LEN * H;
    for (const m of [beamA, beamB]) { m.scale.set(BEAM_W, bl, 1); m.position.y = bl / 2; }

    key.position.set(0.5 * H, 1.0 * H, 1.4 * H);
    glint.position.set(0, 0.30 * H, 0.45 * H);
    glint.intensity = 0.02 * H * H;   // physical 1/r^2 falloff, so intensity tracks scene scale
    glint.distance = 1.4 * H;
  }
  relayout();

  // ------------------------------------------------------------ pointer
  // Everything lives on the sheet, so raycast the sheet's own (undeformed) plane and
  // invert the sheet map back to physics coords.
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), hit = new THREE.Vector3();

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      const w = (hit.y - SHEET_Y * H) * SINP - hit.z * COSP;   // (hit − Cs)·ŵ
      PHY.setPointer(W / 2 + hit.x / PLANE_S, H / 2 - w / PLANE_S);
    } else PHY.clearPointer();
  }
  const onLeave = () => { PHY.clearPointer(); ndc.set(0, 0); };
  // touch has no pointerleave — a finger just lifts. Without this the trap stays pinned
  // wherever the last touch ended and the swarm never lets go.
  const onUp = e => { if (e.pointerType === 'touch') onLeave(); };
  const onClick = () => PHY.melt();

  // ------------------------------------------------------------ resize
  let rt = 0;
  function doResize() {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    PHY.resize(W, H);
    relayout();
  }
  const onResize = () => { clearTimeout(rt); rt = setTimeout(doResize, 200); };

  // ------------------------------------------------------------ fps
  let fpsEl = null, frames = 0, fpsT = performance.now();
  if (location.search.includes('fps')) {
    fpsEl = document.createElement('div');
    fpsEl.style.cssText = 'position:fixed;top:74px;right:10px;z-index:9;pointer-events:none;' +
      'font:11px ui-monospace,Menlo,monospace;color:#8de9ec;opacity:.7';
    document.body.appendChild(fpsEl);
  }

  // ------------------------------------------------------------ loop
  // every rendered frame goes through here — rAF, the QA hook and the reduced-motion
  // still frame alike, so the laser can never be a rAF-only decoration
  // parallax + the morph's dolly in one place: the dolly scales the camera's offset FROM
  // the look point, so pulling back never breaks the pointer parallax.
  // rate 1 = snap (the synchronous QA path), 0.05 = the usual eased follow.
  function trackCamera(rate) {
    camera.position.x += (ndc.x * 0.02 * H - camera.position.x) * rate;
    camera.position.y += (look.y + (baseY - look.y) * dolly + ndc.y * 0.02 * H - camera.position.y) * rate;
    camera.position.z += (camZ * dolly - camera.position.z) * rate;
    camera.lookAt(look);
  }

  function drawFrame(dt) {
    updateLaser(dt);
    if (pulseOn) advancePulses(dt);
    // the twinkle lives here, not in frame(), so the synchronous advance() breathes too.
    // drawFrame is the ONLY writer of the final sprite scale/opacity — updateJourney writes
    // the bases into starS/starO and this modulates them, so the two can never fight.
    // …guarded on `planets`, not on journeyGrp.visible: a hidden group that keeps its LAST
    // visible scale/opacity is invisible on screen but lies in boardStats, and the sprites
    // must read back the zeroes updateJourney wrote for t4 = 0. Only the clock is gated.
    if (planets) {
      if (journeyGrp.visible) starT += dt;
      const w = 2 * Math.PI * PL_TW_HZ * starT;
      for (let i = 0; i < planets.length; i++) {
        const p = Math.sin(w + i * 1.7);                     // fixed per-star phase spread
        const s = starS[i] * (1 + PL_TW_S * p);
        planets[i].scale.set(s, s, 1);
        planets[i].material.opacity = starO[i] * (1 - PL_TW_O + PL_TW_O * p);
      }
      // …and the orbit, on the same clock and by the same rule: updateJourney owns the base,
      // this owns the angle. û·cos + ŵ·sin, i.e. a circle lying IN the sheet.
      for (let i = 0; i < sats.length; i++) {
        const a = SAT_HZ * starT + SATS[i][2], o = i * 3;
        const cx = Math.cos(a) * satR[i], cw = Math.sin(a) * satR[i];
        satW[o] = satP[o] + cx;
        satW[o + 1] = satP[o + 1] + cw * SINP;
        satW[o + 2] = satP[o + 2] - cw * COSP;
        sats[i].position.set(satW[o], satW[o + 1], satW[o + 2]);
        sats[i].scale.set(satS[i], satS[i], 1);
        sats[i].material.opacity = satO[i];
        sats[i].visible = satO[i] > 0.004;
      }
    }
    if (ring.visible) ring.rotation.z += RING_SPIN * dt;
    // the nano node drifts and breathes — same split as the twinkle above: updateSignal owns
    // the base (nanoO), this owns the clock, and neither writes the other's number.
    if (nano.visible) {
      nanoT += dt;
      nano.rotation.y += 0.22 * dt; nano.rotation.x += 0.09 * dt;
      const b = Math.sin(2 * Math.PI * 0.32 * nanoT);
      nanoMat.opacity = nanoO * (0.88 + 0.12 * b);
      nanoMat.size = nanoPt * (1 + 0.16 * b);
    }
    placeBeads(meshMain, idxMain);
    placeBeads(meshTrac, idxTrac);
    composer.render();
  }

  let raf = 0, acc = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc += dt;
    while (acc >= C.dt) { PHY.step(C.dt); acc -= C.dt; }

    stars.rotation.y += 0.0015 * dt;
    // the planet-to-planet cruise: one lerped focus var, dt-exact like the laser's glide
    if (jourT > 0 && focusF !== planetIdx) {
      focusF += (planetIdx - focusF) * (1 - Math.pow(0.94, dt * 60));
      if (Math.abs(planetIdx - focusF) < 1e-3) focusF = planetIdx;
      updateJourney();
    }
    trackCamera(0.05);

    updateFabric();
    drawFrame(dt);

    if (fpsEl) {
      frames++;
      if (now - fpsT > 500) {
        fpsEl.textContent = (frames * 1000 / (now - fpsT)).toFixed(0) + ' fps';
        frames = 0; fpsT = now;
      }
    }
  }

  // QA hook: drives the sim + one render synchronously, so automated screenshot
  // tooling can capture any state even while the tab is hidden and rAF is suspended.
  window.__hero = {
    advance(seconds) {
      const n = Math.max(1, Math.round(seconds / C.dt));
      for (let i = 0; i < n; i++) { PHY.step(C.dt); updateFabric(); }
      focusF = planetIdx;     // the cruise is a rAF lerp, so the sync path snaps it
      updateMorph();          // the morph is a visual, so it must run on the sync path too
      trackCamera(1);
      drawFrame(n * C.dt);
    },
    setPointer: (x, y) => PHY.setPointer(x, y),
    clearPointer: () => PHY.clearPointer(),
    melt: () => PHY.melt(),
    mode: () => PHY.getMode(),
    lambda: () => PHY.getLambda(),
    tier: () => Q.tier,
    setMorph,
    setBand,
    setArm,
    setAlgo,
    setExit,
    setJourney,
    setPlanet,
    setFinale,
    project,
    projectWorld,
    anchors,
    // everything the morph can get wrong, in one readable object
    boardStats() {
      const mch = {
        tb: bandT, t2: armT, ta: algoT, bandLoaded: !!bandV, bandFailed: bandFail,
        armLoaded: !!arm, armFailed: armFail, armOpacity: +armMat.opacity.toFixed(3),
        armSegs: armGeo ? armGeo.attributes.position.count / 2 : 0,
        // the box AFTER ARM_ROT + ARM_YAW, in geometry units, and the same box on screen.
        // armDims[1] is the vertical: if it is not the biggest of the three, the arm is lying down.
        armDims: arm ? [armDim.x, armDim.y, armDim.z].map(v => +v.toFixed(3)) : null,
        armWorld: arm ? [armDim.x, armDim.y, armDim.z].map(v => Math.round(v * arm.scale.x)) : null,
        armUpright: arm ? armDim.y > armDim.x && armDim.y > armDim.z : null,
        bandOpacity: +bandMat.opacity.toFixed(3),
        bandSegs: bandGeo ? bandGeo.attributes.position.count / 2 : 0,
        dockWorld: [dockW.x, dockW.y, dockW.z].map(v => Math.round(v)),
        dockScale: +dockScale().toFixed(4),
        signalProgress: +(sigDrawn / SIG_N).toFixed(3),
        signalOpacity: +sigArm.m.opacity.toFixed(3),
        nanoOpacity: +sigNano.m.opacity.toFixed(3),
        nanoNode: +nanoO.toFixed(3), nanoDots: NANO_N,
        algoDim: +algoDim().toFixed(3),
      };
      const jrn = {
        t4: jourT, t5: finT, planetIdx, focusLerp: +focusF.toFixed(3),
        starsBuilt: planets ? planets.length : 0,
        starOpacity: planets ? planets.map(p => +p.material.opacity.toFixed(3)) : null,
        starScale: planets ? planets.map(p => Math.round(p.scale.x)) : null,
        satOpacity: sats ? sats.map(p => +p.material.opacity.toFixed(3)) : null,
        satScale: sats ? sats.map(p => Math.round(p.scale.x)) : null,
        satOrbitPx: sats ? [...satR].map(v => Math.round(v)) : null,
        satPos: sats ? sats.map(p => [p.position.x, p.position.y].map(v => Math.round(v))) : null,
        linkOpacity: +linkMat.opacity.toFixed(3), ringOpacity: +ringMat.opacity.toFixed(3),
      };
      if (!board) return { board: null, failed: boardFail, pending: boardBusy, t: morphT, t3: exitT, ...mch, ...jrn };
      let mn = Infinity, mx = 0, len = 0, bad = 0;
      for (let k = 0; k < NT; k++) {
        const o = k * 4;
        mn = Math.min(mn, Math.hypot(tSrc[o] - tTgt[o], tSrc[o + 1] - tTgt[o + 1]));
        mx = Math.max(mx, Math.hypot(tSrc[o + 2] - tTgt[o + 2], tSrc[o + 3] - tTgt[o + 3]));
        len += Math.hypot(tTgt[o + 2] - tTgt[o], tTgt[o + 3] - tTgt[o + 1]);
        const j = srcLine[k], i = j >= 0 ? j : -1 - j;   // row j, or column encoded as -1-i
        if (i % Q.fabStride || i >= (j >= 0 ? GH : GW)) bad++;   // must land on a DRAWN line
      }
      return {
        board: board.name, traces: NT, badSource: bad, fromRows: srcRows, fromCols: NT - srcRows,
        srcMinPx: +mn.toFixed(2), srcMaxPx: +mx.toFixed(2), pathLenPx: Math.round(len),
        boardPx: [Math.round(bw), Math.round(bh)],
        t: morphT, fabricOpacity: +fabMat.opacity.toFixed(3), fabricVisible: fabric.visible,
        traceOpacity: +traceMat.opacity.toFixed(3), boardVisible: boardGrp.visible,
        maskOpacity: +faceMat.opacity.toFixed(3), silkSprites: silkGrp.children.length,
        photoOpacity: +photoMat.opacity.toFixed(3), photoPx: photoPx.map(v => +v.toFixed(1)),
        pulseOn, pulses: pulsePos.length / 2, beadScale: +beadScale.toFixed(3),
        dolly: +dolly.toFixed(3), lambda: +PHY.getLambda().toFixed(4), mode: PHY.getMode(),
        t3: exitT,
        boardScale: +boardGrp.scale.x.toFixed(4),
        boardPos: [boardGrp.position.x, boardGrp.position.y, boardGrp.position.z].map(v => Math.round(v)),
        ...mch,
        ...jrn,
      };
    },
  };

  if (reduced) {
    // no animation: fast-forward ~6 s so the name is already assembled, then one frame
    for (let i = 0; i < 360; i++) PHY.step(C.dt);
    for (let i = 0; i < 40; i++) updateFabric();   // let the eased sheet settle
    drawFrame(C.dt);
  } else {
    raf = requestAnimationFrame(frame);
    addEventListener('pointermove', onMove);
    addEventListener('pointerleave', onLeave);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
    canvas.addEventListener('click', onClick);
    addEventListener('resize', onResize);
  }

  return {
    setMorph,
    setBand,
    setArm,
    setAlgo,
    setExit,
    setJourney,
    setPlanet,
    setFinale,
    project,
    projectWorld,
    anchors,
    // the one table the journey is authored in — the page pins its overview labels to it,
    // so a label can never drift off its own planet: [name, x·W, y·H, n̂ offset ·H]
    nodes: PLANETS.map(([n, x, y, z]) => [n, x, y, z]),
    // …and the satellites, which have no fixed place at all: their world position is wherever
    // the last frame's orbit put them, so the page reads it rather than deriving it.
    // [label, x, y, z, opacity] — opacity is the gate, so a label cannot outlive its star.
    satellites: () => SATS.map(([n], i) => [n, satW[i * 3], satW[i * 3 + 1], satW[i * 3 + 2], satO[i]]),
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerleave', onLeave);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      if (fpsEl) fpsEl.remove();
      bloom.dispose(); outPass.dispose(); composer.dispose();
      fabGeo.dispose(); beadGeo.dispose(); starGeo.dispose(); beamGeo.dispose();
      traceGeo.dispose(); outGeo.dispose(); padGeo.dispose(); faceGeo.dispose(); photoGeo.dispose();
      if (armGeo) armGeo.dispose();
      if (bandGeo) bandGeo.dispose();
      armMat.dispose(); bandMat.dispose();
      for (const s of [sigArm, sigNano]) { s.g.dispose(); s.m.dispose(); }
      nanoGeo.dispose(); nanoMat.dispose();
      traceMat.dispose(); outMat.dispose(); padMat.dispose(); faceMat.dispose();
      if (photoMat.map) photoMat.map.dispose();
      photoMat.dispose();
      for (const sp of silkGrp.children) { sp.material.map.dispose(); sp.material.dispose(); }
      linkGeo.dispose(); linkMat.dispose(); ringGeo.dispose(); ringMat.dispose();
      if (starTex) starTex.dispose();                 // one texture, shared by every star
      if (planets) for (const p of planets) p.material.dispose();
      if (sats) for (const p of sats) p.material.dispose();
      fabMat.dispose(); starMat.dispose(); glassMat.dispose(); tracMat.dispose();
      beamMat.dispose(); glowMat.dispose(); coreMat.dispose();
      beamTex.dispose(); glowTex.dispose();
      meshMain.dispose(); meshTrac.dispose();
      envRT.dispose(); scene.environment = null;
      renderer.dispose();
    },
  };
}
