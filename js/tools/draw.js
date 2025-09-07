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
    const cx = item.kind === 'line' ? (item.p1.x + item.p2.x) / 2 : item.kind === 'quadratic' ? (item.p1.x + item.p2.x) / 2 : item.path.reduce((s, p) => s + p.x, 0) / item.path.length;
    const cy = item.kind === 'line' ? (item.p1.y + item.p2.y) / 2 : item.kind === 'quadratic' ? (item.p1.y + item.p2.y) / 2 : item.path.reduce((s, p) => s + p.y, 0) / item.path.length;
    ctx.translate(cx, cy);
    ctx.rotate(item.rot * Math.PI / 180);
    ctx.translate(-cx, -cy);
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