/**
 * @fileoverview Lightweight runtime-only renderer that can replay exported
 * LinePack packs on an arbitrary canvas element without loading the authoring
 * UI. The class reads the JSON file, adapts it to the canvas size, and exposes
 * helpers to inspect or tweak animations programmatically.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lpt = (A, B, t) => ({
    x: lerp(A.x, B.x, t),
    y: lerp(A.y, B.y, t)
});
const itemCenter = (it) => {
    const pts = [];
    if (it.kind === 'line') {
        pts.push(it.p1, it.p2);
    } else if (it.kind === 'quadratic') {
        pts.push(it.p1, it.cp, it.p2);
    } else if (it.kind === 'shape') {
        pts.push(...(Array.isArray(it.path) ? it.path : []));
    }
    if (!pts.length) return { x: 0, y: 0 };
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2
    };
};

const EPSILON = 1e-4;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const KIND_ALIASES = {
    l: 'line',
    line: 'line',
    ln: 'line',
    q: 'quadratic',
    quad: 'quadratic',
    quadratic: 'quadratic',
    c: 'quadratic',
    curve: 'quadratic',
    s: 'shape',
    sh: 'shape',
    shape: 'shape',
    g: 'group',
    grp: 'group',
    group: 'group'
};

function toPoint(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        if (value.length >= 2 && typeof value[0] !== 'object' && typeof value[1] !== 'object') {
            const x = +value[0];
            const y = +value[1];
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        }
        if (Array.isArray(value[0])) {
            return toPoint(value[0]);
        }
        if (typeof value[0] === 'object') {
            return toPoint(value[0]);
        }
        return null;
    }
    if (typeof value === 'object') {
        const x = value.x ?? value[0];
        const y = value.y ?? value[1];
        if (x === undefined || y === undefined) return null;
        const px = +x;
        const py = +y;
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        return { x: px, y: py };
    }
    return null;
}

function expandPath(pathSource) {
    if (!Array.isArray(pathSource)) return [];
    if (!pathSource.length) return [];
    if (typeof pathSource[0] === 'number') {
        const out = [];
        for (let i = 0; i < pathSource.length - 1; i += 2) {
            const pt = toPoint([pathSource[i], pathSource[i + 1]]);
            if (pt) out.push(pt);
        }
        return out;
    }
    return pathSource.map(pt => toPoint(pt)).filter(Boolean);
}

function expandCompactItem(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) {
        const [id, kind, payload] = entry;
        const obj = { i: id, k: kind };
        if (payload !== undefined) obj.p = payload;
        entry = obj;
    }
    if (typeof entry !== 'object') return null;
    const id = entry.id ?? entry.i ?? entry.name ?? null;
    if (!id) return null;
    const kindRaw = entry.kind ?? entry.type ?? entry.k ?? 'line';
    const kind = KIND_ALIASES[kindRaw] ?? kindRaw;
    const base = { id, type: kind, kind };

    const styleSource = typeof entry.style === 'object' && entry.style
        ? { ...entry.style }
        : {};
    if ('c' in entry && styleSource.color === undefined) styleSource.color = entry.c;
    if ('color' in entry && styleSource.color === undefined) styleSource.color = entry.color;
    if ('w' in entry && styleSource.width === undefined) styleSource.width = entry.w;
    if ('width' in entry && styleSource.width === undefined) styleSource.width = entry.width;
    if ('r' in entry && styleSource.rot === undefined) styleSource.rot = entry.r;
    if ('rot' in entry && styleSource.rot === undefined) styleSource.rot = entry.rot;
    if ('rotation' in entry && styleSource.rot === undefined) styleSource.rot = entry.rotation;
    if ('v' in entry && styleSource.visible === undefined) styleSource.visible = entry.v;
    if ('visible' in entry && styleSource.visible === undefined) styleSource.visible = entry.visible;
    const fillValue = entry.fill ?? entry.f ?? styleSource.fill;
    if (fillValue !== undefined) {
        base.fill = fillValue;
        delete styleSource.fill;
    }
    if (styleSource.width !== undefined) {
        const w = +styleSource.width;
        styleSource.width = Number.isFinite(w) ? w : undefined;
    }
    if (styleSource.rot !== undefined) {
        const r = +styleSource.rot;
        styleSource.rot = Number.isFinite(r) ? r : undefined;
    }
    if (styleSource.visible !== undefined) {
        styleSource.visible = !!styleSource.visible;
    }
    Object.keys(styleSource).forEach(key => {
        if (styleSource[key] === undefined) delete styleSource[key];
    });
    if (Object.keys(styleSource).length) base.style = styleSource;

    const points = entry.points ?? entry.p;
    if (kind === 'line' || kind === 'quadratic') {
        let start = entry.start ?? entry.s;
        let end = entry.end ?? entry.e;
        let control = entry.control ?? entry.cp ?? entry.ctrl ?? entry.q;
        if ((!start || !end) && points) {
            if (Array.isArray(points)) {
                if (points.length >= 4 && typeof points[0] === 'number') {
                    start = [points[0], points[1]];
                    end = [points[2], points[3]];
                    if (points.length >= 6) control = [points[4], points[5]];
                } else if (points.length >= 2 && Array.isArray(points[0])) {
                    start = points[0];
                    end = points[1];
                    if (points.length >= 3) control = points[2];
                } else if (typeof points[0] === 'object') {
                    start = points[0];
                    end = points[1];
                    if (points.length >= 3) control = points[2];
                }
            } else if (typeof points === 'object') {
                start = points.p1 ?? points.start ?? points.a ?? start;
                end = points.p2 ?? points.end ?? points.b ?? end;
                control = points.cp ?? points.control ?? points.c ?? control;
            }
        }
        const startPt = toPoint(start);
        const endPt = toPoint(end);
        if (startPt) base.start = startPt;
        if (endPt) base.end = endPt;
        if (kind === 'quadratic') {
            const cp = toPoint(control);
            if (cp) base.control = cp;
        }
    } else if (kind === 'shape') {
        const path = expandPath(points ?? entry.path);
        if (path.length) base.path = path;
        if (Array.isArray(entry.segments)) base.segments = entry.segments;
        if (Array.isArray(entry.children)) base.children = entry.children.slice();
    } else if (kind === 'group') {
        if (Array.isArray(entry.children)) base.children = entry.children.slice();
    }
    return base;
}

function expandCompactKeyframe(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) {
        const [time, snapshot] = entry;
        entry = { t: time, s: snapshot };
    }
    if (typeof entry !== 'object') return null;
    const t = +(entry.t ?? entry.time ?? entry.sec ?? 0);
    if (!Number.isFinite(t)) return null;
    const snapshotSource = entry.snapshot ?? entry.s ?? entry.items ?? [];
    const snapshot = Array.isArray(snapshotSource)
        ? snapshotSource.map(expandCompactItem).filter(Boolean)
        : [];
    return { t, snapshot };
}

function expandCompactAnimation(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) {
        const [id, name, duration, keyframes] = entry;
        entry = { i: id, n: name, d: duration, k: keyframes };
    }
    if (typeof entry !== 'object') return null;
    const id = entry.id ?? entry.i ?? null;
    const name = entry.name ?? entry.n ?? id ?? 'Animation';
    const duration = +(entry.duration ?? entry.d ?? 5);
    const keyframesSource = entry.keyframes ?? entry.k ?? [];
    const keyframes = Array.isArray(keyframesSource)
        ? keyframesSource.map(expandCompactKeyframe).filter(Boolean)
        : [];
    return {
        id: id ?? `anim_${Math.random().toString(36).slice(2, 8)}`,
        name,
        duration,
        keyframes
    };
}

function expandCompactPack(pack) {
    if (!pack || typeof pack !== 'object') return pack;
    if (pack.type) return pack;
    if (!('t' in pack)) return pack;
    const typeMap = {
        LP: 'LinePack',
        LinePack: 'LinePack',
        LPS: 'LinePackSummary',
        LinePackSummary: 'LinePackSummary'
    };
    const type = typeMap[pack.t] ?? pack.type ?? 'LinePack';
    const sizeSource = pack.s ?? pack.size;
    let size = { w: 512, h: 512 };
    if (Array.isArray(sizeSource)) {
        size = {
            w: Number.isFinite(+sizeSource[0]) ? +sizeSource[0] : 512,
            h: Number.isFinite(+sizeSource[1]) ? +sizeSource[1] : 512
        };
    } else if (typeof sizeSource === 'object' && sizeSource) {
        const w = sizeSource.w ?? sizeSource.width ?? sizeSource[0];
        const h = sizeSource.h ?? sizeSource.height ?? sizeSource[1];
        size = {
            w: Number.isFinite(+w) ? +w : 512,
            h: Number.isFinite(+h) ? +h : 512
        };
    }
    const elementsSource = pack.e ?? pack.elements ?? [];
    const animationsSource = pack.a ?? pack.animations ?? [];
    const elements = Array.isArray(elementsSource)
        ? elementsSource.map(expandCompactItem).filter(Boolean)
        : [];
    const animations = Array.isArray(animationsSource)
        ? animationsSource.map(expandCompactAnimation).filter(Boolean)
        : [];
    return {
        type,
        version: +(pack.v ?? pack.version ?? 2),
        size,
        elements,
        animations
    };
}

function denormPoint(point, size) {
    if (!point) return null;
    return {
        x: (point.x ?? point[0] ?? 0) * size.w,
        y: (point.y ?? point[1] ?? 0) * size.h
    };
}

function inflateSegment(seg, size) {
    if (!seg) return null;
    const p1 = denormPoint(seg.p1 ?? seg.start, size);
    const p2 = denormPoint(seg.p2 ?? seg.end, size);
    if (!p1 || !p2) return null;
    if ((seg.kind === 'quadratic' || seg.type === 'curve') && (seg.cp || seg.control)) {
        const cp = denormPoint(seg.cp ?? seg.control, size);
        if (!cp) return { kind: 'line', p1, p2 };
        return { kind: 'quadratic', p1, cp, p2 };
    }
    return { kind: seg.kind ?? seg.type ?? 'line', p1, p2 };
}

function deserializeItem(entry, size) {
    if (!entry) return null;
    const kind = entry.kind ?? entry.type;
    const base = {
        id: entry.id,
        kind,
        color: entry.style?.color ?? entry.color ?? '#ffffff',
        width: +(entry.style?.width ?? entry.width ?? 3),
        rot: +(entry.style?.rot ?? entry.rotation ?? 0),
        visible: entry.style?.visible ?? entry.visible ?? true
    };

    if (kind === 'group') {
        return {
            ...base,
            children: Array.isArray(entry.children) ? entry.children.slice() : []
        };
    }

    if (kind === 'line') {
        const p1 = denormPoint(entry.points?.p1 ?? entry.start, size);
        const p2 = denormPoint(entry.points?.p2 ?? entry.end, size);
        if (!p1 || !p2) return null;
        return { ...base, p1, p2 };
    }

    if (kind === 'quadratic') {
        const p1 = denormPoint(entry.points?.p1 ?? entry.start, size);
        const cp = denormPoint(entry.points?.cp ?? entry.control, size);
        const p2 = denormPoint(entry.points?.p2 ?? entry.end, size);
        if (!p1 || !cp || !p2) return null;
        return { ...base, p1, cp, p2 };
    }

    if (kind === 'shape') {
        const pathSource = entry.path ?? entry.points ?? [];
        const path = Array.isArray(pathSource)
            ? pathSource.map(pt => denormPoint(pt, size)).filter(Boolean)
            : [];
        const segments = Array.isArray(entry.segments)
            ? entry.segments.map(seg => inflateSegment(seg, size)).filter(Boolean)
            : [];
        return {
            ...base,
            path,
            segments,
            fill: entry.fill ?? entry.style?.fill ?? null,
            children: Array.isArray(entry.children) ? entry.children.slice() : []
        };
    }

    return base;
}

function normalizeKeyframes(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
        return data
            .map(entry => {
                const time = +(entry.time ?? entry.t ?? entry.sec ?? 0);
                if (!Number.isFinite(time)) return null;
                const state = entry.state ?? entry.snapshot ?? (() => {
                    const copy = { ...entry };
                    delete copy.time;
                    delete copy.t;
                    delete copy.sec;
                    return copy;
                })();
                if (!state) return null;
                return { time, state };
            })
            .filter(Boolean);
    }
    if (typeof data === 'object') {
        return Object.entries(data)
            .map(([time, state]) => {
                const t = +time;
                if (!Number.isFinite(t)) return null;
                if (!state) return null;
                return { time: t, state };
            })
            .filter(Boolean);
    }
    return [];
}

function normalizeSummaryItem(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const copy = clone(entry);
    copy.id = copy.id ?? copy.name ?? copy.item ?? copy.uid;
    const type = copy.type ?? copy.kind;
    if (!copy.id || !type) return null;
    copy.type = type;
    copy.kind = copy.kind ?? type;
    return copy;
}

function findFrame(frames, time) {
    if (!frames) return null;
    if (frames instanceof Map) {
        for (const [t, value] of frames.entries()) {
            if (Math.abs(t - time) < EPSILON) return value;
        }
        return null;
    }
    if (Array.isArray(frames)) {
        return frames.find(k => Math.abs(k.time - time) < EPSILON) ?? null;
    }
    return null;
}

function applyDiff(base, diff) {
    const out = clone(base);
    if (!diff || typeof diff !== 'object') return out;
    Object.keys(diff).forEach(key => {
        const value = diff[key];
        if (value === undefined) delete out[key];
        else out[key] = clone(value);
    });
    return out;
}

function parseCompactTrack(track, simplifiedMap, size) {
    if (!track || typeof track !== 'object') return null;
    const itemId = track.item ?? track.id ?? track.target ?? track.shape ?? track.name;
    if (!itemId) return null;
    const baseSource = track.base ? normalizeSummaryItem(track.base) : clone(simplifiedMap.get(itemId));
    if (!baseSource) return null;
    const base = clone(baseSource);
    base.id = base.id ?? itemId;
    base.type = base.type ?? base.kind;
    base.kind = base.kind ?? base.type;
    const frames = normalizeKeyframes(track.keyframes ?? track.frames ?? track.timeline);
    if (!frames.length) return null;
    const frameMap = new Map();
    let last = base;
    frames
        .sort((a, b) => a.time - b.time)
        .forEach(({ time, state }) => {
            const next = (state === null || state === undefined)
                ? clone(last)
                : applyDiff(last, state);
            next.id = next.id ?? itemId;
            next.type = next.type ?? next.kind;
            next.kind = next.kind ?? next.type;
            const inflated = deserializeItem(next, size);
            if (inflated) frameMap.set(+time, inflated);
            last = next;
        });
    if (!frameMap.size) {
        const inflatedBase = deserializeItem(base, size);
        if (inflatedBase) frameMap.set(frames[0].time, inflatedBase);
    }
    return { id: itemId, frames: frameMap };
}

function rebuildCompactAnimation(anim, simplifiedMap, baseMap, size, idFactory) {
    const rawTracks = anim?.timelines ?? anim?.tracks ?? [];
    const trackArray = Array.isArray(rawTracks)
        ? rawTracks
        : (rawTracks && typeof rawTracks === 'object' ? Object.values(rawTracks) : []);
    const tracks = trackArray
        .map(track => parseCompactTrack(track, simplifiedMap, size))
        .filter(Boolean);
    if (!tracks.length) {
        return {
            id: idFactory(),
            name: anim.name ?? 'Animation',
            duration: +(anim.duration ?? 5),
            keyframes: []
        };
    }
    const timeSet = new Set();
    tracks.forEach(track => {
        for (const time of track.frames.keys()) timeSet.add(time);
    });
    if (!timeSet.size) {
        return {
            id: idFactory(),
            name: anim.name ?? 'Animation',
            duration: +(anim.duration ?? 5),
            keyframes: []
        };
    }
    const times = Array.from(timeSet).sort((a, b) => a - b);
    const keyframes = times.map(time => {
        const snapshotMap = new Map();
        baseMap.forEach((item, id) => {
            snapshotMap.set(id, clone(item));
        });
        tracks.forEach(track => {
            const frameItem = findFrame(track.frames, time);
            if (!frameItem) return;
            snapshotMap.set(track.id, clone(frameItem));
        });
        const snapshot = Array.from(snapshotMap.values());
        return { t: +time, snapshot };
    }).filter(kf => kf.snapshot.length);
    return {
        id: idFactory(),
        name: anim.name ?? 'Animation',
        duration: +(anim.duration ?? 5),
        keyframes
    };
}

function tweenItem(a, b, t) {
    const item = clone(a);
    item.color = a.color;
    item.width = lerp(a.width, b.width, t);
    item.rot = lerp(a.rot ?? 0, b.rot ?? 0, t);
    if (a.kind === 'line' && b.kind === 'line') {
        item.p1 = lpt(a.p1, b.p1, t);
        item.p2 = lpt(a.p2, b.p2, t);
    }
    if (a.kind === 'quadratic' && b.kind === 'quadratic') {
        item.p1 = lpt(a.p1, b.p1, t);
        item.cp = lpt(a.cp, b.cp, t);
        item.p2 = lpt(a.p2, b.p2, t);
    }
    if (a.kind === 'shape' && b.kind === 'shape') {
        const count = Math.min(a.path.length, b.path.length);
        const path = [];
        for (let i = 0; i < count; i++) path.push(lpt(a.path[i], b.path[i], t));
        item.path = path;
        item.fill = t < 0.5 ? a.fill : b.fill;
        const segA = Array.isArray(a.segments) ? a.segments : null;
        const segB = Array.isArray(b.segments) ? b.segments : null;
        if (segA || segB) {
            const max = Math.max(segA ? segA.length : 0, segB ? segB.length : 0);
            const segs = [];
            for (let i = 0; i < max; i++) {
                const sA = segA ? segA[i] : null;
                const sB = segB ? segB[i] : null;
                if (sA && sB) {
                    const seg = {
                        kind: sA.kind ?? sB.kind,
                        p1: sA.p1 && sB.p1 ? lpt(sA.p1, sB.p1, t) : clone(sA.p1 ?? sB.p1),
                        p2: sA.p2 && sB.p2 ? lpt(sA.p2, sB.p2, t) : clone(sA.p2 ?? sB.p2)
                    };
                    if (sA.cp || sB.cp) {
                        if (sA.cp && sB.cp) seg.cp = lpt(sA.cp, sB.cp, t);
                        else seg.cp = clone(sA.cp ?? sB.cp);
                    }
                    segs.push(seg);
                } else {
                    const src = sA ?? sB;
                    if (src) segs.push(clone(src));
                }
            }
            item.segments = segs;
        }
    }
    return item;
}

function snapshotAt(anim, sec) {
    const ks = anim.keyframes || [];
    if (!ks.length) return null;
    if (ks.length === 1) return clone(ks[0].snapshot);
    if (sec <= ks[0].t) return clone(ks[0].snapshot);
    if (sec >= ks[ks.length - 1].t) return clone(ks[ks.length - 1].snapshot);
    let k1 = ks[0];
    let k2 = ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++) {
        if (sec >= ks[i].t && sec <= ks[i + 1].t) {
            k1 = ks[i];
            k2 = ks[i + 1];
            break;
        }
    }
    const span = Math.max(1e-6, k2.t - k1.t);
    const tt = clamp((sec - k1.t) / span, 0, 1);
    const map2 = new Map(k2.snapshot.map(o => [o.id, o]));
    const out = k1.snapshot.map(o1 => {
        const o2 = map2.get(o1.id);
        if (!o2) return clone(o1);
        return tweenItem(o1, o2, tt);
    });
    for (const o2 of k2.snapshot) {
        if (!out.find(x => x.id === o2.id)) out.push(clone(o2));
    }
    return out;
}

class LinePackRenderer {
    constructor(canvas, { autoResize = true, pixelRatio } = {}) {
        if (!canvas) throw new Error('Canvas element is required');
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        const defaultRatio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
        this.pixelRatio = Math.max(1, pixelRatio ?? defaultRatio ?? 1);
        this.autoResize = autoResize;

        this.model = null;
        this.baseItems = [];
        this.activeItems = [];
        this.animations = [];
        this.currentAnimationId = null;
        this.loopPlayback = true;
        this.playing = false;
        this.currentTime = 0;
        this.startTime = 0;
        this._raf = null;

        this._size = { w: canvas.width, h: canvas.height };
        this._scale = 1;
        this._offset = { x: 0, y: 0 };

        if (this.autoResize && typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(() => this.resize());
            resizeObserver.observe(this.canvas);
            this._resizeObserver = resizeObserver;
        }

        this.resize();
    }

    async loadFromURL(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load pack: ${res.status}`);
        const data = await res.json();
        this.loadFromData(data);
        return this;
    }

    loadFromData(pack) {
        if (!pack || typeof pack !== 'object') {
            throw new Error('Invalid pack data');
        }
        const normalizedPack = expandCompactPack(pack);
        const data = normalizedPack || pack;
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid pack data');
        }
        if (data.type === 'LinePack') {
            this._loadFullPack(data);
        } else if (data.type === 'LinePackSummary') {
            this._loadSummaryPack(data);
        } else {
            throw new Error('Unsupported pack type');
        }
        this.seek(0);
        this.render();
        return this;
    }

    destroy() {
        this.stop();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width || this.canvas.clientWidth || this.canvas.width;
        const cssH = rect.height || this.canvas.clientHeight || this.canvas.height;
        const dpr = this.pixelRatio;
        this.canvas.width = Math.max(1, Math.round(cssW * dpr));
        this.canvas.height = Math.max(1, Math.round(cssH * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._size = { w: cssW, h: cssH };
        this._fitToCanvas();
        this.render();
    }

    listElements() {
        return clone(this.baseItems);
    }

    listAnimations() {
        return this.animations.map(anim => ({
            id: anim.id,
            name: anim.name,
            duration: anim.duration,
            keyframes: anim.keyframes.length
        }));
    }

    getAnimation(idOrName) {
        if (!idOrName && this.currentAnimationId) {
            return this.animations.find(a => a.id === this.currentAnimationId) || null;
        }
        return this.animations.find(a => a.id === idOrName || a.name === idOrName) || null;
    }

    play(idOrName, { loop = true, startTime = 0 } = {}) {
        if (idOrName) {
            const anim = this.getAnimation(idOrName);
            if (!anim) throw new Error('Animation not found');
            this.currentAnimationId = anim.id;
        }
        const anim = this.getAnimation(this.currentAnimationId);
        if (!anim || !anim.keyframes.length) return;
        this.loopPlayback = loop;
        this.playing = true;
        this.currentTime = clamp(startTime, 0, anim.duration || 0);
        this.startTime = performance.now() - this.currentTime * 1000;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(ts => this._step(ts));
    }

    pause() {
        if (!this.playing) return;
        this.playing = false;
        if (this._raf) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }

    stop() {
        this.pause();
        this.currentTime = 0;
        this.activeItems = clone(this.baseItems);
        this.render();
    }

    seek(sec, idOrName) {
        if (idOrName) {
            const anim = this.getAnimation(idOrName);
            if (!anim) throw new Error('Animation not found');
            this.currentAnimationId = anim.id;
        }
        const anim = this.getAnimation(this.currentAnimationId);
        if (!anim || !anim.keyframes.length) {
            this.activeItems = clone(this.baseItems);
            this.currentTime = 0;
            this.render();
            return;
        }
        const dur = Math.max(0.001, anim.duration || 5);
        const time = clamp(sec, 0, dur);
        const snap = snapshotAt(anim, time);
        if (snap) {
            this.activeItems = snap;
            this.currentTime = time;
            this.render();
        }
    }

    setAnimationDuration(idOrName, duration) {
        const anim = this.getAnimation(idOrName);
        if (!anim) throw new Error('Animation not found');
        anim.duration = Math.max(0.001, +duration || 0);
    }

    renameAnimation(idOrName, name) {
        const anim = this.getAnimation(idOrName);
        if (!anim) throw new Error('Animation not found');
        anim.name = String(name || '').trim() || anim.name;
    }

    addKeyframe(idOrName, keyframe) {
        const anim = this.getAnimation(idOrName);
        if (!anim) throw new Error('Animation not found');
        const entry = {
            t: +(keyframe?.t ?? keyframe?.time ?? 0),
            snapshot: clone(keyframe?.snapshot ?? keyframe?.items ?? this.activeItems)
        };
        if (!Number.isFinite(entry.t) || !Array.isArray(entry.snapshot)) {
            throw new Error('Invalid keyframe');
        }
        anim.keyframes.push(entry);
        anim.keyframes.sort((a, b) => a.t - b.t);
    }

    updateKeyframe(idOrName, index, keyframe) {
        const anim = this.getAnimation(idOrName);
        if (!anim) throw new Error('Animation not found');
        if (index < 0 || index >= anim.keyframes.length) {
            throw new Error('Keyframe index out of range');
        }
        const target = anim.keyframes[index];
        if (keyframe.time !== undefined || keyframe.t !== undefined) {
            target.t = +(keyframe.time ?? keyframe.t);
        }
        if (keyframe.snapshot || keyframe.items) {
            target.snapshot = clone(keyframe.snapshot ?? keyframe.items);
        }
        anim.keyframes.sort((a, b) => a.t - b.t);
    }

    removeKeyframe(idOrName, index) {
        const anim = this.getAnimation(idOrName);
        if (!anim) throw new Error('Animation not found');
        if (index < 0 || index >= anim.keyframes.length) return;
        anim.keyframes.splice(index, 1);
    }

    setElements(items) {
        this.baseItems = clone(items);
        this.activeItems = clone(items);
        this.render();
    }

    toJSON() {
        return clone({
            type: this.model?.type ?? 'LinePack',
            version: this.model?.version ?? 2,
            size: clone(this.model?.size),
            elements: this.baseItems,
            animations: this.animations
        });
    }

    render() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();

        ctx.save();
        ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        ctx.translate(this._offset.x, this._offset.y);
        ctx.scale(this._scale, this._scale);
        for (const item of this.activeItems) {
            this._drawItem(ctx, item);
        }
        ctx.restore();
    }

    _drawItem(ctx, item) {
        if (!item || item.visible === false) return;
        if (item.kind === 'group') return;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = item.color ?? '#ffffff';
        ctx.lineWidth = item.width ?? 1;
        const rot = item.rot ?? 0;
        if (rot) {
            const cen = itemCenter(item);
            ctx.translate(cen.x, cen.y);
            ctx.rotate((rot * Math.PI) / 180);
            ctx.translate(-cen.x, -cen.y);
        }

        if (item.kind === 'line') {
            ctx.beginPath();
            ctx.moveTo(item.p1.x, item.p1.y);
            ctx.lineTo(item.p2.x, item.p2.y);
            ctx.stroke();
        } else if (item.kind === 'quadratic') {
            ctx.beginPath();
            ctx.moveTo(item.p1.x, item.p1.y);
            ctx.quadraticCurveTo(item.cp.x, item.cp.y, item.p2.x, item.p2.y);
            ctx.stroke();
        } else if (item.kind === 'shape') {
            const segs = Array.isArray(item.segments) ? item.segments.filter(Boolean) : [];
            if (segs.length) {
                ctx.beginPath();
                ctx.moveTo(segs[0].p1.x, segs[0].p1.y);
                for (const seg of segs) {
                    if (seg.kind === 'quadratic' && seg.cp) {
                        ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.p2.x, seg.p2.y);
                    } else {
                        ctx.lineTo(seg.p2.x, seg.p2.y);
                    }
                }
                ctx.closePath();
                if (item.fill) {
                    ctx.fillStyle = item.fill;
                    ctx.fill();
                }
                if ((item.width ?? 0) > 0) ctx.stroke();
            } else if (Array.isArray(item.path) && item.path.length) {
                ctx.beginPath();
                ctx.moveTo(item.path[0].x, item.path[0].y);
                for (let i = 1; i < item.path.length; i++) {
                    ctx.lineTo(item.path[i].x, item.path[i].y);
                }
                ctx.closePath();
                if (item.fill) {
                    ctx.fillStyle = item.fill;
                    ctx.fill();
                }
                if ((item.width ?? 0) > 0) ctx.stroke();
            }
        }

        ctx.restore();
    }

    _fitToCanvas() {
        if (!this.model) return;
        const size = this.model.size;
        const cssW = this._size.w;
        const cssH = this._size.h;
        if (!size || !cssW || !cssH) {
            this._scale = 1;
            this._offset = { x: 0, y: 0 };
            return;
        }
        const sx = cssW / size.w;
        const sy = cssH / size.h;
        const scale = Math.min(sx, sy);
        this._scale = scale;
        this._offset = {
            x: (cssW - size.w * scale) / 2,
            y: (cssH - size.h * scale) / 2
        };
    }

    _step(timestamp) {
        if (!this.playing) return;
        const anim = this.getAnimation(this.currentAnimationId);
        if (!anim || !anim.keyframes.length) {
            this.stop();
            return;
        }
        const dur = Math.max(0.001, anim.duration || 5) * 1000;
        const elapsed = timestamp - this.startTime;
        let next = elapsed;
        let finished = false;
        if (this.loopPlayback) {
            next = ((elapsed % dur) + dur) % dur;
        } else if (elapsed >= dur) {
            next = dur;
            finished = true;
        }
        const sec = next / 1000;
        const snap = snapshotAt(anim, sec);
        if (snap) {
            this.activeItems = snap;
            this.currentTime = sec;
            this.render();
        }
        if (finished) {
            this.playing = false;
            return;
        }
        this._raf = requestAnimationFrame(ts => this._step(ts));
    }

    _loadFullPack(pack) {
        const size = pack.size ?? { w: this.canvas.width, h: this.canvas.height };
        const elements = Array.isArray(pack.elements)
            ? pack.elements.map(el => deserializeItem(el, size)).filter(Boolean)
            : [];
        const animations = Array.isArray(pack.animations)
            ? pack.animations.map(anim => ({
                id: anim.id ?? `anim_${Math.random().toString(36).slice(2, 8)}`,
                name: anim.name ?? 'Animation',
                duration: +(anim.duration ?? 5),
                keyframes: Array.isArray(anim.keyframes)
                    ? anim.keyframes.map(kf => ({
                        t: +kf.t,
                        snapshot: Array.isArray(kf.snapshot)
                            ? kf.snapshot.map(el => deserializeItem(el, size)).filter(Boolean)
                            : []
                    })).filter(kf => Number.isFinite(kf.t))
                    : []
            }))
            : [];
        this.model = {
            type: pack.type,
            version: pack.version ?? 2,
            size: size
        };
        this.baseItems = clone(elements);
        this.activeItems = clone(elements);
        this.animations = animations;
        this.currentAnimationId = animations[0]?.id ?? null;
        this._fitToCanvas();
    }

    _loadSummaryPack(pack) {
        const size = pack.size ?? { w: this.canvas.width, h: this.canvas.height };
        const version = +(pack.version ?? 0);
        const simplifiedItems = Array.isArray(pack.items)
            ? pack.items.map(entry => normalizeSummaryItem(entry)).filter(Boolean)
            : [];
        const items = simplifiedItems
            .map(entry => deserializeItem(entry, size))
            .filter(Boolean);
        const idFactory = () => `anim_${Math.random().toString(36).slice(2, 8)}`;
        let animations = [];
        if (version && version < 3) {
            animations = Array.isArray(pack.animations)
                ? pack.animations.map(anim => {
                    const timelines = Array.isArray(anim.timelines)
                        ? anim.timelines.map(track => ({
                            item: track.item ?? track.id ?? track.target ?? track.shape ?? track.name,
                            keyframes: normalizeKeyframes(track.keyframes)
                        })).filter(Boolean)
                        : [];
                    if (!timelines.length) {
                        return {
                            id: idFactory(),
                            name: anim.name ?? 'Animation',
                            duration: +(anim.duration ?? 5),
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
                            stateData.id = stateData.id ?? track.item;
                            stateData.type = stateData.type ?? stateData.kind;
                            stateData.kind = stateData.kind ?? stateData.type;
                            const item = deserializeItem(stateData, size);
                            if (item) snapshot.push(item);
                        });
                        return { t: time, snapshot };
                    }).filter(kf => kf.snapshot.length);
                    return {
                        id: idFactory(),
                        name: anim.name ?? 'Animation',
                        duration: +(anim.duration ?? 5),
                        keyframes
                    };
                })
                : [];
        } else {
            const simplifiedMap = new Map(simplifiedItems.map(entry => [entry.id, entry]));
            const baseMap = new Map(items.map(it => [it.id, clone(it)]));
            animations = Array.isArray(pack.animations)
                ? pack.animations
                    .map(anim => rebuildCompactAnimation(anim, simplifiedMap, baseMap, size, idFactory))
                    .filter(Boolean)
                : [];
        }
        this.model = {
            type: pack.type,
            version: pack.version ?? 3,
            size
        };
        this.baseItems = clone(items);
        this.activeItems = clone(items);
        this.animations = animations;
        this.currentAnimationId = animations[0]?.id ?? null;
        this._fitToCanvas();
    }
}

export { LinePackRenderer };
export default LinePackRenderer;
