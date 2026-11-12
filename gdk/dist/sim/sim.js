// GDK:AUTHORITATIVE — the authoritative simulation for MINI GTA.
// Pure data-in/data-out: no DOM, no rendering, no browser APIs
// (LOG.SIM-RENDER-SEPARATION). Everything here is deterministic:
// same seed + same input sequence => identical world state
// (PHY.DETERMINISM), proven by the headless test suite.
//
// Units (PHY.UNIT-CONSIST): meters, seconds; speeds m/s; accelerations m/s^2.
// Input axes are unitless [-1,1] converted to m/s at exactly one place (below).
import { GameFlow, GameState } from '../game/game_state.js';
export const TICK_RATE = 60;
export const STEP_DT = 1 / TICK_RATE;
export const WORLD_CELLS = 8;
export const CELL_SIZE = 60;
export const ROAD_W = 12;
export const WORLD_SIZE = WORLD_CELLS * CELL_SIZE;
export const MAX_WALK_SPEED_MPS = 3.4;
export const CAR_MAX_SPEED_MPS = 14;
export const POLICE_MAX_SPEED_MPS = 15.5;
export const TRAFFIC_SPEED_MPS = 6;
export const CAR_ACCEL_MPS2 = 9;
export const CAR_BRAKE_MPS2 = 20;
export const CAR_ROLL_FRICTION_MPS2 = 3;
export const STEER_RATE = 2.4;
export const PICKUP_RADIUS_M = 6;
export const ENTER_CAR_RADIUS_M = 2.8;
export const BUST_TIME_S = 1.6;
export const BUST_RESPAWN_S = 2.5;
export const WANTED_DECAY_S = 10;
export const MISSION_REWARD = 500;
export const BUST_PENALTY = 250;
export const SEED = 1337;
/** mulberry32 — seeded PRNG; ALL sim randomness flows through it. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function nextRand(s) {
    // Inline mulberry32 step over the persisted state (serializable, LOG.SAVE-SAFE).
    let a = (s.rngState + 0x6D2B79F5) | 0;
    s.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function clamp(v, lo, hi) {
    if (v < lo)
        return lo;
    if (v > hi)
        return hi;
    return v;
}
/** Reject impossible values, then clamp to the declared range. */
function sanitizeAxis(v) {
    if (!isFinite(v))
        return 0;
    return clamp(v, -1, 1);
}
export function sanitizeInput(raw) {
    const mx = sanitizeAxis(raw.move?.x ?? 0);
    const my = sanitizeAxis(raw.move?.y ?? 0);
    const len = Math.hypot(mx, my);
    const scale = len > 1 ? 1 / len : 1;
    return {
        move: { x: mx * scale, y: my * scale },
        throttle: sanitizeAxis(raw.throttle ?? 0),
        steer: sanitizeAxis(raw.steer ?? 0),
        handbrake: raw.handbrake === true,
        action: raw.action === true,
    };
}
function isRoad(x, y) {
    const mx = ((x % CELL_SIZE) + CELL_SIZE) % CELL_SIZE;
    const my = ((y % CELL_SIZE) + CELL_SIZE) % CELL_SIZE;
    return mx < ROAD_W || my < ROAD_W;
}
function randRoadPoint(s) {
    // Any point on a road (lanes are the road strips along cell edges).
    for (let tries = 0; tries < 200; tries++) {
        const x = nextRand(s) * WORLD_SIZE;
        const y = nextRand(s) * WORLD_SIZE;
        if (isRoad(x, y))
            return { x, y };
    }
    return { x: ROAD_W / 2, y: ROAD_W / 2 };
}
function pushEvent(s, kind, detail = '') {
    s.events.push({ tick: s.tick, kind, detail });
    if (s.events.length > 64)
        s.events.shift();
}
export function createSim(seed = SEED) {
    const s = {
        tick: 0,
        flow: new GameFlow(),
        buildings: [],
        player: { pos: { x: 0, y: 0 }, heading: 0, carIndex: null },
        cars: [],
        peds: [],
        score: 0,
        wanted: 0,
        lastCrimeTick: -100000,
        checkpoint: { x: 0, y: 0 },
        rngSeed: seed,
        rngState: seed >>> 0,
        events: [],
    };
    // City: one building block per cell (roads are the strips along cell edges).
    const inner = CELL_SIZE - ROAD_W;
    for (let cx = 0; cx < WORLD_CELLS; cx++) {
        for (let cy = 0; cy < WORLD_CELLS; cy++) {
            const bx = cx * CELL_SIZE + ROAD_W + 1.5;
            const by = cy * CELL_SIZE + ROAD_W + 1.5;
            const size = inner - 3;
            // plaza (no building) when the dice say so
            if (nextRand(s) < 0.12)
                continue;
            // split each block into 1-2 buildings
            if (nextRand(s) < 0.5) {
                s.buildings.push({ x: bx, y: by, w: size, h: size, tone: nextRand(s) });
            }
            else {
                const split = 0.35 + nextRand(s) * 0.3;
                if (nextRand(s) < 0.5) {
                    s.buildings.push({ x: bx, y: by, w: size * split, h: size, tone: nextRand(s) });
                    s.buildings.push({ x: bx + size * split + 2, y: by, w: size * (1 - split) - 2, h: size, tone: nextRand(s) });
                }
                else {
                    s.buildings.push({ x: bx, y: by, w: size, h: size * split, tone: nextRand(s) });
                    s.buildings.push({ x: bx, y: by + size * split + 2, w: size, h: size * (1 - split) - 2, tone: nextRand(s) });
                }
            }
        }
    }
    // Player spawns on a road, facing ALONG it (not into the facing wall).
    s.player.pos = randRoadPoint(s);
    s.player.heading = (s.player.pos.x % CELL_SIZE) < ROAD_W ? Math.PI / 2 : 0;
    // Parked cars along roads.
    for (let i = 0; i < 10; i++) {
        const p = randRoadPoint(s);
        s.cars.push({
            pos: p, heading: nextRand(s) * Math.PI * 2, speed: 0,
            parked: true, traffic: false, police: false, lane: [], laneIdx: 0, bustContactS: 0,
        });
    }
    // Traffic cars on rectangular lane rings around random blocks.
    for (let i = 0; i < 8; i++) {
        const bx = Math.floor(nextRand(s) * (WORLD_CELLS - 1)) * CELL_SIZE;
        const by = Math.floor(nextRand(s) * (WORLD_CELLS - 1)) * CELL_SIZE;
        const o = ROAD_W / 2 + 2.5; // right-lane offset from road center
        const ring = [
            { x: bx + o, y: by + o },
            { x: bx + CELL_SIZE - o, y: by + o },
            { x: bx + CELL_SIZE - o, y: by + CELL_SIZE - o },
            { x: bx + o, y: by + CELL_SIZE - o },
        ];
        const start = ring[0];
        s.cars.push({
            pos: { ...start }, heading: 0, speed: TRAFFIC_SPEED_MPS,
            parked: false, traffic: true, police: false,
            lane: ring, laneIdx: 1, bustContactS: 0,
        });
    }
    // Pedestrians on sidewalks (road edges).
    for (let i = 0; i < 44; i++) {
        const p = randRoadPoint(s);
        const horiz = nextRand(s) < 0.5;
        const sgn = nextRand(s) < 0.5 ? -1 : 1;
        s.peds.push({
            pos: p,
            dir: horiz ? { x: sgn, y: 0 } : { x: 0, y: sgn },
            knocked: false,
            speed: 1.1 + nextRand(s) * 0.6,
        });
    }
    s.checkpoint = randRoadPoint(s);
    // Start the mission loop: FREE_ROAM -> MISSION_ACTIVE (legal transition).
    s.flow.transitionTo(GameState.MISSION_ACTIVE, 0);
    pushEvent(s, 'mission-start', 'deliver to checkpoint');
    return s;
}
function circleRectPushout(px, py, r, b) {
    const cx = clamp(px, b.x, b.x + b.w);
    const cy = clamp(py, b.y, b.y + b.h);
    const dx = px - cx;
    const dy = py - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r)
        return null;
    if (d2 > 0.000001) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        return { push: { x: nx * (r - d), y: ny * (r - d) }, nx, ny };
    }
    // center inside the rect: push out along the smallest axis
    const left = px - b.x, right = b.x + b.w - px, top = py - b.y, bot = b.y + b.h - py;
    const m = Math.min(left, right, top, bot);
    if (m === left)
        return { push: { x: -(left + r), y: 0 }, nx: -1, ny: 0 };
    if (m === right)
        return { push: { x: right + r, y: 0 }, nx: 1, ny: 0 };
    if (m === top)
        return { push: { x: 0, y: -(top + r) }, nx: 0, ny: -1 };
    return { push: { x: 0, y: bot + r }, nx: 0, ny: 1 };
}
function collideBuildings(s, pos, r) {
    // Pushes the circle out of every building it overlaps; reports the last
    // wall normal (pointing away from the wall) for slide handling.
    let impact = 0;
    let nx = 0;
    let ny = 0;
    for (const b of s.buildings) {
        const hit = circleRectPushout(pos.x, pos.y, r, b);
        if (hit !== null) {
            pos.x += hit.push.x;
            pos.y += hit.push.y;
            impact = Math.max(impact, 1);
            nx = hit.nx;
            ny = hit.ny;
        }
    }
    pos.x = clamp(pos.x, 1, WORLD_SIZE - 1);
    pos.y = clamp(pos.y, 1, WORLD_SIZE - 1);
    return { impact, nx, ny };
}
function crimeCommitted(s) {
    s.wanted = Math.min(5, s.wanted + 1);
    s.lastCrimeTick = s.tick;
    pushEvent(s, 'crime', `wanted=${s.wanted}`);
}
function stepDriving(s, car, input, dt, isPlayer) {
    // throttle: positive accelerates, negative brakes then reverses
    if (input.throttle > 0) {
        car.speed += CAR_ACCEL_MPS2 * input.throttle * dt;
    }
    else if (input.throttle < 0) {
        if (car.speed > 0.4)
            car.speed -= CAR_BRAKE_MPS2 * dt;
        else
            car.speed += CAR_ACCEL_MPS2 * input.throttle * dt * 0.5;
    }
    else {
        const drop = CAR_ROLL_FRICTION_MPS2 * dt;
        car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
    }
    if (input.handbrake) {
        car.speed *= Math.max(0, 1 - 3.5 * dt);
    }
    // The clamp is the speedhack immunity: over-max input can never exceed the cap.
    car.speed = clamp(car.speed, -CAR_MAX_SPEED_MPS * 0.4, CAR_MAX_SPEED_MPS);
    // steering strength scales with speed; reversed when backing up
    const grip = clamp(Math.abs(car.speed) / CAR_MAX_SPEED_MPS, 0, 1);
    car.heading += input.steer * STEER_RATE * grip * dt * Math.sign(car.speed || 1);
    car.pos.x += Math.cos(car.heading) * car.speed * dt;
    car.pos.y += Math.sin(car.heading) * car.speed * dt;
    const col = collideBuildings(s, car.pos, 2.0);
    if (col.impact > 0) {
        // Wall slide: redirect motion along the wall tangent instead of grinding
        // into it. Preserves the tangential component of the velocity.
        const vx = Math.cos(car.heading);
        const vy = Math.sin(car.heading);
        const into = vx * col.nx + vy * col.ny;
        if (into < 0) {
            const tx = vx - col.nx * into;
            const ty = vy - col.ny * into;
            const tl = Math.hypot(tx, ty);
            if (tl > 0.05) {
                car.heading = Math.atan2(ty / tl, tx / tl);
                car.speed *= 0.88;
            }
            else {
                // dead-on hit: no tangent to slide along, heavy damp
                car.speed *= 0.5;
            }
            if (Math.abs(car.speed) > 6) {
                pushEvent(s, 'crash', `speed=${car.speed.toFixed(1)}`);
            }
        }
    }
    void isPlayer;
}
function stepTraffic(s, car, dt) {
    const target = car.lane[car.laneIdx % car.lane.length];
    const dx = target.x - car.pos.x;
    const dy = target.y - car.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
        car.laneIdx = (car.laneIdx + 1) % car.lane.length;
        return;
    }
    const desired = Math.atan2(dy, dx);
    let diff = desired - car.heading;
    while (diff > Math.PI)
        diff -= Math.PI * 2;
    while (diff < -Math.PI)
        diff += Math.PI * 2;
    car.heading += clamp(diff, -2 * dt, 2 * dt);
    car.speed = TRAFFIC_SPEED_MPS;
    car.pos.x += Math.cos(car.heading) * car.speed * dt;
    car.pos.y += Math.sin(car.heading) * car.speed * dt;
}
function stepPolice(s, car, dt, targetPos) {
    const dx = targetPos.x - car.pos.x;
    const dy = targetPos.y - car.pos.y;
    const desired = Math.atan2(dy, dx);
    let diff = desired - car.heading;
    while (diff > Math.PI)
        diff -= Math.PI * 2;
    while (diff < -Math.PI)
        diff += Math.PI * 2;
    car.heading += clamp(diff * 1.5, -2.4 * dt, 2.4 * dt);
    const d = Math.hypot(dx, dy);
    const wantSpeed = d > 8 ? POLICE_MAX_SPEED_MPS : d * 1.2;
    car.speed += clamp(wantSpeed - car.speed, -CAR_BRAKE_MPS2 * dt, CAR_ACCEL_MPS2 * dt);
    car.pos.x += Math.cos(car.heading) * car.speed * dt;
    car.pos.y += Math.sin(car.heading) * car.speed * dt;
    collideBuildings(s, car.pos, 2.0);
}
function playerWorldPos(s) {
    if (s.player.carIndex !== null) {
        return s.cars[s.player.carIndex].pos;
    }
    return s.player.pos;
}
/** One fixed-tick step of the authoritative world. */
export function step(s, rawInput, dt = STEP_DT) {
    s.tick += 1;
    const input = sanitizeInput(rawInput);
    // --- busted flow ---
    if (s.flow.state === GameState.BUSTED) {
        if (s.flow.ticksInState(s.tick) >= BUST_RESPAWN_S * TICK_RATE) {
            // respawn on foot, cleared record; the active mission persists
            s.flow.transitionTo(GameState.FREE_ROAM, s.tick);
            s.flow.transitionTo(GameState.MISSION_ACTIVE, s.tick);
            s.player.carIndex = null;
            s.player.pos = randRoadPoint(s);
            s.wanted = 0;
            for (const c of s.cars) {
                if (c.police)
                    c.pos = { x: -999, y: -999 }; // despawned
            }
            pushEvent(s, 'released', 'wanted cleared; mission re-accepted');
        }
        return;
    }
    // --- player ---
    if (input.action) {
        if (s.player.carIndex === null) {
            // enter nearest car within radius
            let best = -1;
            let bestD = ENTER_CAR_RADIUS_M;
            for (let i = 0; i < s.cars.length; i++) {
                const c = s.cars[i];
                if (c.police)
                    continue;
                const d = Math.hypot(c.pos.x - s.player.pos.x, c.pos.y - s.player.pos.y);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            if (best >= 0) {
                s.player.carIndex = best;
                s.cars[best].parked = false;
                pushEvent(s, 'car-enter', `car=${best}`);
            }
        }
        else {
            const car = s.cars[s.player.carIndex];
            s.player.pos = { x: car.pos.x + Math.cos(car.heading + Math.PI / 2) * 2.2, y: car.pos.y + Math.sin(car.heading + Math.PI / 2) * 2.2 };
            s.player.carIndex = null;
            pushEvent(s, 'car-exit', '');
        }
    }
    const driving = s.player.carIndex !== null;
    const playerCar = s.player.carIndex === null ? null : s.cars[s.player.carIndex];
    if (playerCar !== null) {
        stepDriving(s, playerCar, input, dt, true);
    }
    else {
        // walker wall-slide: decompose the step into wall-normal + tangent and
        // keep the tangent when the normal component hits a building
        const vx0 = input.move.x * MAX_WALK_SPEED_MPS * dt;
        const vy0 = input.move.y * MAX_WALK_SPEED_MPS * dt;
        s.player.pos.x += vx0;
        s.player.pos.y += vy0;
        const col = collideBuildings(s, s.player.pos, 0.9);
        if (col.impact > 0) {
            const into = vx0 * col.nx + vy0 * col.ny;
            if (into < 0) {
                s.player.pos.x -= col.nx * into;
                s.player.pos.y -= col.ny * into;
            }
        }
        if (Math.hypot(input.move.x, input.move.y) > 0.01) {
            s.player.heading = Math.atan2(input.move.y, input.move.x);
        }
    }
    // --- pedestrians ---
    for (const ped of s.peds) {
        if (ped.knocked)
            continue;
        ped.pos.x += ped.dir.x * ped.speed * dt;
        ped.pos.y += ped.dir.y * ped.speed * dt;
        // bounce at world edge; occasionally turn (seeded rand => deterministic)
        if (ped.pos.x <= 1 || ped.pos.x >= WORLD_SIZE - 1) {
            ped.dir.x = -ped.dir.x;
        }
        if (ped.pos.y <= 1 || ped.pos.y >= WORLD_SIZE - 1) {
            ped.dir.y = -ped.dir.y;
        }
        if (nextRand(s) < 0.004) {
            const horiz = ped.dir.x !== 0;
            ped.dir = horiz ? { x: 0, y: nextRand(s) < 0.5 ? -1 : 1 } : { x: nextRand(s) < 0.5 ? -1 : 1, y: 0 };
        }
        // player-driven car knocks peds down (only player crimes raise wanted)
        if (playerCar !== null) {
            const d = Math.hypot(playerCar.pos.x - ped.pos.x, playerCar.pos.y - ped.pos.y);
            if (d < 1.7 && Math.abs(playerCar.speed) > 3) {
                ped.knocked = true;
                crimeCommitted(s);
                pushEvent(s, 'ped-hit', `speed=${playerCar.speed.toFixed(1)}`);
            }
        }
    }
    // --- other cars ---
    for (let i = 0; i < s.cars.length; i++) {
        const c = s.cars[i];
        if (i === s.player.carIndex)
            continue;
        if (c.police)
            continue; // police handled below
        if (c.traffic)
            stepTraffic(s, c, dt);
        else if (!c.parked)
            stepDriving(s, c, { move: { x: 0, y: 0 }, throttle: 0, steer: 0, handbrake: false, action: false }, dt, false);
    }
    // --- police ---
    const activePolice = s.cars.filter((c) => c.police && c.pos.x > -100);
    const wantCount = s.wanted;
    if (activePolice.length < wantCount) {
        const edge = randRoadPoint(s);
        s.cars.push({
            pos: edge, heading: 0, speed: 0, parked: false, traffic: false,
            police: true, lane: [], laneIdx: 0, bustContactS: 0,
        });
        pushEvent(s, 'police-spawn', `wanted=${s.wanted}`);
    }
    const target = playerWorldPos(s);
    let minPoliceDist = Infinity;
    for (const c of s.cars) {
        if (!c.police)
            continue;
        if (c.pos.x < -100)
            continue;
        stepPolice(s, c, dt, target);
        const d = Math.hypot(c.pos.x - target.x, c.pos.y - target.y);
        minPoliceDist = Math.min(minPoliceDist, d);
        if (d < 2.4 && driving) {
            c.bustContactS += dt;
            if (c.bustContactS >= BUST_TIME_S) {
                s.flow.transitionTo(GameState.BUSTED, s.tick);
                s.score = Math.max(0, s.score - BUST_PENALTY);
                pushEvent(s, 'busted', `penalty=${BUST_PENALTY}`);
                return;
            }
        }
        else {
            c.bustContactS = Math.max(0, c.bustContactS - dt);
        }
    }
    // --- wanted decay (evaded: no crime recently AND police far away) ---
    if (s.wanted > 0 && s.tick - s.lastCrimeTick > WANTED_DECAY_S * TICK_RATE && minPoliceDist > 60) {
        s.wanted -= 1;
        pushEvent(s, 'evaded', `wanted=${s.wanted}`);
        if (s.wanted === 0) {
            for (const c of s.cars) {
                if (c.police)
                    c.pos = { x: -999, y: -999 };
            }
        }
    }
    // --- mission checkpoints ---
    if (s.flow.state === GameState.MISSION_ACTIVE) {
        const p = playerWorldPos(s);
        if (Math.hypot(p.x - s.checkpoint.x, p.y - s.checkpoint.y) < PICKUP_RADIUS_M) {
            // Banked by the authoritative sim — the only place score changes.
            s.score = s.score + MISSION_REWARD;
            pushEvent(s, 'delivery', `reward=${MISSION_REWARD}`);
            s.flow.transitionTo(GameState.FREE_ROAM, s.tick);
            // chain the next mission immediately
            let cp = randRoadPoint(s);
            for (let tries = 0; tries < 100 && Math.hypot(cp.x - p.x, cp.y - p.y) < 120; tries++) {
                cp = randRoadPoint(s);
            }
            s.checkpoint = cp;
            s.flow.transitionTo(GameState.MISSION_ACTIVE, s.tick);
            pushEvent(s, 'mission-start', 'next delivery');
        }
    }
}
