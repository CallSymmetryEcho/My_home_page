// scene3d.js — Three.js layer over physics.js.
//
// Projection: physics is 2D in CSS px on the ground plane. physics (x, y) maps to
// scene (x - W/2, ·, H/2 - y) — i.e. screen-y runs into -z — and +Y is up, out of
// the sheet. The terrain surface is V(x, y) itself; the beads ride on top of it.

import * as THREE from 'three';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import * as PHY from './physics.js';

const GW = 151, GH = 85;               // potential grid == terrain vertex lattice (150 x 84 segments)
const LOG50 = Math.log1p(50);          // log relief normaliser: u = 50 lands on the plateau
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
  renderer.setClearColor(0x060b18, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  PHY.init(W, H, GW, GH);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 1, 20000);
  const look = new THREE.Vector3();
  let baseY = 0, baseZ = 0;

  // ------------------------------------------------------------ environment + lights
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  room.dispose(); pmrem.dispose();

  const ambient = new THREE.AmbientLight(0x40597a, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  const glint = new THREE.PointLight(0x5eead4, 1, 1, 2);   // intensity/range set in relayout (they scale with H)
  scene.add(ambient, key, glint);

  // ------------------------------------------------------------ terrain
  // Vertex (gx, gy) of a PlaneGeometry(_, _, GW-1, GH-1) has index gx + GW*gy — the same
  // row-major layout fillPotential() writes — so positions can be authored directly in
  // scene space and the plane's own width/height never matter. DoubleSide keeps winding moot.
  const terGeo = new THREE.PlaneGeometry(1, 1, GW - 1, GH - 1);
  terGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3));
  terGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  terGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);

  const wireMat = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  // opaque shell just under the wires, so hills hide the mesh behind them
  const occMat = new THREE.MeshBasicMaterial({ color: 0x060b18, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const occluder = new THREE.Mesh(terGeo, occMat);
  const wire = new THREE.Mesh(terGeo, wireMat);
  occluder.renderOrder = 0; wire.renderOrder = 1;
  occluder.frustumCulled = wire.frustumCulled = false;   // positions are authored, bounds are stale
  scene.add(occluder, wire);

  const vbuf = new Float32Array(GW * GH);   // V from physics
  const hgt = new Float32Array(GW * GH);    // terrain Y, shared with the bead placement
  const LOW = new THREE.Color().setRGB(10 / 255, 18 / 255, 38 / 255, THREE.SRGBColorSpace);
  const HI = new THREE.Color().setRGB(94 / 255, 234 / 255, 212 / 255, THREE.SRGBColorSpace);

  function updateTerrain() {
    PHY.fillPotential(vbuf);
    const p = terGeo.attributes.position.array, col = terGeo.attributes.color.array;
    const invRef = 1 / C.pesVref, sharp = C.canyonSharpen, relief = C.terrainRelief / LOG50;
    for (let k = 0; k < vbuf.length; k++) {
      let u = vbuf[k] * invRef;
      if (sharp !== 1) u = Math.pow(u, sharp);
      const y = relief * Math.log1p(u);       // log compression: plateau and cursor hill both fit
      hgt[k] = y; p[k * 3 + 1] = y;
      const t = Math.exp(-2.2 * u);           // Boltzmann weight — deep wells glow
      col[k * 3] = LOW.r + (HI.r - LOW.r) * t;
      col[k * 3 + 1] = LOW.g + (HI.g - LOW.g) * t;
      col[k * 3 + 2] = LOW.b + (HI.b - LOW.b) * t;
    }
    terGeo.attributes.position.needsUpdate = true;
    terGeo.attributes.color.needsUpdate = true;
  }

  // bilinear read of the height buffer at physics (x, y)
  function sampleH(x, y) {
    const g = PHY.grid;
    let a = (x - g.x0) / g.dx, b = (y - g.y0) / g.dy;
    a = a < 0 ? 0 : a > GW - 1 ? GW - 1 : a;
    b = b < 0 ? 0 : b > GH - 1 ? GH - 1 : b;
    const i0 = a | 0, j0 = b | 0;
    const i1 = i0 < GW - 1 ? i0 + 1 : i0, j1 = j0 < GH - 1 ? j0 + 1 : j0;
    const fa = a - i0, fb = b - j0, r0 = j0 * GW, r1 = j1 * GW;
    return (hgt[r0 + i0] + (hgt[r0 + i1] - hgt[r0 + i0]) * fa) * (1 - fb)
         + (hgt[r1 + i0] + (hgt[r1 + i1] - hgt[r1 + i0]) * fa) * fb;
  }

  // ------------------------------------------------------------ beads
  const N = C.N;
  const idxMain = [], idxTrac = [];
  for (let i = 0; i < N; i++) (PHY.state.tracer[i] ? idxTrac : idxMain).push(i);
  const scl = new Float32Array(N);
  for (let i = 0; i < N; i++) scl[i] = 0.85 + Math.random() * 0.30;

  const beadGeo = new THREE.SphereGeometry(2.8, 24, 16);
  const glassMat = new THREE.MeshPhysicalMaterial({
    metalness: 0, roughness: 0.06, transmission: 0.92, thickness: 5,
    ior: 1.45, color: 0xd9fff6, envMapIntensity: 1.3,
  });
  const tracMat = glassMat.clone();
  tracMat.color.set(0xffd27a);

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
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], s = scl[i], x = px[i], y = py[i];
      M4.makeScale(s, s, s);
      M4.setPosition(x - W / 2, sampleH(x, y) + C.hover + pz[i], H / 2 - y);
      mesh.setMatrixAt(k, M4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ post
  const composer = new EffectComposer(renderer);   // picks up the renderer's size + DPR
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.85, 0.55, 0.6);
  const outPass = new OutputPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(outPass);

  // ------------------------------------------------------------ layout
  function relayout() {
    // static half of the terrain vertices: x and z never move between resizes
    const g = PHY.grid, p = terGeo.attributes.position.array;
    for (let gy = 0; gy < GH; gy++) {
      const sz = H / 2 - (g.y0 + gy * g.dy);
      for (let gx = 0; gx < GW; gx++) {
        const o = (gy * GW + gx) * 3;
        p[o] = g.x0 + gx * g.dx - W / 2;
        p[o + 2] = sz;
      }
    }
    baseY = 0.62 * H; baseZ = 0.95 * H;
    look.set(0, 0, -0.06 * H);
    camera.position.set(0, baseY, baseZ);
    camera.lookAt(look);
    key.position.set(0.35 * H, 0.9 * H, 0.8 * H);
    // the word sits at wordY of the viewport -> z = H/2 - wordY*H
    glint.position.set(0, 0.16 * H, H * (0.5 - C.wordY));
    glint.intensity = 0.035 * H * H;   // physical 1/r^2 falloff, so intensity tracks scene scale
    glint.distance = 1.8 * H;
  }
  relayout();

  // ------------------------------------------------------------ pointer
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // back-convert the ground hit into physics coords (inverse of the map at the top)
    if (ray.ray.intersectPlane(ground, hit)) PHY.setPointer(hit.x + W / 2, H / 2 - hit.z);
    else PHY.clearPointer();
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
    fpsEl.style.cssText = 'position:fixed;top:8px;right:10px;z-index:9;pointer-events:none;' +
      'font:11px ui-monospace,Menlo,monospace;color:#5eead4;opacity:.7';
    document.body.appendChild(fpsEl);
  }

  // ------------------------------------------------------------ loop
  let raf = 0, acc = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(0.1, (now - last) / 1000); last = now;
    while (acc >= C.dt) { PHY.step(C.dt); acc -= C.dt; }

    camera.position.x += (ndc.x * 0.03 * H - camera.position.x) * 0.05;
    camera.position.y += (baseY + ndc.y * 0.03 * H - camera.position.y) * 0.05;
    camera.lookAt(look);

    updateTerrain();
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

  if (reduced) {
    // no animation: fast-forward ~6 s so the name is already assembled, then one frame
    for (let i = 0; i < 360; i++) PHY.step(C.dt);
    updateTerrain();
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
      terGeo.dispose(); beadGeo.dispose();
      wireMat.dispose(); occMat.dispose(); glassMat.dispose(); tracMat.dispose();
      meshMain.dispose(); meshTrac.dispose();
      envRT.dispose(); scene.environment = null;
      renderer.dispose();
    },
  };
}
