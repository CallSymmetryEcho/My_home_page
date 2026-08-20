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

export function createHero(canvas) {
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

  const M4 = new THREE.Matrix4();
  function placeBeads(mesh, idx) {
    const { px, py, pz } = PHY.state;
    const cy0 = SHEET_Y * H, cx = W / 2, cy = H / 2;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], s = scl[i];
      const u = (px[i] - cx) * PLANE_S;         // along û
      const w = (cy - py[i]) * PLANE_S;         // along ŵ (screen-y is inverted)
      // along n̂: rest on the local sheet height, lifted by the bead's own radius, plus
      // the thermal z bob. Beads therefore ride their own dimples and roll into the wells.
      // ride the wells only partially: full ride drags the glyph shape down with the
      // fabric and smears the word; 0.35 keeps the visual coupling without the warp
      const n = heightAt(px[i], py[i]) * 0.35 + BEAD_R * s + 0.5 * pz[i];
      M4.makeScale(s, s, s);
      M4.setPosition(u, cy0 + w * SINP + n * COSP, -w * COSP + n * SINP);
      mesh.setMatrixAt(k, M4);
    }
    mesh.instanceMatrix.needsUpdate = true;
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
    baseY = CAM_Y * H;
    look.set(0, SHEET_Y * H, 0);
    camera.position.set(0, baseY, CAM_Z * H);
    camera.lookAt(look);
    ctr.set(0, SHEET_Y * H, 0);
    plane.setFromNormalAndCoplanarPoint(nrm, ctr);

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
  let raf = 0, acc = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc += dt;
    while (acc >= C.dt) { PHY.step(C.dt); acc -= C.dt; }

    stars.rotation.y += 0.0015 * dt;
    camera.position.x += (ndc.x * 0.02 * H - camera.position.x) * 0.05;
    camera.position.y += (baseY + ndc.y * 0.02 * H - camera.position.y) * 0.05;
    camera.lookAt(look);

    updateFabric();
    placeBeads(meshMain, idxMain);
    placeBeads(meshTrac, idxTrac);
    composer.render();

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
      placeBeads(meshMain, idxMain);
      placeBeads(meshTrac, idxTrac);
      composer.render();
    },
    setPointer: (x, y) => PHY.setPointer(x, y),
    clearPointer: () => PHY.clearPointer(),
    melt: () => PHY.melt(),
    mode: () => PHY.getMode(),
    lambda: () => PHY.getLambda(),
  };

  if (reduced) {
    // no animation: fast-forward ~6 s so the name is already assembled, then one frame
    for (let i = 0; i < 360; i++) PHY.step(C.dt);
    for (let i = 0; i < 40; i++) updateFabric();   // let the eased sheet settle
    placeBeads(meshMain, idxMain);
    placeBeads(meshTrac, idxTrac);
    composer.render();
  } else {
    raf = requestAnimationFrame(frame);
    addEventListener('pointermove', onMove);
    addEventListener('pointerleave', onLeave);
    canvas.addEventListener('click', onClick);
    addEventListener('resize', onResize);
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerleave', onLeave);
      removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      if (fpsEl) fpsEl.remove();
      bloom.dispose(); outPass.dispose(); composer.dispose();
      fabGeo.dispose(); beadGeo.dispose(); starGeo.dispose();
      fabMat.dispose(); starMat.dispose(); glassMat.dispose(); tracMat.dispose();
      meshMain.dispose(); meshTrac.dispose();
      envRT.dispose(); scene.environment = null;
      renderer.dispose();
    },
  };
}
