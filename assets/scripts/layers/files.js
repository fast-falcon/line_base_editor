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
        if (it.kind === 'shape') return { ...base, fill: it.fill || null, path: it.path.map(norm), children: it.children || [] };
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
        api.refreshAnimSelect && api.refreshAnimSelect();
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
            return { ...base, path: (el.path || []).map(den), fill: el.fill || null, children: el.children || [] };
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
        const data = exportPack(false);
        downloadBlob(JSON.stringify(data, null, 2), 'drawing.linepack.json');
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

    const exposed = { exportPack, importPack, downloadBlob };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerFileSystem };
