/* =========================================================================
   SUNSET CITY — a "mini GTA" in real 3D
   three.js r170 (ES module from CDN, import map in index.html)
   Everything procedural: canvas textures, merged/instanced geometry.
   ========================================================================= */
import * as THREE from 'three';

/* ---------------- error surface ---------------- */
const errBox = document.getElementById('err');
function fatal(msg) { errBox.style.display = 'block'; errBox.textContent = 'Startup error: ' + msg; }
window.addEventListener('error', (e) => fatal(e.message || 'unknown'));

/* ---------------- tiny utils ---------------- */
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5EEDC1FE);          // seeded -> identical city every reload
const rr = (a, b) => a + rand() * (b - a);
const ri = (a, b) => Math.floor(a + rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/* ---------------- city config ---------------- */
const N = 8;                    // blocks per side
const PITCH = 66;               // block+road pitch (m)
const HALF = N * PITCH / 2;     // 264 -> city spans -264..264
const ROAD_C = [];              // road centerline coords (9 per axis, incl. edges)
for (let k = 0; k <= N; k++) ROAD_C.push(-HALF + k * PITCH);
const BLOCK_C = [];             // block center coords (8 per axis)
for (let k = 0; k < N; k++) BLOCK_C.push(ROAD_C[k] + PITCH / 2);

/* ---------------- renderer / scene / camera ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.domElement.id = 'game';
document.body.appendChild(renderer.domElement);
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xdfa877);
scene.fog = new THREE.Fog(FOG_COLOR, 70, 340);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2500);

/* ---------------- lights (golden hour) ---------------- */
const SUN_DIR = new THREE.Vector3(-0.62, 0.30, -0.50).normalize();
const hemi = new THREE.HemisphereLight(0x93b7e8, 0xb98a63, 0.85);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x40342a, 0.35);
scene.add(amb);
const sun = new THREE.DirectionalLight(0xffc98f, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 500;
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.6;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

/* ---------------- canvas texture helpers ---------------- */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  return t;
}
function speckle(g, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = (rand() < 0.5) ? light : dark;
    g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(1, 3));
  }
}
const asphaltTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#33343a'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 900, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.18)');
});
const concreteTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#b3aea1'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 500, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)');
  g.strokeStyle = 'rgba(40,38,32,0.4)'; g.lineWidth = 3;
  g.strokeRect(0, 0, w, h);              // slab joint every tile
});
const grassTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#5c7a3b'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 1100, 'rgba(180,220,120,0.10)', 'rgba(20,40,10,0.16)');
});

/* facade textures: one tile = 4x4 windows (12m x 12m in world). map + emissive pair */
function facadePair(style) {
  const cell = 64;
  const litP = style === 'glass' ? 0.38 : 0.26;
  const wall = style === 'glass' ? '#b8c2cb' : '#d9d2c4';
  const frame = style === 'glass' ? '#5c666e' : '#8a8272';
  const dark = style === 'glass' ? '#243240' : '#2b3442';
  const litCol = style === 'glass' ? '#cfe2ff' : '#ffd489';
  const emiCol = style === 'glass' ? '#a8c8ff' : '#ffb45e';
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = 256; e.height = 256;
  const ge = e.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 420, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.05)');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const px = x * cell, py = y * cell;
    g.fillStyle = frame; g.fillRect(px + 9, py + 7, 46, 52);
    const lit = rand() < litP;
    g.fillStyle = lit ? litCol : dark;
    const wx = px + 13, wy = py + 11, ww = 38, wh = 44;
    g.fillRect(wx, wy, ww, wh);
    if (lit) { ge.fillStyle = emiCol; ge.fillRect(wx, wy, ww, wh); }
    g.fillStyle = 'rgba(0,0,0,0.28)';       // mullions
    g.fillRect(px + 31, py + 11, 2, 44);
    g.fillRect(px + 13, py + 31, 38, 2);
    g.fillStyle = 'rgba(0,0,0,0.16)';       // floor band
    g.fillRect(px, py + 60, 64, 4);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = ANISO;
  const emi = new THREE.CanvasTexture(e);
  emi.colorSpace = THREE.SRGBColorSpace;
  emi.wrapS = emi.wrapT = THREE.RepeatWrapping; emi.anisotropy = ANISO;
  return { map, emi };
}
const facadeA = facadePair('classic');
const facadeB = facadePair('glass');

/* sky gradient (big backside sphere) + sun glow sprite */
const skyTex = canvasTex(4, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0.00, '#33518e');
  gr.addColorStop(0.34, '#7e97c4');
  gr.addColorStop(0.46, '#d9a877');
  gr.addColorStop(0.50, '#f2c689');
  gr.addColorStop(0.58, '#e0b183');
  gr.addColorStop(1.00, '#b98f63');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, true);
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 24, 14),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
);
sky.renderOrder = -1;
scene.add(sky);

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,246,220,1)');
    gr.addColorStop(0.25, 'rgba(255,214,140,0.9)');
    gr.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }),
  fog: false, transparent: true, depthWrite: false
}));
sunSprite.scale.set(300, 300, 1);
scene.add(sunSprite);

/* ---------------- merge / tint helpers (static geometry batching) ---------------- */
function tintGeom(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
/* scale box UVs so the texture tiles every `tile` meters (top face optional) */
function scaleBoxUVs(geo, w, h, d, tile, topTile) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      const u = uv.getX(idx), v = uv.getY(idx);
      if (f === 2 || f === 3) {         // +y / -y
        if (topTile) uv.setXY(idx, u * w / topTile, v * d / topTile);
        else uv.setXY(idx, 0.03, 0.03);
      } else if (f === 0 || f === 1) {  // +x / -x
        uv.setXY(idx, u * d / tile, v * h / tile);
      } else {                          // +z / -z
        uv.setXY(idx, u * w / tile, v * h / tile);
      }
    }
  }
  return geo;
}
function mergeGeoms(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    uv.set(p.attributes.uv.array, o * 2);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function addBox(list, w, h, d, x, y, z, color, tile, topTile) {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleBoxUVs(g, w, h, d, tile || 4, topTile);
  tintGeom(g, color);
  g.translate(x, y, z);
  list.push(g);
}
function buildMerged(list, material, cast) {
  if (!list.length) return null;
  const mesh = new THREE.Mesh(mergeGeoms(list), material);
  mesh.castShadow = !!cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
function makeInstanced(geo, mat, items, cast) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  for (let i = 0; i < items.length; i++) {
    im.setMatrixAt(i, items[i].m);
    if (items[i].c) im.setColorAt(i, items[i].c);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = !!cast;
  im.frustumCulled = false;
  scene.add(im);
  return im;
}

/* ---------------- city generation ---------------- */
const buildingBoxes = [];   // {x0,x1,z0,z1} AABBs for collision
const treeCircles = [];     // {x,z,r}
const blockTypes = [];
const lotBlocks = [];

for (let i = 0; i < N; i++) {
  blockTypes[i] = [];
  for (let j = 0; j < N; j++) {
    const r = rand();
    blockTypes[i][j] = r < 0.10 ? 'park' : (r < 0.145 ? 'lot' : 'build');
    if (blockTypes[i][j] === 'lot') lotBlocks.push([i, j]);
  }
}

const facadeGeomsA = [], facadeGeomsB = [], trimGeoms = [], slabGeoms = [], grassGeoms = [], paintGeoms = [];

const ROOF_PAL = ['#6d7076', '#7d7468', '#565b63', '#8a8177', '#4f545c', '#75665a'];
const WALL_PAL = ['#d9cfc0', '#cfc3ae', '#c8b9a8', '#d6d2ca', '#c2b6a4', '#bd8f7f', '#b3a48e', '#c9beb2'];
const GLASS_PAL = ['#aebfc9', '#9fb3c2', '#b8c4cc', '#93a7b5'];
const HOUSE_PAL = ['#c9b391', '#b08a6e', '#9aa48a', '#c2b8a0', '#a89a86', '#b8a0a0'];

function addBuilding(cx, cz, w, d, h, style, withBase) {
  const pal = style === 'glass' ? GLASS_PAL : WALL_PAL;
  const tint = pick(pal);
  if (withBase) addBox(trimGeoms, w + 0.4, 3, d + 0.4, cx, 1.5, cz, '#5c5a55');
  const bodyH = h - (withBase ? 3 : 0);
  const y0 = withBase ? 3 : 0;
  const g = new THREE.BoxGeometry(w, bodyH, d);
  scaleBoxUVs(g, w, bodyH, d, 12);
  tintGeom(g, tint);
  g.translate(cx, y0 + bodyH / 2, cz);
  (style === 'glass' ? facadeGeomsB : facadeGeomsA).push(g);
  // roof slab + clutter
  addBox(trimGeoms, w + 0.7, 0.5, d + 0.7, cx, h + 0.2, cz, pick(ROOF_PAL));
  const acN = ri(1, 2);
  for (let a = 0; a < acN; a++) {
    const s = rr(1.2, 2.4);
    addBox(trimGeoms, s, s * 0.8, s, cx + rr(-w / 2 + 2, w / 2 - 2), h + 0.45 + s * 0.4, cz + rr(-d / 2 + 2, d / 2 - 2), pick(['#9aa0a6', '#7c8288']));
  }
  if (h > 30 && rand() < 0.55) {
    const len = rr(2.5, 4.5);
    const ant = new THREE.CylinderGeometry(0.07, 0.07, len, 5);
    tintGeom(ant, '#3c4046');
    ant.translate(cx + rr(-w / 3, w / 3), h + 0.5 + len / 2, cz + rr(-d / 3, d / 3));
    trimGeoms.push(ant);
  }
  buildingBoxes.push({
    x0: cx - (w / 2 + 0.35), x1: cx + (w / 2 + 0.35),
    z0: cz - (d / 2 + 0.35), z1: cz + (d / 2 + 0.35)
  });
}
function addHouse(cx, cz) {
  const c = pick(HOUSE_PAL);
  addBox(trimGeoms, 9, 6, 9, cx, 3, cz, c);
  addBox(trimGeoms, 9.8, 0.6, 9.8, cx, 6.3, cz, pick(['#6b4a3a', '#54575e', '#7a5a48']));
  buildingBoxes.push({ x0: cx - 4.9, x1: cx + 4.9, z0: cz - 4.9, z1: cz + 4.9 });
}

const treeItems = { trunk: [], cone1: [], cone2: [] };
const CANOPY = new THREE.Color();

function addTree(x, z, y) {
  const s = rr(0.8, 1.3);
  const m = new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeScale(s, s, s));
  CANOPY.setHSL(0.28 + rr(-0.03, 0.06), 0.5, 0.26 + rr(0, 0.12));
  treeItems.trunk.push({ m });
  treeItems.cone1.push({ m, c: CANOPY.clone() });
  treeItems.cone2.push({ m, c: CANOPY.clone() });
  treeCircles.push({ x, z, r: 0.45 });
}

for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const cx = BLOCK_C[i], cz = BLOCK_C[j];
    const type = blockTypes[i][j];
    // sidewalk slab for every block
    addBox(slabGeoms, 52, 0.14, 52, cx, 0.07, cz, '#c9c4b8', 2, 2);
    if (type === 'park') {
      addBox(grassGeoms, 46, 0.14, 46, cx, 0.21, cz, pick(['#96b06c', '#8aa862', '#a0b478']), 3, 3);
      const nT = ri(10, 15);
      for (let t = 0; t < nT; t++) addTree(cx + rr(-21, 21), cz + rr(-21, 21), 0.28);
    } else if (type === 'lot') {
      addBox(slabGeoms, 48, 0.06, 48, cx, 0.17, cz, '#3e4046', 4, 4);
      addBox(paintGeoms, 0.15, 0.02, 4.6, cx, 0.21, cz, '#d8d8d8'); // lot hint
    } else {
      const dFac = Math.max(Math.abs(cx), Math.abs(cz)) / HALF;   // 0 downtown -> 1 edge
      const snapH = (h) => clamp(Math.round(h / 3) * 3, 12, 39);
      const pat = rand();
      if (pat < 0.30) {           // single tower
        const w = 3 * ri(8, 14), d = 3 * ri(8, 14);
        const h = snapH(lerp(34, 14, dFac) + rr(-6, 10));
        const style = rand() < 0.2 + 0.35 * (1 - dFac) ? 'glass' : 'classic';
        addBuilding(cx + rr(-1, 1) * (43 - w) / 2 * 0.6, cz + rr(-1, 1) * (43 - d) / 2 * 0.6, w, d, h, style, true);
      } else if (pat < 0.50) {    // two slabs
        const vert = rand() < 0.5;
        for (let s = -1; s <= 1; s += 2) {
          const h = snapH(lerp(28, 13, dFac) + rr(-4, 10));
          const style = rand() < 0.25 + 0.3 * (1 - dFac) ? 'glass' : 'classic';
          if (vert) addBuilding(cx + s * 13, cz + rr(-2, 2), 18, 3 * ri(10, 14), h, style, true);
          else addBuilding(cx + rr(-2, 2), cz + s * 13, 3 * ri(10, 14), 18, h, style, true);
        }
      } else if (pat < 0.70) {    // four quads
        for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
          const h = snapH(lerp(24, 12, dFac) + rr(-3, 9));
          const style = rand() < 0.25 ? 'glass' : 'classic';
          addBuilding(cx + sx * 11, cz + sz * 11, 18, 18, h, style, true);
        }
      } else if (pat < 0.85) {    // podium + tower
        const w = 3 * ri(6, 9), d = 3 * ri(6, 9);
        const h = snapH(lerp(38, 16, dFac) + rr(0, 8));
        addBox(trimGeoms, 42, 6, 42, cx, 3, cz, '#6a675f');
        addBox(trimGeoms, 42.7, 0.5, 42.7, cx, 6.2, cz, pick(ROOF_PAL));
        addBuilding(cx, cz, w, d, h + 6, rand() < 0.5 ? 'glass' : 'classic', false);
        buildingBoxes.push({ x0: cx - 21.35, x1: cx + 21.35, z0: cz - 21.35, z1: cz + 21.35 }); // podium is solid
      } else {                    // small houses
        const n = ri(5, 6);
        for (let hn = 0; hn < n; hn++) {
          addHouse(cx + rr(-16, 16), cz + rr(-16, 16));
        }
      }
    }
  }
}

/* road paint: center dashes (yellow), edge lines (white), crosswalk stripes (white) */
for (let k = 0; k <= N; k++) {
  for (let a = -HALF + 8; a < HALF - 4; a += 9) {
    addBox(paintGeoms, 0.3, 0.02, 3, ROAD_C[k], 0.03, a, '#d9a83c');      // vertical road dashes
    addBox(paintGeoms, 3, 0.02, 0.3, a, 0.03, ROAD_C[k], '#d9a83c');      // horizontal road dashes
  }
  for (let s = -1; s <= 1; s += 2) {
    addBox(paintGeoms, 0.18, 0.02, HALF * 2 - 16, ROAD_C[k] + s * 6.1, 0.03, 0, '#c8c8c8');
    addBox(paintGeoms, HALF * 2 - 16, 0.02, 0.18, 0, 0.03, ROAD_C[k] + s * 6.1, '#c8c8c8');
  }
}
for (let k = 1; k < N; k++) for (let m = 1; m < N; m++) {
  const ix = ROAD_C[k], iz = ROAD_C[m];
  for (let s = -1; s <= 1; s += 2) {
    for (let st = -2; st <= 2; st++) {                                    // crosswalks
      addBox(paintGeoms, 0.7, 0.02, 2.4, ix + st * 1.5, 0.035, iz + s * 5.2, '#cfcfcf');
      addBox(paintGeoms, 2.4, 0.02, 0.7, ix + s * 5.2, 0.035, iz + st * 1.5, '#cfcfcf');
    }
  }
}

/* street lamps (instanced) */
const lampSpots = [];
for (let k = 0; k <= N; k++) {
  for (let m = 0; m < 3; m++) {
    const along = -HALF + 110 + m * 176;
    const side = ((k + m) % 2 === 0) ? 1 : -1;
    lampSpots.push([ROAD_C[k] + side * 7.9, along]);
    lampSpots.push([along, ROAD_C[k] + side * 7.9]);
  }
}
const lampPoleItems = [], lampHeadItems = [], lampBulbItems = [];
for (const [lx, lz] of lampSpots) {
  const m = new THREE.Matrix4().makeTranslation(lx, 0.14, lz);
  lampPoleItems.push({ m });
  lampHeadItems.push({ m: new THREE.Matrix4().makeTranslation(lx, 4.72, lz) });
  lampBulbItems.push({ m: new THREE.Matrix4().makeTranslation(lx, 4.56, lz) });
}

/* ground */
const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(2200, 2200),
  new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 })
);
groundMesh.material.map.repeat.set(220, 220);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

/* materials for merged city */
const facadeMatA = new THREE.MeshStandardMaterial({
  map: facadeA.map, emissiveMap: facadeA.emi, emissive: 0xffffff, emissiveIntensity: 0.85,
  vertexColors: true, roughness: 0.85, metalness: 0.08
});
const facadeMatB = new THREE.MeshStandardMaterial({
  map: facadeB.map, emissiveMap: facadeB.emi, emissive: 0xffffff, emissiveIntensity: 1.1,
  vertexColors: true, roughness: 0.6, metalness: 0.25
});
const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
const slabMat = new THREE.MeshStandardMaterial({ map: concreteTex, vertexColors: true, roughness: 0.95 });
const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 1 });
const paintMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});

buildMerged(facadeGeomsA, facadeMatA, true);
buildMerged(facadeGeomsB, facadeMatB, true);
buildMerged(trimGeoms, trimMat, true);
buildMerged(slabGeoms, slabMat, false);
buildMerged(grassGeoms, grassMat, false);
buildMerged(paintGeoms, paintMat, false);

/* instanced trees + lamps */
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.7, 6); trunkGeo.translate(0, 0.85, 0);
const cone1Geo = new THREE.ConeGeometry(1.7, 2.8, 7); cone1Geo.translate(0, 2.9, 0);
const cone2Geo = new THREE.ConeGeometry(1.15, 2.0, 7); cone2Geo.translate(0, 4.1, 0);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
makeInstanced(trunkGeo, trunkMat, treeItems.trunk, true);
makeInstanced(cone1Geo, canopyMat, treeItems.cone1, true);
makeInstanced(cone2Geo, canopyMat, treeItems.cone2, true);

const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 4.6, 6); poleGeo.translate(0, 2.3, 0);
const lampHeadGeo = new THREE.BoxGeometry(0.55, 0.16, 0.28);
const lampBulbGeo = new THREE.SphereGeometry(0.11, 8, 6);
makeInstanced(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.5 }), lampPoleItems, true);
makeInstanced(lampHeadGeo, new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.4 }), lampHeadItems, false);
makeInstanced(lampBulbGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampBulbItems, false);

/* ---------------- cars ---------------- */
const carBodyGeo = new THREE.BoxGeometry(1.9, 0.62, 4.5);
const carCabinGeo = new THREE.BoxGeometry(1.72, 0.55, 2.3);
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12); wheelGeo.rotateZ(Math.PI / 2);
const hlGeo = new THREE.BoxGeometry(1.7, 0.16, 0.08);
const tlGeo = new THREE.BoxGeometry(1.7, 0.14, 0.08);
const copBandGeo = new THREE.BoxGeometry(1.94, 0.5, 1.7);
const barBaseGeo = new THREE.BoxGeometry(1.15, 0.1, 0.42);
const barRedGeo = new THREE.BoxGeometry(0.5, 0.16, 0.4);
const glassMat = new THREE.MeshStandardMaterial({ color: 0x18222c, roughness: 0.25, metalness: 0.75 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.4, metalness: 0.4 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
const tlMat = new THREE.MeshBasicMaterial({ color: 0xff3524 });
const copRedMat = new THREE.MeshBasicMaterial({ color: 0xff2018 });
const copBlueMat = new THREE.MeshBasicMaterial({ color: 0x2255ff });
const CAR_COLORS = [0xb8b8bd, 0x22252a, 0x8a1f1f, 0x1f4d7a, 0x7a7f86, 0x3c5c3f, 0xc9c19a, 0x5a3c6e, 0xd97b2f];

function makeCar(color, police) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const body = new THREE.Mesh(carBodyGeo, bodyMat);
  body.position.y = 0.62; body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(carCabinGeo, police ? whiteMat : glassMat);
  cabin.position.set(0, 1.12, -0.25); cabin.castShadow = true;
  g.add(cabin);
  const hl = new THREE.Mesh(hlGeo, hlMat); hl.position.set(0, 0.66, 2.26); g.add(hl);
  const tl = new THREE.Mesh(tlGeo, tlMat); tl.position.set(0, 0.68, -2.26); g.add(tl);
  const wheels = [], pivots = [];
  for (const [wx, wz, front] of [[-0.82, 1.45, 1], [0.82, 1.45, 1], [-0.82, -1.45, 0], [0.82, -1.45, 0]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    if (front) {
      const p = new THREE.Group(); p.position.set(wx, 0.36, wz);
      p.add(w); g.add(p); pivots.push(p);
    } else {
      w.position.set(wx, 0.36, wz); g.add(w);
    }
    wheels.push(w);
  }
  if (police) {
    const band = new THREE.Mesh(copBandGeo, new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 }));
    band.position.set(0, 0.62, 0.1); g.add(band);
    const base = new THREE.Mesh(barBaseGeo, new THREE.MeshStandardMaterial({ color: 0x1a1c20 }));
    base.position.set(0, 1.45, -0.25); g.add(base);
    const red = new THREE.Mesh(barRedGeo, copRedMat); red.position.set(-0.29, 1.56, -0.25); g.add(red);
    const blue = new THREE.Mesh(barRedGeo, copBlueMat); blue.position.set(0.29, 1.56, -0.25); g.add(blue);
  }
  return { group: g, bodyMat, wheels, pivots, origColor: color };
}

const allCars = [];
const cops = [];

function spawnCar(kind, x, z, heading, color) {
  const cm = makeCar(color, kind === 'cop');
  const c = {
    kind, pos: new THREE.Vector3(x, 0, z), heading, vel: new THREE.Vector3(),
    steer: 0, speed: 0, wheelSpin: 0, roll: 0, stun: 0,
    stuckT: 0, revT: 0, lastSteer: 0,
    group: cm.group, bodyMat: cm.bodyMat, wheels: cm.wheels, pivots: cm.pivots, origColor: cm.origColor
  };
  if (kind === 'traffic') {
    c.axis = rand() < 0.5 ? 'x' : 'z';
    c.dir = rand() < 0.5 ? 1 : -1;
    c.road = ri(0, N);
    c.cruise = rr(7, 10.5);
  }
  cm.group.position.set(x, 0, z);
  cm.group.rotation.y = heading;
  scene.add(cm.group);
  allCars.push(c);
  if (kind === 'cop') cops.push(c);
  return c;
}

function roadSpot(minD, maxD, fromX, fromZ) {
  for (let t = 0; t < 40; t++) {
    const axis = rand() < 0.5 ? 'x' : 'z';
    const k = ri(0, N);
    const along = rr(-HALF + 10, HALF - 10);
    const x = axis === 'z' ? ROAD_C[k] : along;
    const z = axis === 'z' ? along : ROAD_C[k];
    const d = dist2D(x, z, fromX, fromZ);
    if (d >= minD && d <= maxD) return { x, z, axis, k };
  }
  return null;
}
function spawnTraffic() {
  const spot = roadSpot(25, HALF, player.pos.x, player.pos.z) || { x: 0, z: 0, axis: 'z', k: 4 };
  const dir = rand() < 0.5 ? 1 : -1;
  const c = spawnCar('traffic', spot.x, spot.z, 0, pick(CAR_COLORS));
  c.axis = spot.axis; c.dir = dir; c.road = spot.k; c.cruise = rr(7, 10.5);
  const f = forwardOf(c.heading);
  if (c.axis === 'z') { c.heading = dir > 0 ? 0 : Math.PI; c.pos.x = ROAD_C[c.road] - dir * 3.0; }
  else { c.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2; c.pos.z = ROAD_C[c.road] + dir * 3.0; }
  c.pos.x = clamp(c.pos.x, -HALF + 8, HALF - 8); c.pos.z = clamp(c.pos.z, -HALF + 8, HALF - 8);
}
function spawnCop() {
  const spot = roadSpot(90, 180, focusPos().x, focusPos().z);
  if (!spot) return;
  const c = spawnCar('cop', spot.x, spot.z, 0, 0xe8eaee);
  c.heading = Math.atan2(focusPos().x - spot.x, focusPos().z - spot.z);
}
function removeCops() {
  for (const c of cops) {
    scene.remove(c.group);
    const idx = allCars.indexOf(c);
    if (idx >= 0) allCars.splice(idx, 1);
  }
  cops.length = 0;
}

/* parked cars: roadsides + lots + one next to spawn */
function addParked(axis, k, along, side) {
  const x = axis === 'z' ? ROAD_C[k] + side * 5.4 : along;
  const z = axis === 'z' ? along : ROAD_C[k] + side * 5.4;
  for (const rc of ROAD_C) if (Math.abs(along - rc) < 12) return;  // keep clear of intersections
  const h = axis === 'z' ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  spawnCar('parked', x, z, h, pick(CAR_COLORS));
}
for (let p = 0; p < 10; p++) {
  const axis = rand() < 0.5 ? 'x' : 'z';
  addParked(axis, ri(0, N), rr(-HALF + 20, HALF - 20), rand() < 0.5 ? 1 : -1);
}
for (const [li, lj] of lotBlocks) {
  const cx = BLOCK_C[li], cz = BLOCK_C[lj];
  for (let row = 0; row < 2; row++) for (let col = -1; col <= 1; col++) {
    spawnCar('parked', cx + col * 6.5, cz + (row ? 9 : -9), row ? Math.PI : 0, pick(CAR_COLORS));
  }
}
spawnCar('parked', 5.6, 16, 0, 0x8a1f1f);   // starter car right next to spawn

/* ---------------- physics helpers ---------------- */
function forwardOf(h) { return { x: Math.sin(h), z: Math.cos(h) }; }

function collideWorld(p, r, vel) {
  // buildings (slide along walls)
  for (const b of buildingBoxes) {
    const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-9) {
        const l = p.x - b.x0, rt = b.x1 - p.x, tp = p.z - b.z0, bt = b.z1 - p.z;
        const m = Math.min(l, rt, tp, bt);
        if (m === l) { p.x = b.x0 - r; if (vel && vel.x > 0) vel.x = 0; }
        else if (m === rt) { p.x = b.x1 + r; if (vel && vel.x < 0) vel.x = 0; }
        else if (m === tp) { p.z = b.z0 - r; if (vel && vel.z > 0) vel.z = 0; }
        else { p.z = b.z1 + r; if (vel && vel.z < 0) vel.z = 0; }
      } else {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        p.x = cx + nx * r; p.z = cz + nz * r;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
        }
      }
    }
  }
  // trees
  for (const t of treeCircles) {
    const dx = p.x - t.x, dz = p.z - t.z, rr2 = r + t.r, d2 = dx * dx + dz * dz;
    if (d2 < rr2 * rr2 && d2 > 1e-9) {
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      p.x = t.x + nx * rr2; p.z = t.z + nz * rr2;
      if (vel) {
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
      }
    }
  }
  // city boundary
  const B = HALF - 1.5;
  if (p.x > B) { p.x = B; if (vel && vel.x > 0) vel.x = 0; }
  if (p.x < -B) { p.x = -B; if (vel && vel.x < 0) vel.x = 0; }
  if (p.z > B) { p.z = B; if (vel && vel.z > 0) vel.z = 0; }
  if (p.z < -B) { p.z = -B; if (vel && vel.z < 0) vel.z = 0; }
}
function pointInBuilding(x, z, pad) {
  for (const b of buildingBoxes) {
    if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
  }
  return false;
}
function pointFree(x, z, r) {
  if (pointInBuilding(x, z, r)) return false;
  for (const t of treeCircles) if (dist2D(x, z, t.x, t.z) < r + t.r) return false;
  return true;
}
function groundYAt(x, z) {
  const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
  if (i < 0 || i >= N || j < 0 || j >= N) return 0;
  if (Math.abs(x - BLOCK_C[i]) > 26 || Math.abs(z - BLOCK_C[j]) > 26) return 0;
  if (blockTypes[i][j] === 'park' && Math.abs(x - BLOCK_C[i]) < 23 && Math.abs(z - BLOCK_C[j]) < 23) return 0.28;
  if (blockTypes[i][j] === 'lot' && Math.abs(x - BLOCK_C[i]) < 24 && Math.abs(z - BLOCK_C[j]) < 24) return 0.2;
  return 0.14;
}

/* arcade car physics shared by player + cops + free-rolling cars */
function carPhysics(c, throttle, steerIn, hand, dt, maxSpeed) {
  const f = forwardOf(c.heading);
  const rx = -f.z, rz = f.x;                    // right vector
  let vF = c.vel.x * f.x + c.vel.z * f.z;
  let vR = c.vel.x * rx + c.vel.z * rz;
  c.steer = lerp(c.steer, clamp(steerIn, -1, 1), damp(8, dt));
  const spd = clamp(vF / 12, -1, 1);
  c.heading += c.steer * (hand ? 2.6 : 1.9) * spd * dt;   // sign of vF flips steering in reverse
  if (throttle > 0) vF += throttle * (vF < 0 ? 26 : 17 * (1 - clamp(vF / maxSpeed, 0, 1))) * dt;
  else if (throttle < 0) {
    if (vF > 0.5) vF += throttle * 26 * dt;     // brake
    else if (vF > -11) vF += throttle * 8 * dt; // reverse
  }
  if (hand) vF *= Math.exp(-2.2 * dt);
  vF *= Math.exp(-0.35 * dt);
  if (throttle === 0) vF *= Math.exp(-0.7 * dt);
  vF = clamp(vF, -11, maxSpeed);
  vR *= Math.exp(-(hand ? 1.1 : 6.5) * dt);     // drift-lite: handbrake kills grip
  const f2 = forwardOf(c.heading);
  const rx2 = -f2.z, rz2 = f2.x;
  c.vel.x = f2.x * vF + rx2 * vR;
  c.vel.z = f2.z * vF + rz2 * vR;
  c.pos.x += c.vel.x * dt;
  c.pos.z += c.vel.z * dt;
  c.speed = vF;
}
function carVisual(c, dt) {
  const gy = groundYAt(c.pos.x, c.pos.z);
  c.group.position.set(c.pos.x, lerp(c.group.position.y, gy, damp(9, dt)), c.pos.z);
  c.roll = lerp(c.roll, clamp(-c.steer * c.speed * 0.006, -0.09, 0.09), damp(6, dt));
  c.group.rotation.set(0, c.heading, c.roll);
  c.wheelSpin += (c.speed / 0.36) * dt;
  for (const w of c.wheels) w.rotation.x = c.wheelSpin;
  for (const p of c.pivots) p.rotation.y = c.steer * 0.45;
}
function velOf(c) {
  if (c.kind === 'traffic' || c.kind === 'parked') {
    const f = forwardOf(c.heading);
    return { x: f.x * (c.speed || 0), z: f.z * (c.speed || 0) };
  }
  return { x: c.vel.x, z: c.vel.z };
}
function moveWeight(c) { return c.kind === 'parked' ? 0.12 : 1; }

/* ---------------- pedestrians (instanced crowd) ---------------- */
const PED_N = 40;
const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.55, 3, 8);
const headGeo = new THREE.SphereGeometry(0.16, 8, 6);
const legGeo = new THREE.BoxGeometry(0.13, 0.78, 0.15); legGeo.translate(0, -0.39, 0);
const armGeo = new THREE.BoxGeometry(0.11, 0.62, 0.13); armGeo.translate(0, -0.31, 0);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
const SHIRTS = [0xb34a4a, 0x4a7ab3, 0x4a9a5c, 0xc9c14a, 0x8a5cb3, 0xc97f2f, 0x7a8a94, 0xb3b3b3, 0x3f4a5a, 0xd97f9f].map(h => new THREE.Color(h));
const PANTS = [0x2a2d34, 0x3c3a45, 0x4f4438, 0x26303a, 0x54463a].map(h => new THREE.Color(h));
const SKINS = [0xe8b48c, 0xc98d5f, 0x8a5a3c, 0xf0c8a0].map(h => new THREE.Color(h));

const pedTorsoIM = new THREE.InstancedMesh(torsoGeo, skinMat.clone(), PED_N);
const pedHeadIM = new THREE.InstancedMesh(headGeo, skinMat.clone(), PED_N);
const pedLegsIM = new THREE.InstancedMesh(legGeo, skinMat.clone(), PED_N * 2);
const pedArmsIM = new THREE.InstancedMesh(armGeo, skinMat.clone(), PED_N * 2);
for (const im of [pedTorsoIM, pedHeadIM, pedLegsIM, pedArmsIM]) {
  im.frustumCulled = false;
  im.castShadow = true;
  scene.add(im);
}

const peds = [];
function pedRingPoint(p) {
  const m = 23.5, cx = BLOCK_C[p.bi], cz = BLOCK_C[p.bj];
  const L = 2 * m;
  let u = ((p.t % (4 * L)) + 4 * L) % (4 * L);
  let x, z, tx, tz;
  if (u < L) { x = -m + u; z = -m; tx = 1; tz = 0; }
  else if (u < 2 * L) { x = m; z = -m + (u - L); tx = 0; tz = 1; }
  else if (u < 3 * L) { x = m - (u - 2 * L); z = m; tx = -1; tz = 0; }
  else { x = -m; z = m - (u - 3 * L); tx = 0; tz = -1; }
  return { x: cx + x, z: cz + z, tx: tx * p.dir, tz: tz * p.dir };
}
function randomizePedColors(p) {
  const shirt = pick(SHIRTS), skin = pick(SKINS), pants = pick(PANTS);
  p.torsoIM.setColorAt(p.idx, shirt);
  p.headIM.setColorAt(p.idx, skin);
  p.legsIM.setColorAt(p.idx * 2, pants);
  p.legsIM.setColorAt(p.idx * 2 + 1, pants);
  p.armsIM.setColorAt(p.idx * 2, shirt);
  p.armsIM.setColorAt(p.idx * 2 + 1, shirt);
}
function respawnPed(p, nearPlayer) {
  p.state = 'walk'; p.downT = 0; p.fallAng = 0; p.fallDir = rand() < 0.5 ? 1 : -1;
  for (let tries = 0; tries < 20; tries++) {
    let bi, bj;
    if (nearPlayer) {
      const fx = focusPos().x, fz = focusPos().z;
      bi = clamp(Math.floor((fx + HALF) / PITCH) + ri(-2, 2), 0, N - 1);
      bj = clamp(Math.floor((fz + HALF) / PITCH) + ri(-2, 2), 0, N - 1);
      const d = dist2D(BLOCK_C[bi], BLOCK_C[bj], fx, fz);
      if (d < 60 || d > 170) continue;
    } else {
      bi = ri(0, N - 1); bj = ri(0, N - 1);
    }
    p.bi = bi; p.bj = bj; break;
  }
  p.t = rr(0, 4 * 2 * 23.5);
  p.dir = rand() < 0.5 ? 1 : -1;
  p.speed = rr(1.1, 2.1);
  p.scale = rr(0.88, 1.1);
  p.phase = rr(0, 6.28);
  const pt = pedRingPoint(p);
  p.pos.set(pt.x, 0.14, pt.z);
  p.yaw = Math.atan2(pt.tx, pt.tz);
  randomizePedColors(p);
  p.colorsDirty = true;
}
for (let i = 0; i < PED_N; i++) {
  const p = {
    idx: i, bi: 0, bj: 0, t: 0, dir: 1, speed: 1.5, scale: 1, phase: 0,
    yaw: 0, state: 'walk', downT: 0, fallAng: 0, fallDir: 1,
    pos: new THREE.Vector3(),
    torsoIM: pedTorsoIM, headIM: pedHeadIM, legsIM: pedLegsIM, armsIM: pedArmsIM,
    colorsDirty: false
  };
  peds.push(p);
  respawnPed(p, false);
}

const _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _pe = new THREE.Euler();
const _pv = new THREE.Vector3(), _ps = new THREE.Vector3(), _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4();
const _idq = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_X = new THREE.Vector3(1, 0, 0);
function setPart(im, i, root, ox, oy, oz, rx) {
  _pq.setFromEuler(_pe.set(rx, 0, 0));
  _pv.set(ox, oy, oz);
  _pm2.compose(_pv, _pq, _ps.set(1, 1, 1));
  _pm.multiplyMatrices(root, _pm2);
  im.setMatrixAt(i, _pm);
}
function updatePeds(dt) {
  for (const p of peds) {
    if (p.state === 'down') {
      p.downT += dt;
      p.fallAng = lerp(p.fallAng, -1.5, damp(10, dt));
      if (p.downT > 9) respawnPed(p, true);
    } else {
      p.t += p.dir * p.speed * dt;
      const pt = pedRingPoint(p);
      p.pos.set(pt.x, 0.14, pt.z);
      p.yaw = lerpAngle(p.yaw, Math.atan2(pt.tx, pt.tz), damp(8, dt));
      p.phase += p.speed * dt * 2.4;
      // recycle far peds near the player to keep streets alive
      if (p.pos.distanceTo(focusPos()) > 230) respawnPed(p, true);
    }
    // root matrix
    _pq2.setFromAxisAngle(AXIS_Y, p.yaw);
    if (p.state === 'down') {
      const qf = new THREE.Quaternion().setFromAxisAngle(AXIS_X, p.fallDir * p.fallAng);
      _pq2.multiply(qf);
    }
    _pv.set(p.pos.x, p.state === 'down' ? lerp(0.14, 0.32, Math.abs(p.fallAng) / 1.5) : 0.14, p.pos.z);
    _pm.compose(_pv, _pq2, _ps.set(p.scale, p.scale, p.scale));
    const swing = p.state === 'down' ? 0 : Math.sin(p.phase) * 0.55 * clamp(p.speed / 1.6, 0.4, 1);
    setPart(pedTorsoIM, p.idx, _pm, 0, 1.16, 0, 0);
    setPart(pedHeadIM, p.idx, _pm, 0, 1.64, 0, 0);
    setPart(pedLegsIM, p.idx * 2, _pm, -0.11, 0.78, 0, swing);
    setPart(pedLegsIM, p.idx * 2 + 1, _pm, 0.11, 0.78, 0, -swing);
    setPart(pedArmsIM, p.idx * 2, _pm, -0.35, 1.5, 0, -swing * 0.8);
    setPart(pedArmsIM, p.idx * 2 + 1, _pm, 0.35, 1.5, 0, swing * 0.8);
    if (p.colorsDirty) {
      pedTorsoIM.instanceColor.needsUpdate = true;
      pedHeadIM.instanceColor.needsUpdate = true;
      pedLegsIM.instanceColor.needsUpdate = true;
      pedArmsIM.instanceColor.needsUpdate = true;
      p.colorsDirty = false;
    }
  }
  pedTorsoIM.instanceMatrix.needsUpdate = true;
  pedHeadIM.instanceMatrix.needsUpdate = true;
  pedLegsIM.instanceMatrix.needsUpdate = true;
  pedArmsIM.instanceMatrix.needsUpdate = true;
}
function knockPed(p) {
  if (p.state === 'down') return;
  p.state = 'down'; p.downT = 0;
  toast('PEDESTRIAN DOWN');
}
function pedCollisions() {
  for (const c of allCars) {
    const sp = Math.abs(c.kind === 'traffic' || c.kind === 'parked' ? (c.speed || 0) : c.speed);
    if (sp < 3.5) continue;
    const f = forwardOf(c.heading);           // test nose and tail, not just center
    const fx1 = c.pos.x + f.x * 1.4, fz1 = c.pos.z + f.z * 1.4;
    const fx2 = c.pos.x - f.x * 1.4, fz2 = c.pos.z - f.z * 1.4;
    for (const p of peds) {
      if (p.state === 'down') continue;
      if (dist2D(p.pos.x, p.pos.z, fx1, fz1) < 1.1 || dist2D(p.pos.x, p.pos.z, fx2, fz2) < 1.1) {
        knockPed(p);
        if (c === currentCar) addWanted(1);
      }
    }
  }
}

/* ---------------- player ---------------- */
function buildPerson(shirt, pants, skin) {
  const g = new THREE.Group();
  const mk = (geo, color, x, y, z, cast) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    m.position.set(x, y, z); m.castShadow = !!cast; g.add(m); return m;
  };
  const torso = mk(torsoGeo, shirt, 0, 1.16, 0, true);
  const head = mk(headGeo, skin, 0, 1.64, 0, true);
  const legL = mk(legGeo, pants, -0.11, 0.78, 0);
  const legR = mk(legGeo, pants, 0.11, 0.78, 0);
  const armL = mk(armGeo, shirt, -0.35, 1.5, 0);
  const armR = mk(armGeo, shirt, 0.35, 1.5, 0);
  return { group: g, torso, head, legL, legR, armL, armR };
}
const person = buildPerson(0xc8452c, 0x2a2d34, 0xd9a06c);
scene.add(person.group);
const player = {
  pos: new THREE.Vector3(2.5, 0, 9), vel: new THREE.Vector3(), heading: 0,
  mode: 'foot', speedCur: 0, walkPhase: 0
};
let camYaw = 0;

/* ---------------- game state ---------------- */
let cash = 0, stars = 0;
let copSpawnT = 0, evadeT = 0, bustT = 0, lastCopRamT = -9, bustedT = 0, elapsed = 0;
let currentCar = null, enterHintT = 0;
let starsDirty = true, cashDirty = true;

function focusPos() { return (player.mode === 'drive' && currentCar) ? currentCar.pos : player.pos; }
function addWanted(n) {
  stars = clamp(stars + n, 0, 5);
  starsDirty = true;
  toast('WANTED ' + '\u2605'.repeat(stars));
}

/* ---------------- checkpoint beacon ---------------- */
const beacon = new THREE.Group();
{
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 34, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc84a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  pillar.position.y = 17;
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 34, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  core.position.y = 17;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.14, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd76a, fog: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.7;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.3, 24), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06;
  const arrowGeo = new THREE.ConeGeometry(1.1, 1.9, 4); arrowGeo.rotateX(Math.PI);
  const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a0, fog: false }));
  arrow.position.y = 6;
  beacon.add(pillar, core, ring, disc, arrow);
  beacon.userData = { ring, arrow, disc, pillar };
}
scene.add(beacon);
const beaconPos = new THREE.Vector3();
function spawnCheckpoint() {
  const f = focusPos();
  for (let t = 0; t < 50; t++) {
    const k = ri(1, N - 1), m = ri(1, N - 1);
    const x = ROAD_C[k], z = ROAD_C[m];
    const d = dist2D(x, z, f.x, f.z);
    if (d > 110 && d < 400) { beaconPos.set(x, 0, z); beacon.position.set(x, 0, z); return; }
  }
  beaconPos.set(ROAD_C[4], 0, ROAD_C[4]); beacon.position.set(ROAD_C[4], 0, ROAD_C[4]);
}
spawnCheckpoint();
for (let i = 0; i < 14; i++) spawnTraffic();   // initial traffic fleet

/* ---------------- input ---------------- */
const keys = {};
let started = false;
const startEl = document.getElementById('start');
function dismissStart() { if (!started) { started = true; startEl.style.display = 'none'; } }
startEl.addEventListener('click', dismissStart);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
  dismissStart();
  if (!e.repeat) {
    keys[e.code] = true;
    if (e.code === 'KeyE') tryEnterExit();
    if (e.code === 'KeyR') tryResetCar();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function tryEnterExit() {
  if (bustedT > 0) return;
  if (player.mode === 'foot') {
    let best = null, bd = 3.9 * 3.9;
    for (const c of allCars) {
      const d = dist2D(player.pos.x, player.pos.z, c.pos.x, c.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) enterCar(best);
  } else exitCar();
}
function enterCar(c) {
  const wasTraffic = c.kind === 'traffic';
  currentCar = c; c.kindPrev = c.kind; c.kind = 'driven';
  player.mode = 'drive';
  player.meshHidden = true;
  person.group.visible = false;
  c.bodyMat.color.setHex(0xffc219);           // your stolen ride reads yellow
  enterHintT = 4;
  if (wasTraffic) { addWanted(1); toast('CARJACKED!'); }
}
function exitCar() {
  const c = currentCar;
  if (!c) return;
  const f = forwardOf(c.heading);
  const rx = -f.z, rz = f.x;
  const spots = [
    [c.pos.x + rx * 2.4, c.pos.z + rz * 2.4],
    [c.pos.x - rx * 2.4, c.pos.z - rz * 2.4],
    [c.pos.x - f.x * 3.4, c.pos.z - f.z * 3.4]
  ];
  let spot = spots[0];
  for (const s of spots) if (pointFree(s[0], s[1], 0.5)) { spot = s; break; }
  player.pos.set(spot[0], 0, spot[1]);
  player.vel.set(0, 0, 0);
  player.mode = 'foot';
  person.group.visible = true;
  c.kind = 'parked'; c.speed = 0; c.vel.set(0, 0, 0);
  c.bodyMat.color.setHex(c.origColor);
  if (c.kindPrev === 'cop') {                  // abandoned cop car stops being a chaser
    const ci = cops.indexOf(c);
    if (ci >= 0) cops.splice(ci, 1);
  }
  currentCar = null;
}
function tryResetCar() {
  if (player.mode !== 'drive' || !currentCar) return;
  const c = currentCar;
  let bestAxis = 'z', bestRoad = 0, bestD = 1e9;
  for (const rc of ROAD_C) {
    if (Math.abs(c.pos.x - rc) < bestD) { bestD = Math.abs(c.pos.x - rc); bestAxis = 'z'; bestRoad = rc; }
    if (Math.abs(c.pos.z - rc) < bestD) { bestD = Math.abs(c.pos.z - rc); bestAxis = 'x'; bestRoad = rc; }
  }
  if (bestAxis === 'z') { c.pos.x = bestRoad; c.heading = 0; }
  else { c.pos.z = bestRoad; c.heading = Math.PI / 2; }
  c.vel.set(0, 0, 0); c.speed = 0;
  toast('CAR RESET');
}

/* ---------------- HUD ---------------- */
const cashEl = document.getElementById('cash');
const starsEl = document.getElementById('stars');
const starSpans = starsEl.querySelectorAll('span');
const objEl = document.getElementById('objective');
const speedEl = document.getElementById('speed');
const speedValEl = document.getElementById('speedVal');
const hintEl = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const bustedEl = document.getElementById('busted');
const bustedSub = document.getElementById('bustedSub');
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
}
function updateHUD() {
  if (cashDirty) { cashEl.textContent = '$' + cash.toLocaleString('en-US'); cashDirty = false; }
  if (starsDirty) {
    starSpans.forEach((s, i) => s.classList.toggle('lit', i < stars));
    starsEl.classList.toggle('hot', stars > 0);
    starsDirty = false;
  }
  const d = Math.round(dist2D(focusPos().x, focusPos().z, beaconPos.x, beaconPos.z));
  objEl.textContent = 'REACH THE BEACON \u00b7 ' + d + 'M \u00b7 +$500';
  if (player.mode === 'drive' && currentCar) {
    speedEl.style.display = 'block';
    speedValEl.textContent = String(Math.round(Math.abs(currentCar.speed) * 3.6));
  } else speedEl.style.display = 'none';
  let hint = '';
  if (enterHintT > 0 && player.mode === 'drive') hint = 'E \u2014 EXIT \u00b7 SPACE \u2014 HANDBRAKE \u00b7 R \u2014 RESET';
  else if (player.mode === 'foot') {
    for (const c of allCars) {
      if (dist2D(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.9) { hint = 'PRESS E \u2014 ENTER CAR'; break; }
    }
  }
  hintEl.style.opacity = hint ? 1 : 0;
  if (hint) hintEl.textContent = hint;
}

/* ---------------- minimap ---------------- */
const mmC = document.getElementById('minimap');
const mm = mmC.getContext('2d');
const MMS = 190, mmScale = MMS / (2 * HALF + 12), mmOff = 6;
const mmStatic = document.createElement('canvas');
mmStatic.width = MMS; mmStatic.height = MMS;
{
  const g = mmStatic.getContext('2d');
  g.fillStyle = '#23262b'; g.fillRect(0, 0, MMS, MMS);
  const toX = (x) => (x + HALF) * mmScale + mmOff;
  const toY = (z) => (z + HALF) * mmScale + mmOff;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = BLOCK_C[i], cz = BLOCK_C[j];
    g.fillStyle = blockTypes[i][j] === 'park' ? '#33502f' : (blockTypes[i][j] === 'lot' ? '#2c2f33' : '#31353c');
    g.fillRect(toX(cx - 26), toY(cz - 26), 52 * mmScale, 52 * mmScale);
  }
  g.fillStyle = '#3c414a';
  for (const b of buildingBoxes) g.fillRect(toX(b.x0), toY(b.z0), (b.x1 - b.x0) * mmScale, (b.z1 - b.z0) * mmScale);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
  g.strokeRect(1, 1, MMS - 2, MMS - 2);
}
function drawMinimap(t) {
  mm.drawImage(mmStatic, 0, 0);
  const toX = (x) => (x + HALF) * mmScale + mmOff;
  const toY = (z) => (z + HALF) * mmScale + mmOff;
  // traffic
  mm.fillStyle = '#9aa0a8';
  for (const c of allCars) {
    if (c.kind === 'traffic') mm.fillRect(toX(c.pos.x) - 1.5, toY(c.pos.z) - 1.5, 3, 3);
  }
  // cops (flashing)
  const flash = Math.floor(t * 6) % 2 === 0;
  mm.fillStyle = flash ? '#ff4040' : '#4a7cff';
  for (const c of cops) {
    mm.beginPath(); mm.arc(toX(c.pos.x), toY(c.pos.z), 3.4, 0, 6.284); mm.fill();
  }
  // beacon
  mm.fillStyle = '#ffd24a';
  const pulse = 3 + Math.sin(t * 4) * 1.2;
  mm.beginPath(); mm.arc(toX(beaconPos.x), toY(beaconPos.z), pulse, 0, 6.284); mm.fill();
  // player arrow
  const fx = focusPos().x, fz = focusPos().z;
  const h = (player.mode === 'drive' && currentCar) ? currentCar.heading : player.heading;
  mm.save();
  mm.translate(toX(fx), toY(fz));
  mm.rotate(-h);
  mm.fillStyle = '#ffffff';
  mm.beginPath();
  mm.moveTo(0, 5); mm.lineTo(-3.4, -3.6); mm.lineTo(3.4, -3.6); mm.closePath(); mm.fill();
  mm.restore();
}

/* ---------------- traffic AI ---------------- */
function updateTraffic(dt) {
  for (const c of allCars) {
    if (c.kind !== 'traffic') continue;
    if (c === currentCar) continue;
    if (c.stun > 0) { c.stun -= dt; c.speed = 0; carVisual(c, dt); continue; }
    // obstacle check ahead
    const f = forwardOf(c.heading);
    let blocked = false;
    const checkObs = (ox, oz) => {
      const dx = ox - c.pos.x, dz = oz - c.pos.z;
      const fwd = dx * f.x + dz * f.z;
      if (fwd > 0 && fwd < 9) {
        const lat = Math.abs(dx * -f.z + dz * f.x);
        if (lat < 1.9) blocked = true;
      }
    };
    for (const o of allCars) { if (o !== c) checkObs(o.pos.x, o.pos.z); }
    if (player.mode === 'foot') checkObs(player.pos.x, player.pos.z);
    const target = blocked ? 0 : c.cruise;
    c.speed = lerp(c.speed, target, damp(blocked ? 4.5 : 1.2, dt));
    // steer back toward lane center
    const along = c.axis === 'x' ? c.pos.x + c.dir * 6 : c.pos.z + c.dir * 6;
    const laneC = c.axis === 'x' ? ROAD_C[c.road] + c.dir * 3.0 : ROAD_C[c.road] - c.dir * 3.0;
    const tx = c.axis === 'x' ? along : laneC;
    const tz = c.axis === 'x' ? laneC : along;
    c.heading = lerpAngle(c.heading, Math.atan2(tx - c.pos.x, tz - c.pos.z), damp(2.2, dt));
    c.pos.x += f.x * c.speed * dt;
    c.pos.z += f.z * c.speed * dt;
    if (c.axis === 'z') { if (c.pos.z > HALF - 3) c.pos.z = -HALF + 3; if (c.pos.z < -HALF + 3) c.pos.z = HALF - 3; }
    else { if (c.pos.x > HALF - 3) c.pos.x = -HALF + 3; if (c.pos.x < -HALF + 3) c.pos.x = HALF - 3; }
    collideWorld(c.pos, 1.3, null);
    carVisual(c, dt);
    // recycle far traffic
    if (c.pos.distanceTo(focusPos()) > 280) {
      const spot = roadSpot(120, 210, focusPos().x, focusPos().z);
      if (spot) {
        c.road = spot.k; c.axis = spot.axis; c.dir = rand() < 0.5 ? 1 : -1;
        if (c.axis === 'z') { c.heading = c.dir > 0 ? 0 : Math.PI; c.pos.set(spot.x, 0, spot.z); c.pos.x = ROAD_C[c.road] - c.dir * 3.0; }
        else { c.heading = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; c.pos.set(spot.x, 0, spot.z); c.pos.z = ROAD_C[c.road] + c.dir * 3.0; }
        c.speed = 0;
      }
    }
  }
}

/* ---------------- cop AI ---------------- */
function updateCops(dt) {
  const tgt = _copT.copy(focusPos());
  if (player.mode === 'drive' && currentCar) tgt.addScaledVector(currentCar.vel, 0.55);
  for (const c of cops) {
    if (c === currentCar) continue;
    const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z;
    const desired = Math.atan2(dx, dz);
    const diff = angleDiff(c.heading, desired);
    let throttle = 1, steer = clamp(diff * 2.0, -1, 1);
    if (Math.abs(diff) > 2.1 && Math.abs(c.speed) > 6) throttle = -0.5;
    if (c.revT > 0) {
      c.revT -= dt;
      throttle = -1; steer = -Math.sign(c.lastSteer || 1);
    } else if (Math.abs(c.speed) < 0.6 && throttle > 0.5) {
      c.stuckT += dt;
      if (c.stuckT > 1.1) { c.revT = 0.9; c.lastSteer = steer; c.stuckT = 0; }
    } else c.stuckT = 0;
    carPhysics(c, throttle, steer, false, dt, 24 + stars * 1.6);
    collideWorld(c.pos, 1.35, c.vel);
    carVisual(c, dt);
  }
}
const _copT = new THREE.Vector3();

/* car-vs-car separation + reactions */
function carVsCar() {
  for (let i = 0; i < allCars.length; i++) {
    for (let j = i + 1; j < allCars.length; j++) {
      const a = allCars[i], b = allCars[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz, minD = 2.7;
      if (d2 > minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, overlap = minD - d;
      const wa = moveWeight(a), wb = moveWeight(b), tot = wa + wb;
      a.pos.x -= nx * overlap * (wb / tot); a.pos.z -= nz * overlap * (wb / tot);
      b.pos.x += nx * overlap * (wa / tot); b.pos.z += nz * overlap * (wa / tot);
      if (a.kind === 'parked') collideWorld(a.pos, 1.3, null);   // parked cars get shoved but stay out of walls
      if (b.kind === 'parked') collideWorld(b.pos, 1.3, null);
      const av = velOf(a), bv = velOf(b);
      const rel = (av.x - bv.x) * nx + (av.z - bv.z) * nz;   // approach speed
      if (rel <= 0.5) continue;
      // player-driven reactions
      if (a === currentCar || b === currentCar) {
        const other = a === currentCar ? b : a;
        const me = a === currentCar ? a : b;
        const sgn = a === currentCar ? -1 : 1;
        me.vel.x += nx * rel * 0.25 * sgn; me.vel.z += nz * rel * 0.25 * sgn;
        if (other.kind === 'parked') { other.kind = 'free'; }
        if (other.kind === 'traffic') { other.stun = 2.5; }
        if (other.kind === 'free') { other.vel.x += nx * rel * 0.5 * -sgn; other.vel.z += nz * rel * 0.5 * -sgn; }
        if (other.kind === 'cop' && rel > 6 && elapsed - lastCopRamT > 2) {
          lastCopRamT = elapsed; addWanted(1); toast('COP CAR RAMMED');
        }
      } else if (a.kind === 'traffic' && b.kind === 'traffic') {
        a.stun = Math.max(a.stun, 1.2); b.stun = Math.max(b.stun, 1.2);
      }
    }
  }
}
function updateFreeCars(dt) {
  for (const c of allCars) {
    if (c.kind !== 'free') continue;
    if (Math.abs(c.vel.x) + Math.abs(c.vel.z) > 0.05) {
      carPhysics(c, 0, 0, false, dt, 30);
      collideWorld(c.pos, 1.35, c.vel);
    }
    carVisual(c, dt);
  }
}

/* ---------------- player updates ---------------- */
function updatePlayerFoot(dt) {
  const cf = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
  const cr = { x: -cf.z, z: cf.x };
  let mx = 0, mz = 0;
  if (keys['KeyW']) { mx += cf.x; mz += cf.z; }
  if (keys['KeyS']) { mx -= cf.x; mz -= cf.z; }
  if (keys['KeyA']) { mx += cr.x; mz += cr.z; }
  if (keys['KeyD']) { mx -= cr.x; mz -= cr.z; }
  const moving = mx !== 0 || mz !== 0;
  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 8.6 : 4.8;
  if (moving) {
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
    player.pos.x += mx * speed * dt;
    player.pos.z += mz * speed * dt;
    player.heading = lerpAngle(player.heading, Math.atan2(mx, mz), damp(10, dt));
    camYaw = lerpAngle(camYaw, player.heading, damp(2.4, dt));
    player.walkPhase += speed * dt * 1.7;
    camYawFollowT = 0;
  }
  player.speedCur = moving ? speed : 0;
  collideWorld(player.pos, 0.4, null);
  // cars push the player
  for (const c of allCars) {
    const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
    const d2 = dx * dx + dz * dz, minD = 1.8;
    if (d2 < minD * minD && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      player.pos.x = c.pos.x + dx / d * minD;
      player.pos.z = c.pos.z + dz / d * minD;
    }
  }
  // animate
  const gy = groundYAt(player.pos.x, player.pos.z);
  person.group.position.set(player.pos.x, lerp(person.group.position.y, gy, damp(10, dt)), player.pos.z);
  person.group.rotation.y = player.heading;
  const amp = moving ? 0.62 : 0;
  const sw = Math.sin(player.walkPhase) * amp;
  person.legL.rotation.x = sw; person.legR.rotation.x = -sw;
  person.armL.rotation.x = -sw * 0.7; person.armR.rotation.x = sw * 0.7;
}
let camYawFollowT = 0;
function updatePlayerDrive(dt) {
  const c = currentCar;
  const throttle = (keys['KeyW'] ? 1 : 0) + (keys['KeyS'] ? -1 : 0);
  const steer = (keys['KeyA'] ? 1 : 0) + (keys['KeyD'] ? -1 : 0);
  const hand = !!keys['Space'];
  carPhysics(c, throttle, steer, hand, dt, 33);
  collideWorld(c.pos, 1.35, c.vel);
  carVisual(c, dt);
}

/* ---------------- wanted / busted ---------------- */
function updateWanted(dt) {
  if (bustedT > 0) {
    bustedT -= dt;
    if (bustedT <= 0) bustedEl.style.opacity = 0;
    return;
  }
  if (stars <= 0) { bustT = 0; evadeT = 0; return; }
  const desired = Math.min(1 + stars, 6);
  copSpawnT -= dt;
  if (cops.length < desired && copSpawnT <= 0) { spawnCop(); copSpawnT = 2.2; }
  const f = focusPos();
  let nearest = 1e9;
  for (const c of cops) if (c !== currentCar) nearest = Math.min(nearest, dist2D(f.x, f.z, c.pos.x, c.pos.z));
  // evade -> decay (only while cops actually exist and are far away)
  if (cops.length > 0 && nearest > 85) {
    evadeT += dt;
    if (evadeT > 9) {
      evadeT = 0; stars--; starsDirty = true;
      if (stars <= 0) { removeCops(); toast('YOU LOST THE COPS'); }
      else toast('EVADED \u2014 WANTED ' + stars);
    }
  } else evadeT = Math.max(0, evadeT - dt * 2);
  // sustained contact -> busted
  const speed = player.mode === 'drive' ? Math.abs(currentCar.speed) : player.speedCur;
  let contact = false;
  for (const c of cops) {
    if (c === currentCar) continue;
    const d = dist2D(f.x, f.z, c.pos.x, c.pos.z);
    if (player.mode === 'drive') { if (d < 7.5 && speed < 4) contact = true; }
    else if ((d < 3.4 && speed < 2.2) || d < 2.0) contact = true;
  }
  bustT = contact ? bustT + dt : Math.max(0, bustT - dt * 1.6);
  if (bustT > 1.8) doBusted();
}
function doBusted() {
  bustedT = 2.4;
  bustedEl.style.opacity = 1;
  cash = Math.max(0, cash - 300); cashDirty = true;
  bustedSub.textContent = 'Fine paid: $300';
  toast('BUSTED');
  stars = 0; starsDirty = true; bustT = 0;
  removeCops();
  if (player.mode === 'drive' && currentCar) {
    currentCar.bodyMat.color.setHex(currentCar.origColor);
    currentCar.kind = 'parked'; currentCar.vel.set(0, 0, 0); currentCar.speed = 0;
    currentCar = null;
  }
  player.mode = 'foot';
  person.group.visible = true;
  player.pos.set(2.5, 0, 9); player.vel.set(0, 0, 0); player.heading = 0;
  camPos.set(2.5, 3, 3); camLook.set(2.5, 1.4, 9);
}

/* ---------------- checkpoint ---------------- */
function updateCheckpoint() {
  const f = focusPos();
  if (dist2D(f.x, f.z, beaconPos.x, beaconPos.z) < 5.5) {
    cash += 500; cashDirty = true;
    toast('+$500 \u2014 CHECKPOINT REACHED');
    spawnCheckpoint();
  }
}
function updateBeaconAnim(dt) {
  const u = beacon.userData;
  u.arrow.rotation.y += dt * 2.4;
  u.ring.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.1);
  u.ring.position.y = 0.7 + Math.sin(elapsed * 2.1) * 0.3;
  u.disc.material.opacity = 0.16 + Math.sin(elapsed * 3) * 0.08;
}

/* ---------------- camera ---------------- */
const camPos = new THREE.Vector3(2.5, 3, 3);
const camLook = new THREE.Vector3(2.5, 1.4, 9);
const _camD = new THREE.Vector3(), _camL = new THREE.Vector3(), _cf = new THREE.Vector3();
function updateCamera(dt) {
  let dist, h;
  if (player.mode === 'drive' && currentCar) {
    const c = currentCar;
    _cf.set(Math.sin(c.heading), 0, Math.cos(c.heading));
    const sp = Math.abs(c.speed);
    dist = 8.6 + sp * 0.16; h = 3.4 + sp * 0.045;     // pulls back with speed
    _camD.copy(c.pos).addScaledVector(_cf, -dist); _camD.y = h;
    _camL.copy(c.pos).addScaledVector(_cf, 3.5 + sp * 0.22); _camL.y = 1.3;  // look-ahead
  } else {
    _cf.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    dist = 5.4; h = 2.7;
    _camD.copy(player.pos).addScaledVector(_cf, -dist); _camD.y = h;
    _camL.copy(player.pos).addScaledVector(_cf, 2.4); _camL.y = 1.5;
  }
  // keep camera out of buildings
  let tt = 1;
  for (let i = 0; i < 7; i++) {
    const px = lerp(_camL.x, _camD.x, tt), pz = lerp(_camL.z, _camD.z, tt);
    if (!pointInBuilding(px, pz, 0.5)) break;
    tt -= 0.14;
  }
  const k = Math.max(tt, 0.18);
  _camD.set(lerp(_camL.x, _camD.x, k), lerp(1.6, _camD.y, k), lerp(_camL.z, _camD.z, k));
  camPos.lerp(_camD, damp(4.2, dt));
  camLook.lerp(_camL, damp(7, dt));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (enterHintT > 0) enterHintT -= dt;

  if (bustedT <= 0) {
    if (player.mode === 'drive' && currentCar) updatePlayerDrive(dt);
    else updatePlayerFoot(dt);
  }
  updateTraffic(dt);
  updateCops(dt);
  updateFreeCars(dt);
  carVsCar();
  updatePeds(dt);
  pedCollisions();
  updateWanted(dt);
  updateCheckpoint();
  updateBeaconAnim(dt);
  updateCamera(dt);

  // sun + shadow rig follows the action
  const f = focusPos();
  const sx = Math.round(f.x / 2) * 2, sz = Math.round(f.z / 2) * 2;
  sun.position.set(sx + SUN_DIR.x * 190, SUN_DIR.y * 190, sz + SUN_DIR.z * 190);
  sun.target.position.set(sx, 0, sz);
  sky.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 1300);

  // cop light bar flash
  const flash = Math.floor(elapsed * 7) % 2 === 0;
  copRedMat.color.setHex(flash ? 0xff3020 : 0x400a08);
  copBlueMat.color.setHex(flash ? 0x1a1440 : 0x3a6cff);

  updateHUD();
  drawMinimap(elapsed);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(loop);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
