/**
 * @fileoverview Implements advanced grouping and face-detection utilities
 * responsible for building closed shapes from vector segments in LinePack Pro.
 */

function registerGrouping(ctx) {
    const { state, canvas, ui, utils, api } = ctx;
    const { rndId, clamp, dist } = utils;

    function groupSelection() {
        const selIds = [...(state?.selected || new Set())];
        if (!selIds.length) return;

        const items = state?.items || [];
        const byId = new Map(items.map(it => [it.id, it]));
        const get = (id) => byId.get(id);
        const isSeg = (it) => it && (it.kind === 'line' || it.kind === 'quadratic');

        const W = state?.size?.w || (typeof canvas !== 'undefined' && canvas ? canvas.width : 1) || 1;
        const H = state?.size?.h || (typeof canvas !== 'undefined' && canvas ? canvas.height : 1) || 1;

        const isNormPoint = (p) => p && p.x >= -0.01 && p.x <= 1.01 && p.y >= -0.01 && p.y <= 1.01;
        const toPx = (p) => !p ? { x: 0, y: 0 } : (isNormPoint(p) ? { x: p.x * W, y: p.y * H } : { x: p.x, y: p.y });
        const fromPx = (p, norm) => norm ? { x: p.x / W, y: p.y / H } : { x: p.x, y: p.y };

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
        const getLineEnds = it => [pick(it.p1, it.points?.p1, it.points?.start, it.points?.a), pick(it.p2, it.points?.p2, it.points?.end, it.points?.b)];
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
        const normAng = (x) => {
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

        const segs = [];
        const allPts = [];
        const nearHits = [];
        const owners = [];
        let avgLen = 0;

        for (const it of segObjs) {
            if (it.kind === 'line') {
                const [p1, p2] = getLineEnds(it);
                const a = toPx(p1);
                const b = toPx(p2);
                segs.push({ a, b, id: it.id, norm: isNormPoint(p1) && isNormPoint(p2) });
                owners.push(it.id);
                allPts.push(a, b);
                avgLen += Math.sqrt(dist2(a, b));
            } else if (it.kind === 'quadratic') {
                const [p1, cp, p2] = getQuadEnds(it);
                const a = toPx(p1);
                const c = toPx(cp);
                const b = toPx(p2);
                const eps = clamp(0.45 * ((it.width || 1) || 1), 0.6, 2.5);
                const flat = flattenQuadratic(a, c, b, eps);
                for (let i = 0; i < flat.length - 1; i++) {
                    segs.push({ a: flat[i], b: flat[i + 1], id: it.id, norm: isNormPoint(p1) && isNormPoint(cp) && isNormPoint(p2) });
                    owners.push(it.id);
                }
                allPts.push(...flat);
                for (let i = 0; i < flat.length - 1; i++) avgLen += Math.sqrt(dist2(flat[i], flat[i + 1]));
            }
        }

        const segCount = segs.length || 1;
        avgLen = avgLen / segCount;
        const MERGE_EPS = clamp(avgLen * 0.1, 8, 36);
        const NEAR_EPS = clamp(MERGE_EPS * 0.35, 2, 8);

        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                const s1 = segs[i], s2 = segs[j];
                const hit = segSegIntersect(s1.a, s1.b, s2.a, s2.b);
                if (hit && hit.t > 1e-4 && hit.t < 1 - 1e-4 && hit.u > 1e-4 && hit.u < 1 - 1e-4) {
                    nearHits.push({
                        kind: 'cross',
                        p: hit.p,
                        segA: i,
                        segB: j
                    });
                } else {
                    const close = segSegClosest(s1.a, s1.b, s2.a, s2.b);
                    if (close.d2 <= NEAR_EPS * NEAR_EPS) {
                        nearHits.push({
                            kind: 'near',
                            p: {
                                x: (close.p.x + close.q.x) / 2,
                                y: (close.p.y + close.q.y) / 2
                            },
                            segA: i,
                            segB: j
                        });
                    }
                }
            }
        }

        const pts = [];
        const key = (p) => Math.round(p.x) + ':' + Math.round(p.y);
        const merged = new Map();

        function pushBase(a, b, prim) {
            const add = (p, segIdx) => {
                const id = key(p);
                if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y, segs: new Set() });
                const ref = merged.get(id);
                ref.segs.add(segIdx);
                return ref;
            };
            const aRef = add(a, prim);
            const bRef = add(b, prim);
            pts.push({ a: aRef, b: bRef, owner: owners[prim] });
        }

        segs.forEach((seg, idx) => pushBase(seg.a, seg.b, idx));

        for (const hit of nearHits) {
            const { p, segA, segB } = hit;
            const aRef = pushBase(p, p, segA);
            const bRef = pushBase(p, p, segB);
            aRef.segs.add(segB);
            bRef.segs.add(segA);
        }

        const nodes = [...merged.values()];

        function projParam(p, a, b) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len, uy = dy / len;
            return (p.x - a.x) * ux + (p.y - a.y) * uy;
        }

        for (const n of nodes) {
            for (const segIdx of n.segs) {
                const seg = segs[segIdx];
                const param = projParam(n, seg.a, seg.b);
                if (!seg.split) seg.split = [];
                seg.split.push({ param, node: n });
            }
        }

        const graphEdges = [];
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (!seg.split) {
                graphEdges.push({ a: seg.a, b: seg.b, owner: owners[i], norm: seg.norm });
            } else {
                seg.split.sort((x, y) => x.param - y.param);
                const unique = [];
                for (const s of seg.split) {
                    if (!unique.length || dist2(unique[unique.length - 1].node, s.node) > 0.01) unique.push(s);
                }
                let prev = seg.a;
                for (const s of unique) {
                    graphEdges.push({ a: prev, b: s.node, owner: owners[i], norm: seg.norm });
                    prev = s.node;
                }
                graphEdges.push({ a: prev, b: seg.b, owner: owners[i], norm: seg.norm });
            }
        }

        const verts = [];
        const idxOf = new Map();
        function addPt(p) {
            const id = key(p);
            if (idxOf.has(id)) return idxOf.get(id);
            const idx = verts.length;
            verts.push({ x: p.x, y: p.y, edges: new Set() });
            idxOf.set(id, idx);
            return idx;
        }

        for (const edge of graphEdges) {
            const ia = addPt(edge.a);
            const ib = addPt(edge.b);
            verts[ia].edges.add(ib);
            verts[ib].edges.add(ia);
        }

        const uniqSort = (set) => Array.from(set).sort((a, b) => a - b);
        const faces = [];

        function walkFace(a, b) {
            const face = [];
            let prev = a;
            let curr = b;
            face.push(prev);
            face.push(curr);
            let safety = 0;
            while (safety++ < 10000) {
                const vertsCurr = verts[curr];
                const options = uniqSort(vertsCurr.edges);
                let best = null;
                let bestAng = Infinity;
                for (const next of options) {
                    if (next === prev) continue;
                    const angPrev = angleOf(verts[prev], verts[curr]);
                    const angNext = angleOf(verts[curr], verts[next]);
                    const delta = normAng(angNext - angPrev);
                    if (delta <= 0) continue;
                    if (delta < bestAng) {
                        bestAng = delta;
                        best = next;
                    }
                }
                if (best === null) break;
                if (best === a) {
                    face.push(best);
                    break;
                }
                face.push(best);
                prev = curr;
                curr = best;
            }
            return face;
        }

        for (let a = 0; a < verts.length; a++) {
            for (const b of verts[a].edges) {
                const face = walkFace(a, b);
                if (face.length >= 3) faces.push(face);
            }
        }

        const polys = faces.map(idx => idx.map(i => verts[i]));

        function ownerOf(u, v) {
            for (const edge of graphEdges) {
                if ((edge.a === u && edge.b === v) || (edge.a === v && edge.b === u)) return edge.owner;
            }
            return null;
        }

        function simplifyFaceIdx(idx) {
            if (idx.length < 3) return [];
            const path = [];
            for (let i = 0; i < idx.length - 1; i++) {
                const curr = verts[idx[i]];
                const next = verts[idx[i + 1]];
                const owner = ownerOf(curr, next);
                path.push({
                    x: curr.x,
                    y: curr.y,
                    owner
                });
            }
            const cleaned = [path[0]];
            const ANG_EPS = 8.6 * Math.PI / 180;
            for (let i = 1; i < path.length - 1; i++) {
                const prev = cleaned[cleaned.length - 1];
                const curr = path[i];
                const next = path[i + 1];
                const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
                const v2 = { x: next.x - curr.x, y: next.y - curr.y };
                const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y) || 1;
                const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y) || 1;
                const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
                const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
                const sameOwner = curr.owner === next.owner;
                if (Math.abs(ang) < ANG_EPS && sameOwner) continue;
                cleaned.push(curr);
            }
            cleaned.push(path[path.length - 1]);
            return cleaned;
        }

        const simplePolys = polys.map(simplifyFaceIdx).filter(p => p.length >= 3);
        const areas = simplePolys.map(poly => {
            let area = 0;
            for (let i = 0; i < poly.length; i++) {
                const p1 = poly[i];
                const p2 = poly[(i + 1) % poly.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return Math.abs(area) / 2;
        });

        const comps = new Map();
        simplePolys.forEach((poly, idx) => {
            const bounds = poly.reduce((acc, p) => {
                if (!acc) return { minx: p.x, miny: p.y, maxx: p.x, maxy: p.y };
                return {
                    minx: Math.min(acc.minx, p.x),
                    miny: Math.min(acc.miny, p.y),
                    maxx: Math.max(acc.maxx, p.x),
                    maxy: Math.max(acc.maxy, p.y)
                };
            }, null);
            const keyComp = JSON.stringify(bounds);
            if (!comps.has(keyComp)) comps.set(keyComp, []);
            comps.get(keyComp).push(idx);
        });

        const keptFaces = [];
        for (const group of comps.values()) {
            if (!group.length) continue;
            const areasInComp = group.map(i => areas[i]);
            const sum = areasInComp.reduce((a, b) => a + b, 0);
            const avg = sum / areasInComp.length;
            const dynMinArea = clamp(avg * 0.015, 20, 1200);
            let bestIdx = group[0];
            let bestArea = areas[bestIdx];
            for (const idx of group) {
                if (areas[idx] > bestArea) {
                    bestIdx = idx;
                    bestArea = areas[idx];
                }
            }
            for (const idx of group) {
                if (idx === bestIdx) continue;
                if (areas[idx] >= dynMinArea) keptFaces.push({ path: simplePolys[idx] });
            }
        }

        if (!keptFaces.length) return makePlainGroup(leafIds);

        const uniq = [];
        function bbox(poly) {
            let minx = poly[0].x, miny = poly[0].y, maxx = poly[0].x, maxy = poly[0].y;
            for (const p of poly) {
                if (p.x < minx) minx = p.x;
                if (p.y < miny) miny = p.y;
                if (p.x > maxx) maxx = p.x;
                if (p.y > maxy) maxy = p.y;
            }
            return { minx, miny, maxx, maxy };
        }

        function bboxClose(a, b, eps = 1.0) {
            return Math.abs(a.minx - b.minx) < eps && Math.abs(a.miny - b.miny) < eps && Math.abs(a.maxx - b.maxx) < eps && Math.abs(a.maxy - b.maxy) < eps;
        }

        for (const f of keptFaces) {
            const isDup = uniq.some(u => bboxClose(bbox(u.path), bbox(f.path)));
            if (!isDup) uniq.push(f);
        }
        if (!uniq.length) return makePlainGroup(leafIds);

        api.pushHistory && api.pushHistory();
        const made = [];
        for (const f of uniq) {
            const pathOut = f.path.map(p => fromPx(p, srcNorm));
            const shape = {
                id: (typeof rndId === 'function') ? rndId('shape') : ('shape_' + Math.random().toString(36).slice(2)),
                kind: 'shape',
                path: pathOut,
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
