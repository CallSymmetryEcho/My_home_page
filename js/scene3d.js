// scene3d.js — Three.js layer over physics.js: deep space + a general-relativity
// "rubber sheet". Two different projections out of the one 2D physics box:
//
//   BEADS / NAME — a tilted plane floating above the origin, leaning back TILT from
//     vertical so it very nearly faces the camera. That is what makes the word
//     legible: it is read head-on, not foreshortened along the floor.
//         p = C + û·(x − W/2)·S − v̂·(y − H·wordY)·S·Sv + n̂·pz
//     with û = +X, v̂ = (0, cosθ, −sinθ), n̂ = û×v̂ (toward the camera). pz bobs the
//     beads out of the plane.
//
//   FABRIC — the spacetime sheet on the ground below, sampling the SAME potential
//     through the old map, physics (x, y) → ground (x − W/2, H/2 − y). So each well
//     sits under the shadow of the letter that made it: mass above, curvature below.
//     Drawn as quad grid lines only — the curvature of the lines IS the data.

import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import * as PHY from './physics.js';

const GW = 121, GH = 61;                  // potential grid == fabric line lattice
const TILT = 28 * Math.PI / 180;          // plane lean from vertical
const VY = Math.cos(TILT), VZ = -Math.sin(TILT);   // v̂ = (0, VY, VZ)
const NY = -VZ, NZ = VY;                  // n̂ = û × v̂ = (0, sinθ, cosθ)
const PLANE_S = 0.55;                     // plane scale — the word lands at ~65% frame width
const PLANE_V = 0.9;                      // extra squash along the plane's up axis
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
  const camera = new THREE.PerspectiveCamera(34, W / H, 1, 40000);
  const look = new THREE.Vector3();
  let baseY = 0, baseZ = 0, planeY = 0;

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
  const hgt = new Float32Array(GW * GH);    // current sheet Y, eased toward the target
  const fade = new Float32Array(GW * GH);   // static edge fade, rebuilt on resize
  // a whisper of ice-cyan (#bfeeee) in the deepest wells, linear-light
  const ICE = new THREE.Color().setRGB(0xbf / 255, 0xee / 255, 0xee / 255, THREE.SRGBColorSpace);

  function updateFabric() {
    PHY.fillPotential(vbuf);
    const text = PHY.getMode() === 'text';
    const relief = C.fabricRelief * H, cl = C.fabricClamp;
    const inv = 1 / (C.pesVref * C.fabricU0);
    // the trap is ~50x pesVref deep, so exp(-V/…) saturates and punches a flat-bottomed
    // cylinder. Log-compress the V<0 side instead, normalised so the trap centre lands
    // exactly on the clamp: a round funnel, and the clamp is touched, never ridden.
    const kNeg = (cl - 1) / Math.log1p(Math.abs(C.mouseA) / C.pesVref);
    const sheetY = C.fabricBaseY * H;   // the sheet floats just under the letters
    const p = fabGeo.attributes.position.array, col = fabGeo.attributes.color.array;
    for (let k = 0; k < vbuf.length; k++) {
      const V = vbuf[k];
      // letter wells: dip = exp(-u/U0), 1 on a glyph -> 0 in the far field (asymptotically
      // FLAT, no bathtub). gas/melt have no glyph sites, so this half is simply absent.
      // cursor well: the attractive trap drives V negative, and only that adds depth —
      // which makes the far field flat in every mode with no baseline bookkeeping.
      let e = (text ? Math.exp(-(V > 0 ? V : 0) * inv) : 0)
            + (V < 0 ? kNeg * Math.log1p(-V / C.pesVref) : 0);
      if (e > cl) e = cl;
      // ease, so mode switches (gas -> text, click -> melt) grow the wells instead of popping
      const y = hgt[k] += (-relief * e - hgt[k]) * 0.12;
      p[k * 3 + 1] = sheetY + y;

      const d = -y / relief;                       // 0 flat · 1 letter well · up to cl in the trap
      const b = 0.38 * fade[k] * (1 + 1.5 * d);    // wells glow, the rim fades into the void
      const t = 0.5 * (d < 1 ? d : 1);
      col[k * 3] = b * (1 + (ICE.r - 1) * t);
      col[k * 3 + 1] = b * (1 + (ICE.g - 1) * t);
      col[k * 3 + 2] = b * (1 + (ICE.b - 1) * t);
    }
    fabGeo.attributes.position.needsUpdate = true;
    fabGeo.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------ beads
  const N = C.N;
  const idxMain = [], idxTrac = [];
  for (let i = 0; i < N; i++) (PHY.state.tracer[i] ? idxTrac : idxMain).push(i);
  const scl = new Float32Array(N);
  for (let i = 0; i < N; i++) scl[i] = 0.85 + Math.random() * 0.30;

  const beadGeo = new THREE.SphereGeometry(2.6, 24, 16);
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
    const sv = PLANE_S * PLANE_V, cx = W / 2, cy = H * C.wordY;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], s = scl[i];
      const a = (px[i] - cx) * PLANE_S;        // along û
      const b = -(py[i] - cy) * sv;            // along v̂ (screen-y is inverted)
      const z = pz[i];                         // along n̂, out of the plane
      M4.makeScale(s, s, s);
      M4.setPosition(a, planeY + b * VY + z * NY, b * VZ + z * NZ);
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
  const plane = new THREE.Plane();   // the bead/name plane, for pointer picking
  const nrm = new THREE.Vector3(0, NY, NZ);
  const ctr = new THREE.Vector3();

  function relayout() {
    // static half of the fabric: x and z never move between resizes, only Y animates
    const g = PHY.grid, p = fabGeo.attributes.position.array;
    const halfX = (GW - 1) * g.dx / 2, halfZ = (GH - 1) * g.dy / 2;
    const midX = g.x0 + halfX - W / 2, midZ = H / 2 - (g.y0 + halfZ);
    for (let gy = 0; gy < GH; gy++) {
      const sz = H / 2 - (g.y0 + gy * g.dy);
      for (let gx = 0; gx < GW; gx++) {
        const k = gy * GW + gx, sx = g.x0 + gx * g.dx - W / 2;
        p[k * 3] = sx; p[k * 3 + 2] = sz;
        const r = Math.hypot((sx - midX) / halfX, (sz - midZ) / halfZ);
        const s = Math.min(1, Math.max(0, (r - FADE0) / (1 - FADE0)));
        fade[k] = 1 - s * s * (3 - 2 * s);   // smoothstep to 0 at the rim
      }
    }
    fabGeo.attributes.position.needsUpdate = true;

    // frame BOTH the name and the fabric wells beneath it: name low enough that its
    // shadow region of the sheet is well inside the frame
    planeY = 0.235 * H;
    baseY = 0.31 * H; baseZ = 1.38 * H;
    look.set(0, 0.155 * H, 0);
    camera.position.set(0, baseY, baseZ);
    camera.lookAt(look);
    ctr.set(0, planeY, 0);
    plane.setFromNormalAndCoplanarPoint(nrm, ctr);

    key.position.set(0.5 * H, 1.0 * H, 1.4 * H);
    glint.position.set(0, 0.30 * H, 0.45 * H);
    glint.intensity = 0.02 * H * H;   // physical 1/r^2 falloff, so intensity tracks scene scale
    glint.distance = 1.4 * H;
  }
  relayout();

  // ------------------------------------------------------------ pointer
  // Beads live on the tilted plane, so the trap has to be picked there — pick the ground
  // and the cursor would grab beads it is nowhere near on screen.
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), hit = new THREE.Vector3();

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      const b = (hit.y - planeY) * VY + hit.z * VZ;    // (hit − centre)·v̂
      PHY.setPointer(W / 2 + hit.x / PLANE_S, H * C.wordY - b / (PLANE_S * PLANE_V));
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
