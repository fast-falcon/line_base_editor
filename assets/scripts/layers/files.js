/**
 * @fileoverview Manages import and export operations for LinePack Pro packs,
 * including JSON serialization, minified saves, and PNG rendering helpers.
 */

function registerFileSystem(ctx) {
    const { state, ui, canvas, api, utils } = ctx;
    const { rndId } = utils;

    const PRECISION = 3;
    const EPSILON = 1e-3;

    const normPoint = (p, w, h) => {
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
        return [+(p.x / w).toFixed(PRECISION), +(p.y / h).toFixed(PRECISION)];
    };

    const denormPoint = (pt, size) => {
        if (!Array.isArray(pt) || pt.length < 2) return null;
        const x = Number.isFinite(pt[0]) ? pt[0] : 0;
        const y = Number.isFinite(pt[1]) ? pt[1] : 0;
        return { x: x * size.w, y: y * size.h };
    };

    const simplifySegments = (shape, w, h) => {
        const src = Array.isArray(shape.segments) && shape.segments.length
            ? shape.segments
            : (() => {
                const path = Array.isArray(shape.path) ? shape.path : [];
                if (path.length < 2) return [];
                const segs = [];
                for (let i = 0; i < path.length; i++) {
                    const p1 = path[i];
                    const p2 = path[(i + 1) % path.length];
                    if (!p1 || !p2) continue;
                    if (p1.x === p2.x && p1.y === p2.y) continue;
                    segs.push({ kind: 'line', p1, p2 });
                }
                return segs;
            })();
        return src.map(seg => {
            if (!seg || !seg.p1 || !seg.p2) return null;
            const start = normPoint(seg.p1, w, h);
            const end = normPoint(seg.p2, w, h);
            if (!start || !end) return null;
            if (seg.kind === 'quadratic' && seg.cp) {
                const control = normPoint(seg.cp, w, h);
                if (!control) return { type: 'line', start, end };
                return { type: 'curve', start, control, end };
            }
            return { type: 'line', start, end };
        }).filter(Boolean);
    };

    const simplifyItem = (it, w, h) => {
        if (!it) return null;
        const base = {
            id: it.id,
            type: it.kind,
            color: it.color,
            width: +it.width,
            visible: it.visible !== false,
            rotation: +(it.rot || 0)
        };
        if (it.kind === 'group') {
            return {
                ...base,
                children: Array.isArray(it.children) ? it.children.slice() : []
            };
        }
        if (it.kind === 'line') {
            const start = normPoint(it.p1, w, h);
            const end = normPoint(it.p2, w, h);
            const geometry = start && end ? [{ type: 'line', start, end }] : [];
            const out = { ...base };
            if (geometry.length) out.geometry = geometry;
            return out;
        }
        if (it.kind === 'quadratic') {
            const start = normPoint(it.p1, w, h);
            const end = normPoint(it.p2, w, h);
            const control = normPoint(it.cp, w, h);
            const geometry = (start && end && control)
                ? [{ type: 'curve', start, control, end }]
                : [];
            const out = { ...base };
            if (geometry.length) out.geometry = geometry;
            return out;
        }
        if (it.kind === 'shape') {
            const path = Array.isArray(it.path)
                ? it.path.map(p => normPoint(p, w, h)).filter(Boolean)
                : [];
            const geometry = simplifySegments(it, w, h);
            const children = Array.isArray(it.children) ? it.children.slice() : [];
            const out = {
                ...base,
                type: 'shape',
                fill: it.fill || null,
                path,
                children
            };
            if (geometry.length) out.geometry = geometry;
            return out;
        }
        return base;
    };

    const inflateSegment = (seg, size) => {
        if (!seg) return null;
        const start = denormPoint(seg.start, size);
        const end = denormPoint(seg.end, size);
        if (!start || !end) return null;
        if ((seg.type === 'curve' || seg.type === 'quadratic') && seg.control) {
            const control = denormPoint(seg.control, size);
            if (!control) return { kind: 'line', p1: start, p2: end };
            return { kind: 'quadratic', p1: start, cp: control, p2: end };
        }
        return { kind: 'line', p1: start, p2: end };
    };

    const inflateItem = (entry, size) => {
        if (!entry) return null;
        const type = entry.type || entry.kind;
        const base = {
            id: entry.id || rndId('it'),
            kind: type === 'curve' ? 'quadratic' : type,
            color: entry.color || '#fff',
            width: +(entry.width ?? 3),
            rot: +(entry.rotation || 0),
            visible: entry.visible !== false
        };
        if (base.kind === 'group') {
            return {
                ...base,
                children: Array.isArray(entry.children) ? entry.children.slice() : []
            };
        }
        if (base.kind === 'line') {
            const geom = Array.isArray(entry.geometry) ? entry.geometry[0] : null;
            const start = geom?.start || entry.start;
            const end = geom?.end || entry.end;
            const p1 = denormPoint(start, size);
            const p2 = denormPoint(end, size);
            if (!p1 || !p2) return null;
            return { ...base, p1, p2 };
        }
        if (base.kind === 'quadratic') {
            const geom = Array.isArray(entry.geometry) ? entry.geometry[0] : null;
            const start = geom?.start || entry.start;
            const end = geom?.end || entry.end;
            const control = geom?.control || entry.control || entry.cp;
            const p1 = denormPoint(start, size);
            const p2 = denormPoint(end, size);
            const cp = denormPoint(control, size);
            if (!p1 || !p2 || !cp) return null;
            return { ...base, p1, p2, cp };
        }
        if (base.kind === 'shape') {
            const path = Array.isArray(entry.path)
                ? entry.path.map(pt => denormPoint(pt, size)).filter(Boolean)
                : [];
            const geometry = Array.isArray(entry.geometry)
                ? entry.geometry.map(seg => inflateSegment(seg, size)).filter(Boolean)
                : [];
            const children = Array.isArray(entry.children) ? entry.children.slice() : [];
            const shape = {
                ...base,
                path,
                fill: entry.fill || null,
                children
            };
            if (!shape.path.length && geometry.length) {
                const pts = [];
                geometry.forEach(seg => {
                    if (!pts.length || pts[pts.length - 1].x !== seg.p1.x || pts[pts.length - 1].y !== seg.p1.y) {
                        pts.push({ x: seg.p1.x, y: seg.p1.y });
                    }
                });
                if (geometry.length) {
                    const last = geometry[geometry.length - 1].p2;
                    if (!pts.length || pts[0].x !== last.x || pts[0].y !== last.y) pts.push({ x: last.x, y: last.y });
                }
                shape.path = pts;
            }
            if (geometry.length) shape.segments = geometry;
            return shape;
        }
        return base;
    };

    const normalizeKeyframes = (data) => {
        if (!data) return [];
        if (Array.isArray(data)) {
            return data.map(k => {
                const time = +(k.time ?? k.t ?? 0);
                if (!Number.isFinite(time)) return null;
                const state = k.state ? k.state : (() => {
                    const copy = { ...k };
                    delete copy.time;
                    delete copy.t;
                    return copy;
                })();
                return state ? { time, state } : null;
            }).filter(Boolean);
        }
        if (typeof data === 'object') {
            return Object.entries(data).map(([time, state]) => {
                const t = +time;
                if (!Number.isFinite(t)) return null;
                return state ? { time: t, state } : null;
            }).filter(Boolean);
        }
        return [];
    };

    const normalizeTimelines = (anim) => {
        const raw = anim?.timelines ?? anim?.tracks ?? [];
        if (Array.isArray(raw)) {
            return raw.map(track => {
                const item = track.item || track.id || track.target || track.shape || track.name;
                const keyframes = normalizeKeyframes(track.keyframes);
                if (!item || !keyframes.length) return null;
                keyframes.sort((a, b) => a.time - b.time);
                return { item, keyframes };
            }).filter(Boolean);
        }
        if (raw && typeof raw === 'object') {
            return Object.entries(raw).map(([item, value]) => {
                const keyframes = normalizeKeyframes(value);
                if (!keyframes.length) return null;
                keyframes.sort((a, b) => a.time - b.time);
                return { item, keyframes };
            }).filter(Boolean);
        }
        return [];
    };

    const findFrame = (frames, time) => {
        return frames.find(k => Math.abs(k.time - time) < EPSILON) || null;
    };

    const applyImportedState = (items, animations) => {
        state.animations = animations;
        state.items = items;
        state.currentAnimId = state.animations[0]?.id || null;
        state.selected && state.selected.clear && state.selected.clear();
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
    };

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
        const items = state.items
            .map(it => simplifyItem(it, w, h))
            .filter(Boolean);

        const animations = state.animations.map(anim => {
            const trackMap = new Map();
            (anim.keyframes || []).forEach(kf => {
                const time = +kf.t;
                (kf.snapshot || []).forEach(item => {
                    const frames = trackMap.get(item.id) || [];
                    const simplified = simplifyItem(item, w, h);
                    if (!simplified) return;
                    const existing = frames.find(f => Math.abs(f.time - time) < EPSILON);
                    if (existing) {
                        existing.state = simplified;
                    } else {
                        frames.push({ time, state: simplified });
                    }
                    trackMap.set(item.id, frames);
                });
            });
            const timelines = Array.from(trackMap.entries()).map(([item, frames]) => ({
                item,
                keyframes: frames
                    .filter(f => f && typeof f.time === 'number')
                    .sort((a, b) => a.time - b.time)
            })).filter(tl => tl.keyframes.length);
            return {
                name: anim.name,
                duration: anim.duration,
                timelines
            };
        });

        return {
            type: 'LinePackSummary',
            version: 2,
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
        if (!pack || typeof pack !== 'object') throw new Error('فایل معتبر نیست');
        if (pack.type === 'LinePack') {
            importFullPack(pack);
            return;
        }
        if (pack.type === 'LinePackSummary') {
            importSummaryPack(pack);
            return;
        }
        throw new Error('نوع فایل پشتیبانی نمی‌شود');
    }

    function importFullPack(pack) {
        const size = pack.size || { w: canvas.width, h: canvas.height };
        const animations = (pack.animations || []).map(a => ({
            id: rndId('anim'),
            name: a.name,
            duration: a.duration,
            keyframes: (a.keyframes || []).map(k => ({
                t: k.t,
                snapshot: (k.snapshot || []).map(el => deserializeItem(el, size)).filter(Boolean)
            }))
        }));
        const items = (pack.elements || []).map(el => deserializeItem(el, size)).filter(Boolean);
        applyImportedState(items, animations);
    }

    function importSummaryPack(pack) {
        const size = pack.size || { w: canvas.width, h: canvas.height };
        const items = (pack.items || []).map(entry => inflateItem(entry, size)).filter(Boolean);
        const animations = (pack.animations || []).map(anim => {
            const timelines = normalizeTimelines(anim);
            if (!timelines.length) {
                return {
                    id: rndId('anim'),
                    name: anim.name || 'Animation',
                    duration: +(anim.duration || 5),
                    keyframes: []
                };
            }
            const timeSet = new Set();
            timelines.forEach(track => {
                track.keyframes.forEach(kf => timeSet.add(+kf.time || 0));
            });
            const times = Array.from(timeSet).sort((a, b) => a - b);
            const keyframes = times.map(time => {
                const snapshot = [];
                timelines.forEach(track => {
                    const frame = findFrame(track.keyframes, time);
                    if (!frame) return;
                    const stateData = { ...frame.state };
                    stateData.id = stateData.id || track.item;
                    stateData.type = stateData.type || stateData.kind;
                    stateData.kind = stateData.kind || stateData.type;
                    const item = inflateItem(stateData, size);
                    if (item) snapshot.push(item);
                });
                return { t: time, snapshot };
            }).filter(kf => kf.snapshot.length);
            return {
                id: rndId('anim'),
                name: anim.name || 'Animation',
                duration: +(anim.duration || 5),
                keyframes
            };
        });
        applyImportedState(items, animations);
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
        downloadBlob(JSON.stringify(data, null, 2), 'drawing.simple.json');
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
