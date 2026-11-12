(function () {
'use strict';

// ================= setup =================
var cv = document.getElementById('game');
var ctx = cv.getContext('2d');
var VW = 1280, VH = 720;

function fit() {
  var s = Math.min(window.innerWidth / VW, window.innerHeight / VH, 1);
  cv.style.width = (VW * s) + 'px';
  cv.style.height = (VH * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

// ================= seeded rng =================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rng = mulberry32(452411);
function rand(a, b) { return a + rng() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function rf(a, b) { return a + Math.random() * (b - a); }
function ri(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function pickR(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ================= math =================
var TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function angDiff(a, b) { var d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function hyp(ax, ay) { return Math.sqrt(ax * ax + ay * ay); }

// ================= city =================
var TILE = 400, ROAD = 100, LANE = 18, NX = 6, NY = 5;
var WW = NX * TILE + ROAD, WH = NY * TILE + ROAD;
var blocks = [];
var colliders = [];
var roofColors = ['#6e6e78', '#7d6b5d', '#8a8f99', '#6f7f6e', '#96865f', '#756a80', '#626a74', '#5d6a70', '#8c7a68', '#73737d'];
var carColors = ['#c23b3b', '#3b6ec2', '#c2a53b', '#3bc26e', '#8a3bc2', '#c27f3b', '#4a4a52', '#d0d0d0', '#2f8f8f', '#b5b0a4'];
var shirtColors = ['#c94f4f', '#4f7fc9', '#c9a44f', '#59c94f', '#9a4fc9', '#c97f4f', '#4fc9b0', '#c94f88', '#8a8f98', '#d8d2c4'];

function genCity() {
  for (var i = 0; i < NX; i++) {
    for (var j = 0; j < NY; j++) {
      var bx = i * TILE + ROAD, by = j * TILE + ROAD, bs = TILE - ROAD;
      var isPark = rng() < 0.16;
      var b = { x: bx, y: by, s: bs, park: isPark, trees: [], pond: null };
      if (isPark) {
        var n = randi(3, 6);
        for (var k = 0; k < n; k++) b.trees.push({ x: bx + rand(30, bs - 30), y: by + rand(30, bs - 30), r: rand(11, 19) });
        if (rng() < 0.45) b.pond = { x: bx + bs / 2, y: by + bs / 2 };
      } else {
        var m = 14, ix = bx + m, iy = by + m, is = bs - 2 * m;
        var mode = rng(), rects = [];
        if (mode < 0.2) {
          rects.push({ x: ix, y: iy, w: is, h: is });
        } else if (mode < 0.55) {
          var r1 = rand(0.35, 0.65);
          if (rng() < 0.5) {
            rects.push({ x: ix, y: iy, w: is * r1 - 4, h: is });
            rects.push({ x: ix + is * r1 + 4, y: iy, w: is * (1 - r1) - 4, h: is });
          } else {
            rects.push({ x: ix, y: iy, w: is, h: is * r1 - 4 });
            rects.push({ x: ix, y: iy + is * r1 + 4, w: is, h: is * (1 - r1) - 4 });
          }
        } else {
          var rx = rand(0.4, 0.6), ry = rand(0.4, 0.6);
          rects.push({ x: ix, y: iy, w: is * rx - 4, h: is * ry - 4 });
          rects.push({ x: ix + is * rx + 4, y: iy, w: is * (1 - rx) - 4, h: is * ry - 4 });
          rects.push({ x: ix, y: iy + is * ry + 4, w: is * rx - 4, h: is * (1 - ry) - 4 });
          rects.push({ x: ix + is * rx + 4, y: iy + is * ry + 4, w: is * (1 - rx) - 4, h: is * (1 - ry) - 4 });
        }
        for (var q = 0; q < rects.length; q++) {
          colliders.push({ x: rects[q].x, y: rects[q].y, w: rects[q].w, h: rects[q].h, color: pick(roofColors), seed: Math.floor(rng() * 1e9) });
        }
      }
      blocks.push(b);
    }
  }
}
function blockAt(i, j) { return blocks[i * NY + j]; }

// prerendered city (roads, dashes, crosswalks, sidewalks, buildings, parks)
var cityCanvas = document.createElement('canvas');
cityCanvas.width = WW; cityCanvas.height = WH;

function renderCity() {
  var g = cityCanvas.getContext('2d');
  var i, j, k;
  g.fillStyle = '#3b3b41'; g.fillRect(0, 0, WW, WH);
  // lane dashes
  g.strokeStyle = '#c9b83e'; g.lineWidth = 3; g.setLineDash([22, 18]);
  for (i = 0; i <= NX; i++) { var x = i * TILE + ROAD / 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, WH); g.stroke(); }
  for (j = 0; j <= NY; j++) { var y = j * TILE + ROAD / 2; g.beginPath(); g.moveTo(0, y); g.lineTo(WW, y); g.stroke(); }
  g.setLineDash([]);
  // curb lines
  g.strokeStyle = 'rgba(220,220,225,0.4)'; g.lineWidth = 2;
  for (i = 0; i <= NX; i++) {
    g.beginPath(); g.moveTo(i * TILE + 5, 0); g.lineTo(i * TILE + 5, WH); g.stroke();
    g.beginPath(); g.moveTo(i * TILE + ROAD - 5, 0); g.lineTo(i * TILE + ROAD - 5, WH); g.stroke();
  }
  for (j = 0; j <= NY; j++) {
    g.beginPath(); g.moveTo(0, j * TILE + 5); g.lineTo(WW, j * TILE + 5); g.stroke();
    g.beginPath(); g.moveTo(0, j * TILE + ROAD - 5); g.lineTo(WW, j * TILE + ROAD - 5); g.stroke();
  }
  // clear intersections (removes dashes crossing them)
  g.fillStyle = '#3b3b41';
  for (i = 0; i <= NX; i++) for (j = 0; j <= NY; j++) g.fillRect(i * TILE, j * TILE, ROAD, ROAD);
  // crosswalks
  g.fillStyle = 'rgba(230,230,235,0.7)';
  for (i = 0; i <= NX; i++) for (j = 0; j <= NY; j++) {
    var x0 = i * TILE, y0 = j * TILE;
    for (k = 0; k < 6; k++) {
      var p = 9 + k * 15;
      g.fillRect(x0 + 2, y0 + p, 10, 9);
      g.fillRect(x0 + ROAD - 12, y0 + p, 10, 9);
      g.fillRect(x0 + p, y0 + 2, 9, 10);
      g.fillRect(x0 + p, y0 + ROAD - 12, 9, 10);
    }
  }
  // blocks: sidewalk ring + interior
  for (var bi = 0; bi < blocks.length; bi++) {
    var b = blocks[bi];
    g.fillStyle = '#a3a3aa'; g.fillRect(b.x, b.y, b.s, b.s);
    g.strokeStyle = '#71717a'; g.lineWidth = 3; g.strokeRect(b.x + 1.5, b.y + 1.5, b.s - 3, b.s - 3);
    g.fillStyle = b.park ? '#4d8a45' : '#83838b';
    g.fillRect(b.x + 14, b.y + 14, b.s - 28, b.s - 28);
    if (b.park && b.pond) {
      g.fillStyle = '#4a7fae'; g.beginPath(); g.ellipse(b.pond.x, b.pond.y, 34, 24, 0, 0, TAU); g.fill();
      g.strokeStyle = '#39688f'; g.lineWidth = 3; g.stroke();
    }
    for (var t = 0; t < b.trees.length; t++) {
      var tr = b.trees[t];
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(tr.x + 4, tr.y + 5, tr.r, 0, TAU); g.fill();
      g.fillStyle = '#2c6a2c'; g.beginPath(); g.arc(tr.x, tr.y, tr.r, 0, TAU); g.fill();
      g.fillStyle = '#3d8540'; g.beginPath(); g.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.55, 0, TAU); g.fill();
    }
  }
  // buildings with shadows + rooftop details
  for (var ci = 0; ci < colliders.length; ci++) {
    var c = colliders[ci];
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(c.x + 5, c.y + 7, c.w, c.h);
    g.fillStyle = c.color; g.fillRect(c.x, c.y, c.w, c.h);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.strokeRect(c.x + 5, c.y + 5, c.w - 10, c.h - 10);
    var rr = mulberry32(c.seed);
    var n = 1 + Math.floor(rr() * 3);
    for (k = 0; k < n; k++) {
      var vw = 12 + rr() * 30, vh = 12 + rr() * 30;
      var vx = c.x + 7 + rr() * Math.max(1, c.w - 14 - vw);
      var vy = c.y + 7 + rr() * Math.max(1, c.h - 14 - vh);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(vx, vy, vw, vh);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(vx + 2, vy + 2, vw - 4, vh - 4);
    }
  }
}

// minimap base
var mmScale = 0.075;
var mmW = Math.ceil(WW * mmScale), mmH = Math.ceil(WH * mmScale);
var mmCanvas = document.createElement('canvas');
mmCanvas.width = mmW; mmCanvas.height = mmH;
function renderMinimapBase() {
  var g = mmCanvas.getContext('2d');
  g.fillStyle = '#3b3b41'; g.fillRect(0, 0, mmW, mmH);
  for (var bi = 0; bi < blocks.length; bi++) {
    var b = blocks[bi];
    g.fillStyle = b.park ? '#4d8a45' : '#8b8b92';
    g.fillRect(b.x * mmScale, b.y * mmScale, b.s * mmScale, b.s * mmScale);
  }
  g.fillStyle = '#66666e';
  for (var ci = 0; ci < colliders.length; ci++) {
    var c = colliders[ci];
    g.fillRect(c.x * mmScale, c.y * mmScale, c.w * mmScale, c.h * mmScale);
  }
}

// ================= state =================
var SPAWN_X = 3 * TILE + ROAD / 2, SPAWN_Y = 2 * TILE + ROAD / 2;
var player = { x: SPAWN_X + 60, y: SPAWN_Y + 62, ang: 0, inCar: null };
var cars = [];
var peds = [];
var texts = [];
var checkpoint = { x: 0, y: 0 };
var cam = { x: SPAWN_X, y: SPAWN_Y };
var state = { cash: 0, wanted: 0, evadeT: 0, bustT: 0, busted: false, bustedT: 0, policeSpawnT: 0, trafficCd: 0, time: 0 };

function px() { return player.inCar ? player.inCar.x : player.x; }
function py() { return player.inCar ? player.inCar.y : player.y; }

// ================= collision helpers =================
function circleRectPush(pxx, pyy, r, rc) {
  var cx = clamp(pxx, rc.x, rc.x + rc.w), cy = clamp(pyy, rc.y, rc.y + rc.h);
  var dx = pxx - cx, dy = pyy - cy;
  var d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    var d = Math.sqrt(d2), s = (r - d) / d;
    return { x: dx * s, y: dy * s, nx: dx / d, ny: dy / d };
  }
  var l = pxx - rc.x, rt = rc.x + rc.w - pxx, t = pyy - rc.y, bt = rc.y + rc.h - pyy;
  var m = Math.min(l, rt, t, bt);
  if (m === l) return { x: -(l + r), y: 0, nx: -1, ny: 0 };
  if (m === rt) return { x: rt + r, y: 0, nx: 1, ny: 0 };
  if (m === t) return { x: 0, y: -(t + r), nx: 0, ny: -1 };
  return { x: 0, y: bt + r, nx: 0, ny: 1 };
}
function pointInCollider(x, y) {
  for (var k = 0; k < colliders.length; k++) {
    var c = colliders[k];
    if (x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) return true;
  }
  return false;
}
function collidePoint(e, r) {
  for (var k = 0; k < colliders.length; k++) {
    var p = circleRectPush(e.x, e.y, r, colliders[k]);
    if (p) { e.x += p.x; e.y += p.y; }
  }
  e.x = clamp(e.x, 12, WW - 12);
  e.y = clamp(e.y, 12, WH - 12);
}
function collideCarWorld(c) {
  var fwX = Math.cos(c.angle), fwY = Math.sin(c.angle);
  var s, k, p;
  for (var it = 0; it < 2; it++) {
    s = it === 0 ? 12 : -12;
    var sx = c.x + fwX * s, sy = c.y + fwY * s;
    for (k = 0; k < colliders.length; k++) {
      p = circleRectPush(sx, sy, 11, colliders[k]);
      if (p) {
        c.x += p.x; c.y += p.y;
        var vn = c.vx * p.nx + c.vy * p.ny;
        if (vn < 0) {
          c.vx -= p.nx * vn * 1.05; c.vy -= p.ny * vn * 1.05;
          c.vx *= 0.98; c.vy *= 0.98;
        }
        sx = c.x + fwX * s; sy = c.y + fwY * s;
      }
    }
  }
  if (c.x < 16) { c.x = 16; if (c.vx < 0) c.vx = 0; }
  if (c.x > WW - 16) { c.x = WW - 16; if (c.vx > 0) c.vx = 0; }
  if (c.y < 16) { c.y = 16; if (c.vy < 0) c.vy = 0; }
  if (c.y > WH - 16) { c.y = WH - 16; if (c.vy > 0) c.vy = 0; }
  c.speed = c.vx * fwX + c.vy * fwY;
}

// ================= car physics =================
function carPhysics(c, dt, throttle, brake, steer, hand, maxF) {
  var fwX = Math.cos(c.angle), fwY = Math.sin(c.angle);
  var rtX = -fwY, rtY = fwX;
  var vf = c.vx * fwX + c.vy * fwY;
  var vl = c.vx * rtX + c.vy * rtY;
  if (throttle > 0) vf += 330 * throttle * dt;
  if (brake > 0) {
    if (vf > 5) vf -= 620 * brake * dt;
    else vf -= 240 * brake * dt;
  }
  vf = clamp(vf, -160, maxF);
  vf -= vf * 0.7 * dt;
  if (hand) vf -= vf * 2.4 * dt;
  var grip = hand ? 1.7 : 8;
  vl -= vl * Math.min(1, grip * dt);
  var srate = 2.7 * clamp(Math.abs(vf) / 130, 0, 1) * (vf < 0 ? -1 : 1);
  c.angle += steer * srate * dt * (hand ? 1.5 : 1);
  c.vx = fwX * vf + rtX * vl;
  c.vy = fwY * vf + rtY * vl;
  c.speed = vf;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
}

// ================= cars: spawn =================
function nodePos(n) { return { x: n.i * TILE + ROAD / 2, y: n.j * TILE + ROAD / 2 }; }
function adjacentNodes(i, j) {
  var out = [];
  if (i > 0) out.push({ i: i - 1, j: j });
  if (i < NX) out.push({ i: i + 1, j: j });
  if (j > 0) out.push({ i: i, j: j - 1 });
  if (j < NY) out.push({ i: i, j: j + 1 });
  return out;
}
function spawnTraffic() {
  var tries = 0;
  while (tries++ < 20) {
    var a = { i: ri(0, NX), j: ri(0, NY) };
    var adj = adjacentNodes(a.i, a.j);
    var b = pickR(adj);
    var A = nodePos(a), B = nodePos(b);
    var t = rf(0.1, 0.9);
    var dx = B.x - A.x, dy = B.y - A.y, len = hyp(dx, dy);
    if (len < 1) continue;
    var dirx = dx / len, diry = dy / len;
    var x = A.x + dx * t - diry * LANE, y = A.y + dy * t + dirx * LANE;
    if (hyp(x - px(), y - py()) < 500) continue;
    cars.push({ kind: 'traffic', x: x, y: y, angle: Math.atan2(diry, dirx), dispAngle: Math.atan2(diry, dirx), vx: dirx * 120, vy: diry * 120, speed: 120, spd: 120, color: pickR(carColors), a: a, b: b, t: t, offX: -diry * LANE, offY: dirx * LANE, kx: 0, ky: 0, controlled: false });
    return;
  }
}
function placeParked() {
  var placed = 0, tries = 0;
  while (placed < 12 && tries++ < 400) {
    var x, y, ang;
    if (rng() < 0.5) {
      var i2 = randi(0, NX);
      x = i2 * TILE + ROAD / 2 + (rng() < 0.5 ? -44 : 44);
      y = rand(120, WH - 120);
      ang = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      var j2 = randi(0, NY);
      y = j2 * TILE + ROAD / 2 + (rng() < 0.5 ? -44 : 44);
      x = rand(120, WW - 120);
      ang = rng() < 0.5 ? 0 : Math.PI;
    }
    var ok = hyp(x - SPAWN_X, y - SPAWN_Y) > 150;
    var ni = clamp(Math.round((x - ROAD / 2) / TILE), 0, NX);
    var nj = clamp(Math.round((y - ROAD / 2) / TILE), 0, NY);
    var np = nodePos({ i: ni, j: nj });
    if (hyp(x - np.x, y - np.y) < 150) ok = false;
    for (var c2 = 0; c2 < cars.length; c2++) if (hyp(cars[c2].x - x, cars[c2].y - y) < 80) ok = false;
    if (!ok) continue;
    cars.push({ kind: 'parked', x: x, y: y, angle: ang, vx: 0, vy: 0, speed: 0, color: pick(carColors), controlled: false });
    placed++;
  }
  cars.push({ kind: 'parked', x: SPAWN_X + 95, y: SPAWN_Y + 38, angle: 0, vx: 0, vy: 0, speed: 0, color: '#c23b3b', controlled: false });
}

// ================= peds =================
var CROSS = [
  [[-1, 0, 1], [0, -1, 3]],
  [[1, 0, 0], [0, -1, 2]],
  [[1, 0, 3], [0, 1, 1]],
  [[-1, 0, 2], [0, 1, 0]]
];
function cornerPos(i, j, idx) {
  var b = blockAt(i, j), s = TILE - ROAD, o = 7;
  if (idx === 0) return { x: b.x + o, y: b.y + o };
  if (idx === 1) return { x: b.x + s - o, y: b.y + o };
  if (idx === 2) return { x: b.x + s - o, y: b.y + s - o };
  return { x: b.x + o, y: b.y + s - o };
}
function spawnPeds() {
  for (var k = 0; k < 50; k++) {
    var i = randi(0, NX - 1), j = randi(0, NY - 1);
    var ci = randi(0, 3);
    var p0 = cornerPos(i, j, ci);
    peds.push({ x: p0.x, y: p0.y, bi: i, bj: j, corner: ci, cw: rng() < 0.5 ? 1 : -1, spd: rand(40, 70), ang: rng() * TAU, col: pick(shirtColors), skin: pick(['#d9a066', '#b87a4a', '#8a5a34', '#e8b98a']), down: false, downT: 0, crossing: false, tx: 0, ty: 0, nbi: 0, nbj: 0, ncorner: 0, hitCd: 0 });
  }
}
function updatePeds(dt) {
  for (var k = 0; k < peds.length; k++) {
    var p = peds[k];
    if (p.hitCd > 0) p.hitCd -= dt;
    if (p.down) {
      p.downT -= dt;
      if (p.downT <= 0) p.down = false;
      continue;
    }
    var tx, ty;
    if (p.crossing) { tx = p.tx; ty = p.ty; }
    else { var c0 = cornerPos(p.bi, p.bj, p.corner); tx = c0.x; ty = c0.y; }
    var dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy);
    if (d < 4) {
      if (p.crossing) {
        p.crossing = false; p.bi = p.nbi; p.bj = p.nbj; p.corner = p.ncorner;
      } else {
        if (Math.random() < 0.15) p.cw *= -1;
        var didCross = false;
        if (Math.random() < 0.12) {
          var opts = CROSS[p.corner];
          var o = opts[Math.floor(Math.random() * opts.length)];
          var ni = p.bi + o[0], nj = p.bj + o[1];
          if (ni >= 0 && ni < NX && nj >= 0 && nj < NY) {
            var np = cornerPos(ni, nj, o[2]);
            p.crossing = true; p.tx = np.x; p.ty = np.y; p.nbi = ni; p.nbj = nj; p.ncorner = o[2];
            didCross = true;
          }
        }
        if (!didCross) p.corner = (p.corner + p.cw + 4) % 4;
      }
    } else {
      p.x += dx / d * p.spd * dt;
      p.y += dy / d * p.spd * dt;
      p.ang += angDiff(Math.atan2(dy, dx), p.ang) * Math.min(1, dt * 8);
    }
  }
}
function knockPed(p, car, isPlayerCar) {
  if (p.down) {
    if (isPlayerCar && p.hitCd <= 0) { addWanted(1); p.hitCd = 1.5; }
    return;
  }
  p.down = true; p.downT = 8; p.hitCd = 1.5;
  p.ang = car.angle + rf(-0.6, 0.6);
  var nx = p.x + car.vx * 0.18, ny = p.y + car.vy * 0.18;
  if (!pointInCollider(nx, ny)) { p.x = nx; p.y = ny; }
  if (isPlayerCar) addWanted(1);
  texts.push({ x: p.x, y: p.y - 14, txt: 'OW!', t: 1.2, col: '#ffd8d8' });
}
function addWanted(n) {
  var before = state.wanted;
  state.wanted = clamp(state.wanted + n, 0, 5);
  if (state.wanted > before) {
    state.evadeT = 0;
    texts.push({ x: px(), y: py() - 30, txt: 'WANTED +' + (state.wanted - before) + ' STAR', t: 1.6, col: '#ffd23c' });
  }
}
function carPedHits() {
  for (var ci = 0; ci < cars.length; ci++) {
    var c = cars[ci];
    if (hyp(c.vx, c.vy) < 50) continue;
    for (var k = 0; k < peds.length; k++) {
      var p = peds[k];
      if (p.down && p.hitCd > 0) continue;
      if (hyp(c.x - p.x, c.y - p.y) < 18) knockPed(p, c, c === player.inCar);
    }
  }
}
function playerCarPush() {
  if (player.inCar) return;
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    var dx = player.x - c.x, dy = player.y - c.y, d = hyp(dx, dy);
    if (d < 26 && d > 0.01) {
      var push = 26 - d;
      player.x += dx / d * push; player.y += dy / d * push;
    }
  }
}

// ================= traffic =================
function aheadBlocked(c, dirx, diry) {
  var k, o, rx, ry, along, perp;
  for (k = 0; k < cars.length; k++) {
    o = cars[k];
    if (o === c) continue;
    rx = o.x - c.x; ry = o.y - c.y;
    along = rx * dirx + ry * diry;
    if (along > 4 && along < 62) {
      perp = -rx * diry + ry * dirx;
      if (Math.abs(perp) < 15) return true;
    }
  }
  if (!player.inCar) {
    rx = player.x - c.x; ry = player.y - c.y;
    along = rx * dirx + ry * diry;
    if (along > 4 && along < 56) {
      perp = -rx * diry + ry * dirx;
      if (Math.abs(perp) < 15) return true;
    }
  }
  for (k = 0; k < peds.length; k++) {
    var p = peds[k];
    if (p.down) continue;
    rx = p.x - c.x; ry = p.y - c.y;
    along = rx * dirx + ry * diry;
    if (along > 4 && along < 54) {
      perp = -rx * diry + ry * dirx;
      if (Math.abs(perp) < 15) return true;
    }
  }
  return false;
}
function updateTraffic(dt) {
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    if (c.kind !== 'traffic' || c.controlled) continue;
    var A = nodePos(c.a), B = nodePos(c.b);
    var dx = B.x - A.x, dy = B.y - A.y, len = hyp(dx, dy);
    if (len < 1) { c.t = 0; continue; }
    var dirx = dx / len, diry = dy / len;
    var f = Math.min(1, dt * 3.2);
    c.offX = lerp(c.offX, -diry * LANE, f);
    c.offY = lerp(c.offY, dirx * LANE, f);
    var distB = len * (1 - c.t);
    var target = distB < 80 ? 85 : 135;
    if (aheadBlocked(c, dirx, diry)) target = 0;
    c.spd += clamp(target - c.spd, -340 * dt, 130 * dt);
    c.t += c.spd * dt / len;
    if (c.t >= 1) {
      var prevA = c.a;
      c.a = c.b;
      var opts = adjacentNodes(c.a.i, c.a.j);
      var filtered = [];
      for (var q = 0; q < opts.length; q++) if (!(opts[q].i === prevA.i && opts[q].j === prevA.j)) filtered.push(opts[q]);
      if (filtered.length === 0) filtered = opts;
      var straight = { i: c.a.i + (c.a.i - prevA.i), j: c.a.j + (c.a.j - prevA.j) };
      var straightOk = false;
      for (var q2 = 0; q2 < filtered.length; q2++) if (filtered[q2].i === straight.i && filtered[q2].j === straight.j) straightOk = true;
      if (straightOk && Math.random() < 0.62) c.b = straight;
      else c.b = pickR(filtered);
      c.t = 0;
    }
    A = nodePos(c.a); B = nodePos(c.b);
    dx = B.x - A.x; dy = B.y - A.y; len = hyp(dx, dy);
    if (len < 1) { c.t = 0; continue; }
    dirx = dx / len; diry = dy / len;
    c.x = A.x + dx * c.t + c.offX + c.kx;
    c.y = A.y + dy * c.t + c.offY + c.ky;
    c.vx = dirx * c.spd; c.vy = diry * c.spd;
    c.speed = c.spd;
    c.dispAngle += angDiff(Math.atan2(diry, dirx), c.dispAngle) * Math.min(1, dt * 7);
    c.angle = c.dispAngle;
    c.kx = lerp(c.kx, 0, Math.min(1, dt * 2.5));
    c.ky = lerp(c.ky, 0, Math.min(1, dt * 2.5));
  }
}
function updateTrafficCount(dt) {
  var n = 0;
  for (var k = 0; k < cars.length; k++) if (cars[k].kind === 'traffic') n++;
  if (n < 14) {
    state.trafficCd -= dt;
    if (state.trafficCd <= 0) { spawnTraffic(); state.trafficCd = 1.2; }
  }
}

// ================= free cars (parked / abandoned) =================
function updateFreeCars(dt) {
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    if (c === player.inCar) continue;
    if (c.kind === 'traffic') continue;
    if (c.kind === 'police') continue;
    var v = hyp(c.vx, c.vy);
    if (v < 2) { c.vx = 0; c.vy = 0; c.speed = 0; continue; }
    var fr = Math.min(1, 2.5 * dt);
    c.vx -= c.vx * fr; c.vy -= c.vy * fr;
    c.x += c.vx * dt; c.y += c.vy * dt;
    collideCarWorld(c);
  }
}

// ================= car-car collisions =================
function shiftCar(c, dx, dy) {
  if (c.kind === 'traffic' && !c.controlled) { c.kx += dx; c.ky += dy; }
  else { c.x += dx; c.y += dy; }
}
function addVel(c, dx, dy) {
  if (c.kind === 'traffic' && !c.controlled) { c.kx += dx * 0.08; c.ky += dy * 0.08; }
  else { c.vx += dx; c.vy += dy; }
}
function carPairCollisions() {
  for (var i = 0; i < cars.length; i++) {
    for (var j = i + 1; j < cars.length; j++) {
      var a = cars[i], b = cars[j];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 676 || d2 < 0.0001) continue;
      var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (26 - d) / 2;
      shiftCar(a, -nx * ov, -ny * ov);
      shiftCar(b, nx * ov, ny * ov);
      var rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        var imp = rv * 0.65;
        addVel(a, nx * imp, ny * imp);
        addVel(b, -nx * imp, -ny * imp);
      }
    }
  }
}

// ================= police + wanted =================
function policeCount() {
  var n = 0;
  for (var k = 0; k < cars.length; k++) if (cars[k].kind === 'police') n++;
  return n;
}
function removePolice() {
  var keep = [];
  for (var k = 0; k < cars.length; k++) if (cars[k].kind !== 'police') keep.push(cars[k]);
  cars = keep;
}
function spawnPolice() {
  var side = ri(0, 3), x, y, ang;
  if (side === 0) { x = ri(0, NX) * TILE + ROAD / 2; y = 10; ang = Math.PI / 2; }
  else if (side === 1) { x = ri(0, NX) * TILE + ROAD / 2; y = WH - 10; ang = -Math.PI / 2; }
  else if (side === 2) { x = 10; y = ri(0, NY) * TILE + ROAD / 2; ang = 0; }
  else { x = WW - 10; y = ri(0, NY) * TILE + ROAD / 2; ang = Math.PI; }
  cars.push({ kind: 'police', x: x, y: y, angle: ang, vx: 0, vy: 0, speed: 0, color: '#e8e8ee', stuck: 0, revT: 0, controlled: false });
}
function updatePolice(dt) {
  var target = Math.min(state.wanted + 1, 6);
  if (state.wanted > 0 && policeCount() < target && !state.busted) {
    state.policeSpawnT -= dt;
    if (state.policeSpawnT <= 0) { spawnPolice(); state.policeSpawnT = 1.4; }
  }
  var tx = px(), ty = py();
  var pvx = player.inCar ? player.inCar.vx : 0, pvy = player.inCar ? player.inCar.vy : 0;
  var minD = 1e9;
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    if (c.kind !== 'police') continue;
    var dx = tx + pvx * 0.3 - c.x, dy = ty + pvy * 0.3 - c.y;
    var d = hyp(dx, dy);
    if (d < minD) minD = d;
    if (state.wanted <= 0) continue;
    var des = Math.atan2(dy, dx);
    var diff = angDiff(des, c.angle);
    var steer = clamp(diff * 2.2, -1, 1), throttle = 1, brake = 0;
    if (Math.abs(diff) > 1.9 && c.speed > 80) { throttle = 0; brake = 1; }
    if (Math.abs(c.speed) < 26) c.stuck += dt; else c.stuck = 0;
    if (c.stuck > 1.3) { c.revT = 0.9; c.stuck = 0; }
    if (c.revT > 0) { c.revT -= dt; throttle = 0; brake = 1; steer = -steer; }
    if (state.busted) {
      throttle = 0; brake = 0;
      c.vx -= c.vx * Math.min(1, 4 * dt);
      c.vy -= c.vy * Math.min(1, 4 * dt);
    }
    carPhysics(c, dt, throttle, brake, steer, false, 375);
    collideCarWorld(c);
  }
  if (state.wanted <= 0 && policeCount() > 0) { removePolice(); state.bustT = 0; }
  if (state.wanted > 0 && !state.busted) {
    if (policeCount() === 0 || minD > 560) state.evadeT += dt;
    else state.evadeT = Math.max(0, state.evadeT - dt * 2);
    if (state.evadeT >= 10) {
      state.wanted = 0; state.evadeT = 0;
      removePolice();
      texts.push({ x: px(), y: py() - 30, txt: 'EVADED!', t: 2, col: '#7cfc00' });
    } else {
      if (policeCount() > 0 && minD < 40) state.bustT += dt;
      else state.bustT = Math.max(0, state.bustT - dt * 1.5);
      if (state.bustT >= 2) startBusted();
    }
  }
}
function startBusted() {
  state.busted = true;
  state.bustedT = 2.4;
  state.bustT = 0;
}
function endBusted() {
  state.busted = false;
  state.cash = Math.max(0, state.cash - 200);
  state.wanted = 0; state.evadeT = 0; state.bustT = 0;
  removePolice();
  if (player.inCar) { player.inCar.controlled = false; player.inCar = null; }
  player.x = SPAWN_X + 60; player.y = SPAWN_Y + 62; player.ang = 0;
  texts.push({ x: player.x, y: player.y - 30, txt: '-$200', t: 1.8, col: '#ff6a6a' });
}

// ================= enter / exit cars =================
function nearestEnterable() {
  var best = null, bd = 52 * 52;
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    if (c.kind === 'police' || c.controlled) continue;
    var d2 = (c.x - player.x) * (c.x - player.x) + (c.y - player.y) * (c.y - player.y);
    if (d2 < bd) { bd = d2; best = c; }
  }
  return best;
}
function enterCar(c) {
  player.inCar = c;
  c.controlled = true;
  if (c.kind === 'traffic') { c.kind = 'stolen'; state.trafficCd = 3; }
}
function exitCar() {
  var c = player.inCar;
  c.controlled = false;
  var rx = -Math.sin(c.angle), ry = Math.cos(c.angle);
  var fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  var cands = [[rx * 30, ry * 30], [-rx * 30, -ry * 30], [-fx * 34, -fy * 34]];
  var placed = false;
  for (var k = 0; k < cands.length; k++) {
    var nx = c.x + cands[k][0], ny = c.y + cands[k][1];
    if (!pointInCollider(nx, ny) && nx > 10 && nx < WW - 10 && ny > 10 && ny < WH - 10) {
      player.x = nx; player.y = ny; placed = true; break;
    }
  }
  if (!placed) { player.x = c.x; player.y = c.y; }
  player.inCar = null;
}

// ================= player =================
function updatePlayer(dt) {
  if (player.inCar) {
    var c = player.inCar;
    var throttle = (key('KeyW') || key('ArrowUp')) ? 1 : 0;
    var brake = (key('KeyS') || key('ArrowDown')) ? 1 : 0;
    var steer = ((key('KeyD') || key('ArrowRight')) ? 1 : 0) - ((key('KeyA') || key('ArrowLeft')) ? 1 : 0);
    var hand = !!key('Space');
    if (state.busted) {
      throttle = 0; brake = 0; steer = 0;
      c.vx -= c.vx * Math.min(1, 4 * dt);
      c.vy -= c.vy * Math.min(1, 4 * dt);
    }
    carPhysics(c, dt, throttle, brake, steer, hand, 440);
    collideCarWorld(c);
  } else {
    var mx = 0, my = 0;
    if (key('KeyW') || key('ArrowUp')) my -= 1;
    if (key('KeyS') || key('ArrowDown')) my += 1;
    if (key('KeyA') || key('ArrowLeft')) mx -= 1;
    if (key('KeyD') || key('ArrowRight')) mx += 1;
    var l = hyp(mx, my);
    if (l > 0 && !state.busted) {
      mx /= l; my /= l;
      player.x += mx * 150 * dt;
      player.y += my * 150 * dt;
      player.ang += angDiff(Math.atan2(my, mx), player.ang) * Math.min(1, dt * 14);
    }
    collidePoint(player, 9);
  }
}

// ================= checkpoint =================
function spawnCheckpoint() {
  var x = WW / 2, y = WH / 2;
  for (var tries = 0; tries < 200; tries++) {
    if (Math.random() < 0.5) {
      x = ri(0, NX) * TILE + ROAD / 2 + rf(-30, 30);
      y = rf(60, WH - 60);
    } else {
      y = ri(0, NY) * TILE + ROAD / 2 + rf(-30, 30);
      x = rf(60, WW - 60);
    }
    if (pointInCollider(x, y)) continue;
    if (tries < 150 && hyp(x - px(), y - py()) < 650) continue;
    break;
  }
  checkpoint.x = x; checkpoint.y = y;
}
function updateCheckpoint() {
  if (state.busted) return;
  if (hyp(px() - checkpoint.x, py() - checkpoint.y) < 50) {
    state.cash += 500;
    texts.push({ x: checkpoint.x, y: checkpoint.y - 20, txt: '+$500', t: 1.8, col: '#7cfc00' });
    spawnCheckpoint();
  }
}

// ================= main update =================
function update(dt) {
  state.time += dt;
  if (enterPressed) {
    enterPressed = false;
    if (!state.busted) {
      if (player.inCar) exitCar();
      else {
        var c = nearestEnterable();
        if (c) enterCar(c);
      }
    }
  }
  updatePlayer(dt);
  updateTraffic(dt);
  updateFreeCars(dt);
  updatePolice(dt);
  carPairCollisions();
  carPedHits();
  playerCarPush();
  updatePeds(dt);
  updateCheckpoint();
  updateTrafficCount(dt);
  if (state.busted) {
    state.bustedT -= dt;
    if (state.bustedT <= 0) endBusted();
  }
  for (var k = texts.length - 1; k >= 0; k--) {
    texts[k].t -= dt;
    texts[k].y -= 26 * dt;
    if (texts[k].t <= 0) texts.splice(k, 1);
  }
  var tx = px(), ty = py();
  if (player.inCar) { tx += player.inCar.vx * 0.22; ty += player.inCar.vy * 0.22; }
  var f = 1 - Math.exp(-5 * dt);
  cam.x = clamp(lerp(cam.x, tx, f), VW / 2, WW - VW / 2);
  cam.y = clamp(lerp(cam.y, ty, f), VH / 2, WH - VH / 2);
}

// ================= drawing =================
function inView(x, y, m) {
  return x > cam.x - VW / 2 - m && x < cam.x + VW / 2 + m && y > cam.y - VH / 2 - m && y < cam.y + VH / 2 + m;
}
function drawCar(c) {
  var g = ctx;
  g.save();
  g.translate(c.x, c.y);
  g.rotate((c.kind === 'traffic' && !c.controlled) ? c.dispAngle : c.angle);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-20, -7, 40, 18);
  g.fillStyle = '#1c1c1e';
  g.fillRect(-15, -11, 9, 4); g.fillRect(-15, 7, 9, 4);
  g.fillRect(7, -11, 9, 4); g.fillRect(7, 7, 9, 4);
  g.fillStyle = c.color;
  g.fillRect(-20, -9, 40, 18);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.5;
  g.strokeRect(-20, -9, 40, 18);
  g.fillStyle = 'rgba(28,38,54,0.85)';
  g.fillRect(3, -7, 7, 14);
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.fillRect(-8, -7, 10, 14);
  g.fillStyle = '#ffe9a3';
  g.fillRect(18, -7, 2, 4); g.fillRect(18, 3, 2, 4);
  g.fillStyle = '#d33b3b';
  g.fillRect(-20, -7, 2, 4); g.fillRect(-20, 3, 2, 4);
  if (c.kind === 'police') {
    g.fillStyle = '#15151a';
    g.fillRect(-20, -9, 12, 18);
    g.fillStyle = '#1d3f8f';
    g.fillRect(-6, -9, 4, 18);
    var flashOn = ((state.time * 7) % 2) < 1;
    g.fillStyle = flashOn ? '#ff3b3b' : '#3b6bff';
    g.fillRect(-4, -7, 4, 14);
    g.fillStyle = flashOn ? '#3b6bff' : '#ff3b3b';
    g.fillRect(1, -7, 4, 14);
  }
  if (c === player.inCar) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(9, 0); g.lineTo(3, -4); g.lineTo(3, 4);
    g.closePath(); g.fill();
  }
  g.restore();
}
function drawPed(p) {
  var g = ctx;
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.ang);
  if (p.down) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(2, 3, 9, 4.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#8a4a4a';
    g.beginPath(); g.ellipse(0, 0, 8.5, 4.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#c98f8f';
    g.beginPath(); g.arc(6.5, 0, 3, 0, TAU); g.fill();
  } else {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(1, 2, 6, 4, 0, 0, TAU); g.fill();
    g.fillStyle = p.col;
    g.beginPath(); g.ellipse(0, 0, 6, 4.4, 0, 0, TAU); g.fill();
    g.fillStyle = p.skin;
    g.beginPath(); g.arc(3.5, 0, 2.8, 0, TAU); g.fill();
  }
  g.restore();
}
function drawPlayer() {
  var g = ctx;
  g.save();
  g.translate(player.x, player.y);
  g.rotate(player.ang);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(1, 3, 9, 6, 0, 0, TAU); g.fill();
  g.fillStyle = '#2f86c9';
  g.beginPath(); g.ellipse(0, 0, 9.5, 6, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = '#e8b98a';
  g.beginPath(); g.arc(4, 0, 3.6, 0, TAU); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(11, 0); g.lineTo(6, -3.4); g.lineTo(6, 3.4);
  g.closePath(); g.fill();
  g.restore();
}
function drawCheckpoint() {
  var g = ctx;
  var r = 42 + Math.sin(state.time * 4) * 5;
  var grad = g.createRadialGradient(checkpoint.x, checkpoint.y, 6, checkpoint.x, checkpoint.y, r + 26);
  grad.addColorStop(0, 'rgba(120,255,120,0.45)');
  grad.addColorStop(1, 'rgba(120,255,120,0)');
  g.fillStyle = grad;
  g.fillRect(checkpoint.x - r - 30, checkpoint.y - r - 30, (r + 30) * 2, (r + 30) * 2);
  g.strokeStyle = '#7cff7c'; g.lineWidth = 5;
  g.beginPath(); g.arc(checkpoint.x, checkpoint.y, r, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2;
  g.beginPath(); g.arc(checkpoint.x, checkpoint.y, r - 8, 0, TAU); g.stroke();
  g.fillStyle = '#7cff7c';
  g.beginPath(); g.arc(checkpoint.x, checkpoint.y, 6, 0, TAU); g.fill();
  var bob = Math.sin(state.time * 5) * 6;
  g.fillStyle = '#7cff7c';
  g.beginPath();
  g.moveTo(checkpoint.x, checkpoint.y - 62 + bob);
  g.lineTo(checkpoint.x - 9, checkpoint.y - 78 + bob);
  g.lineTo(checkpoint.x + 9, checkpoint.y - 78 + bob);
  g.closePath(); g.fill();
}
function drawText(t) {
  var g = ctx;
  g.globalAlpha = clamp(t.t, 0, 1);
  g.font = 'bold 15px Consolas, monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillText(t.txt, t.x + 1, t.y + 1);
  g.fillStyle = t.col;
  g.fillText(t.txt, t.x, t.y);
  g.textAlign = 'left';
  g.globalAlpha = 1;
}
function drawMinimap() {
  var g = ctx;
  var x0 = VW - mmW - 12, y0 = 12;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(x0 - 3, y0 - 3, mmW + 6, mmH + 6);
  g.drawImage(mmCanvas, x0, y0);
  var blink = (state.time * 3) % 2 < 1.3;
  if (blink) {
    g.fillStyle = '#5aff5a';
    g.beginPath(); g.arc(x0 + checkpoint.x * mmScale, y0 + checkpoint.y * mmScale, 3.2, 0, TAU); g.fill();
  }
  for (var k = 0; k < cars.length; k++) {
    var c = cars[k];
    if (c.kind === 'police') {
      g.fillStyle = ((state.time * 7) % 2 < 1) ? '#ff4a4a' : '#4a8aff';
      g.beginPath(); g.arc(x0 + c.x * mmScale, y0 + c.y * mmScale, 2.6, 0, TAU); g.fill();
    } else if (c.kind === 'traffic' && !c.controlled) {
      g.fillStyle = 'rgba(220,220,220,0.6)';
      g.fillRect(x0 + c.x * mmScale - 1, y0 + c.y * mmScale - 1, 2, 2);
    }
  }
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(x0 + px() * mmScale, y0 + py() * mmScale, 3, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5;
  g.strokeRect(x0, y0, mmW, mmH);
}
function drawCpArrow() {
  var sx = checkpoint.x - cam.x + VW / 2, sy = checkpoint.y - cam.y + VH / 2;
  if (sx > 0 && sx < VW && sy > 0 && sy < VH) return;
  var cx = VW / 2, cy = VH / 2;
  var dx = sx - cx, dy = sy - cy;
  var m = Math.max(Math.abs(dx) / (VW / 2 - 46), Math.abs(dy) / (VH / 2 - 46), 0.001);
  var ax = cx + dx / m, ay = cy + dy / m;
  var ang = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.fillStyle = '#5aff5a';
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}
function drawHUD() {
  var g = ctx;
  g.font = 'bold 28px Consolas, monospace';
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText('$' + state.cash, 17, 37);
  g.fillStyle = '#8dff6a'; g.fillText('$' + state.cash, 16, 36);
  var s = '';
  for (var i = 0; i < 5; i++) s += (i < state.wanted) ? '\u2605' : '\u2606';
  g.font = '26px sans-serif';
  g.globalAlpha = state.wanted > 0 ? (0.6 + 0.4 * Math.sin(state.time * 6)) : 1;
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(s, 17, 69);
  g.fillStyle = state.wanted > 0 ? '#ffd23c' : 'rgba(255,255,255,0.45)';
  g.fillText(s, 16, 68);
  g.globalAlpha = 1;
  g.font = 'bold 15px Consolas, monospace';
  var obj;
  if (state.busted) obj = 'BUSTED!';
  else if (state.wanted > 0) obj = 'EVADE the police - ' + (Math.max(0, 10 - state.evadeT)).toFixed(1) + 's to lose them';
  else obj = 'Reach the glowing checkpoint (+$500)';
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(obj, 17, 97);
  g.fillStyle = '#e8e8f0'; g.fillText(obj, 16, 96);
  if (player.inCar) {
    var kmh = Math.round(Math.abs(player.inCar.speed) * 0.45);
    g.font = 'bold 22px Consolas, monospace';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(kmh + ' km/h', 17, VH - 17);
    g.fillStyle = '#ffd23c'; g.fillText(kmh + ' km/h', 16, VH - 18);
  }
  g.font = '13px Consolas, monospace';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.textAlign = 'right';
  g.fillText('WASD/arrows walk+drive  |  E enter/exit car  |  SPACE handbrake', VW - 12, VH - 12);
  g.textAlign = 'left';
  if (state.busted) {
    g.fillStyle = 'rgba(110,0,0,0.45)';
    g.fillRect(0, 0, VW, VH);
    g.font = 'bold 84px Consolas, monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillText('BUSTED', VW / 2 + 4, VH / 2 + 4);
    g.fillStyle = '#ff5a5a'; g.fillText('BUSTED', VW / 2, VH / 2);
    g.font = 'bold 20px Consolas, monospace';
    g.fillStyle = '#ffffff';
    g.fillText('-$200 - respawning on foot...', VW / 2, VH / 2 + 44);
    g.textAlign = 'left';
  }
  drawMinimap();
  drawCpArrow();
}
function render() {
  var ox = Math.round(cam.x - VW / 2), oy = Math.round(cam.y - VH / 2);
  ctx.fillStyle = '#202024';
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(-ox, -oy);
  ctx.drawImage(cityCanvas, ox, oy, VW, VH, ox, oy, VW, VH);
  drawCheckpoint();
  var k;
  for (k = 0; k < peds.length; k++) if (peds[k].down && inView(peds[k].x, peds[k].y, 30)) drawPed(peds[k]);
  for (k = 0; k < cars.length; k++) if (inView(cars[k].x, cars[k].y, 60)) drawCar(cars[k]);
  for (k = 0; k < peds.length; k++) if (!peds[k].down && inView(peds[k].x, peds[k].y, 30)) drawPed(peds[k]);
  if (!player.inCar) drawPlayer();
  for (k = 0; k < texts.length; k++) drawText(texts[k]);
  ctx.restore();
  drawHUD();
}

// ================= input =================
var keys = {};
var enterPressed = false;
function key(c) { return !!keys[c]; }
window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
  if (!e.repeat && e.code === 'KeyE') enterPressed = true;
  keys[e.code] = true;
});
window.addEventListener('keyup', function (e) { keys[e.code] = false; });
window.addEventListener('blur', function () { keys = {}; });

// ================= init =================
genCity();
renderCity();
renderMinimapBase();
placeParked();
spawnPeds();
for (var tq = 0; tq < 14; tq++) spawnTraffic();
spawnCheckpoint();

var last = performance.now();
function frame(now) {
  var dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

})();
