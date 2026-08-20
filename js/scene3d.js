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
      M4.makeScale(s, s, s);
      M4.setPosition(u, cy0 + w * SINP + n * COSP, -w * COSP + n * SINP);
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
  //   .85 → 1    pull back  camera dollies out ×DOLLY; the board reads as one object
  const BOARD_URL = './js/data/board-hswb.json';
  const LOGO_URL = 'image/logo-bin-mono.png';
  const BOARD_ROT = 90;      // knob: board rotation on the sheet [deg]. 90° = portrait board -> landscape frame
  const BOARD_W = 0.52;      // board width AFTER rotation, as a fraction of the viewport W
  const TRACE_N = 0.9;       // trace layer lift along n̂ [world]
  const FACE_N = 0.2;        // solder-mask quad, just under the copper
  const SILK_N = 1.4;        // silkscreen sits on top of the mask
  const PULSE_N = 2.4;       // signal pulses ride above the traces
  const SILK_F = 0.024;      // silkscreen cap height, as a fraction of the board height
  const LOGO_F = 0.11;       // logo sprite size, ditto
  const PULSE_SPEED = 90;    // px/s along a trace
  const N_PULSE = 50;
  const STAGGER = 0.18;      // per-trace slide duration, inside the .25 → .60 stage
  const DOLLY = 1.6;         // camera distance multiplier at t = 1
  const SILK_EVERY = 3;      // draw every Nth reference designator (23 -> 8)

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
  let morphT = 0, held = false, dolly = 1;

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

  const silkGrp = new THREE.Group();
  for (const o of [face, traceLines, outline, padLines, silkGrp]) { o.frustumCulled = false; boardGrp.add(o); }

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
    // stage 1 — hand λ to the morph and keep it down for as long as the morph is running
    const want = t > 0.002;
    if (want !== held) { held = want; PHY.holdRelease(want); }
    beadScale = 1 - 0.55 * stg(t, 0.05, 0.5);     // released beads recede to a dim gas
    dolly = 1 + (DOLLY - 1) * stg(t, 0.85, 1);

    if (!board) { pulseOn = false; return; }

    // stage 2 — the fabric hands its lines over to the copper
    const s2 = stg(t, 0.25, 0.6), s3 = stg(t, 0.6, 0.85);
    fabMat.opacity = 1 - s2;
    fabric.visible = fabMat.opacity > 0.004;

    traceMat.opacity = stg(t, 0.25, 0.36);
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
    faceMat.opacity = 0.92 * s3;
    outMat.opacity = 0.50 * s3;
    padMat.opacity = 0.45 * s3;
    for (const sp of silkGrp.children) sp.material.opacity = (sp.userData.box ? 0.20 : 0.42) * s3;
    const on = s3 > 0.004;
    face.visible = outline.visible = padLines.visible = silkGrp.visible = on;

    pulseOn = t >= 0.6;
  }

  // t ∈ [0, 1], scrub-safe in both directions. The board JSON is fetched lazily on the
  // first t > 0 (or taken from opts.board); until it lands only stage 1 runs.
  function setMorph(t) {
    morphT = t > 0 ? (t < 1 ? t : 1) : 0;
    if (morphT > 0 && !board && !boardBusy && !boardFail) loadBoard();
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

    // the board is authored in viewport px, so a resize is simply a rebuild
    if (board) { buildBoardGeom(); updateMorph(); }

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
    // everything the morph can get wrong, in one readable object
    boardStats() {
      if (!board) return { board: null, failed: boardFail, pending: boardBusy, t: morphT };
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
        pulseOn, pulses: pulsePos.length / 2, beadScale: +beadScale.toFixed(3),
        dolly: +dolly.toFixed(3), lambda: +PHY.getLambda().toFixed(4), mode: PHY.getMode(),
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
      traceGeo.dispose(); outGeo.dispose(); padGeo.dispose(); faceGeo.dispose();
      traceMat.dispose(); outMat.dispose(); padMat.dispose(); faceMat.dispose();
      for (const sp of silkGrp.children) { sp.material.map.dispose(); sp.material.dispose(); }
      fabMat.dispose(); starMat.dispose(); glassMat.dispose(); tracMat.dispose();
      beamMat.dispose(); glowMat.dispose(); coreMat.dispose();
      beamTex.dispose(); glowTex.dispose();
      meshMain.dispose(); meshTrac.dispose();
      envRT.dispose(); scene.environment = null;
      renderer.dispose();
    },
  };
}
