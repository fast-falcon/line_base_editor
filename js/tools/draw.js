import { state } from '../state.js';

export function drawGrid(ctx, w, h, step = 32) {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();
}

export function renderItem(ctx, item, showHandles = false) {
  if (item.visible === false) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = item.color; ctx.lineWidth = item.width;
  if (item.rot) {
    const cen = itemCenter(item);
    ctx.translate(cen.x, cen.y);
    ctx.rotate(item.rot * Math.PI / 180);
    ctx.translate(-cen.x, -cen.y);
  }
  if (item.kind === 'line') {
    ctx.beginPath(); ctx.moveTo(item.p1.x, item.p1.y); ctx.lineTo(item.p2.x, item.p2.y); ctx.stroke();
    if (showHandles) drawHandles(ctx, [item.p1, item.p2]);
  } else if (item.kind === 'quadratic') {
    ctx.beginPath(); ctx.moveTo(item.p1.x, item.p1.y); ctx.quadraticCurveTo(item.cp.x, item.cp.y, item.p2.x, item.p2.y); ctx.stroke();
    if (showHandles) drawHandles(ctx, [item.p1, item.cp, item.p2]);
  } else if (item.kind === 'shape') {
    ctx.beginPath(); ctx.moveTo(item.path[0].x, item.path[0].y);
    for (let i = 1; i < item.path.length; i++) ctx.lineTo(item.path[i].x, item.path[i].y);
    ctx.closePath();
    if (item.fill) { ctx.fillStyle = item.fill; ctx.fill(); }
    if (item.width > 0) ctx.stroke();
    if (showHandles) drawHandles(ctx, item.path);
  }
  ctx.restore();
}

function drawHandles(ctx, pts) {
  ctx.save();
  for (const p of pts) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,200,87,0.95)'; ctx.strokeStyle = '#3b2f00'; ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function itemCenter(it) {
  const pts = it.kind === 'line' ? [it.p1, it.p2]
    : it.kind === 'quadratic' ? [it.p1, it.cp, it.p2]
    : it.path;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}