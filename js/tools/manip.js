import { state } from '../state.js';
import { emit } from '../events.js';
import { pushHistory } from '../utils/history.js';
import { rndId, snapIfNeeded } from '../utils/helpers.js';

let rotDeg, rotHandle, ghost;
let dragging = null;

export function initManip() {
  rotDeg = document.getElementById('rotDeg');
  rotHandle = document.getElementById('rotHandle');
  ghost = document.getElementById('ghost');

  rotHandle.addEventListener('mousedown', e => {
    const box = selectionBBox();
    if (!box) return;
    const mp = mousePos(e);
    const base = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI;
    const rot0 = new Map();
    selectionItems().forEach(it => rot0.set(it.id, it.rot || 0));
    dragging = { type: 'rotate', base, rot0 };
    rotHandle.style.cursor = 'grabbing';
    pushHistory();
  });

  rotDeg.addEventListener('input', () => {
    const deg = +rotDeg.value || 0;
    for (const it of selectionItems()) it.rot = deg;
    emit('draw');
    updateGhost();
  });
}

export function onMouseMove(e) {
  const mp = snapIfNeeded(mousePos(e));
  if (dragging) {
    if (dragging.type === 'handle') {
      const item = state.items.find(it => it.id === dragging.id);
      if (!item) return;
      const pts = itemPoints(item);
      pts[dragging.keyIndex] = mp;
      setItemPoints(item, pts);
      emit('draw');
      updateGhost();
    } else if (dragging.type === 'move') {
      const dx = mp.x - dragging.start.x;
      const dy = mp.y - dragging.start.y;
      dragging.start = mp;
      for (const it of selectionItems()) {
        const pts = itemPoints(it).map(p => ({ x: p.x + dx, y: p.y + dy }));
        setItemPoints(it, pts);
      }
      emit('draw');
      updateGhost();
    } else if (dragging.type === 'rotate') {
      const box = selectionBBox();
      if (!box) return;
      const ang = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI - dragging.base;
      const sel = selectionItems();
      for (const it of sel) it.rot = (dragging.rot0.get(it.id) || 0) + ang;
      rotDeg.value = Math.round(sel[0]?.rot || 0);
      emit('draw');
      updateGhost();
    }
    return;
  }
  if (state.drawing) {
    if (state.drawing.kind === 'line') state.drawing.p2 = mp;
    else if (state.drawing.kind === 'quadratic') {
      if (state.drawing.stage === 1) state.drawing.p2 = mp;
      else if (state.drawing.stage === 2) state.drawing.cp = mp;
    }
    emit('draw');
  }
}

export function onMouseDown(e) {
  const mp = snapIfNeeded(mousePos(e));
  if (state.tool === 'line') {
    if (!state.drawing) {
      state.drawing = { id: rndId('ln'), kind: 'line', p1: mp, p2: mp, color: getStrokeColor(), width: getStrokeWidth() };
    } else {
      commitDrawing();
    }
    emit('draw');
    return;
  }
  if (state.tool === 'quadratic') {
    if (!state.drawing) {
      state.drawing = { id: rndId('q'), kind: 'quadratic', p1: mp, p2: mp, cp: mp, color: getStrokeColor(), width: getStrokeWidth(), stage: 1 };
    } else {
      if (state.drawing.stage === 1) { state.drawing.stage = 2; state.drawing.p2 = mp; }
      else { state.drawing.cp = mp; commitDrawing(); }
    }
    emit('draw');
    return;
  }
  if (state.tool === 'rect') {
    if (!state.drawing) {
      state.drawing = { id: rndId('r'), kind: 'shape', path: [mp, mp, mp, mp], color: getStrokeColor(), width: getFillMode() === 'fill' ? 0 : getStrokeWidth(), fill: getFillMode() === 'hollow' ? null : getFillColor(), _isRect: true };
    } else {
      commitDrawing();
    }
    emit('draw');
    return;
  }
  if (state.tool === 'ellipse') {
    if (!state.drawing) {
      state.drawing = { id: rndId('e'), kind: 'shape', path: [mp], color: getStrokeColor(), width: getFillMode() === 'fill' ? 0 : getStrokeWidth(), fill: getFillMode() === 'hollow' ? null : getFillColor(), _center: mp, _edge: mp, _isEllipse: true };
    } else {
      commitDrawing();
    }
    emit('draw');
    return;
  }
  if (state.tool === 'select') {
    const hit = hitTestHandle(mp);
    if (hit) {
      state.selected.clear(); state.selected.add(hit.id);
      dragging = { type: 'handle', id: hit.id, keyIndex: hit.keyIndex };
      pushHistory();
      return;
    }
    const box = selectionBBox();
    if (box && mp.x >= box.x && mp.x <= box.x + box.w && mp.y >= box.y && mp.y <= box.y + box.h) {
      dragging = { type: 'move', start: mp };
      pushHistory();
      return;
    }
    const hitId = hitTestItem(mp);
    if (hitId) {
      if (!e.shiftKey) state.selected.clear();
      state.selected.add(hitId);
      emit('draw');
      updateGhost();
    } else {
      if (!e.shiftKey) state.selected.clear();
      emit('draw');
      updateGhost();
    }
  }
}

export function onMouseUp() {
  dragging = null;
  rotHandle.style.cursor = 'grab';
}

function mousePos(e) {
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function hitTestHandle(pt) {
  const r = 7;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (!state.selected.has(it.id)) continue;
    const pts = itemPoints(it);
    for (let k = pts.length - 1; k >= 0; k--) {
      const p = pts[k];
      if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 <= r * r) return { id: it.id, keyIndex: k };
    }
  }
  return null;
}

function hitTestItem(pt) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.visible === false) continue;
    if (pointNearItem(pt, it)) return it.id;
  }
  return null;
}

function pointNearItem(p, it) {
  if (it.kind === 'line') return pointLineDist(p, it.p1, it.p2) < Math.max(6, it.width + 4);
  if (it.kind === 'quadratic') return pointQuadNear(p, it.p1, it.cp, it.p2) < Math.max(6, it.width + 4);
  if (it.kind === 'shape') return pointInPolygon(p, it.path);
}

function pointLineDist(p, a, b) {
  const l2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

function quadAt(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function pointQuadNear(p, a, c, b) {
  let min = 1e9, prev = a;
  for (let i = 1; i <= 30; i++) {
    const t = i / 30, q = quadAt(a, c, b, t);
    const d = pointLineDist(p, prev, q);
    if (d < min) min = d;
    prev = q;
  }
  return min;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function selectionItems() {
  return state.items.filter(it => state.selected.has(it.id));
}

function selectionBBox() {
  const sel = selectionItems();
  if (!sel.length) return null;
  let xs = [], ys = [];
  sel.forEach(it => itemPoints(it).forEach(p => { xs.push(p.x); ys.push(p.y); }));
  const x1 = Math.min(...xs), y1 = Math.min(...ys), x2 = Math.max(...xs), y2 = Math.max(...ys);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

export function updateGhost() {
  const box = selectionBBox();
  if (!box) {
    ghost.classList.add('hide');
    rotHandle.classList.add('hide');
    return;
  }
  ghost.classList.remove('hide');
  rotHandle.classList.remove('hide');
  ghost.style.left = box.x + 'px';
  ghost.style.top = box.y + 'px';
  ghost.style.width = Math.max(0, box.w) + 'px';
  ghost.style.height = Math.max(0, box.h) + 'px';
  rotHandle.style.left = (box.cx - 8) + 'px';
  rotHandle.style.top = (box.y - 26) + 'px';
  rotDeg.value = Math.round(selectionItems()[0]?.rot || 0);
}

function commitDrawing() {
  if (!state.drawing) return;
  const it = state.drawing;
  delete it.stage; delete it._isEllipse; delete it._center; delete it._edge; delete it._isRect;
  state.items.push(it);
  pushHistory();
  state.drawing = null;
  emit('draw');
  emit('refreshList');
}

function getStrokeColor() { return document.getElementById('strokeColor').value; }
function getStrokeWidth() { return +document.getElementById('strokeWidth').value; }
function getFillColor() { return document.getElementById('fillColor').value; }
function getFillMode() { return document.getElementById('fillMode').value; }

function itemPoints(it) {
  if (it.kind === 'line') return [it.p1, it.p2];
  if (it.kind === 'quadratic') return [it.p1, it.cp, it.p2];
  if (it.kind === 'shape') return it.path;
  return [];
}

function setItemPoints(it, pts) {
  if (it.kind === 'line') { it.p1 = pts[0]; it.p2 = pts[1]; }
  if (it.kind === 'quadratic') { it.p1 = pts[0]; it.cp = pts[1]; it.p2 = pts[2]; }
  if (it.kind === 'shape') it.path = pts;
}