import { state } from '../state.js';

export function exportJSON() {
  const { clientWidth: w, clientHeight: h } = document.getElementById('stage');
  return {
    type: 'LinePack',
    version: 2,
    size: { w, h },
    elements: state.items.map(it => serializeItem(it, w, h)),
    animations: state.animations
  };
}

export function importJSON(data) {
  if (!data || data.type !== 'LinePack') throw new Error('Invalid LinePack file');
  const { w, h } = data.size;
  const den = p => ({ x: p.x * w, y: p.y * h });
  state.items = data.elements.map(el => {
    const it = { id: el.id, kind: el.kind, color: el.style.color, width: +el.style.width, rot: +(el.style.rot || 0), visible: el.style.visible !== false };
    if (el.kind === 'line') { it.p1 = den(el.points.p1); it.p2 = den(el.points.p2); }
    if (el.kind === 'quadratic') { it.p1 = den(el.points.p1); it.cp = den(el.points.cp); it.p2 = den(el.points.p2); }
    if (el.kind === 'shape') { it.path = el.path.map(den); it.fill = el.fill || null; }
    return it;
  });
  state.animations = data.animations || [];
}

function serializeItem(it, w, h) {
  const norm = p => ({ x: +(p.x / w).toFixed(6), y: +(p.y / h).toFixed(6) });
  const base = { id: it.id, kind: it.kind, style: { color: it.color, width: +it.width, rot: +(it.rot || 0), visible: it.visible !== false } };
  if (it.kind === 'line') return { ...base, points: { p1: norm(it.p1), p2: norm(it.p2) } };
  if (it.kind === 'quadratic') return { ...base, points: { p1: norm(it.p1), cp: norm(it.cp), p2: norm(it.p2) } };
  if (it.kind === 'shape') return { ...base, fill: it.fill || null, path: it.path.map(norm) };
}