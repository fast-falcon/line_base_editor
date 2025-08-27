(() => {
        const toolbar = document.getElementById('toolbar');
        const stageWrap = document.getElementById('stageWrap');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const DPR = Math.max(1, window.devicePixelRatio || 1);
        const UI = {
            // tools
            shapeMenu: document.getElementById('shapeMenu'),
            shapeMenuBtn: document.getElementById('shapeMenuBtn'),
            shapePop: document.getElementById('shapePop'),
            // draw props
            strokeWidth: document.getElementById('strokeWidth'),
            strokeColor: document.getElementById('strokeColor'),
            fillWrap: document.getElementById('fillWrap'),
            fillColor: document.getElementById('fillColor'),
            rotDeg: document.getElementById('rotDeg'),
            // history / file
            undo: document.getElementById('undo'),
            redo: document.getElementById('redo'),
            fileInput: document.getElementById('fileInput'),
            saveJSON: document.getElementById('saveJSON'),
            saveJSONMin: document.getElementById('saveJSONMin'),
            exportPNG: document.getElementById('exportPNG'),
            clear: document.getElementById('clear'),
            // sidebar
            tabElems: document.getElementById('tabElems'),
            tabAnims: document.getElementById('tabAnims'),
            panelElems: document.getElementById('panelElems'),
            panelAnims: document.getElementById('panelAnims'),
            elemList: document.getElementById('elemList'),
            toggleAll: document.getElementById('toggleAll'),
            deleteSel: document.getElementById('deleteSel'),
            groupBtn: document.getElementById('groupBtn'),
            ungroupBtn: document.getElementById('ungroupBtn'),
            // timeline (bottom)
            timeline: document.getElementById('timeline'),
            ticks: document.getElementById('ticks'),
            cursor: document.getElementById('cursor'),
            playhead: document.getElementById('playhead'),
            tlAddKey: document.getElementById('tlAddKey'),
            tlPlay: document.getElementById('tlPlay'),
            // anim panel
            animName: document.getElementById('animName'),
            animDur: document.getElementById('animDur'),
            animSelect: document.getElementById('animSelect'),
            addAnim: document.getElementById('addAnim'),
            renameAnim: document.getElementById('renameAnim'),
            setKey: document.getElementById('setKey'),
            play: document.getElementById('play'),
            pause: document.getElementById('pause'),
            delAnim: document.getElementById('delAnim'),
            // selection visuals
            ghost: document.getElementById('ghost'),
            rotHandle: document.getElementById('rotHandle'),
            // apply
            apply: document.getElementById('apply'),
            help: document.getElementById('help'),
            fillEnabled: document.getElementById('fillEnabled'),
            fillMode: document.getElementById('fillMode'),
        };
        // ========= State =========
        /** @typedef {{x:number,y:number}} Pt */
        /** @typedef {{id:string, kind:'line', p1:Pt, p2:Pt, color:string, width:number, rot?:number, visible?:boolean, name?:string}} LineItem */
        /** @typedef {{id:string, kind:'quadratic', p1:Pt, p2:Pt, cp:Pt, color:string, width:number, rot?:number, visible?:boolean, name?:string}} QuadItem */
        /** @typedef {{id:string, kind:'shape', path:Pt[], color:string, width:number, fill?:string, rot?:number, visible?:boolean, name?:string, children?:string[]}} ShapeItem */
        /** @typedef {{id:string, name:string, duration:number, keyframes:Array<{t:number, snapshot:any}>}} Anim */
        let state = {
            tool: 'select',
            items: /** @type {(LineItem|QuadItem|ShapeItem)[]} */ ([]),
            selected: /** @type {Set<string>} */ (new Set()),
            drawing: null, // temp drawing item
            history: [],
            future: [],
            animations: /** @type {Anim[]} */ ([]),
            currentAnimId: null,
            tl: {
                sec: 0,
                playing: false,
                startTime: 0
            },
        };
        // ========= DOM refs =========
        // اضافه کردن ref جدید برای دکمه راهنما
        UI.helpBtn = document.getElementById('helpBtn');
        // ========= کلیدهای میانبر =========
        const shortcuts = {
            'h': () => UI.helpBtn.click(), // نمایش/پنهان راهنما
            's': () => setTool('select'), // ابزار انتخاب
            'm': () => setTool('move'), // ابزار جابجایی
            'l': () => setTool('line'), // ابزار خط
            'c': () => setTool('quadratic'), // ابزار منحنی
            'r': () => setTool('rect'), // ابزار مستطیل
            'e': () => setTool('ellipse'), // ابزار بیضی
            'g': () => groupSelection(), // گروه‌بندی
            'u': () => ungroupSelection(), // باز کردن گروه
            'f2': () => renameSelected(), // تغییر نام
            'delete': () => deleteSelection(), // حذف
            'escape': () => cancelDrawing(), // لغو عملیات
            'enter': () => commitDrawing() // اعمال رسم
        };
        window.addEventListener('keydown', (e) => {
            // جلوگیری از فعال شدن کلیدها در حالت ویرایش متن
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            // کلیدهای ترکیبی
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                UI.saveJSON.click();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                UI.fileInput.click();
            }
            // کلیدهای تک حرفی
            const key = e.key.toLowerCase();
            if (shortcuts[key]) {
                e.preventDefault();
                shortcuts[key]();
            }
        });
        // ========= گروه‌بندی پیشرفته =========
        // ========= گروه‌بندی پیشرفته (با ساخت خودکار چند شکل بسته) =========
        // ---------------------------------------------------------
// گروه‌بندی با تشخیص خودکار شکل بسته + حذف قطعات تشکیل‌دهنده
// ---------------------------------------------------------
        /*
Robust closed-shape detection via grouping
-----------------------------------------
This `groupSelection()` implementation handles all cases you asked for:
1) Endpoint snapping: if line/curve ends are NEAR each other, they connect.
2) Mid‑edge intersections: if segments cross anywhere (line–line, line–curve, curve–curve), we split both at the intersection(s) and create vertices there.
3) T‑junctions & mixed cases: if an endpoint lies near the body of another segment, we split the other segment accordingly.
4) Supports both straight lines (`kind: 'line'`) and quadratic curves (`kind: 'quadratic'`). Quadratics are adaptively flattened to polylines for robust intersection tests.
5) Multiple closed faces: enumerates ALL inner faces per connected component and builds a shape for each (outer face per component is dropped).

Extra robustness:
- Adaptive tolerances based on the selection scale (avg segment length) and stroke width.
- Face walking on a merged-vertex graph using a right-hand rule.
- Border simplification removes fake mid-vertices that arise from flattening (keeping only true junctions: intersections / T‑junctions / endpoints).
- Per-component dynamic min-area to keep tiny noise rings out while preserving small valid faces.
- Source segments (lines/quadratics) are removed only if at least one shape is created.

Tuneables (search in code below):
- MERGE_EPS: endpoint/vertex merge threshold (px). Default ≈ 10% of mean segment length, clamped to [8..36].
- NEAR_EPS: near-intersection tolerance (px) for almost touching segments. Default ≈ 0.35 * MERGE_EPS, clamped [2..8].
- FLAT_EPS: curve flattening tolerance (px) ~ 0.45 * avg stroke width, clamped [0.6..2.5].
- dynMinArea: per-component minimum area ≈ 1.5% of (component scale)^2, clamped [20..1200] px^2.
- ANG_EPS: angle threshold (rad) for removing almost-colinear mid-vertices that belong to the same primitive (~8.6°).

Integration notes:
- Expects `state` with: { items, selected, size? } and helper fns: pushHistory, refreshElemList, draw, rndId.
- Reads UI colors from `UI?.strokeColor?.value`, `UI?.strokeWidth?.value`, `UI?.fillColor?.value` if present.
- Outputs shape `path` in the SAME coordinate system as input (normalized 0..1 if all inputs were normalized, otherwise pixel coords).

*/

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
            pushHistory && pushHistory();
            const made = [];
            for (const f of uniq) {
                const pathOut = f.path.map(p => fromPx(p, srcNorm));
                const shape = {
                    id: (typeof rndId === 'function') ? rndId('shape') : ('shape_' + Math.random().toString(36).slice(2)),
                    kind: 'shape', path: pathOut,
                    color: UI?.strokeColor?.value ?? '#fff',
                    width: +UI?.strokeWidth?.value || 1.5,
                    fill: UI?.fillColor?.value ?? 'transparent',
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

            refreshElemList && refreshElemList();
            draw && draw();

            // ---------- fallback: plain group ----------
            function makePlainGroup(childIds) {
                pushHistory && pushHistory();
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
                refreshElemList && refreshElemList();
                draw && draw();
            }
        }


        function applyStyle() {
            const mode = UI.fillMode?.value || 'solid';
            const strokeCol = UI.strokeColor.value;
            const strokeW = +UI.strokeWidth.value || 1;
            pushHistory();
            for (const it of selectionLeafItems()) {
                // رنگ و ضخامت خط برای همه
                it.color = strokeCol;
                if (it.kind === 'shape') {
                    if (mode === 'hollow') {
                        it.fill = null;
                        it.width = strokeW;
                    } else if (mode === 'solid') {
                        it.fill = UI.fillColor.value;
                        it.width = strokeW;
                    } else if (mode === 'fill') {
                        it.fill = UI.fillColor.value;
                        it.width = 0;
                    } // بدون خط
                } else {
                    // خط و منحنی فقط stroke دارند
                    it.width = strokeW;
                }
            }
            draw();
            refreshElemList();
        }

        function selectionLeafItems() {
            const out = [];
            const seen = new Set();

            function addById(id) {
                const it = state.items.find(x => x.id === id);
                if (!it) return;
                if (it.kind === 'group') {
                    (it.children || []).forEach(addById);
                } else if (!seen.has(it.id)) {
                    seen.add(it.id);
                    out.push(it);
                }
            }

            [...state.selected].forEach(addById);
            return out;
        }

        function ungroupSelection() {
            const groups = itemsByIds([...state.selected]).filter(it => it.kind === 'group');
            if (groups.length === 0) return;
            pushHistory();
            for (const group of groups) {
                // حذف گروه
                state.items = state.items.filter(it => it.id !== group.id);
                // حذف از انتخاب
                state.selected.delete(group.id);
            }
            refreshElemList();
            draw();
        }

        function renameSelected() {
            const selected = [...state.selected];
            if (selected.length !== 1) return;
            const item = state.items.find(it => it.id === selected[0]);
            if (!item) return;
            // پیدا کردن ردیف در لیست
            const row = document.querySelector(`.row[data-id="${item.id}"]`);
            if (!row) return;
            const title = row.querySelector('.title');
            if (!title) return;
            // ایجاد فیلد ویرایش
            const input = document.createElement('input');
            input.type = 'text';
            input.value = item.name || niceName(item);
            input.className = 'name-edit';
            title.replaceWith(input);
            input.focus();
            input.addEventListener('blur', () => {
                item.name = input.value.trim() || niceName(item);
                refreshElemList();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
            });
        }

        // ========= راهنمای قابل نمایش/پنهان =========
        UI.helpBtn.addEventListener('click', () => {
            UI.help.classList.toggle('hide');
        });

        function appendChildren(container, parent) {
            for (const childId of (parent.children || [])) {
                const child = state.items.find(it => it.id === childId);
                if (!child) continue;
                const row = createRow(child, child.kind === 'group');
                container.appendChild(row);
                if (child.kind === 'group') {
                    const sub = document.createElement('div');
                    sub.className = 'group-children';
                    appendChildren(sub, child);
                    container.appendChild(sub);
                }
            }
        }

        // ========= به‌روزرسانی لیست المان‌ها =========
        function refreshElemList() {
            UI.elemList.innerHTML = '';
            const allGroups = state.items.filter(it => it.kind === 'group');
            const childSet = new Set(allGroups.flatMap(g => g.children || []));
            const topGroups = allGroups.filter(g => !childSet.has(g.id));
            // افزودن گروه‌ها و المان‌های داخل آنها
            for (const group of topGroups) {
                // ردیف گروه
                const groupRow = createRow(group, true);
                UI.elemList.appendChild(groupRow);
                // المان‌های داخل گروه
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'group-children';
                appendChildren(childrenContainer, group);
                UI.elemList.appendChild(childrenContainer);
            }
            // افزودن المان‌های بدون گروه
            const ungrouped = state.items.filter(it => !childSet.has(it.id) && it.kind !== 'group');
            for (const item of ungrouped) {
                const row = createRow(item);
                UI.elemList.appendChild(row);
            }
        }

        function createRow(it, isGroup = false) {
            const row = document.createElement('div');
            row.className = `row ${isGroup ? 'group-row' : ''}`;
            row.dataset.id = it.id;
            row.setAttribute('aria-selected', state.selected.has(it.id));
            const sw = document.createElement('div');
            sw.className = 'sw';
            sw.style.background = it.kind === 'shape' ? (it.fill || it.color) : it.color;
            row.appendChild(sw);
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = niceName(it);
            row.appendChild(title);
            const eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            eye.setAttribute('viewBox', '0 0 24 24');
            eye.classList.add('icon');
            eye.innerHTML = `<use href="#${it.visible === false ? 'ico-eyeoff' : 'ico-eye'}"></use>`;
            eye.style.cursor = 'pointer';
            row.appendChild(eye);
            const del = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            del.setAttribute('viewBox', '0 0 24 24');
            del.classList.add('icon');
            del.innerHTML = '<use href="#ico-trash"></use>';
            del.style.cursor = 'pointer';
            row.appendChild(del);
            // رویدادهای کلیک
            row.addEventListener('click', (ev) => {
                const add = ev.shiftKey;
                ensureSelected(it.id, add);
                draw();
            });
            eye.addEventListener('click', (ev) => {
                ev.stopPropagation();
                it.visible = it.visible === false ? true : false;
                refreshElemList();
                draw();
            });
            del.addEventListener('click', (ev) => {
                ev.stopPropagation();
                pushHistory();
                if (it.kind === 'group') {
                    // حذف گروه و فرزندانش
                    state.items = state.items.filter(item => item.id !== it.id && !it.children.includes(item.id));
                } else {
                    // حذف المان عادی
                    state.items = state.items.filter(x => x.id !== it.id);
                }
                state.selected.delete(it.id);
                refreshElemList();
                draw();
            });
            return row;
        }

        // ========= راهنمای کلیدهای میانبر =========
        const helpContent = `
                <strong>راهنما و کلیدهای میانبر</strong>
                <ul>
                    <li><span class="kbd">H</span>: نمایش/مخفی راهنما</li>
                    <li><span class="kbd">S</span>: ابزار انتخاب</li>
                    <li><span class="kbd">M</span>: ابزار جابجایی</li>
                    <li><span class="kbd">L</span>: ابزار خط</li>
                    <li><span class="kbd">C</span>: ابزار منحنی</li>
                    <li><span class="kbd">R</span>: ابزار مستطیل</li>
                    <li><span class="kbd">E</span>: ابزار بیضی</li>
                    <li><span class="kbd">G</span>: گروه‌بندی المان‌ها</li>
                    <li><span class="kbd">U</span>: باز کردن گروه</li>
                    <li><span class="kbd">F2</span>: تغییر نام المان/گروه</li>
                    <li><span class="kbd">Delete</span>: حذف انتخاب‌شده‌ها</li>
                    <li><span class="kbd">Ctrl+S</span>: ذخیره پروژه</li>
                    <li><span class="kbd">Ctrl+O</span>: باز کردن پروژه</li>
                    <li><span class="kbd">Escape</span>: لغو عملیات جاری</li>
                    <li><span class="kbd">Enter</span>: اعمال رسم جاری</li>
                </ul>
                <div>فرمت ذخیره: <span class="badge">LinePack+Anim v2</span></div>
            `;
        // جایگزینی محتوای راهنما
        UI.help.innerHTML = helpContent;
        UI.help.classList.add('hide');

        // ========= Layout / Sizing =========
        function sizeStage() {
            const tb = toolbar.getBoundingClientRect();
            const full = document.documentElement.getBoundingClientRect();
            const tlH = UI.timeline.getBoundingClientRect().height || 0;
            const h = full.height - tb.height - tlH; // stage only
            stageWrap.style.height = h + 'px';
            canvas.width = Math.floor(stageWrap.clientWidth * DPR);
            canvas.height = Math.floor(stageWrap.clientHeight * DPR);
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            canvas.style.bottom = '0px';
            draw();
        }

        window.addEventListener('resize', sizeStage);
        sizeStage();
        // ========= Utils =========
        const rndId = (p = 'it') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const lerp = (a, b, t) => a + (b - a) * t;
        const lpt = (A, B, t) => ({
            x: lerp(A.x, B.x, t),
            y: lerp(A.y, B.y, t)
        });
        const nearly = (a, b, eps = 6) => Math.abs(a - b) <= eps;

        function rotatePoint(p, c, deg) {
            const rad = deg * Math.PI / 180;
            const s = Math.sin(rad),
                co = Math.cos(rad);
            const dx = p.x - c.x,
                dy = p.y - c.y;
            return {
                x: c.x + dx * co - dy * s,
                y: c.y + dx * s + dy * co
            };
        }

        function itemPoints(it) {
            if (it.kind === 'line') return [it.p1, it.p2];
            if (it.kind === 'quadratic') return [it.p1, it.cp, it.p2];
            if (it.kind === 'shape') return it.path;
            return [];
        }

        function setItemPoints(it, pts) {
            if (it.kind === 'line') {
                it.p1 = pts[0];
                it.p2 = pts[1];
            }
            if (it.kind === 'quadratic') {
                it.p1 = pts[0];
                it.cp = pts[1];
                it.p2 = pts[2];
            }
            if (it.kind === 'shape') {
                it.path = pts;
            }
        }

        function itemCenter(it) {
            const pts = itemPoints(it);
            const xs = pts.map(p => p.x),
                ys = pts.map(p => p.y);
            return {
                x: (Math.min(...xs) + Math.max(...xs)) / 2,
                y: (Math.min(...ys) + Math.max(...ys)) / 2
            };
        }

        function selectionBBox() {
            const sel = selectionLeafItems();
            if (!sel.length) return null;
            let xs = [],
                ys = [];
            sel.forEach(it => itemPoints(it).forEach(p => {
                xs.push(p.x);
                ys.push(p.y);
            }));
            const x1 = Math.min(...xs),
                y1 = Math.min(...ys),
                x2 = Math.max(...xs),
                y2 = Math.max(...ys);
            return {
                x: x1,
                y: y1,
                w: x2 - x1,
                h: y2 - y1,
                cx: (x1 + x2) / 2,
                cy: (y1 + y2) / 2
            };
        }

        function itemsByIds(ids) {
            return ids.map(id => state.items.find(it => it.id === id)).filter(Boolean);
        }

        // ========= Drawing / Render =========
        function drawGrid() {
            const w = stageWrap.clientWidth,
                h = stageWrap.clientHeight;
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.lineWidth = 1;
            ctx.strokeStyle = getCssVar('--grid');
            const step = 32;
            ctx.beginPath();
            for (let x = 0; x <= w; x += step) {
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, h);
            }
            for (let y = 0; y <= h; y += step) {
                ctx.moveTo(0, y + 0.5);
                ctx.lineTo(w, y + 0.5);
            }
            ctx.stroke();
            ctx.restore();
        }

        function renderItem(item, showHandles = false) {
            if (item.visible === false) return;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = item.color;
            ctx.lineWidth = item.width;
            const rot = item.rot || 0;
            const cen = itemCenter(item);
            ctx.translate(cen.x, cen.y);
            ctx.rotate((rot * Math.PI) / 180);
            ctx.translate(-cen.x, -cen.y);
            if (item.kind === 'line') {
                ctx.beginPath();
                ctx.moveTo(item.p1.x, item.p1.y);
                ctx.lineTo(item.p2.x, item.p2.y);
                ctx.stroke();
                if (showHandles) drawHandles([item.p1, item.p2]);
            } else if (item.kind === 'quadratic') {
                ctx.beginPath();
                ctx.moveTo(item.p1.x, item.p1.y);
                ctx.quadraticCurveTo(item.cp.x, item.cp.y, item.p2.x, item.p2.y);
                ctx.stroke();
                if (showHandles) {
                    ctx.save();
                    ctx.setLineDash([5, 4]);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = 'rgba(155,123,255,0.7)';
                    ctx.beginPath();
                    ctx.moveTo(item.p1.x, item.p1.y);
                    ctx.lineTo(item.cp.x, item.cp.y);
                    ctx.moveTo(item.p2.x, item.p2.y);
                    ctx.lineTo(item.cp.x, item.cp.y);
                    ctx.stroke();
                    ctx.restore();
                    drawHandles([item.p1, item.cp, item.p2]);
                }
            } else if (item.kind === 'shape') {
                ctx.beginPath();
                const path = item.path;
                if (!path.length) {
                    ctx.restore();
                    return;
                }
                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) {
                    ctx.lineTo(path[i].x, path[i].y);
                }
                ctx.closePath();
                if (item.fill) {
                    ctx.fillStyle = item.fill;
                    ctx.fill();
                }
                if (item.width > 0) ctx.stroke();
                if (showHandles) drawHandles(path);
            }
            ctx.restore();
        }

        function drawHandles(points) {
            ctx.save();
            for (const p of points) {
                ctx.beginPath();
                ctx.fillStyle = 'rgba(255,200,87,0.95)';
                ctx.strokeStyle = '#3b2f00';
                ctx.lineWidth = 1;
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }

        function draw() {
            drawGrid();
            // items
            for (const it of state.items) {
                const selected = state.selected.has(it.id) && state.tool === 'select';
                renderItem(it, selected);
            }
            // preview current drawing
            if (state.drawing) {
                ctx.save();
                ctx.setLineDash([6, 6]);
                ctx.globalAlpha = 0.95;
                renderItem(state.drawing, true);
                ctx.restore();
            }
            updateGhost();
        }

        // ========= Input =========
        const keys = {
            ctrl: false,
            shift: false
        };
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control') keys.ctrl = true;
            if (e.key === 'Shift') keys.shift = true;
            if (e.key === 'Escape') cancelDrawing();
            if (e.key === 'Delete') deleteSelection();
            if (e.key === 'Enter' && state.drawing) {
                e.preventDefault();
                commitDrawing();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
                e.preventDefault();
                redo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
                e.preventDefault();
                groupSelection();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
                e.preventDefault();
                ungroupSelection();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control') keys.ctrl = false;
            if (e.key === 'Shift') keys.shift = false;
        });

        function mousePos(evt) {
            const r = canvas.getBoundingClientRect();
            return {
                x: evt.clientX - r.left,
                y: evt.clientY - r.top
            };
        }

        function snapIfNeeded(pt) {
            if (!keys.ctrl) return pt;
            const g = 16;
            return {
                x: Math.round(pt.x / g) * g,
                y: Math.round(pt.y / g) * g
            };
        }

        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mouseup', () => {
            dragging = null;
            UI.rotHandle.style.cursor = 'grab';
        });
        let dragging = null; // {type: 'handle'|'rotate'|'move', id, key}
        function onMouseMove(e) {
            const mp = snapIfNeeded(mousePos(e));
            if (dragging) {
                if (dragging.type === 'handle') {
                    const item = state.items.find(it => it.id === dragging.id);
                    if (!item) return;
                    const pts = itemPoints(item);
                    const idx = dragging.keyIndex;
                    pts[idx] = mp;
                    setItemPoints(item, pts);
                    draw();
                } else if (dragging.type === 'move') {
                    const dx = mp.x - dragging.start.x;
                    const dy = mp.y - dragging.start.y;
                    dragging.start = mp;
                    for (const it of selectionLeafItems()) {
                        const pts = itemPoints(it).map(p => ({
                            x: p.x + dx,
                            y: p.y + dy
                        }));
                        setItemPoints(it, pts);
                    }
                    draw();
                } else if (dragging.type === 'rotate') {
                    const box = selectionBBox();
                    if (!box) return;
                    const ang = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI - dragging.base;
                    const leafs = selectionLeafItems();
                    for (const it of leafs) {
                        it.rot = (dragging.rot0.get(it.id) || 0) + ang;
                    }
                    UI.rotDeg.value = Math.round((leafs[0]?.rot || 0));
                    draw();
                    updateGhost();
                }
                return;
            }
            // preview drawing update
            if (state.drawing) {
                if (state.drawing.kind === 'line') state.drawing.p2 = mp;
                else if (state.drawing.kind === 'quadratic') {
                    if (state.drawing.stage === 1) state.drawing.p2 = mp;
                    else if (state.drawing.stage === 2) state.drawing.cp = mp;
                } else if (state.drawing.kind === 'shape') {
                    if (state.drawing._isEllipse) {
                        state.drawing._edge = mp;
                        const cx = state.drawing._center.x,
                            cy = state.drawing._center.y;
                        const rx = Math.abs(mp.x - cx),
                            ry = Math.abs(mp.y - cy);
                        const N = 32,
                            pts = [];
                        for (let i = 0; i < N; i++) {
                            const t = (i / N) * Math.PI * 2;
                            pts.push({
                                x: cx + rx * Math.cos(t),
                                y: cy + ry * Math.sin(t)
                            });
                        }
                        state.drawing.path = pts;
                    } else if (state.drawing._isRect) {
                        const x1 = state.drawing.path[0].x,
                            y1 = state.drawing.path[0].y;
                        const x2 = mp.x,
                            y2 = mp.y;
                        state.drawing.path = [{
                            x: x1,
                            y: y1
                        }, {
                            x: x2,
                            y: y1
                        }, {
                            x: x2,
                            y: y2
                        }, {
                            x: x1,
                            y: y2
                        }];
                    }
                }
                draw();
                return;
            }
        }

        function onMouseDown(e) {
            const mp = snapIfNeeded(mousePos(e));
            if (state.tool === 'line') {
                if (!state.drawing) {
                    state.drawing = {
                        id: rndId('ln'),
                        kind: 'line',
                        p1: mp,
                        p2: mp,
                        color: UI.strokeColor.value,
                        width: +UI.strokeWidth.value
                    }
                } else {
                    commitDrawing();
                }
                draw();
                return;
            }
            if (state.tool === 'quadratic') {
                if (!state.drawing) {
                    state.drawing = {
                        id: rndId('q'),
                        kind: 'quadratic',
                        p1: mp,
                        p2: mp,
                        cp: mp,
                        color: UI.strokeColor.value,
                        width: +UI.strokeWidth.value,
                        stage: 1
                    }
                } else {
                    if (state.drawing.stage === 1) {
                        state.drawing.stage = 2;
                        state.drawing.p2 = mp;
                    } else {
                        state.drawing.cp = mp;
                        commitDrawing();
                    }
                }
                draw();
                return;
            }
            if (state.tool === 'rect') {
                if (!state.drawing) {
                    state.drawing = {
                        id: rndId('r'),
                        kind: 'shape',
                        path: [mp, mp, mp, mp],
                        color: UI.strokeColor.value,
                        width: (UI.fillMode?.value === 'fill' ? 0 : +UI.strokeWidth.value),
                        fill: (UI.fillMode?.value === 'hollow' ? null : UI.fillColor.value),
                        _isRect: true
                    };
                } else {
                    commitDrawing();
                }
                draw();
                return;
            }
            if (state.tool === 'ellipse') {
                if (!state.drawing) {
                    state.drawing = {
                        id: rndId('e'),
                        kind: 'shape',
                        path: [mp],
                        color: UI.strokeColor.value,
                        width: (UI.fillMode?.value === 'fill' ? 0 : +UI.strokeWidth.value),
                        fill: (UI.fillMode?.value === 'hollow' ? null : UI.fillColor.value),
                        _center: mp,
                        _edge: mp,
                        _isEllipse: true
                    };
                } else {
                    commitDrawing();
                }
                draw();
                return;
            }
            if (state.tool === 'move') {
                const hitId = hitTestItem(mp);
                if (hitId && !state.selected.has(hitId)) ensureSelected(hitId, e.shiftKey);
                if (state.selected.size) {
                    dragging = {
                        type: 'move',
                        start: mp
                    };
                    pushHistory();
                }
                return;
            }
            if (state.tool === 'select') {
                const hit = hitTestHandle(mp);
                if (hit) {
                    ensureSelected(hit.id, e.shiftKey);
                    dragging = {
                        type: 'handle',
                        id: hit.id,
                        keyIndex: hit.keyIndex
                    };
                    pushHistory();
                    return;
                }
                const box = selectionBBox();
                if (box && mp.x >= box.x && mp.x <= box.x + box.w && mp.y >= box.y && mp.y <= box.y + box.h) {
                    dragging = {
                        type: 'move',
                        start: mp
                    };
                    pushHistory();
                    return;
                }
                const hitId = hitTestItem(mp);
                if (hitId) {
                    ensureSelected(hitId, e.shiftKey);
                    draw();
                } else {
                    if (!e.shiftKey) state.selected.clear();
                    draw();
                }
                return;
            }
        }

        function commitDrawing() {
            if (!state.drawing) return;
            const it = state.drawing;
            delete it.stage;
            delete it._isEllipse;
            delete it._center;
            delete it._edge;
            delete it._isRect;
            state.items.push(it);
            pushHistory();
            state.drawing = null;
            refreshElemList();
            draw();
            autoDetectClosedShapes();
        }

        function cancelDrawing() {
            state.drawing = null;
            draw();
        }

        function hitTestHandle(pt) {
            const r = 7; // کوچک برای تناسب
            for (let i = state.items.length - 1; i >= 0; i--) {
                const it = state.items[i];
                if (!state.selected.has(it.id)) continue;
                const pts = itemPoints(it);
                for (let k = pts.length - 1; k >= 0; k--) {
                    const p = pts[k];
                    if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 <= r * r) return {
                        id: it.id,
                        keyIndex: k
                    };
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
            if (l2 === 0) return dist(p, a);
            let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const proj = {
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y)
            };
            return dist(p, proj);
        }

        function quadAt(a, c, b, t) {
            const u = 1 - t;
            return {
                x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
                y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
            };
        }

        function pointQuadNear(p, a, c, b) {
            let min = 1e9;
            let prev = a;
            for (let i = 1; i <= 30; i++) {
                const t = i / 30;
                const q = quadAt(a, c, b, t);
                const d = pointLineDist(p, prev, q);
                if (d < min) min = d;
                prev = q;
            }
            return min;
        }

        function pointInPolygon(p, poly) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x,
                    yi = poly[i].y;
                const xj = poly[j].x,
                    yj = poly[j].y;
                const inter = ((yi > p.y) != (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-9) + xi);
                if (inter) inside = !inside;
            }
            return inside;
        }

        function setTool(t) {
            state.tool = t;
            canvas.style.cursor = (t === 'select') ? 'default' : 'crosshair';
            draw();
        }

        // ========= Selection / Group =========
        function ensureSelected(id, add) {
            if (!add) state.selected.clear();
            state.selected.add(id);
            refreshElemList();
            updateGhost();
            updateFillVisibility();
        }

        function deleteSelection() {
            if (!state.selected.size) return;
            pushHistory();
            state.items = state.items.filter(it => !state.selected.has(it.id));
            state.selected.clear();
            refreshElemList();
            draw();
        }

        function buildShapeFromSelection() {
            const ids = [...state.selected];
            if (ids.length < 2) return;
            const shape = tryBuildClosedShape(ids);
            if (shape) {
                pushHistory();
                state.items.push(shape);
                refreshElemList();
                draw();
                state.selected.clear();
                state.selected.add(shape.id);
                updateGhost();
                return;
            }
            alert('مسیر بسته تشخیص داده نشد؛ گروه معمولی شد.');
        }

        function ungroupSelectionOld() {
            /* این نسخه گروه واقعی ندارد؛ شکل هم المان مجزا است */
        }

        function tryBuildClosedShape(ids) {
            const segs = ids.map(id => state.items.find(it => it.id === id)).filter(Boolean);
            const edges = [];
            for (const it of segs) {
                if (it.kind === 'line') edges.push({
                    a: it.p1,
                    b: it.p2
                });
                else if (it.kind === 'quadratic') {
                    let prev = it.p1;
                    for (let i = 1; i <= 20; i++) {
                        const t = i / 20;
                        const q = quadAt(it.p1, it.cp, it.p2, t);
                        edges.push({
                            a: prev,
                            b: q
                        });
                        prev = q;
                    }
                }
            }
            const pts = [];

            function addPt(p) {
                for (const q of pts) {
                    if (dist(p, q) < 6) {
                        return q;
                    }
                }
                pts.push({
                    x: p.x,
                    y: p.y
                });
                return pts[pts.length - 1];
            }

            const E = [];
            for (const e of edges) {
                const a = addPt(e.a),
                    b = addPt(e.b);
                E.push([pts.indexOf(a), pts.indexOf(b)]);
            }
            if (!pts.length) return null;
            const adj = new Map();
            for (const [a, b] of E) {
                if (!adj.has(a)) adj.set(a, []);
                if (!adj.has(b)) adj.set(b, []);
                adj.get(a).push(b);
                adj.get(b).push(a);
            }

            function findCycle() {
                for (let s = 0; s < pts.length; s++) {
                    const stack = [
                        [s, -1, [s]]
                    ];
                    const visited = new Set();
                    while (stack.length) {
                        const [v, par, path] = stack.pop();
                        if (path.length > 2) {
                            for (const u of (adj.get(v) || [])) {
                                if (u === path[0] && path.length >= 3) return path;
                            }
                        }
                        for (const u of (adj.get(v) || [])) {
                            if (u === par) continue;
                            const key = v + ',' + u + ',' + path.length;
                            if (visited.has(key)) continue;
                            visited.add(key);
                            stack.push([u, v, [...path, u]]);
                        }
                    }
                }
                return null;
            }

            const cyc = findCycle();
            if (!cyc) return null;
            const polygon = cyc.map(i => pts[i]);
            const color = UI.strokeColor.value;
            const fill = UI.fillColor.value;
            return {
                id: rndId('shape'),
                kind: 'shape',
                path: polygon,
                color,
                width: 1.5,
                fill,
                children: ids.slice()
            };
        }

        // Auto-detect simple closed loops after each commit (خطی/ساده)
        function autoDetectClosedShapes() {
            // تلاش سبک: فقط اگر حداقل 3 خط داریم و هنوز شکل هم‌پوشان وجود ندارد
            const lineIds = state.items.filter(it => it.kind === 'line').map(it => it.id);
            if (lineIds.length < 3) return;
            const shape = tryBuildClosedShape(lineIds);
            if (shape) { // از ایجاد شکل تکراری جلوگیری: اگر همین path (با تقریب) موجود است، رد کن
                const exists = state.items.some(it => it.kind === 'shape' && approxSamePoly(it.path, shape.path));
                if (!exists) {
                    state.items.push(shape);
                    refreshElemList();
                    draw();
                }
            }
        }

        function approxSamePoly(a, b) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (dist(a[i], b[i]) > 8) return false;
            }
            return true;
        }

        // ========= Sidebar (Elements) =========
        function refreshElemListOld() {
            UI.elemList.innerHTML = '';
            for (const it of state.items) {
                const row = document.createElement('div');
                row.className = 'row';
                row.dataset.id = it.id;
                row.setAttribute('aria-selected', state.selected.has(it.id));
                const sw = document.createElement('div');
                sw.className = 'sw';
                sw.style.background = it.kind === 'shape' ? (it.fill || it.color) : it.color;
                row.appendChild(sw);
                const title = document.createElement('div');
                title.textContent = niceName(it);
                row.appendChild(title);
                const eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                eye.setAttribute('viewBox', '0 0 24 24');
                eye.classList.add('icon');
                eye.innerHTML = `<use href="#${it.visible === false ? 'ico-eyeoff' : 'ico-eye'}"></use>`;
                eye.style.cursor = 'pointer';
                row.appendChild(eye);
                const del = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                del.setAttribute('viewBox', '0 0 24 24');
                del.classList.add('icon');
                del.innerHTML = '<use href="#ico-trash"></use>';
                del.style.cursor = 'pointer';
                row.appendChild(del);
                row.addEventListener('click', (ev) => {
                    const add = ev.shiftKey;
                    ensureSelected(it.id, add);
                    draw();
                });
                eye.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    it.visible = it.visible === false ? true : false;
                    refreshElemList();
                    draw();
                });
                del.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    pushHistory();
                    state.items = state.items.filter(x => x.id !== it.id);
                    state.selected.delete(it.id);
                    refreshElemList();
                    draw();
                });
                UI.elemList.appendChild(row);
            }
        }

        function niceName(it) {
            return it.name || (it.kind === 'line' ? 'خط' : it.kind === 'quadratic' ? 'منحنی' : 'شکل');
        }

        UI.groupBtn.addEventListener('click', groupSelection);
        UI.ungroupBtn.addEventListener('click', ungroupSelection);
        UI.toggleAll.addEventListener('click', () => {
            const anyHidden = state.items.some(it => it.visible === false);
            for (const it of state.items) it.visible = anyHidden;
            refreshElemList();
            draw();
        });
        UI.deleteSel.addEventListener('click', deleteSelection);

        // ========= Fill control visibility =========
        function updateFillVisibility() {
            const hasShape = [...state.selected].some(id => (state.items.find(i => i.id === id)?.kind === 'shape'));
            UI.fillWrap.style.opacity = hasShape ? 1 : 0.4;
            UI.fillWrap.style.pointerEvents = hasShape ? 'auto' : 'none';
        }

        UI.fillColor.addEventListener('input', () => {
            // فقط در حال رسم شکل جدید رنگ پر پیش‌فرض را بروز کن
            if (state.drawing && state.drawing.kind === 'shape') {
                state.drawing.fill = UI.fillColor.value;
                draw();
            }
        });

        // ========= Rotation visuals =========
        function updateGhost() {
            const box = selectionBBox();
            if (!box) {
                UI.ghost.classList.add('hide');
                UI.rotHandle.classList.add('hide');
                return;
            }
            UI.ghost.classList.remove('hide');
            UI.rotHandle.classList.remove('hide');
            UI.ghost.style.left = box.x + 'px';
            UI.ghost.style.top = box.y + 'px';
            UI.ghost.style.width = Math.max(0, box.w) + 'px';
            UI.ghost.style.height = Math.max(0, box.h) + 'px';
            UI.rotHandle.style.left = (box.cx - 8) + 'px';
            UI.rotHandle.style.top = (box.y - 26) + 'px';
        }

        UI.rotHandle.addEventListener('mousedown', (e) => {
            const box = selectionBBox();
            if (!box) return;
            const mp = mousePos(e);
            const base = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI;
            const rot0 = new Map();
            selectionLeafItems().forEach(it => rot0.set(it.id, it.rot || 0));
            dragging = {
                type: 'rotate',
                base,
                rot0
            };
            UI.rotHandle.style.cursor = 'grabbing';
            pushHistory();
        });
        UI.rotDeg.addEventListener('change', () => {
            const deg = +UI.rotDeg.value || 0;
            for (const it of itemsByIds([...state.selected])) it.rot = deg;
            draw();
            updateGhost();
        });
        // ========= Tool menu =========
        UI.shapeMenuBtn.addEventListener('click', () => {
            const open = UI.shapeMenu.getAttribute('aria-expanded') === 'true';
            UI.shapeMenu.setAttribute('aria-expanded', String(!open));
        });
        UI.shapePop.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-tool]');
            if (!btn) return;
            setTool(btn.dataset.tool);
            UI.shapeMenu.setAttribute('aria-expanded', 'false');
        });

        // ========= Timeline =========
        function rebuildTicks() {
            const dur = +UI.animDur.value || 5;
            UI.ticks.innerHTML = '';
            const body = UI.timeline.querySelector('.tl-body');
            const rect = body.getBoundingClientRect();
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
                UI.ticks.appendChild(div);
            }
            placeCursor();
        }

        function secToX(sec) {
            const dur = +UI.animDur.value || 5;
            const rect = UI.timeline.querySelector('.tl-body').getBoundingClientRect();
            return clamp((sec / dur) * rect.width, 0, rect.width);
        }

        function xToSec(x) {
            const dur = +UI.animDur.value || 5;
            const rect = UI.timeline.querySelector('.tl-body').getBoundingClientRect();
            return clamp((x / rect.width) * dur, 0, dur);
        }

        function placeCursor() {
            UI.cursor.style.left = secToX(state.tl.sec) + 'px';
            UI.cursor.classList.toggle('has-kf', hasKeyAt(state.tl.sec));
        }

        UI.timeline.addEventListener('click', (e) => {
            const bodyRect = UI.timeline.querySelector('.tl-body').getBoundingClientRect();
            if (e.clientY < bodyRect.top || e.clientY > bodyRect.bottom) return;
            state.tl.sec = Math.round(xToSec(e.clientX - bodyRect.left));
            placeCursor();
        });

        function currentAnim() {
            return state.animations.find(a => a.id === state.currentAnimId) || null;
        }

        function refreshAnimSelect() {
            UI.animSelect.innerHTML = '';
            state.animations.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = a.name;
                UI.animSelect.appendChild(opt);
            });
            if (state.currentAnimId) UI.animSelect.value = state.currentAnimId;
        }

        UI.addAnim.addEventListener('click', () => {
            const name = UI.animName.value.trim() || ('کلیپ ' + (state.animations.length + 1));
            const id = rndId('anim');
            const a = {
                id,
                name,
                duration: +UI.animDur.value || 5,
                keyframes: []
            };
            state.animations.push(a);
            state.currentAnimId = id;
            refreshAnimSelect();
            placeCursor();
        });
        UI.renameAnim.addEventListener('click', () => {
            const a = currentAnim();
            if (!a) return;
            a.name = UI.animName.value.trim() || a.name;
            refreshAnimSelect();
        });
        UI.delAnim.addEventListener('click', () => {
            if (!state.currentAnimId) return;
            state.animations = state.animations.filter(a => a.id !== state.currentAnimId);
            state.currentAnimId = state.animations[0]?.id || null;
            refreshAnimSelect();
        });
        UI.animSelect.addEventListener('change', () => {
            state.currentAnimId = UI.animSelect.value;
            const a = currentAnim();
            if (a) {
                UI.animName.value = a.name;
                UI.animDur.value = a.duration;
                rebuildTicks();
                placeCursor();
            }
        });
        UI.animDur.addEventListener('change', () => {
            const a = currentAnim();
            if (a) {
                a.duration = +UI.animDur.value || 5;
            }
            rebuildTicks();
            placeCursor();
        });

        function snapshotState() {
            return JSON.parse(JSON.stringify(state.items));
        }

        function putKeyframe() {
            const a = currentAnim();
            if (!a) return;
            const t = state.tl.sec;
            const snap = snapshotState();
            const idx = a.keyframes.findIndex(k => k.t === t);
            if (idx >= 0) a.keyframes[idx].snapshot = snap;
            else a.keyframes.push({
                t,
                snapshot: snap
            });
            a.keyframes.sort((x, y) => x.t - y.t);
            placeCursor();
        }

        UI.setKey.addEventListener('click', () => {
            putKeyframe();
        });
        UI.tlAddKey.addEventListener('click', () => {
            putKeyframe();
        });

        function hasKeyAt(sec) {
            const a = currentAnim();
            if (!a) return false;
            return a.keyframes.some(k => k.t === sec);
        }

        UI.play.addEventListener('click', () => {
            const a = currentAnim();
            if (!a || !a.keyframes.length) return;
            state.tl.playing = true;
            state.tl.startTime = performance.now() - state.tl.sec * 1000;
            requestAnimationFrame(stepPlay);
        });
        UI.pause.addEventListener('click', () => {
            state.tl.playing = false;
        });
        UI.tlPlay.addEventListener('click', () => {
            const a = currentAnim();
            if (!a || !a.keyframes.length) return;
            state.tl.playing = !state.tl.playing;
            if (state.tl.playing) {
                state.tl.startTime = performance.now() - state.tl.sec * 1000;
                requestAnimationFrame(stepPlay);
            }
        });

        function stepPlay(now) {
            if (!state.tl.playing) return;
            const a = currentAnim();
            if (!a) return;
            const dur = (a.duration || 5) * 1000;
            const tms = (now - state.tl.startTime) % dur;
            const t = tms / 1000;
            state.tl.sec = Math.floor(t);
            const ks = a.keyframes;
            if (!ks.length) return;
            let k1 = ks[0],
                k2 = ks[ks.length - 1];
            for (let i = 0; i < ks.length - 1; i++) {
                if (t >= ks[i].t && t <= ks[i + 1].t) {
                    k1 = ks[i];
                    k2 = ks[i + 1];
                    break;
                }
            }
            const span = Math.max(1e-6, k2.t - k1.t);
            const tt = clamp((t - k1.t) / span, 0, 1);
            const map2 = new Map(k2.snapshot.map(o => [o.id, o]));
            const out = k1.snapshot.map(o1 => {
                const o2 = map2.get(o1.id);
                if (!o2) return JSON.parse(JSON.stringify(o1));
                return tweenItem(o1, o2, tt);
            });
            for (const o2 of k2.snapshot) {
                if (!out.find(x => x.id === o2.id)) out.push(JSON.parse(JSON.stringify(o2)));
            }
            const bak = state.items;
            state.items = out;
            draw();
            state.items = bak;
            UI.playhead.style.left = secToX(t) + 'px';
            placeCursor();
            requestAnimationFrame(stepPlay);
        }

        function tweenItem(a, b, t) {
            const o = JSON.parse(JSON.stringify(a));
            o.color = a.color;
            o.width = lerp(a.width, b.width, t);
            o.rot = lerp(a.rot || 0, b.rot || 0, t);
            if (a.kind === 'line' && b.kind === 'line') {
                o.p1 = lpt(a.p1, b.p1, t);
                o.p2 = lpt(a.p2, b.p2, t);
            }
            if (a.kind === 'quadratic' && b.kind === 'quadratic') {
                o.p1 = lpt(a.p1, b.p1, t);
                o.cp = lpt(a.cp, b.cp, t);
                o.p2 = lpt(a.p2, b.p2, t);
            }
            if (a.kind === 'shape' && b.kind === 'shape') {
                const n = Math.min(a.path.length, b.path.length);
                const path = [];
                for (let i = 0; i < n; i++) path.push(lpt(a.path[i], b.path[i], t));
                o.path = path;
                o.fill = t < 0.5 ? a.fill : b.fill;
            }
            return o;
        }

        // ========= History / Files =========
        function pushHistory() {
            state.history.push(JSON.stringify({
                items: state.items,
                animations: state.animations
            }));
            state.future.length = 0;
        }

        function undo() {
            if (!state.history.length) return;
            const snap = state.history.pop();
            state.future.push(JSON.stringify({
                items: state.items,
                animations: state.animations
            }));
            const s = JSON.parse(snap);
            state.items = s.items;
            state.animations = s.animations;
            refreshElemList();
            draw();
        }

        function redo() {
            if (!state.future.length) return;
            const snap = state.future.pop();
            state.history.push(JSON.stringify({
                items: state.items,
                animations: state.animations
            }));
            const s = JSON.parse(snap);
            state.items = s.items;
            state.animations = s.animations;
            refreshElemList();
            draw();
        }

        UI.undo.addEventListener('click', undo);
        UI.redo.addEventListener('click', redo);
        UI.saveJSON.addEventListener('click', () => {
            const data = exportPack(false);
            downloadBlob(JSON.stringify(data, null, 2), 'drawing.linepack.json');
        });
        UI.saveJSONMin.addEventListener('click', () => {
            const data = exportPack(true);
            downloadBlob(JSON.stringify(data), 'drawing.min.linepack.json');
        });
        UI.exportPNG.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = 'canvas.png';
            a.click();
        });
        UI.fileInput.addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            try {
                const txt = await f.text();
                const data = JSON.parse(txt);
                importPack(data);
            } catch (err) {
                alert('فایل معتبر نیست: ' + err.message);
            } finally {
                e.target.value = '';
            }
        });
        UI.clear.addEventListener('click', () => {
            if (confirm('همه چیز پاک شود؟')) {
                pushHistory();
                state.items = [];
                state.selected.clear();
                draw();
                refreshElemList();
            }
        });

        function exportPack(minimal = false) {
            const {
                w,
                h
            } = getCSSSize();
            const els = state.items.map(it => serializeItem(it, w, h, minimal));
            const anims = state.animations.map(a => ({
                name: a.name,
                duration: a.duration,
                keyframes: a.keyframes.map(k => ({
                    t: k.t,
                    snapshot: k.snapshot.map(it => serializeItem(it, w, h, true))
                }))
            }));
            return {
                type: 'LinePack',
                version: 2,
                size: {
                    w,
                    h
                },
                elements: els,
                animations: anims
            };
        }

        function serializeItem(it, w, h, min) {
            const base = {
                id: it.id,
                kind: it.kind,
                style: {
                    color: it.color,
                    width: +it.width,
                    rot: +(it.rot || 0),
                    visible: it.visible !== false
                }
            };
            const norm = p => ({
                x: +(p.x / w).toFixed(min ? 3 : 6),
                y: +(p.y / h).toFixed(min ? 3 : 6)
            });
            if (it.kind === 'line') return {
                ...base,
                points: {
                    p1: norm(it.p1),
                    p2: norm(it.p2)
                }
            };
            if (it.kind === 'quadratic') return {
                ...base,
                points: {
                    p1: norm(it.p1),
                    cp: norm(it.cp),
                    p2: norm(it.p2)
                }
            };
            if (it.kind === 'shape') return {
                ...base,
                fill: it.fill || null,
                path: it.path.map(norm),
                children: it.children || []
            };
        }

        function importPack(pack) {
            if (!pack || pack.type !== 'LinePack') throw new Error('LinePack v2 معتبر نیست');
            const den = (p, s) => ({
                x: p.x * s.w,
                y: p.y * s.h
            });
            state.animations = (pack.animations || []).map(a => ({
                id: rndId('anim'),
                name: a.name,
                duration: a.duration,
                keyframes: a.keyframes.map(k => ({
                    t: k.t,
                    snapshot: k.snapshot.map(el => {
                        const it = {
                            id: el.id || rndId('it'),
                            kind: el.kind,
                            color: el.style?.color || '#fff',
                            width: +(el.style?.width || 3),
                            rot: +(el.style?.rot || 0),
                            visible: el.style?.visible !== false
                        };
                        if (el.kind === 'line') {
                            it.p1 = den(el.points.p1, pack.size);
                            it.p2 = den(el.points.p2, pack.size);
                        } else if (el.kind === 'quadratic') {
                            it.p1 = den(el.points.p1, pack.size);
                            it.cp = den(el.points.cp, pack.size);
                            it.p2 = den(el.points.p2, pack.size);
                        } else if (el.kind === 'shape') {
                            it.path = el.path.map(p => den(p, pack.size));
                            it.fill = el.fill || null;
                            it.children = el.children || [];
                        }
                        return it;
                    })
                }))
            }))
            state.items = pack.elements.map(el => {
                const it = {
                    id: el.id || rndId('it'),
                    kind: el.kind,
                    color: el.style?.color || '#fff',
                    width: +(el.style?.width || 3),
                    rot: +(el.style?.rot || 0),
                    visible: el.style?.visible !== false
                };
                if (el.kind === 'line') {
                    it.p1 = den(el.points.p1, pack.size);
                    it.p2 = den(el.points.p2, pack.size);
                } else if (el.kind === 'quadratic') {
                    it.p1 = den(el.points.p1, pack.size);
                    it.cp = den(el.points.cp, pack.size);
                    it.p2 = den(el.points.p2, pack.size);
                } else if (el.kind === 'shape') {
                    it.path = el.path.map(p => den(p, pack.size));
                    it.fill = el.fill || null;
                    it.children = el.children || [];
                }
                return it;
            });
            state.currentAnimId = state.animations[0]?.id || null;
            refreshAnimSelect();
            refreshElemList();
            draw();
            rebuildTicks();
        }

        function downloadBlob(text, name) {
            const blob = new Blob([text], {
                type: 'application/json'
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 800);
        }

        function getCSSSize() {
            return {
                w: stageWrap.clientWidth,
                h: stageWrap.clientHeight
            };
        }

        function getCssVar(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }

        // ========= Init =========
        // Tabs
        UI.tabElems.addEventListener('click', () => {
            UI.tabElems.setAttribute('aria-selected', 'true');
            UI.tabAnims.setAttribute('aria-selected', 'false');
            UI.panelElems.classList.remove('hide');
            UI.panelAnims.classList.add('hide');
        });
        UI.tabAnims.addEventListener('click', () => {
            UI.tabElems.setAttribute('aria-selected', 'false');
            UI.tabAnims.setAttribute('aria-selected', 'true');
            UI.panelElems.classList.add('hide');
            UI.panelAnims.classList.remove('hide');
        });
        UI.apply.addEventListener('click', applyStyle);
        refreshElemList();
        rebuildTicks();
        draw();
        updateFillVisibility();
    })();
