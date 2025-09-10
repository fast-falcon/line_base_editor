import { state } from '../state.js';
import { emit, on } from '../events.js';
import { CONFIG } from '../config.js';
import { drawGrid, renderItem } from '../tools/draw.js';
import { onMouseDown, onMouseMove, onMouseUp, updateGhost } from '../tools/manip.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * CONFIG.DPR;
  canvas.height = rect.height * CONFIG.DPR;
  ctx.setTransform(CONFIG.DPR, 0, 0, CONFIG.DPR, 0, 0);
  emit('draw');
}

export function initCanvas() {
  resize();
  window.addEventListener('resize', resize);
  on('draw', draw);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mouseup', onMouseUp);
  draw();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas.width, canvas.height);
  for (const it of state.items) renderItem(ctx, it, state.selected.has(it.id));
  if (state.drawing) renderItem(ctx, state.drawing, true);
  updateGhost();
}