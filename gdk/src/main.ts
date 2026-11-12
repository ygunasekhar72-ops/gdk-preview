// GDK main — wiring: keyboard input → fixed-timestep sim steps → 3D renderer.
// The render loop runs at display rate; the SIM always steps at TICK_RATE
// (NET.TICK-FIXED / PHY.FIXED-TIMESTEP), so gameplay never depends on FPS.

import {
  createSim,
  step,
  STEP_DT,
  TICK_RATE,
  CELL_SIZE,
  WORLD_SIZE,
  type SimInput,
  type SimState,
} from './sim/sim.js';
import { CityScene } from './render/scene3d.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudCash = document.getElementById('cash');
const hudStars = document.getElementById('stars');
const hudObjective = document.getElementById('objective');
const hudSpeed = document.getElementById('speed');
const hudFps = document.getElementById('fps');
const bustedOverlay = document.getElementById('busted');
const minimap = document.getElementById('minimap') as HTMLCanvasElement;

const state: SimState = createSim(1337);
const city = new CityScene(state, canvas);

// debug/verification handle (used by the headless visual rig; harmless in prod)
(window as unknown as { __gdk?: unknown }).__gdk = { state };

// explicit viewport sizing (GFX.RENDER-SCALE): full window, DPR-aware
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  city.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// --- keyboard input ---
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});
window.addEventListener('blur', () => keys.clear());

let actionEdge = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !e.repeat) actionEdge = true;
});

function axis(neg: string[], pos: string[]): number {
  const n = neg.some((k) => keys.has(k)) ? 1 : 0;
  const p = pos.some((k) => keys.has(k)) ? 1 : 0;
  return p - n;
}

function gatherInput(): SimInput {
  const input: SimInput = {
    move: { x: 0, y: 0 },
    throttle: 0,
    steer: 0,
    handbrake: keys.has('Space'),
    action: actionEdge,
  };
  if (state.player.carIndex === null) {
    input.move = { x: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), y: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) };
  } else {
    input.throttle = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    input.steer = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
  }
  return input;
}

// --- HUD helpers (read state, update DOM text) ---
function updateHud(fps: number, drawCalls: number): void {
  if (hudCash !== null) hudCash.textContent = `$${state.score}`;
  if (hudStars !== null) hudStars.textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
  if (hudObjective !== null) hudObjective.textContent = 'reach the yellow beacon';
  if (hudSpeed !== null) {
    const pc = state.player.carIndex === null ? null : state.cars[state.player.carIndex];
    const kmh = pc !== null ? Math.abs(pc.speed) * 3.6 : 0;
    hudSpeed.textContent = pc !== null ? `${kmh.toFixed(0)} km/h` : 'on foot';
  }
  if (hudFps !== null) hudFps.textContent = `${fps.toFixed(0)} fps · sim ${TICK_RATE} Hz · ${drawCalls} draw calls`;
  if (bustedOverlay !== null) bustedOverlay.style.display = state.flow.state === 'BUSTED' ? 'flex' : 'none';
}

function drawMinimap(): void {
  if (minimap === null) return;
  const g = minimap.getContext('2d');
  if (g === null) return;
  const size = minimap.width;
  const k = size / WORLD_SIZE;
  g.clearRect(0, 0, size, size);
  g.fillStyle = 'rgba(16, 20, 24, 0.85)';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#565d66';
  for (let i = 0; i <= 8; i++) {
    g.fillRect(i * CELL_SIZE * k - 0.5, 0, 1, size);
    g.fillRect(0, i * CELL_SIZE * k - 0.5, size, 1);
  }
  g.fillStyle = '#ffd94a';
  g.fillRect(state.checkpoint.x * k - 3, state.checkpoint.y * k - 3, 6, 6);
  g.fillStyle = '#5fa8ff';
  for (const c of state.cars) {
    if (c.police && c.pos.x > -100) g.fillRect(c.pos.x * k - 2, c.pos.y * k - 2, 4, 4);
  }
  const p = state.player.carIndex !== null ? state.cars[state.player.carIndex].pos : state.player.pos;
  g.fillStyle = '#ffffff';
  g.fillRect(p.x * k - 2.5, p.y * k - 2.5, 5, 5);
}

// --- fixed-timestep loop ---
let acc = 0;
let last = performance.now();
let fpsEma = 60;

function frame(now: number): void {
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fpsEma = fpsEma * 0.95 + (frameDt > 0 ? 1 / frameDt : 60) * 0.05;

  acc += frameDt;
  let steps = 0;
  while (acc >= STEP_DT && steps < 8) {
    step(state, gatherInput(), STEP_DT);
    actionEdge = false;
    acc -= STEP_DT;
    steps += 1;
  }

  city.update(state, frameDt);
  city.render();
  updateHud(fpsEma, city.drawCalls);
  drawMinimap();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
