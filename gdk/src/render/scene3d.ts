// GDK 3D renderer — reads sim state and draws it. It NEVER writes sim state
// (LOG.SIM-RENDER-SEPARATION: rendering reads, the sim decides).
//
// Coordinate mapping (PHY.UNIT-CONSIST, documented conversion point):
// the sim runs in a plane with (x, y) and heading atan2(y, x); the scene maps
// that plane onto three.js (x, z) with y-up: worldX = sim.x, worldZ = sim.y.
// Meshes face +X in local space, so rotation.y = -heading.
//
// Declared quality config (GFX.RENDER-SCALE / GFX.FPS-BUDGET):
// antialias on, pixel ratio capped at 2, ACES tone mapping, PCF soft shadows,
// single 2048 shadow map following the player, fog culling at 420 m.

import * as THREE from 'three';
import {
  CELL_SIZE,
  ROAD_W,
  WORLD_CELLS,
  WORLD_SIZE,
  type SimState,
} from '../sim/sim.js';

const SKY = 0xe8a56b;
const ASPHALT = 0x3d4248;
const SIDEWALK = 0x6d757f;
const GRASS = 0x4a6a42;
const DASH = 0xe0cd6e;
const ROOFS = [0x6d7a92, 0x7d6a88, 0x887d60, 0x6a887e, 0x886a6a];

function makeFacadeTexture(variant: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d');
  if (g === null) throw new Error('2d context unavailable');
  const base = ['#3d4450', '#463d50', '#50463d', '#3d5046', '#503d3d'][variant % 5];
  g.fillStyle = base;
  g.fillRect(0, 0, 96, 96);
  for (let wy = 6; wy < 92; wy += 12) {
    for (let wx = 6; wx < 92; wx += 12) {
      const lit = (wx * 7 + wy * 13 + variant * 31) % 11 < 4;
      g.fillStyle = lit ? '#ffd98a' : '#1c2028';
      g.fillRect(wx, wy, 7, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function planeToScene(v: { x: number; y: number }): [number, number] {
  return [v.x, v.y];
}

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private sunTarget = new THREE.Object3D();
  private carPool: THREE.Group[] = [];
  private carWheels: THREE.InstancedMesh;
  private wheelSpin: number[] = [];
  private pedPool: THREE.Group[] = [];
  private playerMesh: THREE.Group;
  private checkpoint!: THREE.Group;
  private ring!: THREE.Mesh;
  private carBodyMats: THREE.MeshStandardMaterial[] = [];
  private carLights: { red: THREE.Mesh; blue: THREE.Mesh }[] = [];
  private firstFrame = true;
  private buildingHeights: number[] = [];

  constructor(state: SimState, canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 130, 430);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);

    const hemi = new THREE.HemisphereLight(SKY, 0x4a4038, 1.15);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffb070, 3.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75;
    sc.right = 75;
    sc.top = 75;
    sc.bottom = -75;
    sc.near = 10;
    sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.buildGround();
    this.buildCity(state);
    this.carWheels = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10),
      new THREE.MeshStandardMaterial({ color: 0x14161a }),
      260
    );
    this.carWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carWheels.castShadow = true;
    this.scene.add(this.carWheels);
    this.ensureCars(state.cars.length);
    this.buildPedPool(state);
    this.playerMesh = this.buildPerson(0xffd94a);
    this.scene.add(this.playerMesh);
    this.buildCheckpoint();
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshLambertMaterial({ color: ASPHALT })
    );
    ground.rotation.x = -Math.PI / 2;
    // the world spans [0, WORLD_SIZE]^2 — center the plane on it
    ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // sidewalk slabs + grass cores, instanced (one draw call each)
    const inner = CELL_SIZE - ROAD_W;
    const slabGeo = new THREE.BoxGeometry(inner, 0.24, inner);
    const grassGeo = new THREE.BoxGeometry(inner - 2.4, 0.3, inner - 2.4);
    const slab = new THREE.InstancedMesh(slabGeo, new THREE.MeshLambertMaterial({ color: SIDEWALK }), WORLD_CELLS * WORLD_CELLS);
    const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshLambertMaterial({ color: GRASS }), WORLD_CELLS * WORLD_CELLS);
    slab.receiveShadow = true;
    grass.receiveShadow = true;
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < WORLD_CELLS; i++) {
      for (let j = 0; j < WORLD_CELLS; j++) {
        const [x, z] = planeToScene({ x: i * CELL_SIZE + ROAD_W + inner / 2, y: j * CELL_SIZE + ROAD_W + inner / 2 });
        m.makeTranslation(x, 0.12, z);
        slab.setMatrixAt(k, m);
        m.makeTranslation(x, 0.16, z);
        grass.setMatrixAt(k, m);
        k++;
      }
    }
    this.scene.add(slab, grass);

    // lane dashes, instanced (one draw call)
    const dashGeo = new THREE.BoxGeometry(0.36, 0.04, 2);
    const dashMat = new THREE.MeshBasicMaterial({ color: DASH });
    const positions: THREE.Matrix4[] = [];
    const dm = new THREE.Matrix4();
    for (let i = 0; i <= WORLD_CELLS; i++) {
      const x = i * CELL_SIZE + ROAD_W / 2;
      for (let y = 0; y < WORLD_SIZE; y += 5) {
        if ((y % CELL_SIZE) < ROAD_W + 2) continue;
        dm.makeTranslation(x, 0.05, y);
        positions.push(dm.clone());
      }
    }
    for (let j = 0; j <= WORLD_CELLS; j++) {
      const z = j * CELL_SIZE + ROAD_W / 2;
      for (let x = 0; x < WORLD_SIZE; x += 5) {
        if ((x % CELL_SIZE) < ROAD_W + 2) continue;
        dm.makeTranslation(x, 0.05, z);
        positions.push(dm.clone());
      }
    }
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, positions.length);
    positions.forEach((mm, idx) => dashes.setMatrixAt(idx, mm));
    this.scene.add(dashes);

    // street lamps at intersection corners, instanced poles + emissive heads
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 6, 6);
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x767e88 }), WORLD_CELLS * WORLD_CELLS);
    const headGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), WORLD_CELLS * WORLD_CELLS);
    let li = 0;
    for (let i = 0; i < WORLD_CELLS; i++) {
      for (let j = 0; j < WORLD_CELLS; j++) {
        const [x, z] = planeToScene({ x: i * CELL_SIZE + ROAD_W + 1.2, y: j * CELL_SIZE + ROAD_W + 1.2 });
        m.makeTranslation(x, 3, z);
        pole.setMatrixAt(li, m);
        m.makeTranslation(x, 6.1, z);
        head.setMatrixAt(li, m);
        li++;
      }
    }
    this.scene.add(pole, head);
  }

  private buildCity(state: SimState): void {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const facadeCache = new Map<number, THREE.CanvasTexture>();
    for (const b of state.buildings) {
      let tex = facadeCache.get(Math.floor(b.tone * 5));
      if (tex === undefined) {
        tex = makeFacadeTexture(Math.floor(b.tone * 5));
        facadeCache.set(Math.floor(b.tone * 5), tex);
      }
      const side = tex.clone();
      side.needsUpdate = true;
      side.repeat.set(Math.max(1, Math.round(b.w / 6)), Math.max(1, Math.round(b.h / 6)));
      // windows self-glow at dusk (same trick as any real night-city scene)
      const sideMat = new THREE.MeshLambertMaterial({
        map: side,
        emissive: 0xffffff,
        emissiveMap: side,
        emissiveIntensity: 0.5,
      });
      const roofMat = new THREE.MeshLambertMaterial({ color: ROOFS[Math.floor(b.tone * ROOFS.length) % ROOFS.length] });
      const mats = [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat];
      const mesh = new THREE.Mesh(boxGeo, mats);
      const [x, z] = planeToScene({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const height = 9 + b.tone * 26;
      this.buildingHeights.push(height);
      mesh.scale.set(b.w, height, b.h);
      mesh.position.set(x, height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private ensureCars(n: number): void {
    const palette = [0xb04a3f, 0x3f6ab0, 0x4a8a52, 0x8a6a2f, 0x7a4a8a];
    while (this.carPool.length < n) {
      const idx = this.carPool.length;
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: idx === 0 ? 0xffd94a : palette[idx % palette.length], metalness: 0.35, roughness: 0.45 });
      this.carBodyMats.push(bodyMat);
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 2.0), bodyMat);
      body.position.y = 0.72;
      body.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.85, 1.7), new THREE.MeshStandardMaterial({ color: 0x1c2430, metalness: 0.1, roughness: 0.2 }));
      cabin.position.set(-0.25, 1.55, 0);
      cabin.castShadow = true;
      g.add(body, cabin);
      const lightRed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
      lightRed.position.set(-0.2, 2.12, -0.45);
      const lightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0x3a6bff }));
      lightBlue.position.set(-0.2, 2.12, 0.45);
      lightRed.visible = false;
      lightBlue.visible = false;
      g.add(lightRed, lightBlue);
      this.carLights.push({ red: lightRed, blue: lightBlue });
      this.wheelSpin.push(0);
      this.scene.add(g);
      this.carPool.push(g);
    }
  }

  private buildPedPool(state: SimState): void {
    const geo = new THREE.CapsuleGeometry(0.3, 0.75, 4, 8);
    const mats = [0xd8b48a, 0xb08a6a, 0x9aa4ad].map((c) => new THREE.MeshLambertMaterial({ color: c }));
    for (let i = 0; i < state.peds.length; i++) {
      const p = new THREE.Mesh(geo, mats[i % mats.length]);
      p.castShadow = true;
      const g = new THREE.Group();
      g.add(p);
      this.scene.add(g);
      this.pedPool.push(g);
    }
  }

  private buildPerson(color: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    body.position.y = 0.85;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.7 }));
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(body, head);
    return g;
  }

  private buildCheckpoint(): void {
    this.checkpoint = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.5, 16, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    pillar.position.y = 8;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.28, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd94a })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.4;
    this.checkpoint.add(pillar, this.ring);
    this.scene.add(this.checkpoint);
  }

  /** Sync all dynamic meshes to the sim state and advance the chase camera. */
  update(state: SimState, dt: number): void {
    this.ensureCars(state.cars.length);

    const wheelM = new THREE.Matrix4();
    const wheelQ = new THREE.Quaternion();
    const wheelE = new THREE.Euler(Math.PI / 2, 0, 0);
    let wheelIdx = 0;
    for (let i = 0; i < state.cars.length; i++) {
      const c = state.cars[i];
      const g = this.carPool[i];
      const gone = c.pos.x < -100;
      g.visible = !gone;
      if (!gone) {
        const [x, z] = planeToScene(c.pos);
        g.position.set(x, 0, z);
        g.rotation.y = -c.heading;
        this.wheelSpin[i] += (c.speed * dt) / 0.42;
        const flash = c.police && state.wanted > 0 && state.tick % 30 < 15;
        this.carLights[i].red.visible = c.police && !flash;
        this.carLights[i].blue.visible = c.police && flash;
        // wheels: one global InstancedMesh, matrices computed from car transform
        wheelE.x = Math.PI / 2 + this.wheelSpin[i];
        wheelQ.setFromEuler(wheelE);
        const cosH = Math.cos(c.heading);
        const sinH = Math.sin(c.heading);
        for (const [ox, oz] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) {
          const wx = x + cosH * ox - sinH * oz;
          const wz = z + sinH * ox + cosH * oz;
          wheelM.compose(
            new THREE.Vector3(wx, 0.42, wz),
            wheelQ,
            new THREE.Vector3(1, 1, 1)
          );
          if (wheelIdx < this.carWheels.count) this.carWheels.setMatrixAt(wheelIdx++, wheelM);
        }
      }
    }
    for (let i = wheelIdx; i < this.carWheels.count; i++) {
      wheelM.makeTranslation(0, -50, 0);
      this.carWheels.setMatrixAt(i, wheelM);
    }
    this.carWheels.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < state.peds.length; i++) {
      const ped = state.peds[i];
      const g = this.pedPool[i];
      const [x, z] = planeToScene(ped.pos);
      g.position.set(x, ped.knocked ? 0.35 : Math.abs(Math.sin(state.tick * 0.15 + i)) * 0.06, z);
      g.rotation.z = ped.knocked ? Math.PI / 2 : 0;
      g.rotation.y = -Math.atan2(ped.dir.y, ped.dir.x);
    }

    if (state.player.carIndex === null) {
      this.playerMesh.visible = true;
      const [x, z] = planeToScene(state.player.pos);
      this.playerMesh.position.set(x, 0, z);
      this.playerMesh.rotation.y = -state.player.heading;
    } else {
      this.playerMesh.visible = false;
    }

    const [cx, cz] = planeToScene(state.checkpoint);
    this.checkpoint.position.set(cx, 0, cz);
    this.ring.rotation.z = state.tick * 0.02;

    // chase camera, with a wall probe that shortens the arm when a building
    // blocks the view (samples the arm against building AABBs + heights)
    const p = state.player.carIndex !== null ? state.cars[state.player.carIndex].pos : state.player.pos;
    const heading = state.player.carIndex !== null ? state.cars[state.player.carIndex].heading : state.player.heading;
    const target = new THREE.Vector3(p.x, 0, p.y);
    const driving = state.player.carIndex !== null;
    let dist = driving ? 10.5 : 6.5;
    const height = driving ? 4.6 : 3.4;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const blocked = (sx: number, sy: number, sh: number): boolean => {
      for (let bi = 0; bi < state.buildings.length; bi++) {
        const b = state.buildings[bi];
        if (sx > b.x - 0.4 && sx < b.x + b.w + 0.4 && sy > b.y - 0.4 && sy < b.y + b.h + 0.4) {
          if (sh < this.buildingHeights[bi]) return true;
        }
      }
      return false;
    };
    for (let probe = 0; probe < 3; probe++) {
      let hit = false;
      for (let s = 1; s <= 3; s++) {
        const t = s / 3;
        const sx = p.x - fx * dist * t;
        const sy = p.y - fz * dist * t;
        const sh = 1.6 + (height - 1.6) * t;
        if (blocked(sx, sy, sh)) { hit = true; break; }
      }
      if (!hit) break;
      dist *= 0.65;
    }
    // the more the arm shortened, the higher we ride to look over the corner
    const maxDist = driving ? 10.5 : 6.5;
    const bonusHeight = (1 - dist / maxDist) * 7;
    const want = new THREE.Vector3(target.x - fx * dist, Math.max(2.2, height * (dist / maxDist) + bonusHeight), target.z - fz * dist);
    if (this.firstFrame) {
      // snap on spawn instead of flying in from the origin
      this.camera.position.copy(want);
      this.firstFrame = false;
    } else {
      this.camera.position.lerp(want, Math.min(1, dt * 5.5));
    }
    this.camera.lookAt(target.x + fx * 4, 1.6, target.z + fz * 4);

    // sun follows the player so the shadow map stays tight
    this.sunTarget.position.set(target.x, 0, target.z);
    this.sun.position.set(target.x + 70, 95, target.z + 35);
  }

  resize(viewW: number, viewH: number): void {
    this.camera.aspect = viewW / viewH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(viewW, viewH, false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}
