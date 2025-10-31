/**
 * @fileoverview Maintains selection state, tool management, and shape
 * construction utilities used throughout LinePack Pro editing workflows.
 */

function registerSelection(ctx) {
    const { state, ui, utils, canvas, api } = ctx;
    const { rndId, dist } = utils;

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

    function applyStyle() {
        const mode = ui.fillMode?.value || 'solid';
        const strokeCol = ui.strokeColor.value;
        const strokeW = +ui.strokeWidth.value || 1;
        api.pushHistory && api.pushHistory();
        for (const it of selectionLeafItems()) {
            it.color = strokeCol;
            if (it.kind === 'shape') {
                if (mode === 'hollow') {
                    it.fill = null;
                    it.width = strokeW;
                } else if (mode === 'solid') {
                    it.fill = ui.fillColor.value;
                    it.width = strokeW;
                } else if (mode === 'fill') {
                    it.fill = ui.fillColor.value;
                    it.width = 0;
                }
            } else {
                it.width = strokeW;
            }
        }
        api.draw && api.draw();
        api.refreshElemList && api.refreshElemList();
    }

    function ungroupSelection() {
        const groups = (api.itemsByIds ? api.itemsByIds([...state.selected]) : []).filter(it => it.kind === 'group');
        if (groups.length === 0) return;
        api.pushHistory && api.pushHistory();
        for (const group of groups) {
            state.items = state.items.filter(it => it.id !== group.id);
            state.selected.delete(group.id);
        }
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
    }

    function renameSelected() {
        const selected = [...state.selected];
        if (selected.length !== 1) return;
        const item = state.items.find(it => it.id === selected[0]);
        if (!item) return;
        const row = document.querySelector(`.row[data-id="${item.id}"]`);
        if (!row) return;
        const title = row.querySelector('.title');
        if (!title) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = item.name || niceName(item);
        input.className = 'name-edit';
        title.replaceWith(input);
        input.focus();
        input.addEventListener('blur', () => {
            item.name = input.value.trim() || niceName(item);
            api.refreshElemList && api.refreshElemList();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
        });
    }

    function niceName(it) {
        return it.name || (it.kind === 'line' ? 'خط' : it.kind === 'quadratic' ? 'منحنی' : 'شکل');
    }

    function setTool(t) {
        state.tool = t;
        canvas.style.cursor = (t === 'select') ? 'default' : 'crosshair';
        api.draw && api.draw();
    }

    function ensureSelected(id, add) {
        if (!add) state.selected.clear();
        state.selected.add(id);
        api.refreshElemList && api.refreshElemList();
        api.updateGhost && api.updateGhost();
        api.updateFillVisibility && api.updateFillVisibility();
    }

    function deleteSelection() {
        if (!state.selected.size) return;
        api.pushHistory && api.pushHistory();
        state.items = state.items.filter(it => !state.selected.has(it.id));
        state.selected.clear();
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
    }

    function buildShapeFromSelection() {
        const ids = [...state.selected];
        if (ids.length < 2) return;
        const shape = tryBuildClosedShape(ids);
        if (shape) {
            api.pushHistory && api.pushHistory();
            state.items.push(shape);
            api.refreshElemList && api.refreshElemList();
            api.draw && api.draw();
        }
    }

    function tryBuildClosedShape(ids) {
        const pts = [];
        const seen = new Set();
        const edges = [];
        for (const id of ids) {
            const item = state.items.find(it => it.id === id);
            if (!item) continue;
            if (item.kind === 'line') {
                pts.push(item.p1, item.p2);
                edges.push([item.p1, item.p2]);
            } else if (item.kind === 'quadratic') {
                const N = 32;
                let prev = item.p1;
                for (let i = 1; i <= N; i++) {
                    const t = i / N;
                    const x = (1 - t) * (1 - t) * item.p1.x + 2 * (1 - t) * t * item.cp.x + t * t * item.p2.x;
                    const y = (1 - t) * (1 - t) * item.p1.y + 2 * (1 - t) * t * item.cp.y + t * t * item.p2.y;
                    const pt = { x, y };
                    pts.push(pt);
                    edges.push([prev, pt]);
                    prev = pt;
                }
            } else if (item.kind === 'shape') {
                for (let i = 0; i < item.path.length; i++) {
                    const a = item.path[i];
                    const b = item.path[(i + 1) % item.path.length];
                    edges.push([a, b]);
                    pts.push(a, b);
                }
            }
        }
        if (!pts.length) return null;
        const adj = new Map();
        for (const [a, b] of edges) {
            const getKey = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;
            const ka = getKey(a);
            const kb = getKey(b);
            if (!adj.has(ka)) adj.set(ka, { pt: a, next: new Set() });
            if (!adj.has(kb)) adj.set(kb, { pt: b, next: new Set() });
            adj.get(ka).next.add(kb);
            adj.get(kb).next.add(ka);
        }

        function findCycle() {
            for (const [key, entry] of adj.entries()) {
                const stack = [[key, null, [key]]];
                const visited = new Set();
                while (stack.length) {
                    const [curr, parent, path] = stack.pop();
                    if (path.length > 2) {
                        for (const nxt of adj.get(curr)?.next || []) {
                            if (nxt === path[0] && path.length >= 3) {
                                return path.map(k => adj.get(k)?.pt).filter(Boolean);
                            }
                        }
                    }
                    for (const nxt of adj.get(curr)?.next || []) {
                        if (nxt === parent) continue;
                        const marker = `${curr}-${nxt}-${path.length}`;
                        if (visited.has(marker)) continue;
                        visited.add(marker);
                        stack.push([nxt, curr, [...path, nxt]]);
                    }
                }
            }
            return null;
        }

        const polygon = findCycle();
        if (!polygon) return null;
        const color = ui.strokeColor.value;
        const fill = ui.fillColor.value;
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

    function approxSamePoly(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (dist(a[i], b[i]) > 8) return false;
        }
        return true;
    }

    function autoDetectClosedShapes() {
        const lineIds = state.items.filter(it => it.kind === 'line').map(it => it.id);
        if (lineIds.length < 3) return;
        const shape = tryBuildClosedShape(lineIds);
        if (shape) {
            const exists = state.items.some(it => it.kind === 'shape' && approxSamePoly(it.path, shape.path));
            if (!exists) {
                state.items.push(shape);
                api.refreshElemList && api.refreshElemList();
                api.draw && api.draw();
            }
        }
    }

    const exposed = {
        applyStyle,
        selectionLeafItems,
        ungroupSelection,
        renameSelected,
        setTool,
        ensureSelected,
        deleteSelection,
        buildShapeFromSelection,
        autoDetectClosedShapes,
        approxSamePoly
    };

    Object.assign(api, exposed);
    return { exposed };
}

export { registerSelection };
