// GDK main — wiring: keyboard input → fixed-timestep sim steps → renderer.
// The render loop runs at display rate; the SIM always steps at TICK_RATE
// (NET.TICK-FIXED / PHY.FIXED-TIMESTEP), so gameplay never depends on FPS.
import { createSim, step, STEP_DT, TICK_RATE, } from './sim/sim.js';
import { createCamera, render } from './render/renderer.js';
const canvas = document.getElementById('game');
const ctxMaybe = canvas.getContext('2d');
if (ctxMaybe === null) {
    throw new Error('canvas 2d context unavailable');
}
const ctx = ctxMaybe;
const fpsLabel = document.getElementById('fps');
// explicit viewport sizing (GFX.RENDER-SCALE): fit the window, track DPR
function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
}
window.addEventListener('resize', resize);
resize();
const state = createSim(1337);
const camera = createCamera();
camera.x = state.player.pos.x;
camera.y = state.player.pos.y;
// --- keyboard input ---
const keys = new Set();
window.addEventListener('keydown', (e) => {
    keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
});
window.addEventListener('blur', () => keys.clear());
let actionEdge = false;
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat)
        actionEdge = true;
});
function axis(neg, pos) {
    const n = neg.some((k) => keys.has(k)) ? 1 : 0;
    const p = pos.some((k) => keys.has(k)) ? 1 : 0;
    return p - n;
}
function gatherInput() {
    const input = {
        move: { x: 0, y: 0 },
        throttle: 0,
        steer: 0,
        handbrake: keys.has('Space'),
        action: actionEdge,
    };
    if (state.player.carIndex === null) {
        input.move = { x: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), y: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) };
    }
    else {
        input.throttle = axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
        input.steer = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    }
    return input;
}
// --- fixed-timestep loop ---
let acc = 0;
let last = performance.now();
let fpsEma = 60;
function frame(now) {
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
    // camera zoom-out while driving fast (reads state, never writes it)
    const driving = state.player.carIndex !== null;
    const wantScale = driving ? 11 : 14;
    camera.scale += (wantScale - camera.scale) * 0.03;
    render(ctx, state, camera, canvas.width, canvas.height);
    if (fpsLabel !== null) {
        fpsLabel.textContent = `${fpsEma.toFixed(0)} fps · sim ${TICK_RATE} Hz`;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
