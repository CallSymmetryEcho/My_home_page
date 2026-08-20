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
import * as PHY from './physics.js';

const GW = 121, GH = 61;                  // potential grid == fabric line lattice
const SHEET_TILT = 55 * Math.PI / 180;    // sheet tilt from horizontal (55°: more face-on, word reads)
const SINP = Math.sin(SHEET_TILT), COSP = Math.cos(SHEET_TILT);
const PLANE_S = 0.66;                     // physics px -> world units; word ≈ 70% frame width
const SHEET_Y = 0.16;                     // sheet centre height [·H]
const CAM_Y = 0.52, CAM_Z = 1.30;         // camera position [·H], looking at the sheet centre
const FOV = 34;
const BEAD_R = 2.6;                       // bead geometry radius [world units]
const FADE0 = 0.45;                       // sheet edge fade starts at this normalised radius
const C = PHY.CONFIG;

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
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000004, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  PHY.init(W, H, GW, GH);

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
  const glint = new THREE.PointLight(0x9beff0, 1, 1, 2);   // intensity/range scale with H
  scene.add(key, glint);

  // ------------------------------------------------------------ starfield
  const STARS = 1300;
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
    // draw every 2nd lattice line: big sparse GR cells, while the potential keeps the
    // full lattice resolution so each drawn line still bends smoothly through the wells
    const ix = [];
    for (let j = 0; j < GH; j += 2) for (let i = 0; i < GW - 1; i++) { ix.push(j * GW + i, j * GW + i + 1); }
    for (let i = 0; i < GW; i += 2) for (let j = 0; j < GH - 1; j++) { ix.push(j * GW + i, (j + 1) * GW + i); }
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

  function updateFabric() {
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
        const h = hgt[k] += (-relief * e - hgt[k]) * 0.12;
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
    pjv.set(pj3[0], pj3[1], pj3[2]).project(camera);
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

  const beadGeo = new THREE.SphereGeometry(BEAD_R, 24, 16);
  // less transmission (on black it transmits black), more clearcoat + env: sparkling
  // droplets that catch the bloom, not matte marbles
  const glassMat = new THREE.MeshPhysicalMaterial({
    metalness: 0, roughness: 0.05, transmission: 0.55, thickness: 3,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    ior: 1.45, color: 0xf2feff, envMapIntensity: 3.2,
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
      // offset, and the dock shrink of the arm stage) — beads are drawn in scene space.
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

    // nearest DRAWN lattice line. The fabric draws every 2nd index (see the index build
    // above), so the snap is to an EVEN row/column.
    const jMax = (GH - 1) & ~1, iMax = (GW - 1) & ~1;
    const rowJ = y => Math.max(0, Math.min(jMax, 2 * Math.round((y - g.y0) / g.dy / 2)));
    const colI = x => Math.max(0, Math.min(iMax, 2 * Math.round((x - g.x0) / g.dx / 2)));

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
    updateArm();                                  // the arm stage extends this frame's camera + board transform

    if (!board) {                                 // fail-soft path still owes the journey its fade
      fabMat.opacity = 1 - jh;
      fabric.visible = fabMat.opacity > 0.004;
      pulseOn = false;
      return;
    }

    // stage 2 — the fabric hands its lines over to the copper
    const s2 = stg(t, 0.25, 0.6), s3 = stg(t, 0.6, 0.85), s4 = stg(t, 0.8, 0.97);
    const dim = 1 - (1 - LINE_DIM) * s4;          // lines step back once the photo lands
    // …and the exit hands them BACK. A multiplier cannot lift an opacity the morph drove to
    // 0, so the fabric's own term is a lerp toward 1; every board layer is multiplicative.
    fabMat.opacity = (1 - s2 * inv) * (1 - jh);
    fabric.visible = fabMat.opacity > 0.004;

    traceMat.opacity = stg(t, 0.25, 0.36) * dim * inv;
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
    faceMat.opacity = 0.92 * s3 * (1 - s4) * inv;
    outMat.opacity = 0.50 * s3 * dim * inv;
    padMat.opacity = 0.45 * s3 * dim * inv;
    photoMat.opacity = PHOTO_MAX * s4 * inv;
    for (const sp of silkGrp.children) sp.material.opacity = (sp.userData.box ? 0.20 : 0.42) * s3 * inv;
    const on = s3 * inv > 0.004;
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

  // ------------------------------------------------------------ the machine (chapter ③, finale)
  // Micro → macro: the board that the sheet just became docks into the machine that hosts it.
  // The arm is a raw edge dump (Float32 line segments, height-normalised, centred) drawn in
  // the same additive-white voice as the fabric — a schematic of a real machine, not a render.
  // setArm(t2) is a pure function of t2, same contract as setMorph.
  const ARM_URL = './js/data/arm-edges.bin';
  const ARM_H = 1.05;        // arm height cap [·H world]
  // …and a footprint cap: this SCARA reaches 2.5× further than it is tall, so height alone
  // would put half the machine outside the frustum (and its near links in the camera's lap).
  const ARM_SPAN = 0.62;     // knob: max horizontal extent [·W world]
  const ARM_X = 0.28;        // arm base, right of centre [·W world]
  const ARM_Y = 0.0;         // arm base height — sheet level [·H world]
  const ARM_Z = -0.15;       // arm base, slightly behind the sheet [·H world]
  const ARM_YAW = -25;       // knob: yaw [deg], so the profile reads instead of the front face
  const ARM_OP = 0.38;       // final line opacity
  const DOCK_X = -0.06;      // knobs: dock point, offset from the arm base [·W, ·H, ·H world]
  const DOCK_Y = 0.22;
  const DOCK_Z = 0.30;       // + = forward, toward the camera
  const BOARD_S2 = 0.42;     // board scale at t2 = 1
  const DOLLY2 = 2.05;       // camera distance multiplier at t2 = 1 (extends DOLLY)
  const LOOK_DRIFT = 0.35;   // look-at drift toward the arm, as a fraction of its x

  let armGeo = null, arm = null, armBusy = false, armFail = false, armT = 0;
  // NormalBlending, not additive: pulley teeth stack thousands of edges in one spot and
  // additive lines blow out into white orbs there — normal blending caps at the line color
  const armMat = new THREE.LineBasicMaterial({
    color: 0xcfe4e6, transparent: true, opacity: 0, blending: THREE.NormalBlending, depthWrite: false,
  });

  // fit from the geometry's own bounds, so a re-exported arm needs no new numbers here
  function placeArm() {
    if (!arm) return;
    const bb = armGeo.boundingBox, d = bb.max.clone().sub(bb.min);
    const s = Math.min(ARM_H * H / d.y, ARM_SPAN * W / Math.max(d.x, d.z));
    arm.scale.setScalar(s);
    arm.position.set(ARM_X * W, ARM_Y * H - bb.min.y * s, ARM_Z * H);   // its base lands on ARM_Y
    arm.rotation.y = ARM_YAW * Math.PI / 180;
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
        armFail = true; armBusy = false;          // fail soft: the board still docks, just no machine
        console.warn('arm stage: no edge data —', e.message);
      });
  }

  function updateArm() {
    const t = armT, a = ss(t), inv = 1 - ss(exitT);
    // the exit walks the whole camera move back to 1×: the constellation has to read on the
    // sheet at hero framing, and the DOM labels project against this same camera.
    // …and the finale pulls the whole thing far back on top of that (chapter ⑤)
    dolly = (1 + (dollyM + (DOLLY2 - DOLLY) * a - 1) * inv) * (1 + (FIN_DOLLY - 1) * ss(finT));
    look.x = ARM_X * W * LOOK_DRIFT * a * inv;
    armMat.opacity = ARM_OP * stg(t, 0, 0.5) * inv;
    if (arm) arm.visible = armMat.opacity > 0.004;
    // the board shrinks and glides until its centre sits on the dock point
    const u = stg(t, 0.15, 0.85), sc = 1 + (BOARD_S2 - 1) * u, x0 = BOARD_DX * W;
    boardGrp.scale.setScalar(sc);
    boardGrp.position.set(
      x0 + ((ARM_X + DOCK_X) * W - sc * bC[0] - x0) * u,
      ((ARM_Y + DOCK_Y) * H - sc * bC[1]) * u,
      ((ARM_Z + DOCK_Z) * H - sc * bC[2]) * u,
    );
    updateJourney();          // the planets and the ring are placed against this frame's dolly
  }

  // t2 ∈ [0, 1], scrub-safe both ways. The edge dump is fetched lazily on the first t2 > 0.
  function setArm(t) {
    armT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (armT > 0 && !arm && !armBusy && !armFail) loadArm();
    updateArm();
  }

  // ------------------------------------------------------------ the exit (chapter ③ → ④)
  // The machine story closes and the beads come home. setExit(t3) does not undo setMorph /
  // setArm — it runs ON TOP of them (morphT and armT stay pinned at 1 underneath), fading the
  // board, the arm and the signal pulses out, growing the beads back to full size, handing the
  // fabric its opacity back and dollying the camera home. Pure function of t3, so scrubbing
  // back up re-lights the finale exactly as it was.
  function setExit(t) {
    exitT = t > 0 ? (t < 1 ? t : 1) : 0;
    updateMorph();               // -> updateArm(): every opacity and the camera are re-derived
  }

  // ------------------------------------------------------------ chapter ④ — the planets
  // The constellation is not a bead swarm any more: one node = one PLANET, textured with the
  // school's crest on a 1024×512 equirect (crest at 0° and 180°, so the slow spin always
  // brings a face round). Thin lines wire them together like the Big Dipper.
  //
  //   setJourney(t4)  .00 → .45  OVERVIEW: planets scale in (staggered), the lines draw
  //                              themselves, the fabric and the beads hand the stage over.
  //                   .45 → 1    ZOOM: the focused planet swells to ~0.55H of SCREEN height
  //                              and glides to a left-of-centre anchor (the detail card owns
  //                              the right); the others recede, dim and unwire.
  //   setPlanet(i)    switches while zoomed. focusF *eases* toward i, so the view cruises
  //                   along the constellation line planet-to-planet instead of cutting.
  //   setFinale(t5)   camera pulls far back, the planets unwind and shrink to star-points
  //                   drifting up-right, and one orbit ring comes up around the contact block.
  //
  // Same contract as setMorph/setArm/setExit: pure functions of (t4, focusF, t5), so scrubbing
  // back undoes every stage exactly.
  //   [name, x·W, y·H, n̂ offset ·H (depth stagger), texture, radius multiplier]
  const PLANETS = [
    ['USTC',      0.22, 0.55,  0.04, 'image/planet-ustc.jpg',     1],
    ['BERKELEY',  0.40, 0.46, -0.04, 'image/planet-berkeley.jpg', 1],
    ['BROWN',     0.58, 0.40,  0.03, 'image/planet-brown.jpg',    1],
    ['UT AUSTIN', 0.78, 0.30, -0.03, 'image/planet-utaustin.jpg', 1.25],
  ];
  const PL_R = 0.035;         // base planet radius in the overview [·H world]
  const PL_ZOOM_H = 0.55;     // focused planet diameter, as a fraction of the SCREEN height
  const PL_ANCHOR_X = -0.16;  // …parked left of centre [·W world]
  const PL_DIM = 0.25;        // unfocused planets' opacity multiplier once zoomed
  const PL_SHRINK = 0.8;      // …and their scale multiplier
  const PL_SPIN = 0.12;       // rad/s
  // Two knobs that only exist because of the bloom pass (threshold 0.72, LINEAR): a white
  // crest under the 2.0 key light lands at ~0.8 and blows out into an unreadable disc.
  // PL_TINT pulls the albedo down under the threshold, PL_EMIT puts the near-black navy
  // plate back on the terminator side. Raise PL_EMIT past ~0.35 and the crest blooms again.
  const PL_TINT = 0xb9c1c4;
  const PL_EMIT = 0.12;
  const FIN_DOLLY = 2.4;      // camera distance multiplier at t5 = 1
  const RING_R = 0.42;        // orbit ring semi-major axis [·H world], scaled with the dolly
  const RING_RY = 0.66;       // …minor/major axis: an ellipse, so its slow spin is visible
  const RING_TILT = 18 * Math.PI / 180;
  const RING_SPIN = 0.06;     // rad/s

  let planets = null, jourT = 0, finT = 0, planetIdx = 0, focusF = 0;
  const journeyGrp = new THREE.Group();
  journeyGrp.visible = false;
  scene.add(journeyGrp);

  const planetGeo = new THREE.SphereGeometry(1, 48, 32);   // unit sphere; radius IS the scale
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

  function buildPlanets() {
    if (planets) return;
    const loader = new THREE.TextureLoader();
    planets = PLANETS.map(([name, , , , url]) => {
      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.65, metalness: 0, transparent: true, opacity: 0,
        color: PL_TINT, emissive: 0xffffff, emissiveIntensity: PL_EMIT,
      });
      // fail soft: a missing crest leaves a plain gray planet, never a black hole
      const tex = loader.load(url, undefined, undefined, () => {
        console.warn('journey: planet texture missing —', url);
        mat.map = mat.emissiveMap = null;
        mat.color.set(0x6b7376); mat.emissive.set(0x14181a);
        mat.needsUpdate = true;
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = mat.emissiveMap = tex;
      const m = new THREE.Mesh(planetGeo, mat);
      m.name = name;
      // the crests sit at u = 0 and u = 0.5; three's sphere puts u = 0.25 at the camera, i.e.
      // exactly BETWEEN them — so start a quarter turn round and a face is up from frame one.
      m.rotation.y = Math.PI / 2;
      m.frustumCulled = false;
      journeyGrp.add(m);
      return m;
    });
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
      const [, fx, fy, nOff, , rm] = PLANETS[i];
      const born = stg(t, i * 0.07, i * 0.07 + 0.24);        // staggered forming
      // 1 on the focused planet, ramping to 0 one node away: a fractional focusF therefore
      // has TWO planets half-grown and half-anchored — that is the cruise between them.
      const foc = Math.max(0, 1 - Math.abs(i - focusF));
      const k = zoom * foc * (1 - fin), away = zoom * (1 - foc) * (1 - fin);

      sheetXYZ(fx * W, fy * H, nOff * H, jxyz, 0);
      jp.set(jxyz[0], jxyz[1], jxyz[2]);
      ja.set(PL_ANCHOR_X * W, jxyz[1], jxyz[2]);             // its own sheet-frame height
      jp.lerp(ja, k);
      jp.x += 0.30 * W * fin; jp.y += 0.26 * H * fin;        // the finale flings them up-right

      // solve the frustum at this planet's own distance, so PL_ZOOM_H means the same
      // fraction of the screen on any viewport and at any dolly
      const d = Math.hypot(jp.x, jp.y - camY, jp.z - camD);
      const rZoom = PL_ZOOM_H * d * Math.tan(FOV * Math.PI / 360);
      const rBase = PL_R * H * rm * born * (1 - (1 - PL_SHRINK) * away);
      const r = (rBase + (rZoom - rBase) * k) * (1 - 0.80 * fin);

      planets[i].position.copy(jp);
      planets[i].scale.setScalar(r > 1e-4 ? r : 1e-4);
      const m = planets[i].material;
      m.opacity = born * (1 - (1 - PL_DIM) * away) * (1 - 0.45 * fin);
      planets[i].visible = m.opacity > 0.004;

      if (i > 0) { const o = (i - 1) * 6; lp[o + 3] = jp.x; lp[o + 4] = jp.y; lp[o + 5] = jp.z; }
      if (i < planets.length - 1) { const o = i * 6; lp[o] = jp.x; lp[o + 1] = jp.y; lp[o + 2] = jp.z; }
    }
    linkGeo.attributes.position.needsUpdate = true;
    linkMat.opacity = 0.45 * stg(t, 0.18, 0.45) * (1 - 0.75 * zoom) * (1 - fin);
    links.visible = linkMat.opacity > 0.004;
    journeyGrp.visible = t > 0.001;
  }

  // t4 ∈ [0, 1], scrub-safe. The four textures are fetched lazily on the first t4 > 0.
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
  composer.renderTarget1.samples = composer.renderTarget2.samples = 4;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.3, 0.72);
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
    placeArm();
    updateMorph();               // -> updateArm(): camera dolly, look drift, board dock transform

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
      'font:11px ui-monospace,Menlo,monospace;color:#9beff0;opacity:.7';
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
    // the spin lives here, not in frame(), so the synchronous advance() shows it turning too
    if (journeyGrp.visible) for (const p of planets) p.rotation.y += PL_SPIN * dt;
    if (ring.visible) ring.rotation.z += RING_SPIN * dt;
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
    setMorph,
    setArm,
    setExit,
    setJourney,
    setPlanet,
    setFinale,
    project,
    // everything the morph can get wrong, in one readable object
    boardStats() {
      const jrn = {
        t4: jourT, t5: finT, planetIdx, focusLerp: +focusF.toFixed(3),
        planetLoaded: planets ? planets.filter(p => p.material.map && p.material.map.image).length : 0,
        planetOpacity: planets ? planets.map(p => +p.material.opacity.toFixed(3)) : null,
        planetR: planets ? planets.map(p => Math.round(p.scale.x)) : null,
        linkOpacity: +linkMat.opacity.toFixed(3), ringOpacity: +ringMat.opacity.toFixed(3),
      };
      if (!board) return { board: null, failed: boardFail, pending: boardBusy, t: morphT, t3: exitT, ...jrn };
      let mn = Infinity, mx = 0, len = 0, bad = 0;
      for (let k = 0; k < NT; k++) {
        const o = k * 4;
        mn = Math.min(mn, Math.hypot(tSrc[o] - tTgt[o], tSrc[o + 1] - tTgt[o + 1]));
        mx = Math.max(mx, Math.hypot(tSrc[o + 2] - tTgt[o + 2], tSrc[o + 3] - tTgt[o + 3]));
        len += Math.hypot(tTgt[o + 2] - tTgt[o], tTgt[o + 3] - tTgt[o + 1]);
        const j = srcLine[k], i = j >= 0 ? j : -1 - j;   // row j, or column encoded as -1-i
        if (i % 2 || i >= (j >= 0 ? GH : GW)) bad++;     // must land on a DRAWN (even) line
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
        t2: armT, armLoaded: !!arm, armFailed: armFail, t3: exitT,
        armOpacity: +armMat.opacity.toFixed(3), armSegs: armGeo ? armGeo.attributes.position.count / 2 : 0,
        boardScale: +boardGrp.scale.x.toFixed(3),
        boardPos: [boardGrp.position.x, boardGrp.position.y, boardGrp.position.z].map(v => Math.round(v)),
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
    canvas.addEventListener('click', onClick);
    addEventListener('resize', onResize);
  }

  return {
    setMorph,
    setArm,
    setExit,
    setJourney,
    setPlanet,
    setFinale,
    project,
    // the one table the journey is authored in — the page pins its overview labels to it,
    // so a label can never drift off its own planet: [name, x·W, y·H, n̂ offset ·H]
    nodes: PLANETS.map(([n, x, y, z]) => [n, x, y, z]),
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerleave', onLeave);
      removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      if (fpsEl) fpsEl.remove();
      bloom.dispose(); outPass.dispose(); composer.dispose();
      fabGeo.dispose(); beadGeo.dispose(); starGeo.dispose(); beamGeo.dispose();
      traceGeo.dispose(); outGeo.dispose(); padGeo.dispose(); faceGeo.dispose(); photoGeo.dispose();
      if (armGeo) armGeo.dispose();
      armMat.dispose();
      traceMat.dispose(); outMat.dispose(); padMat.dispose(); faceMat.dispose();
      if (photoMat.map) photoMat.map.dispose();
      photoMat.dispose();
      for (const sp of silkGrp.children) { sp.material.map.dispose(); sp.material.dispose(); }
      planetGeo.dispose(); linkGeo.dispose(); linkMat.dispose(); ringGeo.dispose(); ringMat.dispose();
      if (planets) for (const p of planets) { if (p.material.map) p.material.map.dispose(); p.material.dispose(); }
      fabMat.dispose(); starMat.dispose(); glassMat.dispose(); tracMat.dispose();
      beamMat.dispose(); glowMat.dispose(); coreMat.dispose();
      beamTex.dispose(); glowTex.dispose();
      meshMain.dispose(); meshTrac.dispose();
      envRT.dispose(); scene.environment = null;
      renderer.dispose();
    },
  };
}
