/**
 * @fileoverview Manages import and export operations for LinePack Pro packs,
 * including JSON serialization, minified saves, and PNG rendering helpers.
 */

function registerFileSystem(ctx) {
    const { state, ui, canvas, api, utils } = ctx;
    const { rndId } = utils;

    function exportPack(minimal = false) {
        const { w, h } = api.getCSSSize ? api.getCSSSize() : { w: canvas.width, h: canvas.height };
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
            size: { w, h },
            elements: els,
            animations: anims
        };
    }

    function exportSummary() {
        const { w, h } = api.getCSSSize ? api.getCSSSize() : { w: canvas.width, h: canvas.height };
        const fmt = (p) => {
            if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
            return { x: +(p.x / w).toFixed(3), y: +(p.y / h).toFixed(3) };
        };

        function summarizeShapeEdges(it) {
            const segs = Array.isArray(it.segments) && it.segments.length
                ? it.segments
                : buildEdgesFromPath(it.path);
            return segs.map(seg => {
                if (!seg || !seg.p1 || !seg.p2) return null;
                if (seg.kind === 'quadratic' && seg.cp) {
                    return {
                        kind: 'quadratic',
                        p1: fmt(seg.p1),
                        cp: fmt(seg.cp),
                        p2: fmt(seg.p2)
                    };
                }
                return {
                    kind: 'line',
                    p1: fmt(seg.p1),
                    p2: fmt(seg.p2)
                };
            }).filter(Boolean);
        }

        function buildEdgesFromPath(path) {
            if (!Array.isArray(path) || path.length < 2) return [];
            const edges = [];
            for (let i = 0; i < path.length; i++) {
                const p1 = path[i];
                const p2 = path[(i + 1) % path.length];
                if (p1 && p2 && (p1.x !== p2.x || p1.y !== p2.y)) {
                    edges.push({ kind: 'line', p1, p2 });
                }
            }
            return edges;
        }

        const items = state.items.map(it => {
            const base = {
                id: it.id,
                kind: it.kind,
                color: it.color,
                width: +it.width,
                visible: it.visible !== false
            };
            if (it.kind === 'line') {
                return {
                    ...base,
                    edges: [{ kind: 'line', p1: fmt(it.p1), p2: fmt(it.p2) }]
                };
            }
            if (it.kind === 'quadratic') {
                return {
                    ...base,
                    edges: [{ kind: 'quadratic', p1: fmt(it.p1), cp: fmt(it.cp), p2: fmt(it.p2) }]
                };
            }
            if (it.kind === 'shape') {
                return {
                    ...base,
                    fill: it.fill || null,
                    edges: summarizeShapeEdges(it)
                };
            }
            if (it.kind === 'group') {
                return {
                    ...base,
                    children: Array.isArray(it.children) ? it.children.slice() : []
                };
            }
            return base;
        });

        const animations = state.animations.map(a => ({
            name: a.name,
            duration: a.duration,
            keyframes: a.keyframes.map(k => ({
                t: k.t,
                elements: k.snapshot.map(it => it.id)
            }))
        }));

        return {
            type: 'LinePackSummary',
            version: 1,
            size: { w, h },
            items,
            animations
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
        const norm = p => ({ x: +(p.x / w).toFixed(min ? 3 : 6), y: +(p.y / h).toFixed(min ? 3 : 6) });
        if (it.kind === 'line') return { ...base, points: { p1: norm(it.p1), p2: norm(it.p2) } };
        if (it.kind === 'quadratic') return { ...base, points: { p1: norm(it.p1), cp: norm(it.cp), p2: norm(it.p2) } };
        if (it.kind === 'shape') {
            const segs = Array.isArray(it.segments) ? it.segments.map(seg => {
                if (!seg || !seg.p1 || !seg.p2) return null;
                if (seg.kind === 'quadratic' && seg.cp) {
                    return { kind: 'quadratic', p1: norm(seg.p1), cp: norm(seg.cp), p2: norm(seg.p2) };
                }
                return { kind: 'line', p1: norm(seg.p1), p2: norm(seg.p2) };
            }).filter(Boolean) : null;
            const out = { ...base, fill: it.fill || null, path: it.path.map(norm), children: it.children || [] };
            if (segs && segs.length) out.segments = segs;
            return out;
        }
        if (it.kind === 'group') return { ...base, children: it.children?.slice() || [] };
        return base;
    }

    function importPack(pack) {
        if (!pack || pack.type !== 'LinePack') throw new Error('LinePack v2 معتبر نیست');
        const size = pack.size || { w: canvas.width, h: canvas.height };
        const den = (p) => ({ x: p.x * size.w, y: p.y * size.h });

        state.animations = (pack.animations || []).map(a => ({
            id: rndId('anim'),
            name: a.name,
            duration: a.duration,
            keyframes: (a.keyframes || []).map(k => ({
                t: k.t,
                snapshot: (k.snapshot || []).map(el => deserializeItem(el, size))
            }))
        }));

        state.items = (pack.elements || []).map(el => deserializeItem(el, size));
        state.currentAnimId = state.animations[0]?.id || null;
        state.tl.previewing = false;
        state.tl.previewBackup = null;
        state.tl.sec = 0;
        state.tl.playing = false;
        api.refreshAnimSelect && api.refreshAnimSelect();
        api.renderKeyframeList && api.renderKeyframeList();
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
        api.rebuildTicks && api.rebuildTicks();
        api.placeCursor && api.placeCursor();
    }

    function deserializeItem(el, size) {
        const den = (p) => ({ x: p.x * size.w, y: p.y * size.h });
        const base = {
            id: el.id || rndId('it'),
            kind: el.kind,
            color: el.style?.color || '#fff',
            width: +(el.style?.width || 3),
            rot: +(el.style?.rot || 0),
            visible: el.style?.visible !== false
        };
        if (el.kind === 'line') {
            return { ...base, p1: den(el.points.p1), p2: den(el.points.p2) };
        }
        if (el.kind === 'quadratic') {
            return { ...base, p1: den(el.points.p1), cp: den(el.points.cp), p2: den(el.points.p2) };
        }
        if (el.kind === 'shape') {
            const segs = Array.isArray(el.segments) ? el.segments.map(seg => {
                if (!seg || !seg.p1 || !seg.p2) return null;
                if (seg.kind === 'quadratic' && seg.cp) {
                    return { kind: 'quadratic', p1: den(seg.p1), cp: den(seg.cp), p2: den(seg.p2) };
                }
                return { kind: 'line', p1: den(seg.p1), p2: den(seg.p2) };
            }).filter(Boolean) : [];
            const shape = { ...base, path: (el.path || []).map(den), fill: el.fill || null, children: el.children || [] };
            if (segs.length) shape.segments = segs;
            return shape;
        }
        if (el.kind === 'group') {
            return { ...base, children: el.children?.slice() || [] };
        }
        return { ...base };
    }

    function downloadBlob(text, name) {
        const blob = new Blob([text], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 800);
    }

    ui.saveJSON.addEventListener('click', () => {
        const data = exportSummary();
        downloadBlob(JSON.stringify(data, null, 2), 'drawing.summary.json');
    });

    ui.saveJSONMin.addEventListener('click', () => {
        const data = exportPack(true);
        downloadBlob(JSON.stringify(data), 'drawing.min.linepack.json');
    });

    ui.exportPNG.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'canvas.png';
        link.click();
    });

    ui.fileInput.addEventListener('change', async (e) => {
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

    ui.clear.addEventListener('click', () => {
        if (confirm('همه چیز پاک شود؟')) {
            api.pushHistory && api.pushHistory();
            state.items = [];
            state.selected.clear();
            api.draw && api.draw();
            api.refreshElemList && api.refreshElemList();
        }
    });

    const exposed = { exportPack, importPack, downloadBlob, exportSummary };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerFileSystem };
