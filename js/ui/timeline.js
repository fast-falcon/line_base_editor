import { state } from '../state.js';
import { emit } from '../events.js';
import { pushHistory } from '../utils/history.js';

export function initTimeline() {
  const tl = document.getElementById('timeline');
  tl.innerHTML = `
    <div class="tl-header">
      <span class="badge">Timeline</span>
      <div class="spacer"></div>
      <button id="tlAddKey" class="btn">+ فریم</button>
      <button id="tlPlay" class="btn">پخش/توقف</button>
      <small class="muted">روی نوار کلیک کن تا ثانیه انتخاب شود</small>
    </div>
    <div class="tl-body">
      <div class="ticks" id="ticks"></div>
      <div class="cursor" id="cursor" style="left:0"></div>
      <div class="playhead" id="playhead" style="left:-10px"></div>
    </div>
  `;
  rebuildTicks();
  placeCursor();
  tl.querySelector('.tl-body').addEventListener('click', e => {
    const rect = tl.querySelector('.tl-body').getBoundingClientRect();
    if (e.clientY < rect.top || e.clientY > rect.bottom) return;
    state.tl.sec = Math.round(xToSec(e.clientX - rect.left));
    placeCursor();
  });
  document.getElementById('tlAddKey').addEventListener('click', putKeyframe);
  document.getElementById('tlPlay').addEventListener('click', togglePlay);
}

export function currentAnim() {
  return state.animations.find(a => a.id === state.currentAnimId) || null;
}

export function snapshotState() {
  return JSON.parse(JSON.stringify(state.items));
}

export function rebuildTicks() {
  const dur = +document.getElementById('animDur')?.value || 5;
  const ticks = document.getElementById('ticks');
  ticks.innerHTML = '';
  const rect = document.querySelector('.tl-body').getBoundingClientRect();
  const W = rect.width;
  for (let s = 0; s <= dur; s++) {
    const x = (s / dur) * W;
    const div = document.createElement('div');
    div.className = 'tick' + (s % 5 === 0 ? ' l' : '');
    div.style.left = x + 'px';
    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = s + 's';
    div.appendChild(lab);
    ticks.appendChild(div);
  }
  placeCursor();
}

export function placeCursor() {
  const cursor = document.getElementById('cursor');
  cursor.style.left = secToX(state.tl.sec) + 'px';
  cursor.classList.toggle('has-kf', hasKeyAt(state.tl.sec));
}

function secToX(sec) {
  const dur = +document.getElementById('animDur')?.value || 5;
  const rect = document.querySelector('.tl-body').getBoundingClientRect();
  return Math.max(0, Math.min(rect.width, (sec / dur) * rect.width));
}

function xToSec(x) {
  const dur = +document.getElementById('animDur')?.value || 5;
  const rect = document.querySelector('.tl-body').getBoundingClientRect();
  return Math.max(0, Math.min(dur, (x / rect.width) * dur));
}

function hasKeyAt(sec) {
  const a = currentAnim();
  if (!a) return false;
  return a.keyframes.some(k => k.t === sec);
}

export function putKeyframe() {
  const a = currentAnim();
  if (!a) return;
  const t = state.tl.sec;
  const snap = snapshotState();
  const idx = a.keyframes.findIndex(k => k.t === t);
  if (idx >= 0) a.keyframes[idx].snapshot = snap;
  else a.keyframes.push({ t, snapshot: snap });
  a.keyframes.sort((x, y) => x.t - y.t);
  placeCursor();
}

function togglePlay() {
  const a = currentAnim();
  if (!a || !a.keyframes.length) return;
  state.tl.playing = !state.tl.playing;
  if (state.tl.playing) {
    state.tl.startTime = performance.now() - state.tl.sec * 1000;
    requestAnimationFrame(stepPlay);
  }
}

export function stepPlay(now) {
  if (!state.tl.playing) return;
  const a = currentAnim();
  if (!a) return;
  const dur = (a.duration || 5) * 1000;
  const tms = (now - state.tl.startTime) % dur;
  const t = tms / 1000;
  state.tl.sec = Math.floor(t);
  const ks = a.keyframes;
  if (!ks.length) return;
  let k1 = ks[0], k2 = ks[ks.length - 1];
  for (let i = 0; i < ks.length - 1; i++) {
    if (t >= ks[i].t && t <= ks[i + 1].t) { k1 = ks[i]; k2 = ks[i + 1]; break; }
  }
  const span = Math.max(1e-6, k2.t - k1.t);
  const tt = Math.max(0, Math.min(1, (t - k1.t) / span));
  const map2 = new Map(k2.snapshot.map(o => [o.id, o]));
  const out = k1.snapshot.map(o1 => {
    const o2 = map2.get(o1.id);
    if (!o2) return JSON.parse(JSON.stringify(o1));
    return tweenItem(o1, o2, tt);
  });
  for (const o2 of k2.snapshot) if (!out.find(x => x.id === o2.id)) out.push(JSON.parse(JSON.stringify(o2)));
  const bak = state.items;
  state.items = out;
  emit('draw');
  state.items = bak;
  document.getElementById('playhead').style.left = secToX(t) + 'px';
  placeCursor();
  requestAnimationFrame(stepPlay);
}

function tweenItem(a, b, t) {
  const o = JSON.parse(JSON.stringify(a));
  o.color = a.color; o.width = lerp(a.width, b.width, t); o.rot = lerp(a.rot || 0, b.rot || 0, t);
  if (a.kind === 'line' && b.kind === 'line') { o.p1 = lpt(a.p1, b.p1, t); o.p2 = lpt(a.p2, b.p2, t); }
  if (a.kind === 'quadratic' && b.kind === 'quadratic') { o.p1 = lpt(a.p1, b.p1, t); o.cp = lpt(a.cp, b.cp, t); o.p2 = lpt(a.p2, b.p2, t); }
  if (a.kind === 'shape' && b.kind === 'shape') {
    const n = Math.min(a.path.length, b.path.length);
    o.path = [];
    for (let i = 0; i < n; i++) o.path.push(lpt(a.path[i], b.path[i], t));
    o.fill = t < 0.5 ? a.fill : b.fill;
  }
  return o;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lpt(A, B, t) { return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t) }; }