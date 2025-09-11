import { state } from '../state.js';
import { pushHistory } from '../utils/history.js';
import { emit } from '../events.js';
import { rndId } from '../utils/helpers.js';
import { CONFIG } from '../config.js';

function getStrokeColor() { return document.getElementById('strokeColor')?.value || '#fff'; }
function getStrokeWidth() { return +document.getElementById('strokeWidth')?.value || 1; }
function getFillColor() { return document.getElementById('fillColor')?.value || 'transparent'; }
function getFillMode() { return document.getElementById('fillMode')?.value || 'solid'; }

// Robust closed-shape detection via grouping.
// Ported from old.html to module form and using CONFIG thresholds.
export function groupSelection() {
  const selIds = [...state.selected];
  if (!selIds.length) return;

  const items = state.items;
  const byId = new Map(items.map(it => [it.id, it]));
  const get = id => byId.get(id);
  const isSeg = it => it && (it.kind === 'line' || it.kind === 'quadratic');

  // canvas size in pixels
  const canvas = document.getElementById('canvas');
  const W = canvas?.width || 1;
  const H = canvas?.height || 1;

  const isNormPoint = p => p && p.x >= -0.01 && p.x <= 1.01 && p.y >= -0.01 && p.y <= 1.01;
  const toPx = p => !p ? { x: 0, y: 0 } : (isNormPoint(p) ? { x: p.x * W, y: p.y * H } : { x: p.x, y: p.y });
  const fromPx = (p, norm) => norm ? { x: p.x / W, y: p.y / H } : { x: p.x, y: p.y };

  // expand selection through groups -> leaf ids
  function leafIdsFrom(ids) {
    const out = [], st = [...ids], seen = new Set();
    while (st.length) {
      const id = st.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const it = get(id);
      if (!it) continue;
      if (it.kind === 'group' && Array.isArray(it.children)) st.push(...it.children);
      else out.push(id);
    }
    return Array.from(new Set(out));
  }

  const pick = (...c) => c.find(Boolean) ?? null;
  const getLineEnds = it => [pick(it.p1, it.points?.p1, it.points?.start, it.points?.a),
    pick(it.p2, it.points?.p2, it.points?.end, it.points?.b)];
  const getQuadEnds = it => [pick(it.p1, it.points?.p1), pick(it.cp, it.points?.cp), pick(it.p2, it.points?.p2)];

  function flatness2(p1, cp, p2) {
    const ux = p2.x - p1.x, uy = p2.y - p1.y, L2 = ux * ux + uy * uy || 1;
    const t = ((cp.x - p1.x) * ux + (cp.y - p1.y) * uy) / L2;
    const proj = { x: p1.x + t * ux, y: p1.y + t * uy };
    const dx = cp.x - proj.x, dy = cp.y - proj.y;
    return dx * dx + dy * dy;
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function flattenQuadratic(p1, cp, p2, eps, maxDepth = 12) {
    const out = [];
    (function rec(a, c, b, depth) {
      if (depth >= maxDepth || flatness2(a, c, b) <= eps * eps) {
        if (!out.length) out.push(a);
        out.push(b);
        return;
      }
      const a_c = mid(a, c), c_b = mid(c, b), m = mid(a_c, c_b);
      rec(a, a_c, m, depth + 1);
      rec(m, c_b, b, depth + 1);
    })(p1, cp, p2, 0);
    return out;
  }

  const sqr = x => x * x;
  const clamp01 = x => x < 0 ? 0 : (x > 1 ? 1 : x);

  function dist2(p, q) {
    const dx = p.x - q.x, dy = p.y - q.y;
    return dx * dx + dy * dy;
  }

  const angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const normAng = x => {
    while (x <= -Math.PI) x += 2 * Math.PI;
    while (x > Math.PI) x -= 2 * Math.PI;
    return x;
  };

  function segSegIntersect(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;
    const denom = cross(r.x, r.y, s.x, s.y);
    const qp = { x: c.x - a.x, y: c.y - a.y };
    if (Math.abs(denom) < 1e-9) return null;
    const t = cross(qp.x, qp.y, s.x, s.y) / denom;
    const u = cross(qp.x, qp.y, r.x, r.y) / denom;
    return { t, u, p: { x: a.x + t * r.x, y: a.y + t * r.y } };
  }

  function segSegClosest(a, b, c, d) {
    const vx = b.x - a.x, vy = b.y - a.y, wx = d.x - c.x, wy = d.y - c.y;
    const A = vx * vx + vy * vy || 1, B = vx * wx + vy * wy, C = wx * wx + wy * wy || 1;
    const axc = a.x - c.x, ayc = a.y - c.y;
    const D = vx * axc + vy * ayc, E = wx * axc + wy * ayc;
    const denom = A * C - B * B || 1;
    let t = clamp01((B * E - C * D) / denom), u = clamp01((A * E - B * D) / denom);
    const p = { x: a.x + t * vx, y: a.y + t * vy }, q = { x: c.x + u * wx, y: c.y + u * wy };
    return { t, u, p, q, d2: dist2(p, q) };
  }

  // ---------- 1) Base segments ----------
  const leafIds = leafIdsFrom(selIds);
  const segObjs = leafIds.map(get).filter(isSeg);
  if (!segObjs.length) return makePlainGroup(leafIds);

  const srcNorm = segObjs.every(it => {
    if (it.kind === 'line') {
      const [p1, p2] = getLineEnds(it); return isNormPoint(p1) && isNormPoint(p2);
    }
    const [p1, cp, p2] = getQuadEnds(it); return isNormPoint(p1) && isNormPoint(cp) && isNormPoint(p2);
  });
  const avgW = Math.max(1, segObjs.reduce((s, it) => s + (+it.width || +it.style?.width || 1), 0) / segObjs.length);
  const FLAT_EPS = Math.max(CONFIG.FLAT_EPS_MIN, Math.min(CONFIG.FLAT_EPS_MAX, avgW * 0.45));

  // pre-flatten segments to estimate average length
  const flatPts = segObjs.map(_ => null);
  let totalLen = 0, pieceCnt = 0;
  for (let i = 0; i < segObjs.length; i++) {
    const it = segObjs[i];
    if (it.kind === 'line') {
      const [p1, p2] = getLineEnds(it);
      if (p1 && p2) {
        const a = toPx(p1), b = toPx(p2);
        flatPts[i] = [a, b];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 1e-3) { totalLen += len; pieceCnt++; }
      }
    } else {
      const [p1, cp, p2] = getQuadEnds(it);
      if (p1 && cp && p2) {
        const pts = flattenQuadratic(toPx(p1), toPx(cp), toPx(p2), FLAT_EPS, 12);
        flatPts[i] = pts;
        for (let k = 1; k < pts.length; k++) {
          const len = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
          if (len > 1e-3) { totalLen += len; pieceCnt++; }
        }
      }
    }
  }
  if (!pieceCnt) return makePlainGroup(leafIds);
  const avgLen = totalLen / pieceCnt;

  // dynamic thresholds derived from drawing size
  const MERGE_EPS = Math.max(CONFIG.MERGE_EPS_MIN, Math.min(CONFIG.MERGE_EPS_MAX, avgLen * 0.10));
  const MERGE_EPS2 = MERGE_EPS * MERGE_EPS;
  const NEAR_EPS = Math.max(CONFIG.NEAR_EPS_MIN, Math.min(CONFIG.NEAR_EPS_MAX, MERGE_EPS * 0.35));
  const NEAR_EPS2 = NEAR_EPS * NEAR_EPS;
  const EDGE_MIN = Math.max(CONFIG.EDGE_MIN_MIN, Math.min(CONFIG.EDGE_MIN_MAX, avgW * CONFIG.EDGE_MIN_FACTOR));
  const EPS_TU = Math.min(0.15, Math.max(0.02, MERGE_EPS / (avgLen + 1e-6)));

  // ---------- 1) Base segments ----------
  const base = [];      // {a,b,len,prim}
  function pushBase(a, b, prim) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-3) base.push({ a, b, len, prim });
  }
  for (let i = 0; i < segObjs.length; i++) {
    const pts = flatPts[i];
    if (!pts || pts.length < 2) continue;
    for (let k = 1; k < pts.length; k++) pushBase(pts[k - 1], pts[k], i);
  }
  if (!base.length) return makePlainGroup(leafIds);

  // ---------- 2) Split on intersections and T-junctions ----------
  const cuts = base.map(_ => new Set([0, 1]));

  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const A = base[i].a, B = base[i].b, C = base[j].a, D = base[j].b;
      let hit = segSegIntersect(A, B, C, D);
      if (hit && hit.t >= -EPS_TU && hit.t <= 1 + EPS_TU && hit.u >= -EPS_TU && hit.u <= 1 + EPS_TU) {
        const nearA = dist2(hit.p, A) < MERGE_EPS2 ? 0 : (dist2(hit.p, B) < MERGE_EPS2 ? 1 : hit.t);
        const nearC = dist2(hit.p, C) < MERGE_EPS2 ? 0 : (dist2(hit.p, D) < MERGE_EPS2 ? 1 : hit.u);
        cuts[i].add(nearA); cuts[j].add(nearC);
        continue;
      }
      const close = segSegClosest(A, B, C, D);
      if (close.d2 <= NEAR_EPS2) {
        const nearA = dist2(close.p, A) < MERGE_EPS2 ? 0 : (dist2(close.p, B) < MERGE_EPS2 ? 1 : close.t);
        const nearC = dist2(close.q, C) < MERGE_EPS2 ? 0 : (dist2(close.q, D) < MERGE_EPS2 ? 1 : close.u);
        cuts[i].add(nearA); cuts[j].add(nearC);
      }
    }
  }

  function projParam(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
    return clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / L2);
  }

  for (let i = 0; i < base.length; i++) {
    const Ai = base[i].a, Bi = base[i].b;
    for (let j = 0; j < base.length; j++) if (j !== i) {
      const Aj = base[j].a, Bj = base[j].b;
      const tA = projParam(Ai, Aj, Bj), pA = { x: Aj.x + (Bj.x - Aj.x) * tA, y: Aj.y + (Bj.y - Aj.y) * tA };
      const tB = projParam(Bi, Aj, Bj), pB = { x: Aj.x + (Bj.x - Aj.x) * tB, y: Aj.y + (Bj.y - Aj.y) * tB };
      if (tA > 1e-6 && tA < 1 - 1e-6 && dist2(Ai, pA) < MERGE_EPS2) cuts[j].add(tA);
      if (tB > 1e-6 && tB < 1 - 1e-6 && dist2(Bi, pB) < MERGE_EPS2) cuts[j].add(tB);
    }
  }

  function uniqSort(set) {
    return Array.from(set).sort((a, b) => a - b).filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-6);
  }

  const micro = [];
  for (let i = 0; i < base.length; i++) {
    const A = base[i].a, B = base[i].b, prim = base[i].prim, ts = uniqSort(cuts[i]);
    for (let k = 0; k < ts.length - 1; k++) {
      const t1 = ts[k], t2 = ts[k + 1];
      const P = { x: A.x + (B.x - A.x) * t1, y: A.y + (B.y - A.y) * t1 };
      const Q = { x: A.x + (B.x - A.x) * t2, y: A.y + (B.y - A.y) * t2 };
      if (Math.hypot(Q.x - P.x, Q.y - P.y) > EDGE_MIN) micro.push({ a: P, b: Q, prim });
    }
  }
  if (!micro.length) return makePlainGroup(leafIds);

  // ---------- 3) Build graph ----------
  const pts = [];
  function addPt(p) {
    for (const q of pts) if (dist2(p, q) < MERGE_EPS2) return q;
    const np = { x: p.x, y: p.y }; pts.push(np); return np;
  }

  const E = [];
  const edgeOwner = new Map();
  const edgesAtV = new Map();
  for (const e of micro) {
    const A = addPt(e.a), B = addPt(e.b);
    if (A === B) continue;
    const ia = pts.indexOf(A), ib = pts.indexOf(B);
    const key = ia < ib ? ia + '_' + ib : ib + '_' + ia;
    if (!edgeOwner.has(key)) {
      E.push([ia, ib]);
      edgeOwner.set(key, e.prim);
    }
    if (!edgesAtV.has(ia)) edgesAtV.set(ia, new Set());
    edgesAtV.get(ia).add(e.prim);
    if (!edgesAtV.has(ib)) edgesAtV.set(ib, new Set());
    edgesAtV.get(ib).add(e.prim);
  }
  if (!E.length) return makePlainGroup(leafIds);

  const adj = new Map();
  for (const [a, b] of E) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }

  // ---------- 4) Enumerate faces ----------
  const visited = new Set();
  const dirKey = (u, v) => u + '->' + v;
  const facesIdx = [];

  function walkFace(a, b) {
    if (visited.has(dirKey(a, b))) return;
    let u = a, v = b; const start = dirKey(a, b); const cycle = [a];
    while (!visited.has(dirKey(u, v))) {
      visited.add(dirKey(u, v));
      cycle.push(v);
      const baseAng = angleOf(pts[v], pts[u]);
      const neigh = [...(adj.get(v) || [])].filter(w => w !== u);
      if (!neigh.length) { cycle.length = 0; break; }
      let next = neigh[0], best = Infinity;
      for (const w of neigh) {
        const d = normAng(baseAng - angleOf(pts[v], pts[w]));
        if (d < best) { best = d; next = w; }
      }
      u = v; v = next;
      if (dirKey(u, v) === start) break;
      if (cycle.length > 10000) { cycle.length = 0; break; }
    }
    if (cycle.length) facesIdx.push(cycle.slice());
  }

  for (const [a, b] of E) {
    if (!visited.has(dirKey(a, b))) walkFace(a, b);
    if (!visited.has(dirKey(b, a))) walkFace(b, a);
  }
  if (!facesIdx.length) return makePlainGroup(leafIds);

  // ---------- 4.5) Boundary simplification ----------
  const ANG_EPS = CONFIG.ANG_EPS;
  function ownerOf(u, v) {
    const key = u < v ? u + '_' + v : v + '_' + u; return edgeOwner.get(key);
  }

  const faces = facesIdx.map(idx => {
    const path = idx.map(i => pts[i]);
    // remove colinear mid-verts that belong to same primitive
    const simple = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[(i - 1 + path.length) % path.length];
      const b = path[i];
      const c = path[(i + 1) % path.length];
      const oa = ownerOf(idx[(i - 1 + idx.length) % idx.length], idx[i]);
      const ob = ownerOf(idx[i], idx[(i + 1) % idx.length]);
      const ang = Math.abs(normAng(angleOf(a, b) - angleOf(b, c)));
      if (ang > ANG_EPS || oa !== ob) simple.push(b);
    }
    let area = 0;
    for (let i = 0; i < simple.length; i++) {
      const p = simple[i], q = simple[(i + 1) % simple.length];
      area += p.x * q.y - p.y * q.x;
    }
    return { path: simple, area: area / 2, idx: simple.map(v => pts.indexOf(v)) };
  });

  // ---------- 5) Filter faces ----------
  const MIN_AREA = CONFIG.MIN_AREA;
  const keptFaces = faces.filter(f => Math.abs(f.area) >= MIN_AREA && f.path.length >= 3);
  if (!keptFaces.length) return makePlainGroup(leafIds);

  // drop outer faces per connected component roughly
  const comps = [];
  const visitedV = new Set();
  function dfs(v, cid) {
    if (visitedV.has(v)) return; visitedV.add(v);
    if (!comps[cid]) comps[cid] = new Set();
    comps[cid].add(v);
    for (const nb of adj.get(v) || []) dfs(nb, cid);
  }
  let cid = 0;
  for (let i = 0; i < pts.length; i++) if (!visitedV.has(i)) { dfs(i, cid); cid++; }

  const facesByComp = new Map();
  for (const f of keptFaces) {
    const cid = comps.findIndex(set => set.has(f.idx[0]));
    if (!facesByComp.has(cid)) facesByComp.set(cid, []);
    facesByComp.get(cid).push(f);
  }

  const finalFaces = [];
  for (const [cid, arr] of facesByComp) {
    if (!arr.length) continue;
    let maxI = 0;
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i].area) > Math.abs(arr[maxI].area)) maxI = i;
    arr.splice(maxI, 1);
    finalFaces.push(...arr);
  }
  if (!finalFaces.length) return makePlainGroup(leafIds);

  // ---------- 6) Build shapes + delete source segments ----------
  pushHistory();
  const made = [];
  const mode = getFillMode();
  for (const f of finalFaces) {
    const pathOut = f.path.map(p => fromPx(p, srcNorm));
    const shape = {
      id: rndId('shape'),
      kind: 'shape',
      path: pathOut,
      color: getStrokeColor(),
      width: mode === 'fill' ? 0 : getStrokeWidth(),
      fill: mode === 'hollow' ? null : getFillColor(),
      visible: true
    };
    state.items.push(shape);
    made.push(shape.id);
  }

  if (made.length) {
    const toRemove = new Set(leafIds.filter(id => {
      const it = get(id); return it && (it.kind === 'line' || it.kind === 'quadratic');
    }));
    if (toRemove.size) {
      for (const it of state.items) {
        if (it.kind === 'group' && Array.isArray(it.children)) {
          it.children = it.children.filter(cid => !toRemove.has(cid));
        }
      }
      state.items = state.items.filter(it => !toRemove.has(it.id));
    }
  }

  state.selected.clear();
  if (made.length === 1) state.selected.add(made[0]);
  else if (made.length > 1) {
    const grp = {
      id: rndId('grp'),
      kind: 'group',
      name: 'گروه شکل‌ها',
      children: made,
      visible: true
    };
    state.items.push(grp);
    state.selected.add(grp.id);
  }

  emit('draw');
  emit('refreshList');

  // fallback plain group
  function makePlainGroup(childIds) {
    pushHistory();
    const grp = {
      id: rndId('grp'),
      kind: 'group',
      name: 'گروه',
      children: childIds.slice(),
      visible: true
    };
    state.items.push(grp);
    state.selected.clear();
    state.selected.add(grp.id);
    emit('draw');
    emit('refreshList');
  }
}

export function ungroupSelection() {
  const groups = state.items.filter(it => state.selected.has(it.id) && it.kind === 'group');
  if (!groups.length) return;
  pushHistory();
  const toRemove = new Set(groups.map(g => g.id));
  state.items = state.items.filter(it => !toRemove.has(it.id));
  for (const id of toRemove) state.selected.delete(id);
  emit('draw');
  emit('refreshList');
}

