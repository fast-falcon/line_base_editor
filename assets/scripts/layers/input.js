/**
 * @fileoverview Handles mouse, keyboard, and drawing interactions for
 * LinePack Pro, translating raw events into selection and geometry updates.
 */

function registerInput(ctx) {
    const { state, ui, utils, canvas, api } = ctx;
    const { rndId, itemPoints, setItemPoints } = utils;
    const keys = { ctrl: false, shift: false };
    ctx.dragging = null;

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

    function commitDrawing() {
        if (!state.drawing) return;
        const it = state.drawing;
        delete it.stage;
        delete it._isEllipse;
        delete it._center;
        delete it._edge;
        delete it._isRect;
        state.items.push(it);
        api.pushHistory && api.pushHistory();
        state.drawing = null;
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
        api.autoDetectClosedShapes && api.autoDetectClosedShapes();
    }

    function cancelDrawing() {
        state.drawing = null;
        api.draw && api.draw();
    }

    function hitTestHandle(pt) {
        const r = 7;
        for (let i = state.items.length - 1; i >= 0; i--) {
            const it = state.items[i];
            if (!state.selected.has(it.id)) continue;
            const pts = itemPoints(it);
            for (let k = pts.length - 1; k >= 0; k--) {
                const p = pts[k];
                if ((pt.x - p.x) ** 2 + (pt.y - p.y) ** 2 <= r * r) {
                    return { id: it.id, keyIndex: k };
                }
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
        if (it.kind === 'line') return (api.pointLineDist ? api.pointLineDist(p, it.p1, it.p2) : 999) < Math.max(6, it.width + 4);
        if (it.kind === 'quadratic') return (api.pointQuadNear ? api.pointQuadNear(p, it.p1, it.cp, it.p2) : 999) < Math.max(6, it.width + 4);
        if (it.kind === 'shape') {
            const segs = Array.isArray(it.segments) ? it.segments : null;
            const limit = Math.max(6, (it.width || 0) + 4);
            if (segs && segs.length) {
                let best = Infinity;
                for (const seg of segs) {
                    if (!seg || !seg.p1 || !seg.p2) continue;
                    let distVal = Infinity;
                    if (seg.kind === 'quadratic' && seg.cp && api.pointQuadNear) {
                        distVal = api.pointQuadNear(p, seg.p1, seg.cp, seg.p2);
                    } else if (api.pointLineDist) {
                        distVal = api.pointLineDist(p, seg.p1, seg.p2);
                    }
                    if (distVal < best) best = distVal;
                }
                if (best <= limit) return true;
            }
            return api.pointInPolygon ? api.pointInPolygon(p, it.path) : false;
        }
        return false;
    }

    function onMouseMove(e) {
        const mp = snapIfNeeded(mousePos(e));
        if (ctx.dragging) {
            if (ctx.dragging.type === 'handle') {
                const item = state.items.find(it => it.id === ctx.dragging.id);
                if (!item) return;
                const pts = itemPoints(item);
                const idx = ctx.dragging.keyIndex;
                pts[idx] = mp;
                setItemPoints(item, pts);
                api.draw && api.draw();
            } else if (ctx.dragging.type === 'move') {
                const dx = mp.x - ctx.dragging.start.x;
                const dy = mp.y - ctx.dragging.start.y;
                ctx.dragging.start = mp;
                for (const it of api.selectionLeafItems ? api.selectionLeafItems() : []) {
                    const pts = itemPoints(it).map(p => ({ x: p.x + dx, y: p.y + dy }));
                    setItemPoints(it, pts);
                }
                api.draw && api.draw();
            } else if (ctx.dragging.type === 'rotate') {
                const box = api.selectionBBox ? api.selectionBBox() : null;
                if (!box) return;
                const ang = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI - ctx.dragging.base;
                const leafs = api.selectionLeafItems ? api.selectionLeafItems() : [];
                for (const it of leafs) {
                    it.rot = (ctx.dragging.rot0.get(it.id) || 0) + ang;
                }
                ui.rotDeg.value = Math.round((leafs[0]?.rot || 0));
                api.draw && api.draw();
                api.updateGhost && api.updateGhost();
            }
            return;
        }
        if (state.drawing) {
            if (state.drawing.kind === 'line') state.drawing.p2 = mp;
            else if (state.drawing.kind === 'quadratic') {
                if (state.drawing.stage === 1) state.drawing.p2 = mp;
                else if (state.drawing.stage === 2) state.drawing.cp = mp;
            } else if (state.drawing.kind === 'shape') {
                if (state.drawing._isEllipse) {
                    state.drawing._edge = mp;
                    const cx = state.drawing._center.x;
                    const cy = state.drawing._center.y;
                    const rx = Math.abs(mp.x - cx);
                    const ry = Math.abs(mp.y - cy);
                    const N = 32;
                    const pts = [];
                    for (let i = 0; i < N; i++) {
                        const t = (i / N) * Math.PI * 2;
                        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
                    }
                    state.drawing.path = pts;
                } else if (state.drawing._isRect) {
                    const x1 = state.drawing.path[0].x;
                    const y1 = state.drawing.path[0].y;
                    const x2 = mp.x;
                    const y2 = mp.y;
                    state.drawing.path = [
                        { x: x1, y: y1 },
                        { x: x2, y: y1 },
                        { x: x2, y: y2 },
                        { x: x1, y: y2 }
                    ];
                }
            }
            api.draw && api.draw();
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
                    color: ui.strokeColor.value,
                    width: +ui.strokeWidth.value
                };
            } else {
                commitDrawing();
            }
            api.draw && api.draw();
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
                    color: ui.strokeColor.value,
                    width: +ui.strokeWidth.value,
                    stage: 1
                };
            } else {
                if (state.drawing.stage === 1) {
                    state.drawing.stage = 2;
                    state.drawing.p2 = mp;
                } else {
                    state.drawing.cp = mp;
                    commitDrawing();
                }
            }
            api.draw && api.draw();
            return;
        }
        if (state.tool === 'rect') {
            if (!state.drawing) {
                state.drawing = {
                    id: rndId('r'),
                    kind: 'shape',
                    path: [mp, mp, mp, mp],
                    color: ui.strokeColor.value,
                    width: (ui.fillMode?.value === 'fill' ? 0 : +ui.strokeWidth.value),
                    fill: (ui.fillMode?.value === 'hollow' ? null : ui.fillColor.value),
                    _isRect: true
                };
            } else {
                commitDrawing();
            }
            api.draw && api.draw();
            return;
        }
        if (state.tool === 'ellipse') {
            if (!state.drawing) {
                state.drawing = {
                    id: rndId('e'),
                    kind: 'shape',
                    path: [mp],
                    color: ui.strokeColor.value,
                    width: (ui.fillMode?.value === 'fill' ? 0 : +ui.strokeWidth.value),
                    fill: (ui.fillMode?.value === 'hollow' ? null : ui.fillColor.value),
                    _center: mp,
                    _edge: mp,
                    _isEllipse: true
                };
            } else {
                commitDrawing();
            }
            api.draw && api.draw();
            return;
        }
        if (state.tool === 'move') {
            const hitId = hitTestItem(mp);
            if (hitId && !state.selected.has(hitId)) api.ensureSelected && api.ensureSelected(hitId, e.shiftKey);
            if (state.selected.size) {
                ctx.dragging = { type: 'move', start: mp };
                api.pushHistory && api.pushHistory();
            }
            return;
        }
        if (state.tool === 'select') {
            const hit = hitTestHandle(mp);
            if (hit) {
                api.ensureSelected && api.ensureSelected(hit.id, e.shiftKey);
                ctx.dragging = { type: 'handle', id: hit.id, keyIndex: hit.keyIndex };
                api.pushHistory && api.pushHistory();
                return;
            }
            const box = api.selectionBBox ? api.selectionBBox() : null;
            if (box && mp.x >= box.x && mp.x <= box.x + box.w && mp.y >= box.y && mp.y <= box.y + box.h) {
                ctx.dragging = { type: 'move', start: mp };
                api.pushHistory && api.pushHistory();
                return;
            }
            const hitId = hitTestItem(mp);
            if (hitId) {
                api.ensureSelected && api.ensureSelected(hitId, e.shiftKey);
                api.draw && api.draw();
            } else {
                if (!e.shiftKey) state.selected.clear();
                api.draw && api.draw();
            }
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Control') keys.ctrl = true;
        if (e.key === 'Shift') keys.shift = true;
        if (e.key === 'Escape') cancelDrawing();
        if (e.key === 'Delete') api.deleteSelection && api.deleteSelection();
        if (e.key === 'Enter' && state.drawing) {
            e.preventDefault();
            commitDrawing();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            api.undo && api.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
            e.preventDefault();
            api.redo && api.redo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
            e.preventDefault();
            api.groupSelection && api.groupSelection();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
            e.preventDefault();
            api.ungroupSelection && api.ungroupSelection();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') keys.ctrl = false;
        if (e.key === 'Shift') keys.shift = false;
    });

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', () => {
        ctx.dragging = null;
        ui.rotHandle.style.cursor = 'grab';
    });

    const exposed = {
        mousePos,
        snapIfNeeded,
        commitDrawing,
        cancelDrawing,
        hitTestHandle,
        hitTestItem,
        pointNearItem
    };

    Object.assign(api, exposed);
    return { exposed };
}

export { registerInput };
