/**
 * @fileoverview Legacy grouping logic lifted from old.html.
 */

function registerGrouping(ctx) {
    const { state, canvas, ui, utils, api } = ctx;
    const { rndId } = utils;

    function groupSelection() {
        const selIds = [...(state?.selected || new Set())];
        if (!selIds.length) return;

        // ---------- helpers / setup ----------
        const items = state?.items || [];
        const byId = new Map(items.map(it => [it.id, it]));
        const get = (id) => byId.get(id);
        const isSeg = (it) => it && (it.kind === 'line' || it.kind === 'quadratic');

        // Canvas size for pixel-space tolerances
        const W = state?.size?.w || (typeof canvas !== 'undefined' && canvas ? canvas.width : 1) || 1;
        const H = state?.size?.h || (typeof canvas !== 'undefined' && canvas ? canvas.height : 1) || 1;

        const isNormPoint = (p) => p && p.x >= -0.01 && p.x <= 1.01 && p.y >= -0.01 && p.y <= 1.01;
        const toPx = (p) => !p ? {x: 0, y: 0} : (isNormPoint(p) ? {x: p.x * W, y: p.y * H} : {x: p.x, y: p.y});
        const fromPx = (p, norm) => norm ? {x: p.x / W, y: p.y / H} : {x: p.x, y: p.y};

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

        // Quadratic flatness helper (distance^2 of cp to chord)
        function flatness2(p1, cp, p2) {
            const ux = p2.x - p1.x, uy = p2.y - p1.y, L2 = ux * ux + uy * uy || 1;
            const t = ((cp.x - p1.x) * ux + (cp.y - p1.y) * uy) / L2;
            const proj = {x: p1.x + t * ux, y: p1.y + t * uy};
            const dx = cp.x - proj.x, dy = cp.y - proj.y;
            return dx * dx + dy * dy;
        }

        const mid = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

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
        const normAng = (x) => {
            while (x <= -Math.PI) x += 2 * Math.PI;
            while (x > Math.PI) x -= 2 * Math.PI;
            return x;
        };

        function segSegIntersect(a, b, c, d) {
            const r = {x: b.x - a.x, y: b.y - a.y}, s = {x: d.x - c.x, y: d.y - c.y};
            const cross = (ax, ay, bx, by) => ax * by - ay * bx;
            const denom = cross(r.x, r.y, s.x, s.y);
            const qp = {x: c.x - a.x, y: c.y - a.y};
            if (Math.abs(denom) < 1e-9) return null; // parallel/colinear: ignored here
            const t = cross(qp.x, qp.y, s.x, s.y) / denom;
            const u = cross(qp.x, qp.y, r.x, r.y) / denom;
            return {t, u, p: {x: a.x + t * r.x, y: a.y + t * r.y}};
        }

        function segSegClosest(a, b, c, d) {
            const vx = b.x - a.x, vy = b.y - a.y, wx = d.x - c.x, wy = d.y - c.y;
            const A = vx * vx + vy * vy || 1, B = vx * wx + vy * wy, C = wx * wx + wy * wy || 1;
            const axc = a.x - c.x, ayc = a.y - c.y;
            const D = vx * axc + vy * ayc, E = wx * axc + wy * ayc;
            const denom = A * C - B * B || 1;
            let t = clamp01((B * E - C * D) / denom), u = clamp01((A * E - B * D) / denom);
            const p = {x: a.x + t * vx, y: a.y + t * vy}, q = {x: c.x + u * wx, y: c.y + u * wy};
            return {t, u, p, q, d2: dist2(p, q)};
        }

        // ---------- 1) Base segments (pixel-space) ----------
        const leafIds = leafIdsFrom(selIds);
        const segObjs = leafIds.map(get).filter(isSeg);
        if (!segObjs.length) return makePlainGroup(leafIds);

        const srcNorm = segObjs.every(it => {
            if (it.kind === 'line') {
                const [p1, p2] = getLineEnds(it);
                return isNormPoint(p1) && isNormPoint(p2);
            }
            const [p1, cp, p2] = getQuadEnds(it);
            return isNormPoint(p1) && isNormPoint(cp) && isNormPoint(p2);
        });

        const avgW = Math.max(1, segObjs.reduce((s, it) => s + (+it.width || +it.style?.width || 1), 0) / segObjs.length);

        const base = [];      // {a,b,len,prim}
        const lengths = [];

        function pushBase(a, b, prim) {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len > 1e-3) {
                base.push({a, b, len, prim});
                lengths.push(len);
            }
        }

        for (let pi = 0; pi < segObjs.length; pi++) {
            const it = segObjs[pi];
            if (it.kind === 'line') {
                const [p1, p2] = getLineEnds(it);
                if (p1 && p2) pushBase(toPx(p1), toPx(p2), pi);
            } else {
                const [p1, cp, p2] = getQuadEnds(it);
                if (p1 && cp && p2) {
                    const FLAT_EPS = Math.max(0.9, Math.min(2.5, avgW * 0.45));
                    const pts = flattenQuadratic(toPx(p1), toPx(cp), toPx(p2), FLAT_EPS, 12);
                    for (let i = 1; i < pts.length; i++) pushBase(pts[i - 1], pts[i], pi);
                }
            }
        }
        if (!base.length) return makePlainGroup(leafIds);

        const avgLen = lengths.reduce((s, v) => s + v, 0) / lengths.length;
        const MERGE_EPS = Math.max(8, Math.min(36, avgLen * 0.10));   // vertex merge / endpoint snapping
        const MERGE_EPS2 = MERGE_EPS * MERGE_EPS;
        const NEAR_EPS = Math.max(2, Math.min(8, MERGE_EPS * 0.35));
        const NEAR_EPS2 = NEAR_EPS * NEAR_EPS;
        const EDGE_MIN = 0.75;                                     // drop tiny crumbs
        const EPS_TU = Math.min(0.15, Math.max(0.02, MERGE_EPS / (avgLen + 1e-6)));

        // ---------- 2) Split on intersections and T-junctions ----------
        const cuts = base.map(_ => new Set([0, 1])); // t parameters on each base segment

        // Proper & near intersections
        for (let i = 0; i < base.length; i++) {
            for (let j = i + 1; j < base.length; j++) {
                const A = base[i].a, B = base[i].b, C = base[j].a, D = base[j].b;
                let hit = segSegIntersect(A, B, C, D);
                if (hit && hit.t >= -EPS_TU && hit.t <= 1 + EPS_TU && hit.u >= -EPS_TU && hit.u <= 1 + EPS_TU) {
                    const nearA = dist2(hit.p, A) < MERGE_EPS2 ? 0 : (dist2(hit.p, B) < MERGE_EPS2 ? 1 : hit.t);
                    const nearC = dist2(hit.p, C) < MERGE_EPS2 ? 0 : (dist2(hit.p, D) < MERGE_EPS2 ? 1 : hit.u);
                    cuts[i].add(nearA);
                    cuts[j].add(nearC);
                    continue;
                }
                const close = segSegClosest(A, B, C, D);
                if (close.d2 <= NEAR_EPS2) {
                    const nearA = dist2(close.p, A) < MERGE_EPS2 ? 0 : (dist2(close.p, B) < MERGE_EPS2 ? 1 : close.t);
                    const nearC = dist2(close.q, C) < MERGE_EPS2 ? 0 : (dist2(close.q, D) < MERGE_EPS2 ? 1 : close.u);
                    cuts[i].add(nearA);
                    cuts[j].add(nearC);
                }
            }
        }

        // T-junctions (endpoint onto body of another segment)
        function projParam(p, a, b) {
            const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
            return clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / L2);
        }

        for (let i = 0; i < base.length; i++) {
            const Ai = base[i].a, Bi = base[i].b;
            for (let j = 0; j < base.length; j++) if (j !== i) {
                const Aj = base[j].a, Bj = base[j].b;
                const tA = projParam(Ai, Aj, Bj), pA = {x: Aj.x + (Bj.x - Aj.x) * tA, y: Aj.y + (Bj.y - Aj.y) * tA};
                const tB = projParam(Bi, Aj, Bj), pB = {x: Aj.x + (Bj.x - Aj.x) * tB, y: Aj.y + (Bj.y - Aj.y) * tB};
                if (tA > 1e-6 && tA < 1 - 1e-6 && dist2(Ai, pA) < MERGE_EPS2) cuts[j].add(tA);
                if (tB > 1e-6 && tB < 1 - 1e-6 && dist2(Bi, pB) < MERGE_EPS2) cuts[j].add(tB);
            }
        }

        function uniqSort(set) {
            return Array.from(set).sort((a, b) => a - b).filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-6);
        }

        const micro = []; // {a,b,prim}
        for (let i = 0; i < base.length; i++) {
            const A = base[i].a, B = base[i].b, prim = base[i].prim, ts = uniqSort(cuts[i]);
            for (let k = 0; k < ts.length - 1; k++) {
                const t1 = ts[k], t2 = ts[k + 1];
                const P = {x: A.x + (B.x - A.x) * t1, y: A.y + (B.y - A.y) * t1};
                const Q = {x: A.x + (B.x - A.x) * t2, y: A.y + (B.y - A.y) * t2};
                if (Math.hypot(Q.x - P.x, Q.y - P.y) > EDGE_MIN) micro.push({a: P, b: Q, prim});
            }
        }
        if (!micro.length) return makePlainGroup(leafIds);

        // ---------- 3) Build graph (merge vertices; keep edge owners) ----------
        const pts = [];

        function addPt(p) {
            for (const q of pts) {
                if (dist2(p, q) < MERGE_EPS2) return q;
            }
            const np = {x: p.x, y: p.y};
            pts.push(np);
            return np;
        }

        const E = []; // undirected edges [i,j]
        const edgeOwner = new Map(); // 'min_max' -> prim
        const edgesAtV = new Map(); // v -> Set(prim)

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
            adj.get(a).add(b);
            adj.get(b).add(a);
        }

        // ---------- 4) Enumerate faces (right-hand rule, both directions) ----------
        const visited = new Set();
        const dirKey = (u, v) => u + '->' + v;
        const facesIdx = []; // array of vertex-index cycles

        function walkFace(a, b) {
            if (visited.has(dirKey(a, b))) return;
            let u = a, v = b;
            const start = dirKey(a, b);
            const cycle = [a];
            while (!visited.has(dirKey(u, v))) {
                visited.add(dirKey(u, v));
                cycle.push(v);
                const baseAng = angleOf(pts[v], pts[u]);
                const neigh = [...(adj.get(v) || [])].filter(w => w !== u);
                if (!neigh.length) {
                    cycle.length = 0;
                    break;
                }
                let next = neigh[0], best = Infinity;
                for (const w of neigh) {
                    const d = normAng(baseAng - angleOf(pts[v], pts[w]));
                    if (d < best) {
                        best = d;
                        next = w;
                    }
                }
                u = v;
                v = next;
                if (dirKey(u, v) === start) break;
                if (cycle.length > 10000) {
                    cycle.length = 0;
                    break;
                }
            }
            if (cycle.length) facesIdx.push(cycle.slice());
        }

        for (const [a, b] of E) {
            if (!visited.has(dirKey(a, b))) walkFace(a, b);
            if (!visited.has(dirKey(b, a))) walkFace(b, a);
        }
        if (!facesIdx.length) return makePlainGroup(leafIds);

        // ---------- 4.5) Boundary simplification (remove fake mid-vertices) ----------
        const ANG_EPS = 0.15; // ~8.6°
        function ownerOf(u, v) {
            const key = u < v ? u + '_' + v : v + '_' + u;
            return edgeOwner.get(key);
        }

        function simplifyFaceIdx(idx) {
            let changed = true;
            let vs = idx.slice();
            while (changed && vs.length > 3) {
                changed = false;
                for (let i = 0; i < vs.length; i++) {
                    const a = vs[(i - 1 + vs.length) % vs.length];
                    const b = vs[i];
                    const c = vs[(i + 1) % vs.length];
                    const oa = ownerOf(a, b);
                    const ob = ownerOf(b, c);
                    if (oa == null || ob == null) continue;
                    if (oa === ob) {
                        const ang = Math.abs(normAng(angleOf(pts[a], pts[b]) - angleOf(pts[b], pts[c])));
                        if (ang < ANG_EPS) {
                            vs.splice(i, 1);
                            changed = true;
                            break;
                        }
                    }
                }
            }
            return vs;
        }

        // ---------- 5) Filter faces per connected component ----------
        const compId = new Map(), comps = [];
        for (const v of adj.keys()) {
            if (compId.has(v)) continue;
            const cid = comps.length, set = new Set([v]);
            compId.set(v, cid);
            const q = [v];
            while (q.length) {
                const u = q.shift();
                for (const w of (adj.get(u) || [])) if (!compId.has(w)) {
                    compId.set(w, cid);
                    set.add(w);
                    q.push(w);
                }
            }
            comps.push(set);
        }

        const facesEx = []; // {idx, path, area}
        for (const idx of facesIdx) {
            const vs = simplifyFaceIdx(idx);
            if (vs.length < 3) continue;
            const poly = vs.map(i => pts[i]);
            let A = 0;
            for (let i = 0; i < poly.length; i++) {
                const p = poly[i], q = poly[(i + 1) % poly.length];
                A += p.x * q.y - p.y * q.x;
            }
            facesEx.push({idx: vs, path: poly, area: A * 0.5});
        }
        if (!facesEx.length) return makePlainGroup(leafIds);

        // Group faces by component
        const facesByComp = new Map();
        for (const f of facesEx) {
            const cid = compId.get(f.idx[0]);
            if (cid == null) continue;
            if (!facesByComp.has(cid)) facesByComp.set(cid, []);
            facesByComp.get(cid).push(f);
        }

        const keptFaces = [];
        const MIN_AREA_CLAMP = {min: 20, max: 1200};
        for (let cid = 0; cid < comps.length; cid++) {
            if (!facesByComp.has(cid)) continue;
            const verts = comps[cid];
            let sum = 0, cnt = 0;
            for (const [a, b] of E) if (verts.has(a) && verts.has(b)) {
                const P = pts[a], Q = pts[b];
                sum += Math.hypot(Q.x - P.x, Q.y - P.y);
                cnt++;
            }
            const scale = cnt ? sum / cnt : (avgLen || 24);
            const dynMinArea = Math.max(MIN_AREA_CLAMP.min, Math.min(MIN_AREA_CLAMP.max, (scale * scale) * 0.015));

            // Corner heuristic: at least 3 real corners (owner change at vertex or multiple primitives at vertex)
            function cornerCount(idx) {
                let c = 0;
                for (let i = 0; i < idx.length; i++) {
                    const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], d = idx[(i + 1) % idx.length];
                    const oa = ownerOf(a, b), ob = ownerOf(b, d);
                    const prims = edgesAtV.get(b) || new Set();
                    if (oa !== ob || prims.size >= 2) c++;
                }
                return c;
            }

            const cand = facesByComp.get(cid).filter(f => Math.abs(f.area) >= dynMinArea && f.path.length >= 3 && cornerCount(f.idx) >= 3);
            if (!cand.length) continue;
            let maxI = 0;
            for (let i = 1; i < cand.length; i++) if (Math.abs(cand[i].area) > Math.abs(cand[maxI].area)) maxI = i; // remove outer
            cand.splice(maxI, 1);
            keptFaces.push(...cand);
        }
        if (!keptFaces.length) return makePlainGroup(leafIds);

        // De-dup faces roughly (bbox)
        const uniq = [];

        function bbox(poly) {
            let minx = +Infinity, miny = +Infinity, maxx = -Infinity, maxy = -Infinity;
            for (const p of poly) {
                if (p.x < minx) minx = p.x;
                if (p.y < miny) miny = p.y;
                if (p.x > maxx) maxx = p.x;
                if (p.y > maxy) maxy = p.y;
            }
            return {minx, miny, maxx, maxy};
        }

        function bboxClose(a, b, eps = 1.0) {
            return Math.abs(a.minx - b.minx) < eps && Math.abs(a.miny - b.miny) < eps && Math.abs(a.maxx - b.maxx) < eps && Math.abs(a.maxy - b.maxy) < eps;
        }

        for (const f of keptFaces) {
            const isDup = uniq.some(u => bboxClose(bbox(u.path), bbox(f.path)));
            if (!isDup) uniq.push(f);
        }
        if (!uniq.length) return makePlainGroup(leafIds);

        // ---------- 6) Build shapes + delete source segments ----------
        api.pushHistory && api.pushHistory();
        const made = [];
        for (const f of uniq) {
            const pathOut = f.path.map(p => fromPx(p, srcNorm));
            const shape = {
                id: (typeof rndId === 'function') ? rndId('shape') : ('shape_' + Math.random().toString(36).slice(2)),
                kind: 'shape', path: pathOut,
                color: ui?.strokeColor?.value ?? '#fff',
                width: +ui?.strokeWidth?.value || 1.5,
                fill: ui?.fillColor?.value ?? 'transparent',
                visible: true
            };
            state.items.push(shape);
            made.push(shape.id);
        }

        if (made.length) {
            const toRemove = new Set(leafIds.filter(id => {
                const it = get(id);
                return it && (it.kind === 'line' || it.kind === 'quadratic');
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
        else {
            const grp = {
                id: (typeof rndId === 'function') ? rndId('grp') : ('grp_' + Math.random().toString(36).slice(2)),
                kind: 'group',
                name: 'گروه شکل‌ها',
                children: made,
                visible: true
            };
            state.items.push(grp);
            state.selected.add(grp.id);
        }

        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();

        // ---------- fallback: plain group ----------
        function makePlainGroup(childIds) {
            api.pushHistory && api.pushHistory();
            const grp = {
                id: (typeof rndId === 'function') ? rndId('grp') : ('grp_' + Math.random().toString(36).slice(2)),
                kind: 'group',
                name: 'گروه',
                children: childIds.slice(),
                visible: true
            };
            state.items.push(grp);
            state.selected.clear();
            state.selected.add(grp.id);
            api.refreshElemList && api.refreshElemList();
            api.draw && api.draw();
        }
    }


    const exposed = { groupSelection };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerGrouping };
