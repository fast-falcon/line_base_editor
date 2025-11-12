/**
 * @fileoverview Manages import and export operations for LinePack Pro packs,
 * including JSON serialization, minified saves, and PNG rendering helpers.
 */

function registerFileSystem(ctx) {
    const { state, ui, canvas, api, utils } = ctx;
    const { rndId } = utils;

    const PRECISION = 3;
    const EPSILON = 1e-3;
    const ENCODE_MARK = '~';
    const ULTRA_MARK = '=';
    const POINT_SCALE = 255;

    const quantizeUnit = (value) => {
        if (!Number.isFinite(value)) return 0;
        const clamped = Math.max(0, Math.min(1, value));
        return Math.round(clamped * POINT_SCALE);
    };

    const dequantizeUnit = (value) => {
        if (!Number.isFinite(value)) return 0;
        return +((value / POINT_SCALE).toFixed(PRECISION));
    };

    const encodeBinary = (bytes) => {
        if (!(bytes instanceof Uint8Array)) return '';
        if (typeof btoa === 'function') {
            let out = '';
            for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
            return btoa(out);
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        let result = '';
        for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
        if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
            return globalThis.btoa(result);
        }
        return '';
    };

    const decodeBinary = (text) => {
        if (typeof text !== 'string' || !text.length) return new Uint8Array(0);
        if (typeof atob === 'function') {
            const bin = atob(text);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
        }
        if (typeof Buffer !== 'undefined') {
            const buf = Buffer.from(text, 'base64');
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
            const bin = globalThis.atob(text);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
        }
        return new Uint8Array(0);
    };

    const textEncoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
    const textDecoder = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

    const stringToBytes = (text) => {
        const value = (text === undefined || text === null) ? '' : `${text}`;
        if (textEncoder) return textEncoder.encode(value);
        if (typeof Buffer !== 'undefined') {
            const buf = Buffer.from(value, 'utf8');
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        const encoded = encodeURIComponent(value);
        const bytes = [];
        for (let i = 0; i < encoded.length; i++) {
            const ch = encoded[i];
            if (ch === '%') {
                bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
                i += 2;
            } else {
                bytes.push(ch.charCodeAt(0));
            }
        }
        return new Uint8Array(bytes);
    };

    const bytesToString = (bytes) => {
        if (!(bytes instanceof Uint8Array)) return '';
        if (textDecoder) {
            try {
                return textDecoder.decode(bytes);
            } catch (err) {
                // ignore and fall back
            }
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
        }
        let out = '';
        for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        try {
            let encoded = '';
            for (let i = 0; i < out.length; i++) {
                const code = out.charCodeAt(i).toString(16).padStart(2, '0');
                encoded += `%${code}`;
            }
            return decodeURIComponent(encoded);
        } catch (err) {
            return out;
        }
    };

    const simplifyQuantizedPoints = (points) => {
        if (!Array.isArray(points) || points.length <= 2) {
            return Array.isArray(points) ? points.slice() : [];
        }
        const keep = new Array(points.length).fill(false);
        keep[0] = true;
        keep[points.length - 1] = true;
        const stack = [[0, points.length - 1]];
        const epsilonSq = 9;
        while (stack.length) {
            const [start, end] = stack.pop();
            if (end <= start + 1) continue;
            const startPt = points[start];
            const endPt = points[end];
            const dx = endPt[0] - startPt[0];
            const dy = endPt[1] - startPt[1];
            const lenSq = dx * dx + dy * dy || 1;
            let index = -1;
            let maxDist = 0;
            for (let i = start + 1; i < end; i++) {
                const pt = points[i];
                const t = ((pt[0] - startPt[0]) * dx + (pt[1] - startPt[1]) * dy) / lenSq;
                const projX = startPt[0] + t * dx;
                const projY = startPt[1] + t * dy;
                const distX = pt[0] - projX;
                const distY = pt[1] - projY;
                const distSq = distX * distX + distY * distY;
                if (distSq > maxDist) {
                    maxDist = distSq;
                    index = i;
                }
            }
            if (maxDist > epsilonSq && index > start && index < end) {
                keep[index] = true;
                stack.push([start, index]);
                stack.push([index, end]);
            }
        }
        return points.filter((_, idx) => keep[idx]);
    };

    const encodePointSequence = (points) => {
        if (!Array.isArray(points) || !points.length) return null;
        const quantized = [];
        points.forEach(pt => {
            if (!pt) return;
            const source = Array.isArray(pt) ? pt : [pt.x, pt.y];
            const x = Number.isFinite(+source[0]) ? +source[0] : 0;
            const y = Number.isFinite(+source[1]) ? +source[1] : 0;
            quantized.push([quantizeUnit(x), quantizeUnit(y)]);
        });
        const simplified = simplifyQuantizedPoints(quantized);
        if (!simplified.length) return null;
        const raw = [];
        simplified.forEach(([qx, qy]) => {
            raw.push(qx, qy);
        });
        if (!raw.length) return null;
        const bytes = Uint8Array.from(raw);
        return ENCODE_MARK + encodeBinary(bytes);
    };

    const decodePointSequence = (payload) => {
        if (typeof payload !== 'string' || !payload.startsWith(ENCODE_MARK)) return null;
        const bytes = decodeBinary(payload.slice(1));
        if (!bytes.length) return null;
        const view = bytes;
        const points = [];
        for (let i = 0; i + 1 < view.length; i += 2) {
            const x = dequantizeUnit(view[i]);
            const y = dequantizeUnit(view[i + 1]);
            points.push([x, y]);
        }
        return points;
    };

    const encodeSegmentSequence = (segments) => {
        if (!Array.isArray(segments) || !segments.length) return null;
        const raw = [];
        segments.forEach(seg => {
            if (!seg || !seg.p1 || !seg.p2) return;
            const type = seg.kind === 'quadratic' ? 1 : 0;
            raw.push(type);
            const p1 = Array.isArray(seg.p1) ? seg.p1 : [seg.p1.x, seg.p1.y];
            const p2 = Array.isArray(seg.p2) ? seg.p2 : [seg.p2.x, seg.p2.y];
            raw.push(quantizeUnit(p1[0]), quantizeUnit(p1[1]));
            raw.push(quantizeUnit(p2[0]), quantizeUnit(p2[1]));
            if (type && seg.cp) {
                const cp = Array.isArray(seg.cp) ? seg.cp : [seg.cp.x, seg.cp.y];
                raw.push(quantizeUnit(cp[0]), quantizeUnit(cp[1]));
            }
        });
        if (!raw.length) return null;
        const bytes = new Uint8Array(raw.length);
        bytes.set(raw);
        return ENCODE_MARK + encodeBinary(bytes);
    };

    const decodeSegmentSequence = (payload) => {
        if (typeof payload !== 'string' || !payload.startsWith(ENCODE_MARK)) return null;
        const bytes = decodeBinary(payload.slice(1));
        if (!bytes.length) return null;
        const view = bytes;
        const segments = [];
        for (let i = 0; i < view.length;) {
            const type = view[i++];
            if (i + 3 >= view.length) break;
            const p1 = [dequantizeUnit(view[i++]), dequantizeUnit(view[i++])];
            const p2 = [dequantizeUnit(view[i++]), dequantizeUnit(view[i++])];
            const segment = { kind: type ? 'quadratic' : 'line', p1, p2 };
            if (type) {
                if (i + 1 >= view.length) break;
                segment.cp = [dequantizeUnit(view[i++]), dequantizeUnit(view[i++])];
            }
            segments.push(segment);
        }
        return segments;
    };

    function cloneValue(value) {
        if (Array.isArray(value)) return value.map(cloneValue);
        if (value && typeof value === 'object') {
            const out = {};
            Object.keys(value).forEach(key => {
                out[key] = cloneValue(value[key]);
            });
            return out;
        }
        if (Number.isNaN(value)) return 0;
        return value;
    }

    function cloneSimplified(obj) {
        return obj ? cloneValue(obj) : null;
    }

    function deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a === 'number' && typeof b === 'number') {
            return Math.abs(a - b) < EPSILON;
        }
        if (a === null || b === null) return a === b;
        if (Array.isArray(a) || Array.isArray(b)) {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) return false;
            }
            return true;
        }
        if (typeof a === 'object' && typeof b === 'object') {
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            for (const key of keys) {
                if (!deepEqual(a[key], b[key])) return false;
            }
            return true;
        }
        return false;
    }

    function stableHash(value) {
        if (value === null) return 'null';
        const type = typeof value;
        if (type === 'number') return Number.isFinite(value) ? value.toFixed(6) : '0';
        if (type === 'boolean' || type === 'string') return JSON.stringify(value);
        if (Array.isArray(value)) {
            return `[${value.map(stableHash).join(',')}]`;
        }
        if (type === 'object') {
            const keys = Object.keys(value).sort();
            const inner = keys.map(key => `${JSON.stringify(key)}:${stableHash(value[key])}`).join(',');
            return `{${inner}}`;
        }
        return '';
    }

    function diffSimplified(prev, next) {
        const diff = {};
        const keys = new Set([
            ...Object.keys(prev || {}),
            ...Object.keys(next || {})
        ]);
        keys.delete('id');
        keys.delete('type');
        keys.delete('kind');
        for (const key of keys) {
            const a = prev ? prev[key] : undefined;
            const b = next ? next[key] : undefined;
            if (!deepEqual(a, b)) diff[key] = cloneValue(b);
        }
        return diff;
    }

    function applyDiff(base, diff) {
        const out = cloneSimplified(base);
        if (!diff || diff === null || diff === 0) return out;
        Object.keys(diff).forEach(key => {
            const value = diff[key];
            if (value === undefined) delete out[key];
            else out[key] = cloneValue(value);
        });
        return out;
    }

    const DEFAULT_STROKE_COLOR = '#ffffff';

    const clampByte = (val) => {
        if (!Number.isFinite(val)) return 0;
        return Math.max(0, Math.min(255, Math.round(val)));
    };

    const byteToHex = (val) => clampByte(val).toString(16).padStart(2, '0');

    const parseColorString = (color) => {
        if (!color || typeof color !== 'string') return null;
        const trimmed = color.trim();
        const hexMatch = /^#?([0-9a-f]{6})$/i.exec(trimmed);
        if (hexMatch) {
            const hex = hexMatch[1];
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: 1
            };
        }
        const rgbaMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
        if (rgbaMatch) {
            const parts = rgbaMatch[1].split(',').map(p => p.trim());
            if (parts.length < 3) return null;
            const parseChannel = (entry) => {
                if (!entry) return null;
                const percent = entry.endsWith('%');
                const num = parseFloat(entry);
                if (!Number.isFinite(num)) return null;
                return percent ? clampByte(num * 2.55) : clampByte(num);
            };
            const parseAlpha = (entry) => {
                if (entry === undefined) return 1;
                const trimmedEntry = entry.trim();
                if (!trimmedEntry.length) return 1;
                const percent = trimmedEntry.endsWith('%');
                let num = parseFloat(trimmedEntry);
                if (!Number.isFinite(num)) return 1;
                if (percent) num = num / 100;
                else if (num > 1) num = num > 100 ? num / 255 : num / 100;
                return Math.max(0, Math.min(1, num));
            };
            const r = parseChannel(parts[0]);
            const g = parseChannel(parts[1]);
            const b = parseChannel(parts[2]);
            if ([r, g, b].some(v => v === null)) return null;
            const a = parseAlpha(parts[3]);
            return { r, g, b, a };
        }
        return null;
    };

    const identityMatrix = () => [1, 0, 0, 1, 0, 0];

    const multiplyMatrix = (a, b) => [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5]
    ];

    const translateMatrix = (tx, ty) => [1, 0, 0, 1, tx || 0, ty || 0];

    const scaleMatrix = (sx, sy) => [
        Number.isFinite(sx) ? sx : 1,
        0,
        0,
        Number.isFinite(sy) ? sy : 1,
        0,
        0
    ];

    const rotateMatrix = (deg) => {
        const theta = (Number.isFinite(deg) ? deg : 0) * Math.PI / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return [cos, sin, -sin, cos, 0, 0];
    };

    const applyMatrixPoint = (matrix, pt) => ({
        x: matrix[0] * pt.x + matrix[2] * pt.y + matrix[4],
        y: matrix[1] * pt.x + matrix[3] * pt.y + matrix[5]
    });

    const distanceBetween = (a, b) => {
        if (!a || !b) return Infinity;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.hypot(dx, dy);
    };

    const pointSegmentDistanceSq = (pt, a, b) => {
        if (!pt || !a || !b) return Infinity;
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const wx = pt.x - a.x;
        const wy = pt.y - a.y;
        const lenSq = vx * vx + vy * vy;
        if (lenSq === 0) {
            const dx = pt.x - a.x;
            const dy = pt.y - a.y;
            return dx * dx + dy * dy;
        }
        let t = (wx * vx + wy * vy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = a.x + t * vx;
        const projY = a.y + t * vy;
        const dx = pt.x - projX;
        const dy = pt.y - projY;
        return dx * dx + dy * dy;
    };

    const simplifyPath = (points, tolerance) => {
        if (!Array.isArray(points) || points.length <= 2) {
            return Array.isArray(points) ? points.slice() : [];
        }
        const sqTolerance = (Number.isFinite(tolerance) && tolerance > 0)
            ? tolerance * tolerance
            : 0;
        if (sqTolerance <= EPSILON) {
            return points.map(pt => ({ x: pt.x, y: pt.y }));
        }
        const lastIndex = points.length - 1;
        const markers = new Uint8Array(points.length);
        const stack = [[0, lastIndex]];
        markers[0] = markers[lastIndex] = 1;
        while (stack.length) {
            const [start, end] = stack.pop();
            let maxDist = 0;
            let index = 0;
            for (let i = start + 1; i < end; i++) {
                const dist = pointSegmentDistanceSq(points[i], points[start], points[end]);
                if (dist > maxDist) {
                    maxDist = dist;
                    index = i;
                }
            }
            if (maxDist > sqTolerance && index) {
                markers[index] = 1;
                stack.push([start, index], [index, end]);
            }
        }
        const simplified = [];
        for (let i = 0; i <= lastIndex; i++) {
            if (markers[i]) simplified.push({ x: points[i].x, y: points[i].y });
        }
        if (simplified.length < 2) return points.slice();
        return simplified;
    };

    const approximateCubicSegment = (p0, p1, p2, p3) => {
        const lengthEstimate = distanceBetween(p0, p1)
            + distanceBetween(p1, p2)
            + distanceBetween(p2, p3);
        const steps = Math.max(4, Math.min(32, Math.ceil(lengthEstimate / 25)));
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const inv = 1 - t;
            const inv2 = inv * inv;
            const inv3 = inv2 * inv;
            const t2 = t * t;
            const t3 = t2 * t;
            const x = inv3 * p0.x
                + 3 * inv2 * t * p1.x
                + 3 * inv * t2 * p2.x
                + t3 * p3.x;
            const y = inv3 * p0.y
                + 3 * inv2 * t * p1.y
                + 3 * inv * t2 * p2.y
                + t3 * p3.y;
            points.push({ x, y });
        }
        return points;
    };

    const buildGeometryFromPoints = (localPoints, matrix, closed = true) => {
        if (!Array.isArray(localPoints) || localPoints.length < 2) return null;
        const worldPoints = [];
        const segments = [];

        const pushWorldPoint = (pt) => {
            if (!pt) return null;
            const world = applyMatrixPoint(matrix, pt);
            const last = worldPoints[worldPoints.length - 1];
            if (!last || distanceBetween(last, world) > EPSILON) {
                worldPoints.push({ x: world.x, y: world.y });
            }
            return worldPoints[worldPoints.length - 1];
        };

        let previous = null;
        localPoints.forEach((pt, idx) => {
            const world = pushWorldPoint(pt);
            if (!world) return;
            if (previous && distanceBetween(previous, world) > EPSILON) {
                segments.push({ kind: 'line', p1: { x: previous.x, y: previous.y }, p2: { x: world.x, y: world.y } });
            }
            previous = world;
        });

        if (closed && worldPoints.length > 1) {
            const first = worldPoints[0];
            const last = worldPoints[worldPoints.length - 1];
            if (distanceBetween(first, last) > EPSILON) {
                segments.push({ kind: 'line', p1: { x: last.x, y: last.y }, p2: { x: first.x, y: first.y } });
                worldPoints.push({ x: first.x, y: first.y });
            }
        }

        return { points: worldPoints, segments, closed };
    };

    const staticValue = (prop) => {
        if (prop === null || prop === undefined) return null;
        if (typeof prop === 'object') {
            if ('a' in prop && prop.a !== 0) return null;
            if ('k' in prop) return prop.k;
        }
        return prop;
    };

    const extractKeyframeValue = (frameEntry) => {
        if (!frameEntry) return null;
        if (frameEntry.s !== undefined) {
            const source = frameEntry.s;
            if (Array.isArray(source) && source.length === 1) return cloneValue(source[0]);
            return cloneValue(source);
        }
        if (frameEntry.v !== undefined) return cloneValue(frameEntry.v);
        return cloneValue(frameEntry);
    };

    const valueAtKeyframes = (frames, frame) => {
        if (!Array.isArray(frames) || !frames.length) return null;
        let previous = frames[0];
        let prevTime = Number.isFinite(+previous.t) ? +previous.t : null;
        if (prevTime === null) {
            return extractKeyframeValue(previous);
        }
        if (!Number.isFinite(frame) || frame <= prevTime) {
            return extractKeyframeValue(previous);
        }
        for (let i = 1; i < frames.length; i++) {
            const current = frames[i];
            const currentTime = Number.isFinite(+current.t) ? +current.t : null;
            if (currentTime === null) continue;
            if (frame < currentTime) {
                return extractKeyframeValue(previous);
            }
            previous = current;
        }
        return extractKeyframeValue(previous);
    };

    const valueAt = (prop, frame, fallback = null) => {
        if (prop === null || prop === undefined) return fallback;
        if (frame === null || frame === undefined) {
            const value = staticValue(prop);
            return value === undefined ? fallback : value;
        }
        if (typeof prop === 'object') {
            if (prop.a && Array.isArray(prop.k)) {
                const evaluated = valueAtKeyframes(prop.k, frame);
                if (evaluated !== null && evaluated !== undefined) return evaluated;
            }
            if (prop.k && typeof prop.k === 'object' && prop.k.a && Array.isArray(prop.k.k)) {
                const evaluatedNested = valueAtKeyframes(prop.k.k, frame);
                if (evaluatedNested !== null && evaluatedNested !== undefined) return evaluatedNested;
            }
        }
        const value = staticValue(prop);
        return value === undefined ? fallback : value;
    };

    const toNumber = (value, fallback = 0) => {
        if (Number.isFinite(+value)) return +value;
        return fallback;
    };

    const pointValue = (value, fallback = { x: 0, y: 0 }) => {
        if (value === null || value === undefined) return { x: fallback.x, y: fallback.y };
        if (typeof value === 'object' && value.x !== undefined && value.y !== undefined) {
            return {
                x: toNumber(value.x, fallback.x),
                y: toNumber(value.y, fallback.y)
            };
        }
        if (Array.isArray(value)) {
            const x = toNumber(value[0], fallback.x);
            const y = toNumber(value[1], fallback.y);
            return { x, y };
        }
        if (Number.isFinite(+value)) {
            const num = +value;
            return { x: num, y: 0 };
        }
        return { x: fallback.x, y: fallback.y };
    };

    const numberFrom = (prop, fallback = 0, frame = null) => {
        if (prop && typeof prop === 'object' && prop.x !== undefined && prop.y === undefined) {
            return numberFrom(prop.x, fallback, frame);
        }
        const value = valueAt(prop, frame, null);
        if (Array.isArray(value)) {
            const candidate = value.find(v => Number.isFinite(+v));
            if (candidate !== undefined) return +candidate;
        }
        if (value && typeof value === 'object' && value.x !== undefined) {
            return numberFrom(value.x, fallback, frame);
        }
        if (Number.isFinite(+value)) return +value;
        return fallback;
    };

    const pointFrom = (prop, frame = null, fallback = { x: 0, y: 0 }) => {
        if (prop && typeof prop === 'object' && prop.x !== undefined && prop.y !== undefined) {
            return {
                x: numberFrom(prop.x, fallback.x, frame),
                y: numberFrom(prop.y, fallback.y, frame)
            };
        }
        const value = valueAt(prop, frame, null);
        return pointValue(value, fallback);
    };

    const scaleFrom = (prop, frame = null) => {
        if (prop && typeof prop === 'object' && prop.x !== undefined && prop.y !== undefined && !('k' in prop)) {
            return {
                x: numberFrom(prop.x, 100, frame) / 100,
                y: numberFrom(prop.y, 100, frame) / 100
            };
        }
        const value = valueAt(prop, frame, null);
        if (Array.isArray(value)) {
            const sx = toNumber(value[0], 100);
            const sy = toNumber(value[1], sx);
            return { x: sx / 100, y: sy / 100 };
        }
        if (value && typeof value === 'object') {
            const sx = toNumber(value.x ?? value[0], 100);
            const sy = toNumber(value.y ?? value[1], sx);
            return { x: sx / 100, y: sy / 100 };
        }
        const num = numberFrom(value, 100, frame);
        const ratio = num / 100;
        return { x: ratio, y: ratio };
    };

    const opacityFrom = (prop, frame = null) => {
        const value = numberFrom(prop, 100, frame);
        return Number.isFinite(value) ? value / 100 : 1;
    };

    const normalizeColorValue = (value, fallback = DEFAULT_STROKE_COLOR) => {
        if (Array.isArray(value)) {
            const toByte = (val) => {
                if (!Number.isFinite(val)) return 0;
                const scaled = (val <= 1 && val >= 0) ? val * 255 : val;
                return clampByte(scaled);
            };
            const r = toByte(value[0]);
            const g = toByte(value[1] ?? value[0]);
            const b = toByte(value[2] ?? value[0]);
            return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
        }
        if (value && typeof value === 'object') {
            const r = value.r ?? value.red ?? value[0];
            const g = value.g ?? value.green ?? value[1];
            const b = value.b ?? value.blue ?? value[2];
            if ([r, g, b].some(v => v === undefined)) return fallback;
            return normalizeColorValue([+r, +g, +b], fallback);
        }
        if (typeof value === 'string') {
            const parsed = parseColorString(value);
            if (parsed) {
                return `#${byteToHex(parsed.r)}${byteToHex(parsed.g)}${byteToHex(parsed.b)}`;
            }
        }
        if (Number.isFinite(+value)) {
            const channel = clampByte(+value);
            return `#${byteToHex(channel)}${byteToHex(channel)}${byteToHex(channel)}`;
        }
        return fallback;
    };

    const colorFrom = (prop, fallback = DEFAULT_STROKE_COLOR, frame = null) => {
        const value = valueAt(prop, frame, null);
        if (value === null || value === undefined) return fallback;
        return normalizeColorValue(value, fallback);
    };

    const colorWithAlpha = (color, alpha) => {
        const normalizedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
        if (normalizedAlpha >= 0.999) return color;
        if (typeof color !== 'string') return color;
        const parsed = parseColorString(color);
        if (!parsed) return color;
        const rounded = +(normalizedAlpha.toFixed(PRECISION));
        return `rgba(${parsed.r},${parsed.g},${parsed.b},${rounded})`;
    };

    const gradientStopsFrom = (entry, frame = null) => {
        if (!entry || typeof entry !== 'object') return [];
        const gradient = entry.g || entry;
        if (!gradient) return [];
        const rawValue = gradient.k;
        let stopsArray = valueAt(rawValue, frame, null);
        if (!Array.isArray(stopsArray) && rawValue && typeof rawValue === 'object') {
            stopsArray = valueAt(rawValue.k, frame, null);
        }
        if (!Array.isArray(stopsArray)) return [];
        const pointCount = Number.isFinite(+gradient.p) ? +gradient.p : Math.floor(stopsArray.length / 4);
        const colorStops = [];
        for (let i = 0; i < pointCount; i++) {
            const idx = i * 4;
            if (idx + 3 >= stopsArray.length) break;
            const pos = Number.isFinite(+stopsArray[idx]) ? +stopsArray[idx] : i;
            const r = stopsArray[idx + 1];
            const g = stopsArray[idx + 2];
            const b = stopsArray[idx + 3];
            const color = normalizeColorValue([r, g, b], null);
            if (!color) continue;
            colorStops.push({ pos, color, alpha: 1 });
        }
        if (!colorStops.length) return [];
        const alphaStops = [];
        const alphaStart = pointCount * 4;
        for (let i = alphaStart; i + 1 < stopsArray.length; i += 2) {
            const pos = Number.isFinite(+stopsArray[i]) ? +stopsArray[i] : null;
            let alpha = stopsArray[i + 1];
            if (!Number.isFinite(+alpha)) continue;
            alpha = +alpha;
            if (alpha > 1) alpha = alpha > 100 ? alpha / 255 : alpha / 100;
            alpha = Math.max(0, Math.min(1, alpha));
            alphaStops.push({ pos, alpha });
        }
        if (!alphaStops.length) return colorStops;
        return colorStops.map(stop => {
            let closest = stop.alpha;
            let bestDist = Infinity;
            alphaStops.forEach(entry => {
                const entryAlpha = Number.isFinite(entry.alpha) ? entry.alpha : 1;
                const entryPos = Number.isFinite(entry.pos) ? entry.pos : stop.pos;
                const distance = Number.isFinite(entryPos) && Number.isFinite(stop.pos)
                    ? Math.abs(entryPos - stop.pos)
                    : 0;
                if (distance < bestDist) {
                    bestDist = distance;
                    closest = entryAlpha;
                }
            });
            return { ...stop, alpha: closest };
        });
    };

    const gradientToColor = (entry, fallback = DEFAULT_STROKE_COLOR, opacityMultiplier = 1, frame = null) => {
        const stops = gradientStopsFrom(entry, frame);
        if (!stops.length) return colorWithAlpha(fallback, opacityMultiplier);
        let accumR = 0;
        let accumG = 0;
        let accumB = 0;
        let accumAlpha = 0;
        let accumWeight = 0;
        stops.forEach(stop => {
            if (!stop || !stop.color) return;
            const parsed = parseColorString(stop.color);
            if (!parsed) return;
            const alpha = Number.isFinite(stop.alpha) ? Math.max(0, Math.min(1, stop.alpha)) : (Number.isFinite(parsed.a) ? parsed.a : 1);
            if (alpha <= EPSILON) return;
            accumR += parsed.r * alpha;
            accumG += parsed.g * alpha;
            accumB += parsed.b * alpha;
            accumAlpha += alpha;
            accumWeight += alpha;
        });
        if (accumWeight <= EPSILON) return colorWithAlpha(fallback, opacityMultiplier);
        const avgColor = `#${byteToHex(accumR / accumWeight)}${byteToHex(accumG / accumWeight)}${byteToHex(accumB / accumWeight)}`;
        const avgAlpha = accumAlpha / stops.length;
        return colorWithAlpha(avgColor, avgAlpha * opacityMultiplier);
    };

    const matrixFromTransform = (entry, frame = null) => {
        if (!entry || typeof entry !== 'object') return identityMatrix();
        const anchor = pointFrom(entry.a, frame);
        const position = pointFrom(entry.p, frame);
        const scale = scaleFrom(entry.s, frame);
        const rotation = numberFrom(entry.r ?? entry.z ?? entry.rx ?? entry.ry, 0, frame);
        let matrix = identityMatrix();
        matrix = multiplyMatrix(matrix, translateMatrix(position.x, position.y));
        if (Math.abs(rotation) > EPSILON) matrix = multiplyMatrix(matrix, rotateMatrix(rotation));
        matrix = multiplyMatrix(matrix, scaleMatrix(scale.x, scale.y));
        matrix = multiplyMatrix(matrix, translateMatrix(-anchor.x, -anchor.y));
        return matrix;
    };

    const isLottieAnimation = (data) => {
        if (!data || typeof data !== 'object') return false;
        if (Array.isArray(data.layers) && (typeof data.v === 'string' || Number.isFinite(+data.ip) || Number.isFinite(+data.op))) {
            return true;
        }
        return false;
    };

    const resolvePathValue = (raw, frame = null) => {
        if (!raw) return null;
        let pathValue = valueAt(raw, frame, null);
        if ((!pathValue || !pathValue.v) && Array.isArray(raw.k) && raw.k.length) {
            const first = raw.k[0];
            if (first && typeof first === 'object') {
                const source = Array.isArray(first.s) ? first.s[0] : first.s;
                if (source && source.v) pathValue = source;
            }
        }
        if (!pathValue || !Array.isArray(pathValue.v)) return null;
        return cloneValue(pathValue);
    };

    const geometryFromPathValue = (pathValue, matrix) => {
        if (!pathValue) return null;
        const vertices = Array.isArray(pathValue.v) ? pathValue.v : [];
        const count = vertices.length;
        if (count < 2) return null;
        const inTangents = Array.isArray(pathValue.i) ? pathValue.i : [];
        const outTangents = Array.isArray(pathValue.o) ? pathValue.o : [];
        const closed = !!pathValue.c;
        const segments = [];
        const worldPoints = [];

        const appendPoint = (pt) => {
            if (!pt) return null;
            const last = worldPoints[worldPoints.length - 1];
            if (!last || distanceBetween(last, pt) > EPSILON) {
                worldPoints.push({ x: pt.x, y: pt.y });
            }
            return worldPoints[worldPoints.length - 1];
        };

        const totalSegments = closed ? count : count - 1;
        for (let idx = 0; idx < totalSegments; idx++) {
            const nextIndex = (idx + 1) % count;
            const anchor = pointFrom(vertices[idx]);
            const nextAnchor = pointFrom(vertices[nextIndex]);
            if (!anchor || !nextAnchor) continue;
            const inTanRaw = pointFrom(inTangents[nextIndex]);
            const outTanRaw = pointFrom(outTangents[idx]);
            const startWorld = applyMatrixPoint(matrix, anchor);
            const endWorld = applyMatrixPoint(matrix, nextAnchor);
            const cp1Local = { x: anchor.x + outTanRaw.x, y: anchor.y + outTanRaw.y };
            const cp2Local = { x: nextAnchor.x + inTanRaw.x, y: nextAnchor.y + inTanRaw.y };
            const cp1World = applyMatrixPoint(matrix, cp1Local);
            const cp2World = applyMatrixPoint(matrix, cp2Local);
            appendPoint(startWorld);

            const isCurve = distanceBetween(startWorld, cp1World) > EPSILON
                || distanceBetween(endWorld, cp2World) > EPSILON;

            if (isCurve) {
                const samples = approximateCubicSegment(startWorld, cp1World, cp2World, endWorld);
                for (let i = 1; i < samples.length; i++) {
                    const prev = samples[i - 1];
                    const curr = samples[i];
                    if (distanceBetween(prev, curr) <= EPSILON) continue;
                    segments.push({ kind: 'line', p1: { x: prev.x, y: prev.y }, p2: { x: curr.x, y: curr.y } });
                    appendPoint(curr);
                }
            } else {
                if (distanceBetween(startWorld, endWorld) > EPSILON) {
                    segments.push({ kind: 'line', p1: { x: startWorld.x, y: startWorld.y }, p2: { x: endWorld.x, y: endWorld.y } });
                    appendPoint(endWorld);
                }
            }
        }

        return worldPoints.length >= 2 ? { points: worldPoints, segments, closed } : null;
    };

    const geometryFromRectangle = (entry, matrix, frame) => {
        const size = pointFrom(entry.s, frame);
        const position = pointFrom(entry.p, frame);
        if (!size || !position) return null;
        const width = Number.isFinite(+size.x) ? +size.x : 0;
        const height = Number.isFinite(+size.y) ? +size.y : 0;
        if (Math.abs(width) <= EPSILON || Math.abs(height) <= EPSILON) return null;
        const halfW = width / 2;
        const halfH = height / 2;
        const radiusRaw = Math.abs(numberFrom(entry.r, 0, frame));
        const radius = Math.min(radiusRaw, Math.abs(halfW), Math.abs(halfH));
        const localPoints = [];

        const pushPoint = (pt) => {
            if (!pt) return;
            const last = localPoints[localPoints.length - 1];
            if (!last || distanceBetween(last, pt) > EPSILON) {
                localPoints.push({ x: pt.x, y: pt.y });
            }
        };

        if (radius <= EPSILON) {
            pushPoint({ x: position.x + halfW, y: position.y - halfH });
            pushPoint({ x: position.x + halfW, y: position.y + halfH });
            pushPoint({ x: position.x - halfW, y: position.y + halfH });
            pushPoint({ x: position.x - halfW, y: position.y - halfH });
            return buildGeometryFromPoints(localPoints, matrix, true);
        }

        const cornerCenters = [
            { cx: position.x + halfW - radius, cy: position.y - halfH + radius, start: -Math.PI / 2, end: 0 },
            { cx: position.x + halfW - radius, cy: position.y + halfH - radius, start: 0, end: Math.PI / 2 },
            { cx: position.x - halfW + radius, cy: position.y + halfH - radius, start: Math.PI / 2, end: Math.PI },
            { cx: position.x - halfW + radius, cy: position.y - halfH + radius, start: Math.PI, end: 3 * Math.PI / 2 }
        ];

        const pushArc = (center, startAngle, endAngle, includeStart) => {
            const sweep = endAngle - startAngle;
            const steps = Math.max(4, Math.ceil(Math.abs(sweep) * radius / 12));
            for (let i = 0; i <= steps; i++) {
                if (!includeStart && i === 0) continue;
                const t = i / steps;
                const angle = startAngle + sweep * t;
                pushPoint({
                    x: center.cx + Math.cos(angle) * radius,
                    y: center.cy + Math.sin(angle) * radius
                });
            }
        };

        const pushLine = (from, to) => {
            pushPoint(from);
            pushPoint(to);
        };

        const topRightStart = { x: position.x + halfW - radius, y: position.y - halfH };
        pushPoint(topRightStart);
        pushArc(cornerCenters[0], cornerCenters[0].start, cornerCenters[0].end, false);
        pushLine({ x: position.x + halfW, y: position.y - halfH + radius }, { x: position.x + halfW, y: position.y + halfH - radius });
        pushArc(cornerCenters[1], cornerCenters[1].start, cornerCenters[1].end, false);
        pushLine({ x: position.x + halfW - radius, y: position.y + halfH }, { x: position.x - halfW + radius, y: position.y + halfH });
        pushArc(cornerCenters[2], cornerCenters[2].start, cornerCenters[2].end, false);
        pushLine({ x: position.x - halfW, y: position.y + halfH - radius }, { x: position.x - halfW, y: position.y - halfH + radius });
        pushArc(cornerCenters[3], cornerCenters[3].start, cornerCenters[3].end, false);
        pushLine({ x: position.x - halfW + radius, y: position.y - halfH }, topRightStart);

        if (entry.d === 3 || entry.d === -1) localPoints.reverse();

        return buildGeometryFromPoints(localPoints, matrix, true);
    };

    const geometryFromEllipse = (entry, matrix, frame) => {
        const size = pointFrom(entry.s, frame);
        const position = pointFrom(entry.p, frame);
        if (!size || !position) return null;
        const width = Number.isFinite(+size.x) ? +size.x : 0;
        const height = Number.isFinite(+size.y) ? +size.y : 0;
        if (Math.abs(width) <= EPSILON || Math.abs(height) <= EPSILON) return null;
        const steps = Math.max(24, Math.ceil(Math.max(Math.abs(width), Math.abs(height)) / 12));
        const localPoints = [];
        const dir = (entry.d === 3 || entry.d === -1) ? -1 : 1;
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const angle = -Math.PI / 2 + dir * t * Math.PI * 2;
            const x = position.x + Math.cos(angle) * (width / 2);
            const y = position.y + Math.sin(angle) * (height / 2);
            localPoints.push({ x, y });
        }
        if (dir < 0) localPoints.reverse();
        return buildGeometryFromPoints(localPoints, matrix, true);
    };

    const geometryFromPolystar = (entry, matrix, frame) => {
        const position = pointFrom(entry.p, frame);
        if (!position) return null;
        const pointCount = Math.max(3, Math.round(numberFrom(entry.pt, 5, frame)));
        const outerRadius = Math.abs(numberFrom(entry.or, numberFrom(entry.r, 0, frame), frame));
        if (!Number.isFinite(outerRadius) || outerRadius <= EPSILON) return null;
        const innerRadiusRaw = numberFrom(entry.ir, outerRadius / 2, frame);
        const type = entry.sy === 2 ? 'polygon' : 'star';
        const isStar = type === 'star' && Number.isFinite(innerRadiusRaw) && innerRadiusRaw > EPSILON;
        const innerRadius = isStar ? Math.min(Math.abs(innerRadiusRaw), Math.abs(outerRadius)) : outerRadius;
        const totalPoints = isStar ? pointCount * 2 : pointCount;
        const rotationDeg = numberFrom(entry.r, 0, frame);
        const rotation = (rotationDeg - 90) * Math.PI / 180;
        const dir = (entry.d === 3 || entry.d === -1) ? -1 : 1;
        const localPoints = [];
        for (let i = 0; i < totalPoints; i++) {
            const angle = rotation + dir * (i / totalPoints) * Math.PI * 2;
            const radius = isStar && (i % 2 === 1) ? innerRadius : outerRadius;
            const x = position.x + Math.cos(angle) * radius;
            const y = position.y + Math.sin(angle) * radius;
            localPoints.push({ x, y });
        }
        return buildGeometryFromPoints(localPoints, matrix, true);
    };

    const buildShapeGeometry = (entry, matrix, frame) => {
        if (!entry) return null;
        if (entry.ty === 'sh') {
            const pathValue = resolvePathValue(entry.ks, frame);
            return geometryFromPathValue(pathValue, matrix);
        }
        if (entry.ty === 'rc') {
            return geometryFromRectangle(entry, matrix, frame);
        }
        if (entry.ty === 'el') {
            return geometryFromEllipse(entry, matrix, frame);
        }
        if (entry.ty === 'sr') {
            return geometryFromPolystar(entry, matrix, frame);
        }
        return null;
    };

    const collectKeyframeTimes = (prop, set) => {
        if (!prop || typeof prop !== 'object') return;
        const addFromArray = (arr) => {
            if (!Array.isArray(arr)) return;
            arr.forEach(entry => {
                const time = Number.isFinite(+entry?.t) ? +entry.t : null;
                if (time !== null) set.add(time);
            });
        };
        if (prop.a && Array.isArray(prop.k)) addFromArray(prop.k);
        if (prop.k && typeof prop.k === 'object') {
            if (Array.isArray(prop.k)) addFromArray(prop.k);
            if (prop.k.a && Array.isArray(prop.k.k)) addFromArray(prop.k.k);
        }
        if (prop.x && typeof prop.x === 'object') collectKeyframeTimes(prop.x, set);
        if (prop.y && typeof prop.y === 'object') collectKeyframeTimes(prop.y, set);
        if (prop.z && typeof prop.z === 'object') collectKeyframeTimes(prop.z, set);
    };

    const collectTransformTimes = (transform, set) => {
        if (!transform || typeof transform !== 'object') return;
        ['a', 'p', 's', 'r', 'rx', 'ry', 'rz', 'o'].forEach(key => {
            if (transform[key] !== undefined) collectKeyframeTimes(transform[key], set);
        });
    };

    const collectShapeTimes = (entries, set) => {
        if (!Array.isArray(entries)) return;
        entries.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            if (entry.ty === 'tr') {
                collectTransformTimes(entry, set);
                return;
            }
            if (entry.ty === 'gr') {
                collectShapeTimes(entry.it || [], set);
                return;
            }
            if (entry.ty === 'sh') {
                collectKeyframeTimes(entry.ks, set);
                return;
            }
            if (entry.ty === 'rc' || entry.ty === 'el' || entry.ty === 'sr') {
                collectKeyframeTimes(entry.s, set);
                collectKeyframeTimes(entry.p, set);
                collectKeyframeTimes(entry.r, set);
                collectKeyframeTimes(entry.or, set);
                collectKeyframeTimes(entry.ir, set);
                collectKeyframeTimes(entry.pt, set);
                return;
            }
            if (entry.ty === 'st' || entry.ty === 'gs') {
                collectKeyframeTimes(entry.c, set);
                collectKeyframeTimes(entry.o, set);
                collectKeyframeTimes(entry.w, set);
                return;
            }
            if (entry.ty === 'fl' || entry.ty === 'gf') {
                collectKeyframeTimes(entry.c, set);
                collectKeyframeTimes(entry.o, set);
            }
        });
    };

    const convertLottieToPack = (data) => {
        const width = Number.isFinite(+data.w) && +data.w > 0 ? +data.w : 512;
        const height = Number.isFinite(+data.h) && +data.h > 0 ? +data.h : 512;
        const layers = Array.isArray(data.layers) ? data.layers : [];
        const layerMap = new Map();
        layers.forEach(layer => {
            if (layer && Number.isFinite(+layer.ind)) {
                layerMap.set(+layer.ind, layer);
            }
        });

        if (api.sizeStage) {
            try {
                api.sizeStage();
            } catch (err) {
                console.warn('Stage sizing failed before Lottie conversion:', err);
            }
        }

        const stageSize = api.getCSSSize ? api.getCSSSize() : null;
        const targetWidth = Number.isFinite(+stageSize?.w) && +stageSize.w > 0
            ? +stageSize.w
            : (Number.isFinite(+canvas?.width) && +canvas.width > 0 ? +canvas.width : width);
        const targetHeight = Number.isFinite(+stageSize?.h) && +stageSize.h > 0
            ? +stageSize.h
            : (Number.isFinite(+canvas?.height) && +canvas.height > 0 ? +canvas.height : height);

        const scaleX = width > 0 ? targetWidth / width : 1;
        const scaleY = height > 0 ? targetHeight / height : 1;
        let uniformScale = Math.min(
            Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
            Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
        );
        if (!Number.isFinite(uniformScale) || uniformScale <= 0) uniformScale = 1;

        const frameRate = Number.isFinite(+data.fr) && +data.fr > 0 ? +data.fr : 30;
        const inPoint = Number.isFinite(+data.ip) ? +data.ip : 0;
        const outPointRaw = Number.isFinite(+data.op) ? +data.op : inPoint + frameRate;
        const outPoint = outPointRaw > inPoint ? outPointRaw : inPoint + frameRate;

        const norm = (value, denom) => {
            if (!Number.isFinite(value) || !Number.isFinite(denom) || denom === 0) return 0;
            return +((value / denom).toFixed(PRECISION));
        };

        const cloneState = (state) => ({
            transform: Array.isArray(state.transform) ? state.transform.slice() : identityMatrix(),
            strokeColor: state.strokeColor,
            strokeWidth: state.strokeWidth,
            fill: state.fill
        });

        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        };

        const updateBounds = (pt) => {
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
            bounds.minX = Math.min(bounds.minX, pt.x);
            bounds.minY = Math.min(bounds.minY, pt.y);
            bounds.maxX = Math.max(bounds.maxX, pt.x);
            bounds.maxY = Math.max(bounds.maxY, pt.y);
        };

        const frameSet = new Set([inPoint, outPoint]);
        layers.forEach(layer => {
            if (!layer) return;
            collectTransformTimes(layer.ks, frameSet);
            collectShapeTimes(layer.shapes || [], frameSet);
        });

        const clampedFrames = new Set();
        frameSet.forEach(time => {
            if (!Number.isFinite(time)) return;
            const clamped = Math.max(inPoint, Math.min(outPoint, time));
            clampedFrames.add(clamped);
        });
        if (!clampedFrames.size) {
            clampedFrames.add(inPoint);
            clampedFrames.add(outPoint);
        }
        let sampleFrames = Array.from(clampedFrames).sort((a, b) => a - b);
        if (sampleFrames.length === 1 && sampleFrames[0] !== outPoint) sampleFrames.push(outPoint);
        const MAX_SAMPLES = 12;
        if (sampleFrames.length > MAX_SAMPLES) {
            const reduced = [];
            const span = sampleFrames.length - 1;
            for (let i = 0; i < MAX_SAMPLES; i++) {
                const t = span === 0 ? 0 : (i / (MAX_SAMPLES - 1));
                const index = Math.min(sampleFrames.length - 1, Math.round(t * span));
                reduced.push(sampleFrames[index]);
            }
            sampleFrames = Array.from(new Set(reduced)).sort((a, b) => a - b);
        }

        const frameSamples = new Map();

        const sampleFrame = (frame) => {
            const shapes = [];
            const transformCache = new Map();
            const layerSequences = new Map();

            const layerWorldMatrix = (layer) => {
                if (!layer) return identityMatrix();
                const cacheKey = Number.isFinite(+layer.ind) ? +layer.ind : layer;
                if (transformCache.has(cacheKey)) return transformCache.get(cacheKey);
                let matrix = matrixFromTransform(layer.ks, frame);
                if (Number.isFinite(+layer.parent)) {
                    const parent = layerMap.get(+layer.parent);
                    if (parent) {
                        matrix = multiplyMatrix(layerWorldMatrix(parent), matrix);
                    }
                }
                transformCache.set(cacheKey, matrix);
                return matrix;
            };

            const pushShape = (shapeNode, state, layerMeta) => {
                if (!shapeNode || typeof shapeNode !== 'object' || shapeNode.hd) return null;
                const geometry = buildShapeGeometry(shapeNode, state.transform, frame);
                if (!geometry || !Array.isArray(geometry.points) || geometry.points.length < 2) return null;
                geometry.points.forEach(updateBounds);
                const layerKey = layerMeta.key;
                const seq = (layerSequences.get(layerKey) || 0) + 1;
                layerSequences.set(layerKey, seq);
                const entry = {
                    key: `${layerKey}#${seq}`,
                    layerName: layerMeta.name,
                    layerKey,
                    sequence: seq,
                    points: geometry.points,
                    closed: geometry.closed !== false,
                    segments: Array.isArray(geometry.segments) ? geometry.segments : [],
                    strokeColor: state.strokeColor || DEFAULT_STROKE_COLOR,
                    strokeWidth: Number.isFinite(+state.strokeWidth) ? Math.max(0, +state.strokeWidth) : 0,
                    fill: geometry.closed === false ? null : state.fill
                };
                shapes.push(entry);
                return entry;
            };

            const parseGroup = (entries, incomingState, layerMeta) => {
                if (!Array.isArray(entries)) return [];
                const transformEntry = entries.find(entry => entry && entry.ty === 'tr');
                const baseTransform = transformEntry
                    ? multiplyMatrix(incomingState.transform, matrixFromTransform(transformEntry, frame))
                    : incomingState.transform;
                const state = {
                    transform: baseTransform,
                    strokeColor: incomingState.strokeColor,
                    strokeWidth: incomingState.strokeWidth,
                    fill: incomingState.fill
                };
                const shapesInGroup = [];
                const applyStrokeState = () => {
                    const strokeColor = state.strokeColor || DEFAULT_STROKE_COLOR;
                    const strokeWidth = Number.isFinite(+state.strokeWidth) ? Math.max(0, +state.strokeWidth) : 0;
                    shapesInGroup.forEach(shape => {
                        shape.strokeColor = strokeColor;
                        shape.strokeWidth = strokeWidth;
                    });
                };
                const applyFillState = () => {
                    const fillValue = state.fill;
                    shapesInGroup.forEach(shape => {
                        shape.fill = shape.closed === false ? null : fillValue;
                    });
                };
                entries.forEach(entry => {
                    if (!entry || entry.ty === 'tr') return;
                    if (entry.ty === 'gr') {
                        const nestedShapes = parseGroup(entry.it || [], cloneState(state), layerMeta);
                        shapesInGroup.push(...nestedShapes);
                        return;
                    }
                    if (entry.ty === 'st') {
                        const opacity = opacityFrom(entry.o, frame);
                        if (opacity <= 0) {
                            state.strokeWidth = 0;
                        } else {
                            const strokeColor = colorFrom(entry.c, state.strokeColor || DEFAULT_STROKE_COLOR, frame);
                            state.strokeColor = colorWithAlpha(strokeColor, opacity);
                            const width = numberFrom(entry.w, state.strokeWidth, frame);
                            if (Number.isFinite(width)) state.strokeWidth = Math.max(0, width);
                        }
                        applyStrokeState();
                        return;
                    }
                    if (entry.ty === 'gs') {
                        const opacity = opacityFrom(entry.o, frame);
                        if (opacity <= 0) {
                            state.strokeWidth = 0;
                        } else {
                            state.strokeColor = gradientToColor(entry, state.strokeColor || DEFAULT_STROKE_COLOR, opacity, frame);
                            const width = numberFrom(entry.w, state.strokeWidth, frame);
                            if (Number.isFinite(width)) state.strokeWidth = Math.max(0, width);
                        }
                        applyStrokeState();
                        return;
                    }
                    if (entry.ty === 'fl') {
                        const opacity = opacityFrom(entry.o, frame);
                        if (opacity <= 0) state.fill = null;
                        else {
                            const fillColor = colorFrom(entry.c, state.fill || DEFAULT_STROKE_COLOR, frame);
                            state.fill = colorWithAlpha(fillColor, opacity);
                        }
                        applyFillState();
                        return;
                    }
                    if (entry.ty === 'gf') {
                        const opacity = opacityFrom(entry.o, frame);
                        state.fill = opacity <= 0 ? null : gradientToColor(entry, state.fill || DEFAULT_STROKE_COLOR, opacity, frame);
                        applyFillState();
                        return;
                    }
                    if (entry.ty === 'sh' || entry.ty === 'rc' || entry.ty === 'el' || entry.ty === 'sr') {
                        const shape = pushShape(entry, state, layerMeta);
                        if (shape) shapesInGroup.push(shape);
                    }
                });
                return shapesInGroup;
            };

            layers.forEach((layer, idx) => {
                if (!layer || layer.ty !== 4) return;
                if (layer.hd || layer.tt) return;
                const opacity = opacityFrom(layer.ks?.o, frame);
                if (opacity <= 0) return;
                const layerMatrix = layerWorldMatrix(layer);
                const layerName = typeof layer.nm === 'string' ? layer.nm.trim() : '';
                const layerId = Number.isFinite(+layer.ind) ? +layer.ind : idx;
                const layerMeta = {
                    key: `layer:${layerId}`,
                    name: layerName
                };
                const baseState = {
                    transform: layerMatrix,
                    strokeColor: DEFAULT_STROKE_COLOR,
                    strokeWidth: 0,
                    fill: null
                };
                parseGroup(layer.shapes || [], baseState, layerMeta);
            });

            return shapes;
        };

        sampleFrames.forEach(frame => {
            const shapes = sampleFrame(frame);
            frameSamples.set(frame, shapes);
        });

        const hasBounds = Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY)
            && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY);
        if (hasBounds) {
            const boundsWidth = bounds.maxX - bounds.minX;
            const boundsHeight = bounds.maxY - bounds.minY;
            if (boundsWidth > EPSILON && boundsHeight > EPSILON) {
                const boundScale = Math.min(
                    targetWidth / boundsWidth,
                    targetHeight / boundsHeight
                );
                if (Number.isFinite(boundScale) && boundScale > 0) {
                    uniformScale = Math.min(uniformScale, boundScale);
                }
            }
        }

        let offsetX = (targetWidth - width * uniformScale) / 2;
        let offsetY = (targetHeight - height * uniformScale) / 2;
        if (hasBounds) {
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            offsetX = targetWidth / 2 - centerX * uniformScale;
            offsetY = targetHeight / 2 - centerY * uniformScale;
        }

        const toStagePoint = (pt) => ({
            x: pt.x * uniformScale + offsetX,
            y: pt.y * uniformScale + offsetY
        });

        const geometryToElement = (geo, override = {}) => {
            const stagePoints = [];
            geo.points.forEach(pt => {
                const stage = toStagePoint(pt);
                if (!stage) return;
                const last = stagePoints[stagePoints.length - 1];
                if (!last || distanceBetween(last, stage) > EPSILON) {
                    stagePoints.push({ x: stage.x, y: stage.y });
                }
            });
            if (geo.closed && stagePoints.length > 1) {
                const first = stagePoints[0];
                const last = stagePoints[stagePoints.length - 1];
                if (distanceBetween(first, last) > EPSILON) {
                    stagePoints.push({ x: first.x, y: first.y });
                }
            }
            if (stagePoints.length < 2) return null;
            let simplifiedPoints = stagePoints;
            if (stagePoints.length > 3) {
                const tolerance = Math.max(targetWidth, targetHeight) * 0.004;
                const reduced = simplifyPath(stagePoints, tolerance);
                if (Array.isArray(reduced) && reduced.length >= 2) simplifiedPoints = reduced;
            }
            if (geo.closed && simplifiedPoints.length > 1) {
                const first = simplifiedPoints[0];
                const last = simplifiedPoints[simplifiedPoints.length - 1];
                if (distanceBetween(first, last) > EPSILON) {
                    simplifiedPoints = simplifiedPoints.concat([{ x: first.x, y: first.y }]);
                }
            }
            const path = simplifiedPoints.map(pt => ({
                x: norm(pt.x, targetWidth),
                y: norm(pt.y, targetHeight)
            }));
            const scaledStroke = geo.strokeWidth * uniformScale;
            const element = {
                id: override.id || rndId('lt'),
                type: 'shape',
                kind: 'shape',
                color: geo.strokeColor || DEFAULT_STROKE_COLOR,
                width: Number.isFinite(scaledStroke) ? Math.max(0, scaledStroke) : 0,
                path,
                visible: true
            };
            if (override.name) element.name = override.name;
            if (geo.fill !== undefined && geo.fill !== null && geo.closed !== false) element.fill = geo.fill;
            return element;
        };

        const items = [];
        const groupByLayer = new Map();
        const shapeRegistry = new Map();
        const layerNameCounts = new Map();

        const ensureLayerGroup = (meta) => {
            if (!meta || !meta.layerKey) return null;
            if (!groupByLayer.has(meta.layerKey)) {
                const label = meta.layerName && meta.layerName.length ? meta.layerName : `Layer ${groupByLayer.size + 1}`;
                const group = {
                    id: rndId('lg'),
                    type: 'group',
                    kind: 'group',
                    name: label,
                    color: DEFAULT_STROKE_COLOR,
                    width: 0,
                    rot: 0,
                    visible: true,
                    children: []
                };
                groupByLayer.set(meta.layerKey, group);
                items.push(group);
            }
            return groupByLayer.get(meta.layerKey);
        };

        sampleFrames.forEach(frame => {
            const shapes = frameSamples.get(frame) || [];
            shapes.forEach(geo => {
                if (!shapeRegistry.has(geo.key)) {
                    shapeRegistry.set(geo.key, { id: rndId('lt') });
                }
            });
        });

        const baseFrame = sampleFrames[0];
        const baseShapes = frameSamples.get(baseFrame) || [];
        baseShapes.forEach(geo => {
            const registry = shapeRegistry.get(geo.key) || { id: rndId('lt') };
            shapeRegistry.set(geo.key, registry);
            const countKey = geo.layerKey;
            const count = (layerNameCounts.get(countKey) || 0) + 1;
            layerNameCounts.set(countKey, count);
            const label = geo.layerName ? `${geo.layerName} #${count}` : undefined;
            if (!registry.name && label) registry.name = label;
            const element = geometryToElement(geo, { id: registry.id, name: registry.name || label });
            if (!element) return;
            const group = ensureLayerGroup({ layerKey: geo.layerKey, layerName: geo.layerName });
            items.push(element);
            if (group && !group.children.includes(element.id)) group.children.push(element.id);
        });

        const presentIds = new Set(items.filter(it => it && typeof it === 'object' && it.id).map(it => it.id));
        shapeRegistry.forEach((registry, key) => {
            if (presentIds.has(registry.id)) return;
            for (const frame of sampleFrames) {
                const shapes = frameSamples.get(frame) || [];
                const geo = shapes.find(entry => entry.key === key);
                if (!geo) continue;
                const element = geometryToElement(geo, { id: registry.id, name: registry.name });
                if (!element) break;
                const group = ensureLayerGroup({ layerKey: geo.layerKey, layerName: geo.layerName });
                items.push(element);
                if (group && !group.children.includes(element.id)) group.children.push(element.id);
                presentIds.add(element.id);
                break;
            }
        });

        const staticGroups = Array.from(groupByLayer.values()).map(group => cloneValue(group));

        const keyframes = sampleFrames.map(frame => {
            const shapes = frameSamples.get(frame) || [];
            const shapeMap = new Map(shapes.map(geo => [geo.key, geo]));
            const snapshot = staticGroups.map(group => cloneValue(group));
            shapeRegistry.forEach((registry, key) => {
                const geo = shapeMap.get(key);
                if (!geo) return;
                const element = geometryToElement(geo, { id: registry.id, name: registry.name });
                if (element) snapshot.push(element);
            });
            const sec = (frame - inPoint) / frameRate;
            return {
                t: Number.isFinite(sec) ? +(+sec).toFixed(3) : 0,
                snapshot
            };
        }).filter(entry => entry.snapshot.length);

        const duration = Math.max(0, (Math.max(...sampleFrames) - inPoint) / frameRate);
        const durationFallback = keyframes.length ? Math.max(...keyframes.map(k => k.t || 0)) : 0;
        const animationName = typeof data.nm === 'string' && data.nm.trim().length ? data.nm.trim() : 'Lottie Animation';
        const animations = keyframes.length ? [{
            id: rndId('anim'),
            name: animationName,
            duration: +(Math.max(duration, durationFallback)).toFixed(3),
            keyframes
        }] : [];

        return {
            type: 'LinePack',
            version: 2,
            size: { w: targetWidth, h: targetHeight },
            elements: items,
            animations
        };
    };

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

    const KIND_SHORT = {
        line: 'l',
        quadratic: 'q',
        shape: 's',
        group: 'g'
    };

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

    const toPoint = (value) => {
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
    };

    const expandPath = (pathSource) => {
        if (typeof pathSource === 'string') {
            const decoded = decodePointSequence(pathSource);
            if (Array.isArray(decoded) && decoded.length) {
                return decoded.map(pair => ({
                    x: Number.isFinite(+pair[0]) ? +pair[0] : 0,
                    y: Number.isFinite(+pair[1]) ? +pair[1] : 0
                }));
            }
            return [];
        }
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
    };

    const expandCompactItem = (entry) => {
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
            if ((!start || !end) && typeof points === 'string') {
                const decoded = decodePointSequence(points);
                if (Array.isArray(decoded) && decoded.length >= 2) {
                    [start, end] = decoded;
                    if (decoded.length >= 3) control = decoded[2];
                }
            }
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
            const segSource = entry.segments;
            if (typeof segSource === 'string') {
                const decodedSegments = decodeSegmentSequence(segSource);
                if (Array.isArray(decodedSegments) && decodedSegments.length) base.segments = decodedSegments.map(seg => cloneValue(seg));
            } else if (Array.isArray(segSource)) {
                base.segments = segSource.map(seg => cloneValue(seg));
            }
            if (Array.isArray(entry.children)) base.children = entry.children.slice();
        } else if (kind === 'group') {
            if (Array.isArray(entry.children)) base.children = entry.children.slice();
        }
        return base;
    };

    const extractRemovedIds = (list) => {
        if (!Array.isArray(list)) return [];
        return list.map(entry => {
            if (entry === null || entry === undefined) return null;
            if (typeof entry === 'string' || typeof entry === 'number') return entry;
            if (typeof entry === 'object') {
                return entry.id ?? entry.i ?? entry.item ?? entry.target ?? null;
            }
            return null;
        }).filter(id => id !== null && id !== undefined);
    };

    const expandCompactKeyframe = (entry) => {
        if (!entry) return null;
        if (Array.isArray(entry)) {
            const [time, snapshot] = entry;
            entry = { t: time, s: snapshot };
        }
        if (typeof entry !== 'object') return null;
        const t = +(entry.t ?? entry.time ?? entry.sec ?? 0);
        if (!Number.isFinite(t)) return null;
        const snapshotSource = entry.snapshot ?? entry.s ?? entry.items ?? null;
        const snapshot = Array.isArray(snapshotSource)
            ? snapshotSource.map(expandCompactItem).filter(Boolean)
            : null;
        const updatesDefined = Object.prototype.hasOwnProperty.call(entry, 'u')
            || Object.prototype.hasOwnProperty.call(entry, 'updates')
            || Object.prototype.hasOwnProperty.call(entry, 'delta')
            || Object.prototype.hasOwnProperty.call(entry, 'changes');
        const updatesSource = updatesDefined
            ? (entry.updates ?? entry.u ?? entry.delta ?? entry.changes ?? [])
            : null;
        const updates = updatesDefined
            ? (Array.isArray(updatesSource)
                ? updatesSource.map(expandCompactItem).filter(Boolean)
                : [])
            : null;
        const removedDefined = Object.prototype.hasOwnProperty.call(entry, 'r')
            || Object.prototype.hasOwnProperty.call(entry, 'removed')
            || Object.prototype.hasOwnProperty.call(entry, 'x');
        const removedSource = removedDefined
            ? (entry.removed ?? entry.r ?? entry.x ?? [])
            : null;
        const removed = removedDefined
            ? extractRemovedIds(removedSource)
            : null;
        return { t, snapshot, updates, removed, hasUpdates: updatesDefined, hasRemoved: removedDefined };
    };

    const expandCompactAnimation = (entry) => {
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
        const rawFrames = Array.isArray(keyframesSource)
            ? keyframesSource.map(expandCompactKeyframe).filter(Boolean)
            : [];
        const keyframes = [];
        let current = [];
        const indexMap = new Map();
        const rebuildIndex = () => {
            indexMap.clear();
            current.forEach((item, idx) => {
                if (item && item.id) indexMap.set(item.id, idx);
            });
        };
        rawFrames.forEach(frame => {
            if (!frame) return;
            if (Array.isArray(frame.snapshot)) {
                const baseSnapshot = frame.snapshot.map(item => cloneValue(item));
                current = baseSnapshot.map(item => cloneValue(item));
                rebuildIndex();
                keyframes.push({ t: frame.t, snapshot: baseSnapshot });
                return;
            }
            const updatesList = Array.isArray(frame.updates) ? frame.updates : [];
            const removedList = Array.isArray(frame.removed) ? frame.removed : [];
            const hasHold = frame.hasUpdates || frame.hasRemoved;
            if (!updatesList.length && !removedList.length && !hasHold) return;
            let changed = false;
            if (updatesList.length) {
                updatesList.forEach(item => {
                    if (!item || !item.id) return;
                    const cloneItem = cloneValue(item);
                    if (indexMap.has(item.id)) {
                        const idx = indexMap.get(item.id);
                        current[idx] = cloneItem;
                    } else {
                        indexMap.set(item.id, current.length);
                        current.push(cloneItem);
                    }
                    changed = true;
                });
            }
            if (removedList.length) {
                const removeSet = new Set(removedList);
                if (removeSet.size) {
                    const next = [];
                    current.forEach(item => {
                        if (!item || !item.id) return;
                        if (removeSet.has(item.id)) return;
                        next.push(item);
                    });
                    if (next.length !== current.length) {
                        current = next;
                        changed = true;
                    }
                    rebuildIndex();
                }
            }
            if (changed) rebuildIndex();
            if (!changed && !hasHold) return;
            const snapshotOut = current.map(item => cloneValue(item));
            keyframes.push({ t: frame.t, snapshot: snapshotOut });
        });
        return {
            id: id ?? `anim_${Math.random().toString(36).slice(2, 8)}`,
            name,
            duration,
            keyframes
        };
    };

    const expandCompactPack = (pack) => {
        if (!pack || typeof pack !== 'object') return pack;
        if (pack.type) return pack;
        if (!('t' in pack)) return pack;
        const versionGuess = +(pack.v ?? pack.version ?? 0);
        if ((versionGuess >= 4) || typeof pack.d === 'string') {
            const payloadText = typeof pack.d === 'string'
                ? pack.d
                : (typeof pack.data === 'string' ? pack.data : (typeof pack.payload === 'string' ? pack.payload : null));
            const unpacked = unpackUltraPayload(payloadText);
            if (unpacked) return expandCompactPack(unpacked);
        }
        if (versionGuess >= 3 && (Array.isArray(pack.e) || typeof pack.e === 'string' || typeof pack.a === 'string')) {
            const legacy = convertUltraToLegacy(pack);
            if (legacy) return expandCompactPack(legacy);
        }
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
            const geometry = simplifySegments(it, w, h);
            const children = Array.isArray(it.children) ? it.children.filter(Boolean) : [];
            const out = {
                ...base,
                fill: it.fill ?? null
            };
            if (geometry.length) out.geometry = geometry;
            if (children.length) out.children = children.slice();
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

    function normalizeSummaryItem(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const copy = cloneSimplified(entry);
        copy.id = copy.id || copy.name || copy.item || copy.uid;
        const type = copy.type || copy.kind;
        if (!copy.id || !type) return null;
        copy.type = type;
        copy.kind = copy.kind || type;
        return copy;
    }

    function extractFrames(track) {
        const raw = track?.frames ?? track?.keyframes ?? track?.timeline ?? [];
        const frames = [];
        const pushFrame = (time, payload) => {
            const t = +time;
            if (!Number.isFinite(t)) return;
            frames.push({ time: t, diff: payload === undefined ? null : cloneValue(payload) });
        };
        if (Array.isArray(raw)) {
            raw.forEach(entry => {
                if (Array.isArray(entry)) {
                    pushFrame(entry[0], entry[1]);
                    return;
                }
                if (entry && typeof entry === 'object') {
                    const time = entry.time ?? entry.t ?? entry.sec ?? entry.frame ?? entry.index;
                    if (time === undefined) return;
                    const payload = entry.diff ?? entry.delta ?? entry.changes ?? entry.props ?? entry.state ?? entry.value ?? entry.data ?? entry.payload;
                    if (payload !== undefined) pushFrame(time, payload);
                    else {
                        const clone = { ...entry };
                        delete clone.time;
                        delete clone.t;
                        delete clone.sec;
                        delete clone.frame;
                        delete clone.index;
                        pushFrame(time, clone);
                    }
                }
            });
        } else if (raw && typeof raw === 'object') {
            Object.entries(raw).forEach(([time, payload]) => {
                pushFrame(time, payload);
            });
        }
        frames.sort((a, b) => a.time - b.time);
        return frames;
    }

    function parseCompactTrack(track, simplifiedMap, size) {
        if (!track || typeof track !== 'object') return null;
        const itemId = track.item || track.id || track.target || track.shape || track.name;
        if (!itemId) return null;
        const baseSource = track.base ? normalizeSummaryItem(track.base) : cloneSimplified(simplifiedMap.get(itemId));
        if (!baseSource) return null;
        const base = cloneSimplified(baseSource);
        base.id = base.id || itemId;
        base.type = base.type || base.kind;
        base.kind = base.kind || base.type;
        const frames = extractFrames(track);
        if (!frames.length) return null;
        let last = base;
        const frameMap = new Map();
        frames.forEach(({ time, diff }) => {
            const next = (diff === null || diff === undefined || diff === 0)
                ? cloneSimplified(last)
                : applyDiff(last, diff);
            next.id = next.id || itemId;
            next.type = next.type || next.kind;
            next.kind = next.kind || next.type;
            const inflated = inflateItem(next, size);
            if (inflated) frameMap.set(time, inflated);
            last = next;
        });
        if (!frameMap.size) {
            const inflatedBase = inflateItem(base, size);
            if (inflatedBase) frameMap.set(frames[0].time, inflatedBase);
        }
        return { id: itemId, frames: frameMap };
    }

    function rebuildCompactAnimation(anim, simplifiedMap, baseMap, size) {
        const rawTracks = anim?.timelines ?? anim?.tracks ?? [];
        const trackArray = Array.isArray(rawTracks)
            ? rawTracks
            : (rawTracks && typeof rawTracks === 'object' ? Object.values(rawTracks) : []);
        const tracks = trackArray
            .map(track => parseCompactTrack(track, simplifiedMap, size))
            .filter(Boolean);
        if (!tracks.length) {
            return {
                id: rndId('anim'),
                name: anim.name || 'Animation',
                duration: +(anim.duration || 5),
                keyframes: []
            };
        }
        const timeSet = new Set();
        tracks.forEach(track => {
            for (const time of track.frames.keys()) timeSet.add(time);
        });
        if (!timeSet.size) {
            return {
                id: rndId('anim'),
                name: anim.name || 'Animation',
                duration: +(anim.duration || 5),
                keyframes: []
            };
        }
        const times = Array.from(timeSet).sort((a, b) => a - b);
        const keyframes = times.map(time => {
            const snapshotMap = new Map();
            baseMap.forEach((item, id) => {
                snapshotMap.set(id, cloneValue(item));
            });
            tracks.forEach(track => {
                const frameItem = findFrame(track.frames, time);
                if (!frameItem) return;
                snapshotMap.set(track.id, cloneValue(frameItem));
            });
            const snapshot = Array.from(snapshotMap.values());
            return { t: time, snapshot };
        }).filter(kf => kf.snapshot.length);
        return {
            id: rndId('anim'),
            name: anim.name || 'Animation',
            duration: +(anim.duration || 5),
            keyframes
        };
    }

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
        if (!frames) return null;
        if (frames instanceof Map) {
            for (const [t, value] of frames.entries()) {
                if (Math.abs(t - time) < EPSILON) return value;
            }
            return null;
        }
        if (Array.isArray(frames)) {
            return frames.find(k => Math.abs(k.time - time) < EPSILON) || null;
        }
        return null;
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

    function compressCompactKeyframes(frames) {
        if (!Array.isArray(frames)) return [];
        const hashes = new Map();
        let prevOrder = [];
        return frames.map((frame, index) => {
            const time = Number.isFinite(+frame.t) ? +frame.t : 0;
            const snapshot = Array.isArray(frame.s) ? frame.s : [];
            const seen = [];
            const seenSet = new Set();
            const updates = [];
            snapshot.forEach(item => {
                if (!item || !item.i) return;
                seen.push(item.i);
                seenSet.add(item.i);
                const hash = stableHash(item);
                if (hashes.get(item.i) !== hash) {
                    updates.push(item);
                    hashes.set(item.i, hash);
                }
            });
            const removed = prevOrder.filter(id => !seenSet.has(id));
            if (removed.length) {
                removed.forEach(id => hashes.delete(id));
            }
            const entry = { t: time };
            if (index === 0 || !prevOrder.length) {
                entry.s = snapshot;
            } else {
                entry.u = updates;
                if (removed.length) entry.r = removed;
            }
            prevOrder = seen;
            return entry;
        });
    }

    function buildCompactSnapshot(w, h) {
        const width = Number.isFinite(+w) ? +(+w).toFixed(3) : 0;
        const height = Number.isFinite(+h) ? +(+h).toFixed(3) : 0;
        const elements = state.items
            .map(it => serializeItemCompact(it, w, h))
            .filter(Boolean);
        const animations = state.animations.map(anim => {
            const rawFrames = (anim.keyframes || []).map(k => ({
                t: Number.isFinite(+k.t) ? +(+k.t).toFixed(3) : 0,
                s: (k.snapshot || []).map(it => serializeItemCompact(it, w, h)).filter(Boolean)
            }));
            const keyframes = compressCompactKeyframes(rawFrames);
            return {
                i: anim.id,
                n: anim.name,
                d: Number.isFinite(+anim.duration) ? +(+anim.duration).toFixed(3) : 0,
                k: keyframes
            };
        });
        return {
            t: 'LP',
            v: 2,
            s: [width, height],
            e: elements,
            a: animations
        };
    }

    const TYPE_CODE = {
        g: 0,
        group: 0,
        l: 1,
        line: 1,
        q: 2,
        quadratic: 2,
        s: 3,
        shape: 3
    };

    const TYPE_FROM_CODE = ['g', 'l', 'q', 's'];

    const FIELD_MASK = {
        color: 1 << 0,
        width: 1 << 1,
        rotation: 1 << 2,
        hidden: 1 << 3,
        path: 1 << 4,
        segments: 1 << 5,
        fill: 1 << 6,
        children: 1 << 7
    };

    const FIELD_DEFAULTS = {
        color: 0,
        width: 0,
        rotation: 0,
        hidden: 0,
        path: 0,
        segments: 0,
        fill: 0,
        children: 0
    };

    const FIELD_ORDER = ['color', 'width', 'rotation', 'hidden', 'path', 'segments', 'fill', 'children'];
    const FIELD_ALWAYS = new Set(['path', 'segments', 'children']);
    const WIDTH_BASE = 30;
    const INDEX_MARK = '!';

    const encodeIndexSequence = (list) => {
        if (!Array.isArray(list) || !list.length) return null;
        if (!list.every(value => Number.isInteger(value))) return null;
        const bytes = [];
        let prev = 0;
        list.forEach((value, index) => {
            let delta = index === 0 ? value : value - prev;
            prev = value;
            let zigzag = delta >= 0 ? (delta << 1) : ((-delta << 1) - 1);
            while (zigzag >= 0x80) {
                bytes.push((zigzag & 0x7f) | 0x80);
                zigzag >>>= 7;
            }
            bytes.push(zigzag & 0x7f);
        });
        const buffer = new Uint8Array(bytes);
        return INDEX_MARK + encodeBinary(buffer);
    };

    const decodeIndexSequence = (text) => {
        if (typeof text !== 'string' || !text.startsWith(INDEX_MARK)) return null;
        const payload = decodeBinary(text.slice(1));
        if (!(payload instanceof Uint8Array) || !payload.length) return [];
        const numbers = [];
        let current = 0;
        let shift = 0;
        let prev = 0;
        for (let i = 0; i < payload.length; i++) {
            const byte = payload[i];
            current |= (byte & 0x7f) << shift;
            if (byte & 0x80) {
                shift += 7;
                continue;
            }
            const zigzag = current;
            const delta = (zigzag >>> 1) ^ (-(zigzag & 1));
            const value = numbers.length === 0 ? delta : prev + delta;
            numbers.push(value);
            prev = value;
            current = 0;
            shift = 0;
        }
        return numbers;
    };

    const SIGNED_FIELDS = new Set(['width', 'rotation']);

    const encodeElementTable = (entries) => {
        if (!Array.isArray(entries) || !entries.length) return null;
        const bytes = [];
        entries.forEach(entry => {
            const arr = Array.isArray(entry) ? entry : [];
            const type = Number.isFinite(+arr[0]) ? +arr[0] : 0;
            const mask = Number.isFinite(+arr[1]) ? +arr[1] : 0;
            bytes.push(type & 0xff);
            bytes.push(mask & 0xff);
            let cursor = 2;
            FIELD_ORDER.forEach(key => {
                const bit = FIELD_MASK[key];
                if (!(mask & bit)) return;
                const raw = Number.isFinite(+arr[cursor]) ? +arr[cursor] : 0;
                cursor += 1;
                let value = raw;
                if (SIGNED_FIELDS.has(key)) {
                    value = raw >= 0 ? (raw << 1) : ((-raw << 1) - 1);
                }
                let remaining = value >>> 0;
                while (remaining >= 0x80) {
                    bytes.push((remaining & 0x7f) | 0x80);
                    remaining >>>= 7;
                }
                bytes.push(remaining & 0x7f);
            });
        });
        return '@' + encodeBinary(new Uint8Array(bytes));
    };

    const decodeElementTable = (payload) => {
        if (typeof payload !== 'string' || !payload.startsWith('@')) return null;
        const data = decodeBinary(payload.slice(1));
        if (!(data instanceof Uint8Array) || !data.length) return [];
        const entries = [];
        let offset = 0;
        while (offset < data.length) {
            const type = data[offset++] ?? 0;
            const mask = data[offset++] ?? 0;
            const values = [type, mask];
            FIELD_ORDER.forEach(key => {
                if (!(mask & FIELD_MASK[key])) return;
                let result = 0;
                let shift = 0;
                while (offset < data.length) {
                    const byte = data[offset++];
                    result |= (byte & 0x7f) << shift;
                    if (!(byte & 0x80)) break;
                    shift += 7;
                }
                if (SIGNED_FIELDS.has(key)) {
                    const signed = (result >>> 1) ^ (-(result & 1));
                    values.push(signed);
                } else {
                    values.push(result >>> 0);
                }
            });
            entries.push(values);
        }
        return entries;
    };

    const pushVarint = (buffer, value) => {
        let v = value >>> 0;
        while (v >= 0x80) {
            buffer.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        buffer.push(v & 0x7f);
    };

    const pushSignedVarint = (buffer, value) => {
        const zigzag = value >= 0 ? (value << 1) : ((-value << 1) - 1);
        pushVarint(buffer, zigzag >>> 0);
    };

    const readVarint = (data, state) => {
        let result = 0;
        let shift = 0;
        while (state.pos < data.length) {
            const byte = data[state.pos++];
            result |= (byte & 0x7f) << shift;
            if (!(byte & 0x80)) break;
            shift += 7;
        }
        return result >>> 0;
    };

    const readSignedVarint = (data, state) => {
        const value = readVarint(data, state);
        return (value >>> 1) ^ (-(value & 1));
    };

    const buildStringTable = (list) => {
        if (!Array.isArray(list) || !list.length) return null;
        const buffer = [];
        pushVarint(buffer, list.length);
        list.forEach(entry => {
            const bytes = stringToBytes(entry);
            pushVarint(buffer, bytes.length);
            for (let i = 0; i < bytes.length; i++) buffer.push(bytes[i]);
        });
        return new Uint8Array(buffer);
    };

    const parseStringTable = (payload) => {
        if (!(payload instanceof Uint8Array) || !payload.length) return [];
        const state = { pos: 0 };
        const count = readVarint(payload, state);
        const items = [];
        for (let i = 0; i < count; i++) {
            const length = readVarint(payload, state);
            const end = Math.min(state.pos + length, payload.length);
            const slice = payload.slice(state.pos, end);
            state.pos = end;
            items.push(bytesToString(slice));
        }
        return items;
    };

    const buildChildTable = (list) => {
        if (!Array.isArray(list) || !list.length) return null;
        const buffer = [];
        pushVarint(buffer, list.length);
        list.forEach(entry => {
            const arr = Array.isArray(entry)
                ? entry.map(value => (Number.isInteger(value) && value >= 0) ? value : -1).filter(value => value >= 0)
                : [];
            pushVarint(buffer, arr.length);
            arr.forEach(value => pushVarint(buffer, value >>> 0));
        });
        return new Uint8Array(buffer);
    };

    const parseChildTable = (payload) => {
        if (!(payload instanceof Uint8Array) || !payload.length) return [];
        const state = { pos: 0 };
        const count = readVarint(payload, state);
        const items = [];
        for (let i = 0; i < count; i++) {
            const length = readVarint(payload, state);
            const entry = [];
            for (let j = 0; j < length; j++) {
                entry.push(readVarint(payload, state));
            }
            items.push(entry);
        }
        return items;
    };

    const buildBlobTable = (list, options = {}) => {
        if (!Array.isArray(list) || !list.length) return null;
        const buffer = [];
        pushVarint(buffer, list.length);
        const compressPaths = !!options.compressPaths;
        list.forEach(entry => {
            const value = (entry === undefined || entry === null) ? '' : `${entry}`;
            let flag = 0;
            let bytes = null;
            if (typeof value === 'string' && value.startsWith(ENCODE_MARK)) {
                const decoded = decodeBinary(value.slice(1));
                if (decoded instanceof Uint8Array && decoded.length) {
                    if (compressPaths) {
                        const packed = compressPathEntry(decoded);
                        if (packed) {
                            flag = 2;
                            bytes = packed;
                        } else {
                            flag = 1;
                            bytes = decoded;
                        }
                    } else {
                        flag = 1;
                        bytes = decoded;
                    }
                }
            }
            if (!bytes) {
                bytes = stringToBytes(value);
            }
            buffer.push(flag & 0xff);
            pushVarint(buffer, bytes.length);
            for (let i = 0; i < bytes.length; i++) buffer.push(bytes[i]);
        });
        return new Uint8Array(buffer);
    };

    const parseBlobTable = (payload) => {
        if (!(payload instanceof Uint8Array) || !payload.length) return [];
        const state = { pos: 0 };
        const count = readVarint(payload, state);
        const items = [];
        for (let i = 0; i < count; i++) {
            const flag = payload[state.pos++] ?? 0;
            const length = readVarint(payload, state);
            const end = Math.min(state.pos + length, payload.length);
            const slice = payload.slice(state.pos, end);
            state.pos = end;
            if (flag === 1) {
                items.push(ENCODE_MARK + encodeBinary(slice));
            } else if (flag === 2) {
                const restored = decompressPathEntry(slice);
                if (restored && restored.length) {
                    items.push(ENCODE_MARK + encodeBinary(restored));
                } else {
                    items.push(ENCODE_MARK + encodeBinary(slice));
                }
            } else {
                items.push(bytesToString(slice));
            }
        }
        return items;
    };

    const compressPathEntry = (bytes) => {
        if (!(bytes instanceof Uint8Array) || bytes.length < 4 || (bytes.length & 1)) return null;
        const pointCount = bytes.length >>> 1;
        const buffer = [];
        pushVarint(buffer, pointCount);
        buffer.push(bytes[0]);
        buffer.push(bytes[1]);
        let prevX = bytes[0];
        let prevY = bytes[1];
        for (let i = 2; i < bytes.length; i += 2) {
            const x = bytes[i];
            const y = bytes[i + 1];
            const dx = x - prevX;
            const dy = y - prevY;
            const nibbleX = (dx >= -7 && dx <= 7) ? (dx + 7) : 15;
            const nibbleY = (dy >= -7 && dy <= 7) ? (dy + 7) : 15;
            buffer.push(((nibbleX & 0xf) << 4) | (nibbleY & 0xf));
            if (nibbleX === 15) buffer.push((dx + 256) & 0xff);
            if (nibbleY === 15) buffer.push((dy + 256) & 0xff);
            prevX = x;
            prevY = y;
        }
        return new Uint8Array(buffer);
    };

    const decompressPathEntry = (bytes) => {
        if (!(bytes instanceof Uint8Array) || !bytes.length) return null;
        const state = { pos: 0 };
        const pointCount = readVarint(bytes, state);
        if (!Number.isFinite(pointCount) || pointCount <= 0) return null;
        if (state.pos + 1 >= bytes.length) return null;
        const out = new Uint8Array(pointCount * 2);
        let prevX = bytes[state.pos++] ?? 0;
        let prevY = bytes[state.pos++] ?? 0;
        out[0] = prevX;
        out[1] = prevY;
        let outPos = 2;
        while (outPos < out.length && state.pos < bytes.length) {
            const packed = bytes[state.pos++] ?? 0;
            const nibbleX = packed >>> 4;
            const nibbleY = packed & 0xf;
            let dx = nibbleX === 15 ? ((bytes[state.pos++] ?? 0) << 24 >> 24) : (nibbleX - 7);
            let dy = nibbleY === 15 ? ((bytes[state.pos++] ?? 0) << 24 >> 24) : (nibbleY - 7);
            let x = prevX + dx;
            let y = prevY + dy;
            if (x < 0) x = 0;
            else if (x > 255) x = 255;
            if (y < 0) y = 0;
            else if (y > 255) y = 255;
            out[outPos++] = x & 0xff;
            out[outPos++] = y & 0xff;
            prevX = x & 0xff;
            prevY = y & 0xff;
        }
        if (outPos !== out.length) return null;
        return out;
    };

    const writeSection = (target, section) => {
        if (section instanceof Uint8Array && section.length) {
            pushVarint(target, section.length);
            for (let i = 0; i < section.length; i++) target.push(section[i]);
        } else {
            pushVarint(target, 0);
        }
    };

    const readSection = (data, state) => {
        const length = readVarint(data, state);
        if (!length) return new Uint8Array(0);
        const end = Math.min(state.pos + length, data.length);
        const slice = data.slice(state.pos, end);
        state.pos = end;
        return slice;
    };

    const compressUltraBinary = (bytes) => {
        if (!(bytes instanceof Uint8Array) || bytes.length < 32) return null;
        const out = [];
        pushVarint(out, bytes.length);
        let pos = 0;
        while (pos < bytes.length) {
            const controlIndex = out.length;
            out.push(0);
            let control = 0;
            let mask = 1;
            for (let token = 0; token < 8 && pos < bytes.length; token++, mask <<= 1) {
                const windowStart = Math.max(0, pos - 4095);
                let bestLength = 0;
                let bestOffset = 0;
                const maxLength = Math.min(18, bytes.length - pos);
                if (maxLength >= 3) {
                    for (let candidate = pos - 1; candidate >= windowStart; candidate--) {
                        let length = 0;
                        while (length < maxLength && bytes[candidate + length] === bytes[pos + length]) {
                            length += 1;
                        }
                        if (length > bestLength && length >= 3) {
                            bestLength = length;
                            bestOffset = pos - candidate;
                            if (length === maxLength) break;
                        }
                    }
                }
                if (bestLength >= 3 && bestOffset > 0) {
                    control |= mask;
                    const encodedLength = (bestLength - 3) & 0x0f;
                    out.push(((encodedLength & 0x0f) << 4) | ((bestOffset >>> 8) & 0x0f));
                    out.push(bestOffset & 0xff);
                    pos += bestLength;
                } else {
                    out.push(bytes[pos]);
                    pos += 1;
                }
            }
            out[controlIndex] = control;
        }
        return new Uint8Array(out);
    };

    const decompressUltraBinary = (bytes) => {
        if (!(bytes instanceof Uint8Array) || !bytes.length) return new Uint8Array(0);
        const state = { pos: 0 };
        const expected = readVarint(bytes, state);
        if (!Number.isFinite(expected) || expected < 0) return new Uint8Array(0);
        const output = new Uint8Array(expected);
        let outPos = 0;
        while (state.pos < bytes.length && outPos < expected) {
            const control = bytes[state.pos++] ?? 0;
            for (let mask = 1; mask <= 0x80 && outPos < expected; mask <<= 1) {
                if (state.pos >= bytes.length) break;
                if (control & mask) {
                    if (state.pos + 1 >= bytes.length) return new Uint8Array(0);
                    const header = bytes[state.pos++] ?? 0;
                    const tail = bytes[state.pos++] ?? 0;
                    const offset = ((header & 0x0f) << 8) | tail;
                    const length = ((header >>> 4) & 0x0f) + 3;
                    if (offset <= 0 || offset > outPos) return new Uint8Array(0);
                    for (let i = 0; i < length && outPos < expected; i++) {
                        output[outPos] = output[outPos - offset];
                        outPos += 1;
                    }
                } else {
                    output[outPos++] = bytes[state.pos++] ?? 0;
                }
            }
        }
        if (outPos !== expected) return new Uint8Array(0);
        return output;
    };

    const packUltraPayload = (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const bytes = [];
        const sizeArray = Array.isArray(raw.s) ? raw.s : [0, 0];
        const widthScaled = Math.round((Number.isFinite(+sizeArray[0]) ? +sizeArray[0] : 0) * 1000);
        const heightScaled = Math.round((Number.isFinite(+sizeArray[1]) ? +sizeArray[1] : 0) * 1000);
        pushVarint(bytes, widthScaled >>> 0);
        pushVarint(bytes, heightScaled >>> 0);
        const baseCount = Number.isFinite(+raw.b) ? Math.max(0, Math.floor(+raw.b)) : 0;
        pushVarint(bytes, baseCount >>> 0);

        const encodeElementBinary = (payload) => {
            if (payload instanceof Uint8Array) return payload;
            if (typeof payload === 'string') {
                if (payload.startsWith('@')) {
                    const decoded = decodeBinary(payload.slice(1));
                    if (decoded instanceof Uint8Array && decoded.length) return decoded;
                    return new Uint8Array(0);
                }
                return stringToBytes(payload);
            }
            if (Array.isArray(payload) && payload.length) {
                const encoded = encodeElementTable(payload);
                if (typeof encoded === 'string' && encoded.startsWith('@')) {
                    return decodeBinary(encoded.slice(1));
                }
                return stringToBytes(JSON.stringify(payload));
            }
            return new Uint8Array(0);
        };

        const encodeAnimationBinary = (payload) => {
            if (payload instanceof Uint8Array) return payload;
            if (typeof payload === 'string') {
                if (payload.startsWith('%')) {
                    const decoded = decodeBinary(payload.slice(1));
                    if (decoded instanceof Uint8Array && decoded.length) return decoded;
                    return new Uint8Array(0);
                }
                return stringToBytes(payload);
            }
            if (Array.isArray(payload) && payload.length) {
                const encoded = encodeAnimationsTable(payload);
                if (typeof encoded === 'string' && encoded.startsWith('%')) {
                    return decodeBinary(encoded.slice(1));
                }
                return stringToBytes(JSON.stringify(payload));
            }
            return new Uint8Array(0);
        };

        writeSection(bytes, encodeElementBinary(raw.e));
        writeSection(bytes, encodeAnimationBinary(raw.a));
        writeSection(bytes, buildStringTable(raw.c));
        writeSection(bytes, buildStringTable(raw.f));
        writeSection(bytes, buildBlobTable(raw.p, { compressPaths: true }));
        writeSection(bytes, buildBlobTable(raw.g));
        writeSection(bytes, buildChildTable(raw.h));
        writeSection(bytes, buildStringTable(raw.n));

        if (!bytes.length) return null;
        const rawBytes = new Uint8Array(bytes);
        const compressed = compressUltraBinary(rawBytes);
        if (compressed && compressed.length + 1 < rawBytes.length) {
            return '>' + encodeBinary(compressed);
        }
        return ULTRA_MARK + encodeBinary(rawBytes);
    };

    const unpackUltraPayload = (payload) => {
        if (typeof payload !== 'string') return null;
        let marker = payload[0];
        if (marker !== ULTRA_MARK && marker !== '>') return null;
        const data = decodeBinary(payload.slice(1));
        if (!(data instanceof Uint8Array) || !data.length) return null;
        const source = marker === '>' ? decompressUltraBinary(data) : data;
        if (!(source instanceof Uint8Array) || !source.length) return null;
        const state = { pos: 0 };
        const widthScaled = readVarint(source, state);
        const heightScaled = readVarint(source, state);
        const baseCount = readVarint(source, state);
        const elementBytes = readSection(source, state);
        const animationBytes = readSection(source, state);
        const colorsBytes = readSection(source, state);
        const fillsBytes = readSection(source, state);
        const pathsBytes = readSection(source, state);
        const segmentsBytes = readSection(source, state);
        const childrenBytes = readSection(source, state);
        const namesBytes = readSection(source, state);

        const sizeArray = [+(widthScaled / 1000).toFixed(3), +(heightScaled / 1000).toFixed(3)];
        const result = {
            t: 'LP',
            v: 3,
            s: sizeArray,
            b: baseCount >>> 0,
            e: elementBytes.length ? ('@' + encodeBinary(elementBytes)) : [],
            a: animationBytes.length ? ('%' + encodeBinary(animationBytes)) : []
        };
        const colors = parseStringTable(colorsBytes);
        if (colors.length) result.c = colors;
        const fills = parseStringTable(fillsBytes);
        if (fills.length) result.f = fills;
        const paths = parseBlobTable(pathsBytes);
        if (paths.length) result.p = paths;
        const segments = parseBlobTable(segmentsBytes);
        if (segments.length) result.g = segments;
        const children = parseChildTable(childrenBytes);
        if (children.length) result.h = children;
        const names = parseStringTable(namesBytes);
        if (names.length) result.n = names;
        return result;
    };


    const encodeAnimationsTable = (animations) => {
        if (!Array.isArray(animations) || !animations.length) return null;
        const bytes = [];
        pushVarint(bytes, animations.length);
        animations.forEach(anim => {
            const nameIdx = Number.isFinite(+anim[0]) ? +anim[0] : 0;
            const duration = Number.isFinite(+anim[1]) ? +anim[1] : 0;
            const keyframes = Array.isArray(anim[2]) ? anim[2] : [];
            pushVarint(bytes, nameIdx >>> 0);
            pushVarint(bytes, duration >>> 0);
            pushVarint(bytes, keyframes.length);
            keyframes.forEach(frame => {
                const frameArr = Array.isArray(frame) ? frame : [];
                const time = Number.isFinite(+frameArr[0]) ? +frameArr[0] : 0;
                pushVarint(bytes, time >>> 0);
                let snapshotEntries = frameArr[1];
                if (typeof snapshotEntries === 'string' && snapshotEntries.startsWith(INDEX_MARK)) {
                    snapshotEntries = decodeIndexSequence(snapshotEntries) || [];
                }
                if (!Array.isArray(snapshotEntries)) snapshotEntries = [];
                pushVarint(bytes, snapshotEntries.length);
                snapshotEntries.forEach(entry => {
                    if (Array.isArray(entry)) {
                        const idx = Number.isFinite(+entry[0]) ? +entry[0] : 0;
                        pushVarint(bytes, (idx << 1) | 1);
                        const mask = Number.isFinite(+entry[1]) ? +entry[1] : 0;
                        bytes.push(mask & 0xff);
                        let cursor = 2;
                        FIELD_ORDER.forEach(key => {
                            if (!(mask & FIELD_MASK[key])) return;
                            const raw = Number.isFinite(+entry[cursor]) ? +entry[cursor] : 0;
                            cursor += 1;
                            if (SIGNED_FIELDS.has(key)) pushSignedVarint(bytes, raw);
                            else pushVarint(bytes, raw >>> 0);
                        });
                    } else {
                        const idx = Number.isFinite(+entry) ? +entry : 0;
                        pushVarint(bytes, idx << 1);
                    }
                });
                const updatesEntries = Array.isArray(frameArr[2]) ? frameArr[2] : [];
                pushVarint(bytes, updatesEntries.length);
                updatesEntries.forEach(entry => {
                    const idx = Number.isFinite(+entry[0]) ? +entry[0] : 0;
                    const mask = Number.isFinite(+entry[1]) ? +entry[1] : 0;
                    pushVarint(bytes, idx >>> 0);
                    bytes.push(mask & 0xff);
                    let cursor = 2;
                    FIELD_ORDER.forEach(key => {
                        if (!(mask & FIELD_MASK[key])) return;
                        const raw = Number.isFinite(+entry[cursor]) ? +entry[cursor] : 0;
                        cursor += 1;
                        if (SIGNED_FIELDS.has(key)) pushSignedVarint(bytes, raw);
                        else pushVarint(bytes, raw >>> 0);
                    });
                });
                let removedEntries = frameArr[3];
                if (typeof removedEntries === 'string' && removedEntries.startsWith(INDEX_MARK)) {
                    removedEntries = decodeIndexSequence(removedEntries) || [];
                }
                if (!Array.isArray(removedEntries)) removedEntries = [];
                pushVarint(bytes, removedEntries.length);
                let prevRemoved = 0;
                removedEntries.forEach((value, index) => {
                    const delta = index === 0 ? value : value - prevRemoved;
                    prevRemoved = value;
                    pushSignedVarint(bytes, delta);
                });
            });
        });
        return '%' + encodeBinary(new Uint8Array(bytes));
    };

    const decodeAnimationsTable = (payload) => {
        if (typeof payload !== 'string' || !payload.startsWith('%')) return null;
        const data = decodeBinary(payload.slice(1));
        if (!(data instanceof Uint8Array) || !data.length) return [];
        const state = { pos: 0 };
        const count = readVarint(data, state);
        const animations = [];
        for (let a = 0; a < count; a++) {
            const nameIdx = readVarint(data, state);
            const duration = readVarint(data, state);
            const frameCount = readVarint(data, state);
            const keyframes = [];
            for (let f = 0; f < frameCount; f++) {
                const time = readVarint(data, state);
                const snapshotCount = readVarint(data, state);
                const snapshot = [];
                for (let i = 0; i < snapshotCount; i++) {
                    const tag = readVarint(data, state);
                    if (tag & 1) {
                        const idx = tag >>> 1;
                        const mask = data[state.pos++] ?? 0;
                        const entry = [idx, mask];
                        FIELD_ORDER.forEach(key => {
                            if (!(mask & FIELD_MASK[key])) return;
                            if (SIGNED_FIELDS.has(key)) entry.push(readSignedVarint(data, state));
                            else entry.push(readVarint(data, state));
                        });
                        snapshot.push(entry);
                    } else {
                        const idx = tag >>> 1;
                        snapshot.push(idx);
                    }
                }
                const updatesCount = readVarint(data, state);
                const updates = [];
                for (let i = 0; i < updatesCount; i++) {
                    const idx = readVarint(data, state);
                    const mask = data[state.pos++] ?? 0;
                    const entry = [idx, mask];
                    FIELD_ORDER.forEach(key => {
                        if (!(mask & FIELD_MASK[key])) return;
                        if (SIGNED_FIELDS.has(key)) entry.push(readSignedVarint(data, state));
                        else entry.push(readVarint(data, state));
                    });
                    updates.push(entry);
                }
                const removedCount = readVarint(data, state);
                const removed = [];
                let prevRemoved = 0;
                for (let i = 0; i < removedCount; i++) {
                    const delta = readSignedVarint(data, state);
                    const value = i === 0 ? delta : prevRemoved + delta;
                    prevRemoved = value;
                    removed.push(value);
                }
                const frameEntry = [time, snapshot];
                if (updates.length || removed.length) {
                    frameEntry.push(updates);
                    if (removed.length) frameEntry.push(removed);
                }
                keyframes.push(frameEntry);
            }
            animations.push([nameIdx, duration, keyframes]);
        }
        return animations;
    };

    function shrinkCompactSnapshot(compact) {
        if (!compact || typeof compact !== 'object') {
            return compact;
        }

        const sizeArray = Array.isArray(compact.s) ? compact.s : [0, 0];

        const colorPalette = [];
        const colorIndex = new Map();
        const fillPalette = [];
        const fillIndex = new Map();
        const pathPalette = [];
        const pathIndex = new Map();
        const segmentPalette = [];
        const segmentIndex = new Map();
        const childPalette = [];
        const childIndex = new Map();
        const namePalette = [];
        const nameIndex = new Map();

        const idIndex = new Map();
        const elements = [];
        const baseStates = new Map();

        const ensureArrayIndex = (list, targetIndex) => {
            while (list.length <= targetIndex) list.push(null);
        };

        const cloneStateValues = (values) => ({
            type: values.type,
            color: values.color,
            width: values.width,
            rotation: values.rotation,
            hidden: values.hidden,
            path: values.path,
            segments: values.segments,
            fill: values.fill,
            children: values.children
        });

        const statesEqual = (a, b) => {
            if (!a || !b) return false;
            if ((a.type ?? 0) !== (b.type ?? 0)) return false;
            for (const key of FIELD_ORDER) {
                if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
            }
            return true;
        };

        const ensureItemIndex = (entry) => {
            const id = typeof entry === 'string' ? entry : entry?.i ?? entry?.id ?? null;
            if (!id) return -1;
            if (idIndex.has(id)) return idIndex.get(id);
            const idx = idIndex.size;
            idIndex.set(id, idx);
            ensureArrayIndex(elements, idx);
            return idx;
        };

        const registerColor = (color) => {
            if (!color || typeof color !== 'string' || color === '#ffffff') return 0;
            const normalized = color.trim();
            if (colorIndex.has(normalized)) return colorIndex.get(normalized);
            const idx = colorPalette.length + 1;
            colorPalette.push(normalized);
            colorIndex.set(normalized, idx);
            return idx;
        };

        const registerFill = (fill) => {
            if (fill === undefined || fill === null || fill === '') return 0;
            const key = `${fill}`;
            if (fillIndex.has(key)) return fillIndex.get(key);
            const idx = fillPalette.length + 1;
            fillPalette.push(key);
            fillIndex.set(key, idx);
            return idx;
        };

        const registerPath = (path) => {
            if (!path) return 0;
            let encoded = null;
            if (typeof path === 'string') {
                encoded = path;
            } else if (Array.isArray(path)) {
                encoded = encodePointSequence(path) || JSON.stringify(path);
            } else if (typeof path === 'object') {
                encoded = encodePointSequence(path.points || path) || JSON.stringify(path);
            }
            if (!encoded) return 0;
            if (pathIndex.has(encoded)) return pathIndex.get(encoded);
            const idx = pathPalette.length + 1;
            pathPalette.push(encoded);
            pathIndex.set(encoded, idx);
            return idx;
        };

        const registerSegments = (segments) => {
            if (!segments) return 0;
            let encoded = null;
            if (typeof segments === 'string') {
                encoded = segments;
            } else if (Array.isArray(segments)) {
                encoded = encodeSegmentSequence(segments) || JSON.stringify(segments);
            }
            if (!encoded) return 0;
            if (segmentIndex.has(encoded)) return segmentIndex.get(encoded);
            const idx = segmentPalette.length + 1;
            segmentPalette.push(encoded);
            segmentIndex.set(encoded, idx);
            return idx;
        };

        const registerChildren = (children) => {
            if (!Array.isArray(children) || !children.length) return 0;
            const indexes = children.map(child => ensureItemIndex(child)).filter(idx => idx >= 0);
            if (!indexes.length) return 0;
            const key = indexes.join(',');
            if (childIndex.has(key)) return childIndex.get(key);
            const idx = childPalette.length + 1;
            childPalette.push(indexes);
            childIndex.set(key, idx);
            return idx;
        };

        const registerName = (name) => {
            if (!name) return 0;
            const norm = `${name}`;
            if (nameIndex.has(norm)) return nameIndex.get(norm);
            const idx = namePalette.length + 1;
            namePalette.push(norm);
            nameIndex.set(norm, idx);
            return idx;
        };

        const computeStateValues = (item) => {
            if (!item || typeof item !== 'object') return null;
            const kindRaw = item.k ?? item.kind ?? item.type;
            const type = TYPE_CODE[kindRaw] ?? TYPE_CODE[KIND_ALIASES[kindRaw] ?? kindRaw] ?? 1;
            const colorIdx = registerColor(item.c ?? item.color);
            const widthRaw = item.w ?? item.width;
            const widthDelta = Number.isFinite(+widthRaw) ? Math.round(+widthRaw * 10) - WIDTH_BASE : 0;
            const rotationRaw = item.r ?? item.rot ?? item.rotation;
            const rotationVal = Number.isFinite(+rotationRaw) ? Math.round(+rotationRaw * 100) : 0;
            const hiddenFlag = (item.v === 0 || item.visible === false) ? 1 : 0;
            const pathIdx = registerPath(item.p ?? item.path);
            const segmentIdx = registerSegments(item.segments ?? item.g);
            const fillIdx = registerFill(item.f ?? item.fill);
            const childIdx = registerChildren(item.children);
            return {
                type,
                color: colorIdx,
                width: widthDelta,
                rotation: rotationVal,
                hidden: hiddenFlag,
                path: pathIdx,
                segments: segmentIdx,
                fill: fillIdx,
                children: childIdx
            };
        };

        const encodeFields = (values, previous, includeDefaults) => {
            let mask = 0;
            const data = [];
            FIELD_ORDER.forEach(key => {
                const bit = FIELD_MASK[key];
                const value = values[key] ?? 0;
                const prev = previous ? (previous[key] ?? FIELD_DEFAULTS[key]) : FIELD_DEFAULTS[key];
                const defaultVal = FIELD_DEFAULTS[key];
                const isEssential = FIELD_ALWAYS.has(key);
                const changed = value !== prev;
                const shouldInclude = includeDefaults
                    ? (isEssential ? value !== 0 : value !== defaultVal)
                    : changed;
                if (shouldInclude) {
                    mask |= bit;
                    data.push(value);
                }
            });
            return { mask, data };
        };

        const encodeBaseEntry = (values) => {
            const { mask, data } = encodeFields(values, FIELD_DEFAULTS, true);
            return [values.type, mask, ...data];
        };

        const baseElements = Array.isArray(compact.e) ? compact.e : [];
        baseElements.forEach(item => {
            const idx = ensureItemIndex(item);
            if (idx < 0) return;
            const values = computeStateValues(item);
            if (!values) return;
            const entry = encodeBaseEntry(values);
            ensureArrayIndex(elements, idx);
            elements[idx] = entry;
            baseStates.set(idx, cloneStateValues(values));
        });

        const baseCount = baseElements.length;

        const encodeFrameState = (item, stateMap) => {
            const idx = ensureItemIndex(item);
            if (idx < 0) return null;
            const values = computeStateValues(item);
            if (!values) return null;
            const previous = stateMap.get(idx);
            const includeDefaults = !previous;
            if (!elements[idx]) {
                elements[idx] = encodeBaseEntry(values);
                baseStates.set(idx, cloneStateValues(values));
            }
            const baseState = baseStates.get(idx);
            if (includeDefaults && !baseState) {
                baseStates.set(idx, cloneStateValues(values));
            }
            if (includeDefaults && baseState && statesEqual(baseState, values)) {
                stateMap.set(idx, values);
                return idx;
            }
            const { mask, data } = encodeFields(values, previous ?? FIELD_DEFAULTS, includeDefaults);
            stateMap.set(idx, values);
            if (!mask && !includeDefaults) return null;
            return [idx, mask, ...data];
        };

        const encodeRemoved = (removed, stateMap) => {
            if (!Array.isArray(removed) || !removed.length) return [];
            const out = [];
            removed.forEach(entry => {
                const idx = ensureItemIndex(entry);
                if (idx >= 0) {
                    stateMap.delete(idx);
                    out.push(idx);
                }
            });
            return out;
        };

        const animations = Array.isArray(compact.a) ? compact.a : [];
        const encodedAnimations = animations.map(anim => {
            const nameIdx = registerName(anim.n ?? anim.name);
            const duration = Number.isFinite(+anim.d) ? Math.round(+anim.d * 1000) : 0;
            const keyframes = [];
            const stateMap = new Map();
            (anim.k || []).forEach(frame => {
                const time = Number.isFinite(+frame.t) ? Math.round(+frame.t * 1000) : 0;
                const snapshotList = (frame.s || []).map(item => encodeFrameState(item, stateMap)).filter(Boolean);
                const updates = (frame.u || []).map(item => encodeFrameState(item, stateMap)).filter(Boolean);
                const removedList = encodeRemoved(frame.r || [], stateMap);
                let snapshotPayload = snapshotList;
                if (snapshotList.length && snapshotList.every(entry => typeof entry === 'number')) {
                    const packed = encodeIndexSequence(snapshotList);
                    if (packed) snapshotPayload = packed;
                }
                let removedPayload = removedList;
                if (removedList.length && removedList.every(entry => typeof entry === 'number')) {
                    const packedRemoved = encodeIndexSequence(removedList);
                    if (packedRemoved) removedPayload = packedRemoved;
                }
                const entry = [time, snapshotPayload];
                if (updates.length || (Array.isArray(removedPayload) ? removedPayload.length : !!removedPayload)) {
                    entry.push(updates);
                    if ((Array.isArray(removedPayload) && removedPayload.length) || (typeof removedPayload === 'string' && removedPayload.length)) {
                        entry.push(removedPayload);
                    }
                }
                keyframes.push(entry);
            });
            return [nameIdx, duration, keyframes];
        });

        for (let i = 0; i < elements.length; i++) {
            if (!elements[i]) elements[i] = [0, 0];
        }

        const elementPayload = encodeElementTable(elements);
        const animationPayload = encodeAnimationsTable(encodedAnimations);
        const result = {
            t: 'LP',
            v: 3,
            s: sizeArray.map(num => Number.isFinite(+num) ? +(+num).toFixed(3) : 0),
            b: baseCount,
            e: elementPayload || elements,
            a: animationPayload || encodedAnimations
        };

        if (colorPalette.length) result.c = colorPalette;
        if (fillPalette.length) result.f = fillPalette;
        if (pathPalette.length) result.p = pathPalette;
        if (segmentPalette.length) result.g = segmentPalette;
        if (childPalette.length) result.h = childPalette;
        if (namePalette.length) result.n = namePalette;

        const packed = packUltraPayload(result);
        if (packed) {
            return { t: 'LP', v: 4, d: packed };
        }
        return result;
    }

    function convertUltraToLegacy(pack) {
        if (!pack || typeof pack !== 'object') return null;
        const sizeArray = Array.isArray(pack.s) ? pack.s : [0, 0];
        const colors = Array.isArray(pack.c) ? pack.c : [];
        const fills = Array.isArray(pack.f) ? pack.f : [];
        const paths = Array.isArray(pack.p) ? pack.p : [];
        const segments = Array.isArray(pack.g) ? pack.g : [];
        const childSets = Array.isArray(pack.h) ? pack.h : [];
        const names = Array.isArray(pack.n) ? pack.n : [];
        const rawElements = pack.e;
        const decodedElements = typeof rawElements === 'string' && rawElements.startsWith('@')
            ? decodeElementTable(rawElements)
            : null;
        const elementsRaw = decodedElements || (Array.isArray(rawElements) ? rawElements : []);
        const baseValueMap = new Map();
        const baseCount = Number.isFinite(+pack.b) ? Math.max(0, Math.floor(+pack.b)) : elementsRaw.length;

        const idList = elementsRaw.map((entry, idx) => {
            const arr = Array.isArray(entry) ? entry : [];
            const typeCode = Number.isFinite(+arr[0]) ? +arr[0] : 1;
            const prefix = TYPE_FROM_CODE[typeCode] === 'g' ? 'lg' : 'lt';
            return rndId(prefix);
        });

        const decodeWidth = (delta) => {
            const value = Number.isFinite(+delta) ? +delta + WIDTH_BASE : WIDTH_BASE;
            return value / 10;
        };

        const decodeRotation = (value) => Number.isFinite(+value) ? +value / 100 : 0;

        const decodeColor = (idx) => {
            if (!Number.isFinite(+idx) || +idx <= 0) return '#ffffff';
            return colors[+idx - 1] ?? '#ffffff';
        };

        const decodeFill = (idx) => {
            if (!Number.isFinite(+idx) || +idx <= 0) return undefined;
            return fills[+idx - 1];
        };

        const decodePath = (idx) => {
            if (!Number.isFinite(+idx) || +idx <= 0) return undefined;
            return paths[+idx - 1];
        };

        const decodeSegments = (idx) => {
            if (!Number.isFinite(+idx) || +idx <= 0) return undefined;
            return segments[+idx - 1];
        };

        const decodeChildren = (idx) => {
            if (!Number.isFinite(+idx) || +idx <= 0) return [];
            const source = childSets[+idx - 1];
            if (!Array.isArray(source)) return [];
            return source.map(childIdx => {
                const numeric = Number.isFinite(+childIdx) ? +childIdx : -1;
                return numeric >= 0 ? idList[numeric] : null;
            }).filter(Boolean);
        };

        const decodeEntryValues = (entry) => {
            const arr = Array.isArray(entry) ? entry : [];
            const type = Number.isFinite(+arr[0]) ? +arr[0] : 1;
            const mask = Number.isFinite(+arr[1]) ? +arr[1] : 0;
            let cursor = 2;
            const read = (bit) => {
                if (mask & bit) {
                    const value = Number.isFinite(+arr[cursor]) ? +arr[cursor] : 0;
                    cursor += 1;
                    return value;
                }
                return 0;
            };
            const values = {
                color: read(FIELD_MASK.color),
                width: read(FIELD_MASK.width),
                rotation: read(FIELD_MASK.rotation),
                hidden: read(FIELD_MASK.hidden),
                path: read(FIELD_MASK.path),
                segments: read(FIELD_MASK.segments),
                fill: read(FIELD_MASK.fill),
                children: read(FIELD_MASK.children)
            };
            values.type = type;
            return { type, values };
        };

        const materializeState = (idx, stateValues) => {
            const baseEntry = Array.isArray(elementsRaw[idx]) ? elementsRaw[idx] : [];
            const type = stateValues.type ?? (Number.isFinite(+baseEntry[0]) ? +baseEntry[0] : 1);
            const obj = {
                i: idList[idx] || rndId('lt'),
                k: TYPE_FROM_CODE[type] || 'l',
                c: decodeColor(stateValues.color),
                w: +decodeWidth(stateValues.width).toFixed(3)
            };
            const rotation = decodeRotation(stateValues.rotation);
            if (Math.abs(rotation) > EPSILON) obj.r = +rotation.toFixed(3);
            if (stateValues.hidden) obj.v = 0;
            const pathStr = decodePath(stateValues.path);
            if (pathStr !== undefined) obj.p = pathStr;
            const segStr = decodeSegments(stateValues.segments);
            if (segStr !== undefined) obj.segments = segStr;
            const fillValue = decodeFill(stateValues.fill);
            if (fillValue !== undefined) obj.f = fillValue;
            const children = decodeChildren(stateValues.children);
            if (children.length) obj.children = children;
            return obj;
        };

        const minimalElements = elementsRaw.map((entry, idx) => {
            const { values } = decodeEntryValues(entry);
            const cloned = {
                type: values.type,
                color: values.color,
                width: values.width,
                rotation: values.rotation,
                hidden: values.hidden,
                path: values.path,
                segments: values.segments,
                fill: values.fill,
                children: values.children
            };
            baseValueMap.set(idx, cloned);
            return materializeState(idx, cloned);
        });

        const decodeStateEntry = (entry, stateMap) => {
            if (Number.isFinite(entry)) {
                const idx = +entry;
                const base = baseValueMap.get(idx) || {
                    type: Number.isFinite(+((Array.isArray(elementsRaw[idx]) ? elementsRaw[idx][0] : 1))) ? +(Array.isArray(elementsRaw[idx]) ? elementsRaw[idx][0] : 1) : 1,
                    color: 0,
                    width: 0,
                    rotation: 0,
                    hidden: 0,
                    path: 0,
                    segments: 0,
                    fill: 0,
                    children: 0
                };
                stateMap.set(idx, { ...base });
                return materializeState(idx, base);
            }
            const arr = Array.isArray(entry) ? entry : [];
            const idx = Number.isFinite(+arr[0]) ? +arr[0] : 0;
            const mask = Number.isFinite(+arr[1]) ? +arr[1] : 0;
            let cursor = 2;
            const prev = stateMap.get(idx) || { ...FIELD_DEFAULTS, type: baseValueMap.get(idx)?.type };
            const next = { ...prev };
            FIELD_ORDER.forEach(key => {
                const bit = FIELD_MASK[key];
                if (mask & bit) {
                    const value = Number.isFinite(+arr[cursor]) ? +arr[cursor] : 0;
                    cursor += 1;
                    next[key] = value;
                }
            });
            if (next.type === undefined) {
                next.type = baseValueMap.get(idx)?.type ?? (Number.isFinite(+((Array.isArray(elementsRaw[idx]) ? elementsRaw[idx][0] : 1))) ? +(Array.isArray(elementsRaw[idx]) ? elementsRaw[idx][0] : 1) : 1);
            }
            stateMap.set(idx, next);
            return materializeState(idx, next);
        };

        const rawAnimations = pack.a;
        const decodedAnimations = typeof rawAnimations === 'string' && rawAnimations.startsWith('%')
            ? decodeAnimationsTable(rawAnimations)
            : null;
        const legacyAnimations = (decodedAnimations || (Array.isArray(rawAnimations) ? rawAnimations : [])).map(entry => {
            const arr = Array.isArray(entry) ? entry : [];
            const nameIdx = Number.isFinite(+arr[0]) ? +arr[0] : 0;
            const durationVal = Number.isFinite(+arr[1]) ? +arr[1] : 0;
            const framesRaw = Array.isArray(arr[2]) ? arr[2] : [];
            const stateMap = new Map();
            const keyframes = framesRaw.map(frame => {
                const frameArr = Array.isArray(frame) ? frame : [];
                const timeVal = Number.isFinite(+frameArr[0]) ? +frameArr[0] : 0;
                let snapshotRaw = Array.isArray(frameArr[1]) ? frameArr[1] : [];
                if (typeof frameArr[1] === 'string' && frameArr[1].startsWith(INDEX_MARK)) {
                    snapshotRaw = decodeIndexSequence(frameArr[1]) || [];
                }
                const updatesRaw = Array.isArray(frameArr[2]) ? frameArr[2] : [];
                let removedRaw = Array.isArray(frameArr[3]) ? frameArr[3] : [];
                if (typeof frameArr[3] === 'string' && frameArr[3].startsWith(INDEX_MARK)) {
                    removedRaw = decodeIndexSequence(frameArr[3]) || [];
                }
                const snapshot = snapshotRaw.map(item => decodeStateEntry(item, stateMap)).filter(Boolean);
                const updates = updatesRaw.map(item => decodeStateEntry(item, stateMap)).filter(Boolean);
                const removed = removedRaw.map(idx => {
                    const numeric = Number.isFinite(+idx) ? +idx : -1;
                    if (numeric < 0) return null;
                    stateMap.delete(numeric);
                    return idList[numeric] || null;
                }).filter(Boolean);
                const frameObj = { t: +(timeVal / 1000).toFixed(3) };
                if (snapshot.length) frameObj.s = snapshot;
                if (updates.length) frameObj.u = updates;
                if (removed.length) frameObj.r = removed;
                return frameObj;
            });
            const name = nameIdx > 0 ? names[nameIdx - 1] : undefined;
            return {
                i: rndId('anim'),
                n: name || 'Animation',
                d: +(durationVal / 1000).toFixed(3),
                k: keyframes
            };
        });

        return {
            t: 'LP',
            v: 2,
            s: sizeArray.map(num => Number.isFinite(+num) ? +(+num).toFixed(3) : 0),
            e: minimalElements.slice(0, baseCount),
            a: legacyAnimations
        };
    }

    function exportPack(minimal = false) {
        const { w, h } = api.getCSSSize ? api.getCSSSize() : { w: canvas.width, h: canvas.height };
        if (minimal) {
            const compact = buildCompactSnapshot(w, h);
            return shrinkCompactSnapshot(compact);
        }

        const els = state.items
            .map(it => serializeItem(it, w, h, 6))
            .filter(Boolean);
        const anims = state.animations.map(a => ({
            id: a.id,
            name: a.name,
            duration: Number.isFinite(+a.duration) ? +a.duration : 0,
            keyframes: (a.keyframes || []).map(k => ({
                t: Number.isFinite(+k.t) ? +k.t : 0,
                snapshot: (k.snapshot || []).map(it => serializeItem(it, w, h, 6)).filter(Boolean)
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
        const itemMap = new Map(items.map(it => [it.id, it]));

        const animations = state.animations.map(anim => {
            const keyframes = (anim.keyframes || [])
                .slice()
                .sort((a, b) => a.t - b.t);
            if (!keyframes.length) {
                return {
                    name: anim.name,
                    duration: anim.duration,
                    timelines: []
                };
            }
            const trackMap = new Map();
            keyframes.forEach(kf => {
                const time = +kf.t;
                (kf.snapshot || []).forEach(item => {
                    const simplified = simplifyItem(item, w, h);
                    if (!simplified || !simplified.id) return;
                    let track = trackMap.get(simplified.id);
                    if (!track) {
                        const base = cloneSimplified(simplified);
                        track = {
                            item: simplified.id,
                            base,
                            last: base,
                            frames: [[time, null]]
                        };
                        trackMap.set(simplified.id, track);
                        return;
                    }
                    const diff = diffSimplified(track.last, simplified);
                    track.last = cloneSimplified(simplified);
                    const payload = Object.keys(diff).length ? diff : null;
                    track.frames.push([time, payload]);
                });
            });
            const timelines = Array.from(trackMap.values()).map(track => {
                const baseline = itemMap.get(track.item);
                const frames = track.frames.map(([time, payload]) => [time, payload ? cloneValue(payload) : null]);
                const entry = { item: track.item, frames };
                if (!deepEqual(track.base, baseline)) entry.base = cloneSimplified(track.base);
                return entry;
            }).filter(tl => tl.frames.length);
            return {
                name: anim.name,
                duration: anim.duration,
                timelines
            };
        });

        return {
            type: 'LinePackSummary',
            version: 3,
            size: { w, h },
            items,
            animations
        };
    }

    function serializeItem(it, w, h, precisionFlag) {
        if (!it) return null;
        const digits = typeof precisionFlag === 'number'
            ? precisionFlag
            : (precisionFlag ? 3 : 6);
        const fix = (value) => {
            const rounded = +value.toFixed(digits);
            return Number.isFinite(rounded) ? rounded : 0;
        };
        const norm = (p) => {
            if (!p) return null;
            return { x: fix(p.x / w), y: fix(p.y / h) };
        };

        const style = {
            color: it.color,
            width: Number.isFinite(+it.width) ? +it.width : 0
        };
        const rot = +(it.rot || 0);
        if (Math.abs(rot) > 1e-6) style.rot = +rot.toFixed(3);
        if (it.visible === false) style.visible = false;
        if (it.fill !== undefined && it.fill !== null && it.kind !== 'shape') {
            style.fill = it.fill;
        }
        Object.keys(style).forEach(key => {
            if (style[key] === undefined) delete style[key];
        });

        const base = {
            id: it.id,
            type: it.kind,
            style
        };

        if (it.kind === 'group') {
            if (Array.isArray(it.children)) base.children = it.children.slice();
            return base;
        }

        if (it.kind === 'line') {
            const start = norm(it.p1);
            const end = norm(it.p2);
            if (!start || !end) return null;
            base.start = start;
            base.end = end;
            return base;
        }

        if (it.kind === 'quadratic') {
            const start = norm(it.p1);
            const control = norm(it.cp);
            const end = norm(it.p2);
            if (!start || !control || !end) return null;
            base.start = start;
            base.control = control;
            base.end = end;
            return base;
        }

        if (it.kind === 'shape') {
            const path = Array.isArray(it.path) ? it.path.map(norm).filter(Boolean) : [];
            if (path.length) base.path = path;
            if (it.fill !== undefined) base.fill = it.fill;
            if (Array.isArray(it.children) && it.children.length) base.children = it.children.slice();
            if (Array.isArray(it.segments) && it.segments.length) {
                base.segments = it.segments.map(seg => {
                    if (!seg || !seg.p1 || !seg.p2) return null;
                    const out = {
                        kind: seg.kind === 'quadratic' ? 'quadratic' : 'line',
                        p1: norm(seg.p1),
                        p2: norm(seg.p2)
                    };
                    if (seg.kind === 'quadratic' && seg.cp) out.cp = norm(seg.cp);
                    return out.p1 && out.p2 ? out : null;
                }).filter(Boolean);
            }
            return base;
        }

        return base;
    }

    function serializeItemCompact(it, w, h) {
        if (!it) return null;
        const kind = it.kind;
        const entry = {
            i: it.id,
            k: KIND_SHORT[kind] ?? kind
        };
        if (it.color) entry.c = it.color;
        const width = +it.width;
        if (Number.isFinite(width)) entry.w = +(+width.toFixed(3));
        const rot = +(it.rot || 0);
        if (Math.abs(rot) > 1e-6) entry.r = +rot.toFixed(3);
        if (it.visible === false) entry.v = 0;

        if (kind === 'group') {
            if (Array.isArray(it.children) && it.children.length) entry.children = it.children.slice();
            return entry;
        }

        if (kind === 'line') {
            const p1 = normPoint(it.p1, w, h);
            const p2 = normPoint(it.p2, w, h);
            if (!p1 || !p2) return null;
            const encoded = encodePointSequence([p1, p2]);
            entry.p = encoded ?? [...p1, ...p2];
            return entry;
        }

        if (kind === 'quadratic') {
            const p1 = normPoint(it.p1, w, h);
            const p2 = normPoint(it.p2, w, h);
            const cp = normPoint(it.cp, w, h);
            if (!p1 || !p2 || !cp) return null;
            const encoded = encodePointSequence([p1, p2, cp]);
            entry.p = encoded ?? [...p1, ...p2, ...cp];
            return entry;
        }

        if (kind === 'shape') {
            const path = Array.isArray(it.path) ? it.path.map(pt => normPoint(pt, w, h)).filter(Boolean) : [];
            if (path.length) {
                const encodedPath = encodePointSequence(path);
                if (encodedPath) entry.p = encodedPath;
                else entry.p = path;
            }
            if (it.fill !== undefined && it.fill !== null) entry.f = it.fill;
            if (Array.isArray(it.children) && it.children.length) entry.children = it.children.slice();
            if (Array.isArray(it.segments) && it.segments.length) {
                const segments = it.segments.map(seg => {
                    if (!seg || !seg.p1 || !seg.p2) return null;
                    const p1 = normPoint(seg.p1, w, h);
                    const p2 = normPoint(seg.p2, w, h);
                    if (!p1 || !p2) return null;
                    const out = { kind: seg.kind === 'quadratic' ? 'quadratic' : 'line', p1, p2 };
                    if (seg.kind === 'quadratic' && seg.cp) {
                        const cp = normPoint(seg.cp, w, h);
                        if (cp) out.cp = cp;
                    }
                    return out;
                }).filter(Boolean);
                if (segments.length) {
                    const encodedSegments = encodeSegmentSequence(segments);
                    entry.segments = encodedSegments ?? segments;
                }
            }
            return entry;
        }

        return entry;
    }

    function importPack(pack) {
        if (!pack || typeof pack !== 'object') throw new Error('فایل معتبر نیست');
        if (isLottieAnimation(pack)) {
            const converted = convertLottieToPack(pack);
            importFullPack(converted);
            return;
        }
        const normalized = expandCompactPack(pack);
        if (normalized.type === 'LinePack') {
            importFullPack(normalized);
            return;
        }
        if (normalized.type === 'LinePackSummary') {
            importSummaryPack(normalized);
            return;
        }
        throw new Error('نوع فایل پشتیبانی نمی‌شود');
    }

    function importFullPack(pack) {
        const size = pack.size || { w: canvas.width, h: canvas.height };
        const animations = (pack.animations || []).map(a => ({
            id: a.id || rndId('anim'),
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
        const version = +(pack.version || 0);
        const simplifiedItems = (pack.items || [])
            .map(entry => normalizeSummaryItem(entry))
            .filter(Boolean);
        const items = simplifiedItems
            .map(entry => inflateItem(entry, size))
            .filter(Boolean);

        if (version && version < 3) {
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
            return;
        }

        const simplifiedMap = new Map(simplifiedItems.map(entry => [entry.id, entry]));
        const baseMap = new Map(items.map(it => [it.id, cloneValue(it)]));
        const animations = (pack.animations || [])
            .map(anim => rebuildCompactAnimation(anim, simplifiedMap, baseMap, size))
            .filter(Boolean);
        applyImportedState(items, animations);
    }

    function deserializeItem(el, size) {
        const den = (p) => {
            if (!p) return null;
            const x = p.x ?? p[0];
            const y = p.y ?? p[1];
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x: x * size.w, y: y * size.h };
        };
        const kindRaw = el.kind ?? el.type ?? el.k;
        const kind = KIND_ALIASES[kindRaw] ?? kindRaw ?? 'line';
        const style = el.style || {};
        const base = {
            id: el.id || rndId('it'),
            kind,
            color: style.color ?? el.color ?? '#fff',
            width: Number.isFinite(+(style.width ?? el.width)) ? +(style.width ?? el.width) : 3,
            rot: Number.isFinite(+(style.rot ?? el.rot ?? el.rotation)) ? +(style.rot ?? el.rot ?? el.rotation) : 0,
            visible: (style.visible ?? el.visible ?? true) !== false
        };
        if (kind === 'line') {
            const start = el.points?.p1 ?? el.start ?? el.s;
            const end = el.points?.p2 ?? el.end ?? el.e;
            const p1 = den(start);
            const p2 = den(end);
            if (!p1 || !p2) return null;
            return { ...base, p1, p2 };
        }
        if (kind === 'quadratic') {
            const start = el.points?.p1 ?? el.start ?? el.s;
            const cp = el.points?.cp ?? el.control ?? el.cp;
            const end = el.points?.p2 ?? el.end ?? el.e;
            const p1 = den(start);
            const p2 = den(end);
            const control = den(cp);
            if (!p1 || !p2 || !control) return null;
            return { ...base, p1, cp: control, p2 };
        }
        if (kind === 'shape') {
            const pathSource = el.path ?? el.points ?? [];
            const path = Array.isArray(pathSource)
                ? pathSource.map(pt => den(pt)).filter(Boolean)
                : [];
            const segs = Array.isArray(el.segments)
                ? el.segments.map(seg => {
                    if (!seg || !seg.p1 || !seg.p2) return null;
                    const p1 = den(seg.p1);
                    const p2 = den(seg.p2);
                    if (!p1 || !p2) return null;
                    if ((seg.kind === 'quadratic' || seg.type === 'quadratic' || seg.type === 'curve') && seg.cp) {
                        const cp = den(seg.cp);
                        if (!cp) return { kind: 'line', p1, p2 };
                        return { kind: 'quadratic', p1, cp, p2 };
                    }
                    return { kind: 'line', p1, p2 };
                }).filter(Boolean)
                : [];
            const shape = {
                ...base,
                path,
                fill: el.fill ?? style.fill ?? null,
                children: Array.isArray(el.children) ? el.children.slice() : []
            };
            if (segs.length) shape.segments = segs;
            return shape;
        }
        if (kind === 'group') {
            return { ...base, children: Array.isArray(el.children) ? el.children.slice() : [] };
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

    const exposed = { exportPack, importPack, downloadBlob, exportSummary };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerFileSystem };
