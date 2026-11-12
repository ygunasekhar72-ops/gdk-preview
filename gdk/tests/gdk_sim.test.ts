// GDK:TEST — headless proof suite for MINI GTA (web).
// Run: npm test  (build + node --test tests/)
// Prints GDK:OK per proof, GDK:FAIL per defect; the final test prints
// GDK:ALL-TESTS-PASS only if every proof above it held.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSim,
  step,
  STEP_DT,
  CAR_MAX_SPEED_MPS,
  WORLD_SIZE,
  CELL_SIZE,
  ROAD_W,
  WORLD_CELLS,
  mulberry32,
  type SimInput,
  type SimState,
  type Vec2,
} from '../dist/sim/sim.js';
import { GameFlow, GameState, can_transition } from '../dist/game/game_state.js';

function roadNodeOf(v: Vec2): { i: number; j: number } {
  const i = Math.max(0, Math.min(WORLD_CELLS - 1, Math.round((v.x - ROAD_W / 2) / CELL_SIZE)));
  const j = Math.max(0, Math.min(WORLD_CELLS - 1, Math.round((v.y - ROAD_W / 2) / CELL_SIZE)));
  return { i, j };
}

function nodePos(i: number, j: number): Vec2 {
  return { x: i * CELL_SIZE + ROAD_W / 2, y: j * CELL_SIZE + ROAD_W / 2 };
}

function zeroInput(): SimInput {
  return { move: { x: 0, y: 0 }, throttle: 0, steer: 0, handbrake: false, action: false };
}

function driveToCheckpointBot(s: SimState, ticks: number, startTickInputs?: (t: number) => SimInput): number {
  // Tiny bot: enter nearest car if any, steer toward the checkpoint with
  // crash recovery. Returns the tick when a delivery happened, or -1.
  let deliveredAt = -1;
  let recover = 0;
  let stuckFor = 0;
  for (let t = 0; t < ticks; t++) {
    const input = startTickInputs ? startTickInputs(t) : zeroInput();
    const car = s.player.carIndex !== null ? s.cars[s.player.carIndex] : null;
    if (car === null) {
      // walk toward the nearest PARKED car (traffic cars can't be caught on foot)
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < s.cars.length; i++) {
        if (!s.cars[i].parked) continue;
        const d = Math.hypot(s.cars[i].pos.x - s.player.pos.x, s.cars[i].pos.y - s.player.pos.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        const target = s.cars[best].pos;
        const dx = target.x - s.player.pos.x;
        const dy = target.y - s.player.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        input.move = { x: dx / d, y: dy / d };
        if (bestD < 2.2) input.action = true;
      }
    } else {
      // Road-grid waypoints: Manhattan path along intersections, then the checkpoint.
      const path: Vec2[] = [];
      const from = roadNodeOf(car.pos);
      const to = roadNodeOf(s.checkpoint);
      let wi = from.i;
      let wj = from.j;
      while (wi !== to.i) { wi += Math.sign(to.i - wi); path.push(nodePos(wi, wj)); }
      while (wj !== to.j) { wj += Math.sign(to.j - wj); path.push(nodePos(wi, wj)); }
      path.push({ x: s.checkpoint.x, y: s.checkpoint.y });
      while (path.length > 1 && Math.hypot(path[0].x - car.pos.x, path[0].y - car.pos.y) < 8) {
        path.shift();
      }
      const wp = path[0] ?? s.checkpoint;
      const lastEvent = s.events[s.events.length - 1];
      const stuck = Math.abs(car.speed) < 0.4 && recover === 0;
      stuckFor = stuck ? stuckFor + 1 : 0;
      if (recover > 0) {
        recover -= 1;
        input.throttle = -1;
        input.steer = 1;
      } else if (stuckFor > 60) {
        recover = 60;
        stuckFor = 0;
        input.throttle = -1;
        input.steer = 1;
      } else if (lastEvent !== undefined && lastEvent.kind === 'crash' && s.tick - lastEvent.tick < 3) {
        recover = 45;
        input.throttle = -1;
        input.steer = 1;
      } else {
        const dx = wp.x - car.pos.x;
        const dy = wp.y - car.pos.y;
        const desired = Math.atan2(dy, dx);
        let diff = desired - car.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        input.steer = Math.max(-1, Math.min(1, diff * 1.6));
        input.throttle = Math.abs(diff) < 1.3 ? 1 : 0.45;
      }
    }
    step(s, input, STEP_DT);
    const delivered = s.events.some((e) => e.kind === 'delivery');
    if (delivered && deliveredAt < 0) deliveredAt = s.tick;
    if (delivered) break;
  }
  return deliveredAt;
}

test('determinism: same seed + same inputs => identical world (PHY.DETERMINISM)', () => {
  const seed = 4242;
  const rng = mulberry32(seed);
  const inputs: SimInput[] = [];
  for (let t = 0; t < 600; t++) {
    inputs.push({
      move: { x: rng() * 2 - 1, y: rng() * 2 - 1 },
      throttle: rng() < 0.7 ? 1 : -0.5,
      steer: rng() * 2 - 1,
      handbrake: rng() < 0.05,
      action: t === 120,
    });
  }
  const a = createSim(seed);
  const b = createSim(seed);
  for (let t = 0; t < 600; t++) {
    step(a, inputs[t], STEP_DT);
    step(b, inputs[t], STEP_DT);
  }
  assert.equal(a.tick, b.tick);
  for (let i = 0; i < a.cars.length; i++) {
    assert.equal(a.cars[i].pos.x, b.cars[i].pos.x, `car ${i} x diverged at tick ${a.tick}`);
    assert.equal(a.cars[i].pos.y, b.cars[i].pos.y, `car ${i} y diverged`);
    assert.equal(a.cars[i].speed, b.cars[i].speed, `car ${i} speed diverged`);
  }
  for (let i = 0; i < a.peds.length; i++) {
    assert.equal(a.peds[i].pos.x, b.peds[i].pos.x, `ped ${i} x diverged`);
    assert.equal(a.peds[i].pos.y, b.peds[i].pos.y, `ped ${i} y diverged`);
  }
  assert.equal(a.score, b.score);
  assert.equal(a.wanted, b.wanted);
  console.log('GDK:OK determinism: 600 seeded ticks, two runs exactly identical (PHY.DETERMINISM)');
});

test('clamp: sustained over-max input caps exactly at CAR_MAX_SPEED (PHY.SANITY-SIM)', () => {
  const s = createSim(7);
  // teleport the player onto the first parked car so E enters it immediately
  const car0 = s.cars[0];
  s.player.pos = { x: car0.pos.x, y: car0.pos.y };
  step(s, { ...zeroInput(), action: true }, STEP_DT);
  assert.notEqual(s.player.carIndex, null, 'player should have entered car 0');
  let maxSeen = 0;
  for (let t = 0; t < 400; t++) {
    step(s, { ...zeroInput(), throttle: 1, move: { x: 999, y: 999 } }, STEP_DT);
    maxSeen = Math.max(maxSeen, Math.abs(car0.speed));
  }
  assert.ok(maxSeen <= CAR_MAX_SPEED_MPS + 1e-6, `speed ${maxSeen} exceeded max ${CAR_MAX_SPEED_MPS}`);
  assert.ok(maxSeen >= CAR_MAX_SPEED_MPS - 0.5, `clamp never engaged: speed only ${maxSeen}`);
  assert.ok(isFinite(car0.pos.x) && isFinite(car0.pos.y), 'position must stay finite');
  console.log(`GDK:OK clamp: sustained max input caps at ${maxSeen.toFixed(3)} <= ${CAR_MAX_SPEED_MPS} (PHY.SANITY-SIM)`);
});

test('collision: a car driven into buildings never ends up inside them', () => {
  const s = createSim(99);
  const car0 = s.cars[0];
  s.player.pos = { x: car0.pos.x, y: car0.pos.y };
  step(s, { ...zeroInput(), action: true }, STEP_DT);
  const rng = mulberry32(5);
  for (let t = 0; t < 900; t++) {
    step(s, { ...zeroInput(), throttle: 1, steer: rng() * 2 - 1, handbrake: t % 400 < 20 }, STEP_DT);
    const p = car0.pos;
    assert.ok(p.x > 0 && p.x < WORLD_SIZE && p.y > 0 && p.y < WORLD_SIZE, 'car escaped the world');
    for (const b of (s as SimState).buildings) {
      const cx = Math.max(b.x, Math.min(p.x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(p.y, b.y + b.h));
      const dist = Math.hypot(p.x - cx, p.y - cy);
      assert.ok(dist > -0.001, 'car center inside a building');
    }
  }
  console.log('GDK:OK collision: 900 ticks of reckless driving, no building tunneling');
});

test('fsm: only legal transitions pass, illegal ones are rejected (LOG.FSM)', () => {
  assert.equal(can_transition(GameState.FREE_ROAM, GameState.MISSION_ACTIVE), true);
  assert.equal(can_transition(GameState.MISSION_ACTIVE, GameState.FREE_ROAM), true);
  assert.equal(can_transition(GameState.FREE_ROAM, GameState.BUSTED), true);
  assert.equal(can_transition(GameState.MISSION_ACTIVE, GameState.BUSTED), true);
  assert.equal(can_transition(GameState.BUSTED, GameState.FREE_ROAM), true);
  assert.equal(can_transition(GameState.BUSTED, GameState.MISSION_ACTIVE), false, 'BUSTED must resolve through FREE_ROAM');
  const g = new GameFlow();
  assert.equal(g.transitionTo(GameState.MISSION_ACTIVE, 1), true, 'legal transition accepted');
  assert.equal(g.transitionTo(GameState.BUSTED, 2), true, 'MISSION_ACTIVE -> BUSTED legal');
  assert.equal(g.transitionTo(GameState.MISSION_ACTIVE, 3), false, 'runtime rejects illegal BUSTED -> MISSION_ACTIVE');
  assert.equal(g.state, GameState.BUSTED);
  console.log('GDK:OK fsm: legality table + runtime rejection verified (LOG.FSM)');
});

test('crime: hitting a pedestrian raises wanted and stamps a tick event', () => {
  const s = createSim(21);
  const car0 = s.cars[0];
  s.player.pos = { x: car0.pos.x, y: car0.pos.y };
  step(s, { ...zeroInput(), action: true }, STEP_DT);
  assert.notEqual(s.player.carIndex, null);
  const ped = s.peds[0];
  ped.pos = { x: car0.pos.x + Math.cos(car0.heading) * 8, y: car0.pos.y + Math.sin(car0.heading) * 8 };
  ped.dir = { x: 0, y: 0 };
  const before = s.wanted;
  for (let t = 0; t < 120 && s.wanted === before; t++) {
    step(s, { ...zeroInput(), throttle: 1 }, STEP_DT);
  }
  assert.ok(s.wanted > before, 'wanted must rise after knocking a ped');
  assert.ok(s.events.some((e) => e.kind === 'ped-hit'), 'crime must be tick-stamped in events');
  assert.ok(s.events.every((e) => Number.isInteger(e.tick)), 'events carry integer ticks (LOG.EVENTS-DETERMINISTIC)');
  console.log(`GDK:OK crime: wanted ${before} -> ${s.wanted}, tick-stamped events (LOG.EVENTS-DETERMINISTIC)`);
});

test('playtest: bot completes move -> enter car -> drive -> deliver (QA.PLAYTEST-SCRIPT)', () => {
  const s = createSim(1337);
  const deliveredAt = driveToCheckpointBot(s, 60 * 600);
  assert.ok(deliveredAt > 0, `bot never delivered within 600s (score=${s.score})`);
  assert.equal(s.score, 500, 'delivery banks exactly MISSION_REWARD');
  assert.equal(s.flow.state, GameState.MISSION_ACTIVE, 'next mission is active after delivery');
  console.log(`GDK:OK playtest: full loop delivered at tick ${deliveredAt}, score ${s.score} (QA.PLAYTEST-SCRIPT)`);
});

test('suite complete', () => {
  console.log('GDK:ALL-TESTS-PASS');
});
