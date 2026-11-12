// GDK renderer — reads sim state and draws it. It NEVER writes sim state
// (LOG.SIM-RENDER-SEPARATION: rendering reads, the sim decides).

import {
  CELL_SIZE,
  ROAD_W,
  WORLD_CELLS,
  WORLD_SIZE,
  type SimState,
  type Vec2,
} from '../sim/sim.js';

const ROOFTOPS = ['#4a5568', '#5d4a66', '#665e4a', '#4a6660', '#664a4a'];
const ASPHALT = '#26292e';
const SIDEWALK = '#3a3f45';
const GRASS = '#2d4a2d';
const DASH = '#c9b446';

export interface Camera { x: number; y: number; scale: number }

export function createCamera(): Camera {
  return { x: 0, y: 0, scale: 13 };
}

function playerWorldPos(s: SimState): Vec2 {
  return s.player.carIndex !== null ? s.cars[s.player.carIndex].pos : s.player.pos;
}

export function render(ctx: CanvasRenderingContext2D, s: SimState, cam: Camera, viewW: number, viewH: number): void {
  const target = playerWorldPos(s);
  cam.x += (target.x - cam.x) * 0.12;
  cam.y += (target.y - cam.y) * 0.12;

  ctx.fillStyle = ASPHALT;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(viewW / 2, viewH / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);

  drawCity(ctx, s, cam, viewW, viewH);
  drawCheckpoint(ctx, s);
  drawPeds(ctx, s);
  drawCars(ctx, s);
  drawPlayer(ctx, s);

  ctx.restore();

  drawHud(ctx, s, viewW, viewH);
  drawMinimap(ctx, s, viewW, viewH);
  if (s.flow.state === 'BUSTED') {
    ctx.fillStyle = 'rgba(10, 10, 14, 0.55)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = '#e05555';
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED', viewW / 2, viewH / 2);
    ctx.fillStyle = '#cfcfcf';
    ctx.font = '18px monospace';
    ctx.fillText('respawning...', viewW / 2, viewH / 2 + 40);
    ctx.textAlign = 'left';
  }
}

function visibleCells(cam: Camera, viewW: number, viewH: number): { i0: number; i1: number; j0: number; j1: number } {
  const halfW = viewW / (2 * cam.scale);
  const halfH = viewH / (2 * cam.scale);
  const i0 = Math.max(0, Math.floor((cam.x - halfW) / CELL_SIZE));
  const i1 = Math.min(WORLD_CELLS - 1, Math.ceil((cam.x + halfW) / CELL_SIZE));
  const j0 = Math.max(0, Math.floor((cam.y - halfH) / CELL_SIZE));
  const j1 = Math.min(WORLD_CELLS - 1, Math.ceil((cam.y + halfH) / CELL_SIZE));
  return { i0, i1, j0, j1 };
}

function drawCity(ctx: CanvasRenderingContext2D, s: SimState, cam: Camera, viewW: number, viewH: number): void {
  const { i0, i1, j0, j1 } = visibleCells(cam, viewW, viewH);
  const inner = CELL_SIZE - ROAD_W;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const bx = i * CELL_SIZE + ROAD_W;
      const by = j * CELL_SIZE + ROAD_W;
      ctx.fillStyle = GRASS;
      ctx.fillRect(bx, by, inner, inner);
      ctx.fillStyle = SIDEWALK;
      ctx.fillRect(bx, by, inner, 2.2);
      ctx.fillRect(bx, by + inner - 2.2, inner, 2.2);
      ctx.fillRect(bx, by, 2.2, inner);
      ctx.fillRect(bx + inner - 2.2, by, 2.2, inner);
    }
  }
  // buildings (visible only)
  const vx0 = cam.x - viewW / (2 * cam.scale) - 2;
  const vy0 = cam.y - viewH / (2 * cam.scale) - 2;
  const vx1 = cam.x + viewW / (2 * cam.scale) + 2;
  const vy1 = cam.y + viewH / (2 * cam.scale) + 2;
  for (const b of s.buildings) {
    if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
    const tone = ROOFTOPS[Math.floor(b.tone * ROOFTOPS.length) % ROOFTOPS.length];
    ctx.fillStyle = tone;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  // road center dashes
  ctx.fillStyle = DASH;
  for (let k = i0; k <= i1 + 1; k++) {
    const x = k * CELL_SIZE + ROAD_W / 2;
    for (let y = Math.max(0, vy0); y < Math.min(WORLD_SIZE, vy1); y += 4) {
      if ((y % CELL_SIZE) < ROAD_W) continue;
      ctx.fillRect(x - 0.18, y, 0.36, 2);
    }
  }
  for (let k = j0; k <= j1 + 1; k++) {
    const y = k * CELL_SIZE + ROAD_W / 2;
    for (let x = Math.max(0, vx0); x < Math.min(WORLD_SIZE, vx1); x += 4) {
      if ((x % CELL_SIZE) < ROAD_W) continue;
      ctx.fillRect(x, y - 0.18, 2, 0.36);
    }
  }
}

function drawCheckpoint(ctx: CanvasRenderingContext2D, s: SimState): void {
  const pulse = 1 + 0.15 * Math.sin(s.tick * 0.08);
  ctx.strokeStyle = '#ffd94a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(s.checkpoint.x, s.checkpoint.y, 6 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 217, 74, 0.18)';
  ctx.beginPath();
  ctx.arc(s.checkpoint.x, s.checkpoint.y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawPeds(ctx: CanvasRenderingContext2D, s: SimState): void {
  for (const ped of s.peds) {
    ctx.fillStyle = ped.knocked ? '#5a5148' : '#d8b48a';
    ctx.beginPath();
    ctx.arc(ped.pos.x, ped.pos.y, ped.knocked ? 0.8 : 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (!ped.knocked) {
      ctx.strokeStyle = '#8a6d4a';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(ped.pos.x, ped.pos.y);
      ctx.lineTo(ped.pos.x + ped.dir.x * 1.1, ped.pos.y + ped.dir.y * 1.1);
      ctx.stroke();
    }
  }
}

function carBody(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, len: number, wid: number, color: string, flash: boolean, tick: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = color;
  ctx.fillRect(-len / 2, -wid / 2, len, wid);
  ctx.fillStyle = 'rgba(220, 240, 255, 0.75)';
  ctx.fillRect(len * 0.05, -wid / 2 + 0.5, len * 0.28, wid - 1);
  if (flash) {
    const blue = tick % 30 < 15;
    ctx.fillStyle = blue ? '#3aa0ff' : '#ff4a4a';
    ctx.fillRect(-len / 2 + 0.6, -wid / 2, 1.2, wid / 2);
    ctx.fillRect(-len / 2 + 0.6, 0, 1.2, wid / 2);
  }
  ctx.restore();
}

function drawCars(ctx: CanvasRenderingContext2D, s: SimState): void {
  const colors = ['#b04a3f', '#3f6ab0', '#4a8a52', '#8a6a2f', '#7a4a8a'];
  for (let i = 0; i < s.cars.length; i++) {
    const c = s.cars[i];
    if (c.pos.x < -100) continue;
    const isPlayerCar = i === s.player.carIndex;
    if (c.police) {
      carBody(ctx, c.pos.x, c.pos.y, c.heading, 4.4, 2.0, '#e8e8ea', s.wanted > 0, s.tick);
    } else {
      const color = isPlayerCar ? '#ffd94a' : c.parked ? colors[i % colors.length] : '#9aa4ad';
      carBody(ctx, c.pos.x, c.pos.y, c.heading, 4.4, 2.0, color, false, s.tick);
    }
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: SimState): void {
  if (s.player.carIndex !== null) return;
  const p = s.player.pos;
  ctx.fillStyle = '#ffd94a';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd94a';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(s.player.heading) * 1.6, p.y + Math.sin(s.player.heading) * 1.6);
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, s: SimState, viewW: number, viewH: number): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7ee787';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(`$${s.score}`, 16, 30);
  ctx.fillStyle = '#ff5f5f';
  ctx.font = '24px monospace';
  const stars = '★'.repeat(s.wanted) + '☆'.repeat(5 - s.wanted);
  ctx.textAlign = 'right';
  ctx.fillText(stars, viewW - 16, 32);
  ctx.fillStyle = '#e8d8a0';
  ctx.font = '15px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('reach the yellow checkpoint', viewW / 2, viewH - 26);
  ctx.textAlign = 'left';
}

function drawMinimap(ctx: CanvasRenderingContext2D, s: SimState, viewW: number, viewH: number): void {
  const size = 150;
  const pad = 14;
  const x0 = viewW - size - pad;
  const y0 = viewH - size - pad;
  const k = size / WORLD_SIZE;
  ctx.fillStyle = 'rgba(16, 20, 24, 0.85)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = '#3a3f45';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, size, size);
  ctx.fillStyle = '#3a3f45';
  for (let i = 0; i <= WORLD_CELLS; i++) {
    ctx.fillRect(x0 + (i * CELL_SIZE) * k - 0.5, y0, 1, size);
    ctx.fillRect(x0, y0 + (i * CELL_SIZE) * k - 0.5, size, 1);
  }
  ctx.fillStyle = '#ffd94a';
  ctx.fillRect(x0 + s.checkpoint.x * k - 2, y0 + s.checkpoint.y * k - 2, 4, 4);
  ctx.fillStyle = '#5fa8ff';
  for (const c of s.cars) {
    if (c.police && c.pos.x > -100) {
      ctx.fillRect(x0 + c.pos.x * k - 1.5, y0 + c.pos.y * k - 1.5, 3, 3);
    }
  }
  const p = playerWorldPos(s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 + p.x * k - 2, y0 + p.y * k - 2, 4, 4);
}
