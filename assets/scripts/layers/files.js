/**
 * @fileoverview Manages import and export operations for LinePack Pro packs,
 * including JSON serialization, minified saves, and PNG rendering helpers.
 */

function registerFileSystem(ctx) {
    const { state, ui, canvas, api, utils } = ctx;
    const { rndId } = utils;

    const PRECISION = 3;
    const EPSILON = 1e-3;

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

    const numberFrom = (prop, fallback = 0) => {
        if (prop && typeof prop === 'object' && prop.x !== undefined && prop.y === undefined) {
            return numberFrom(prop.x, fallback);
        }
        const value = staticValue(prop);
        if (value === null || value === undefined) return fallback;
        const num = Array.isArray(value) ? +value[0] : +value;
        return Number.isFinite(num) ? num : fallback;
    };

    const pointFrom = (prop) => {
        if (!prop || typeof prop !== 'object') {
            const num = numberFrom(prop, 0);
            return { x: num, y: 0 };
        }
        if (prop.x !== undefined && prop.y !== undefined) {
            return {
                x: numberFrom(prop.x, 0),
                y: numberFrom(prop.y, 0)
            };
        }
        const value = staticValue(prop);
        if (Array.isArray(value)) {
            const x = Number.isFinite(+value[0]) ? +value[0] : 0;
            const y = Number.isFinite(+value[1]) ? +value[1] : 0;
            return { x, y };
        }
        if (value && typeof value === 'object') {
            const x = Number.isFinite(+(value.x ?? value[0])) ? +(value.x ?? value[0]) : 0;
            const y = Number.isFinite(+(value.y ?? value[1])) ? +(value.y ?? value[1]) : 0;
            return { x, y };
        }
        const num = numberFrom(value, 0);
        return { x: num, y: 0 };
    };

    const scaleFrom = (prop) => {
        if (prop && typeof prop === 'object' && prop.x !== undefined && prop.y !== undefined && !('k' in prop)) {
            return {
                x: numberFrom(prop.x, 100) / 100,
                y: numberFrom(prop.y, 100) / 100
            };
        }
        const value = staticValue(prop);
        if (Array.isArray(value)) {
            const sx = Number.isFinite(+value[0]) ? +value[0] : 100;
            const sy = Number.isFinite(+value[1]) ? +value[1] : sx;
            return { x: sx / 100, y: sy / 100 };
        }
        if (value && typeof value === 'object') {
            const sx = Number.isFinite(+(value.x ?? value[0])) ? +(value.x ?? value[0]) : 100;
            const sy = Number.isFinite(+(value.y ?? value[1])) ? +(value.y ?? value[1]) : sx;
            return { x: sx / 100, y: sy / 100 };
        }
        const num = numberFrom(value, 100);
        const ratio = num / 100;
        return { x: ratio, y: ratio };
    };

    const opacityFrom = (prop) => {
        const value = numberFrom(prop, 100);
        return Number.isFinite(value) ? value / 100 : 1;
    };

    const colorFrom = (prop, fallback = DEFAULT_STROKE_COLOR) => {
        const value = staticValue(prop);
        if (Array.isArray(value)) {
            const [r, g, b] = value;
            if ([r, g, b].some(v => v === undefined)) return fallback;
            const toByte = (val) => {
                if (!Number.isFinite(val)) return 0;
                const scaled = (val <= 1 && val >= 0) ? val * 255 : val;
                return clampByte(scaled);
            };
            return `#${byteToHex(toByte(+r))}${byteToHex(toByte(+g))}${byteToHex(toByte(+b))}`;
        }
        if (value && typeof value === 'object') {
            const r = value.r ?? value.red ?? value[0];
            const g = value.g ?? value.green ?? value[1];
            const b = value.b ?? value.blue ?? value[2];
            if ([r, g, b].some(v => v === undefined)) return fallback;
            return colorFrom([+r, +g, +b], fallback);
        }
        if (typeof value === 'string') {
            const parsed = parseColorString(value);
            if (parsed) {
                return `#${byteToHex(parsed.r)}${byteToHex(parsed.g)}${byteToHex(parsed.b)}`;
            }
        }
        return fallback;
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

    const gradientStopsFrom = (entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const gradient = entry.g || entry;
        if (!gradient) return [];
        const rawValue = gradient.k;
        let stopsArray = staticValue(rawValue);
        if (!Array.isArray(stopsArray) && rawValue && typeof rawValue === 'object') {
            stopsArray = staticValue(rawValue.k);
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
            const color = colorFrom([r, g, b], null);
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

    const gradientToColor = (entry, fallback = DEFAULT_STROKE_COLOR, opacityMultiplier = 1) => {
        const stops = gradientStopsFrom(entry);
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

    const matrixFromTransform = (entry) => {
        if (!entry || typeof entry !== 'object') return identityMatrix();
        const anchor = pointFrom(entry.a);
        const position = pointFrom(entry.p);
        const scale = scaleFrom(entry.s);
        const rotation = numberFrom(entry.r ?? entry.z ?? entry.rx ?? entry.ry, 0);
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

    const resolvePathValue = (raw) => {
        if (!raw) return null;
        let pathValue = staticValue(raw);
        if ((!pathValue || !pathValue.v) && Array.isArray(raw.k) && raw.k.length) {
            const first = raw.k[0];
            if (first && typeof first === 'object') {
                const source = Array.isArray(first.s) ? first.s[0] : first.s;
                if (source && source.v) pathValue = source;
            }
        }
        if (!pathValue || !Array.isArray(pathValue.v)) return null;
        return pathValue;
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

    const geometryFromRectangle = (entry, matrix) => {
        const size = pointFrom(entry.s);
        const position = pointFrom(entry.p);
        if (!size || !position) return null;
        const width = Number.isFinite(+size.x) ? +size.x : 0;
        const height = Number.isFinite(+size.y) ? +size.y : 0;
        if (Math.abs(width) <= EPSILON || Math.abs(height) <= EPSILON) return null;
        const halfW = width / 2;
        const halfH = height / 2;
        const radiusRaw = Math.abs(numberFrom(entry.r, 0));
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

    const geometryFromEllipse = (entry, matrix) => {
        const size = pointFrom(entry.s);
        const position = pointFrom(entry.p);
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

    const geometryFromPolystar = (entry, matrix) => {
        const position = pointFrom(entry.p);
        if (!position) return null;
        const pointCount = Math.max(3, Math.round(numberFrom(entry.pt, 5)));
        const outerRadius = Math.abs(numberFrom(entry.or, numberFrom(entry.r, 0)));
        if (!Number.isFinite(outerRadius) || outerRadius <= EPSILON) return null;
        const innerRadiusRaw = numberFrom(entry.ir, outerRadius / 2);
        const type = entry.sy === 2 ? 'polygon' : 'star';
        const isStar = type === 'star' && Number.isFinite(innerRadiusRaw) && innerRadiusRaw > EPSILON;
        const innerRadius = isStar ? Math.min(Math.abs(innerRadiusRaw), Math.abs(outerRadius)) : outerRadius;
        const totalPoints = isStar ? pointCount * 2 : pointCount;
        const rotationDeg = numberFrom(entry.r, 0);
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

    const buildShapeGeometry = (entry, matrix) => {
        if (!entry) return null;
        if (entry.ty === 'sh') {
            const pathValue = resolvePathValue(entry.ks);
            return geometryFromPathValue(pathValue, matrix);
        }
        if (entry.ty === 'rc') {
            return geometryFromRectangle(entry, matrix);
        }
        if (entry.ty === 'el') {
            return geometryFromEllipse(entry, matrix);
        }
        if (entry.ty === 'sr') {
            return geometryFromPolystar(entry, matrix);
        }
        return null;
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

        const transformCache = new Map();
        const layerWorldMatrix = (layer) => {
            if (!layer) return identityMatrix();
            if (transformCache.has(layer.ind)) return transformCache.get(layer.ind);
            let matrix = matrixFromTransform(layer.ks);
            if (Number.isFinite(+layer.parent)) {
                const parent = layerMap.get(+layer.parent);
                if (parent) {
                    matrix = multiplyMatrix(layerWorldMatrix(parent), matrix);
                }
            }
            transformCache.set(layer.ind, matrix);
            return matrix;
        };

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

        const items = [];
        const pendingGeometry = [];
        const groupByLayer = new Map();
        const layerCounts = new Map();
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

        const ensureLayerGroup = (rawName) => {
            if (!rawName) return null;
            const key = String(rawName).trim();
            if (!key) return null;
            if (!groupByLayer.has(key)) {
                const group = {
                    id: rndId('lg'),
                    type: 'group',
                    kind: 'group',
                    name: key,
                    color: DEFAULT_STROKE_COLOR,
                    width: 0,
                    rot: 0,
                    visible: true,
                    children: []
                };
                groupByLayer.set(key, group);
                items.push(group);
            }
            return groupByLayer.get(key);
        };

        const pushShape = (shapeNode, state, layerName) => {
            if (!shapeNode || typeof shapeNode !== 'object') return;
            if (shapeNode.hd) return;
            const geometry = buildShapeGeometry(shapeNode, state.transform);
            if (!geometry || !Array.isArray(geometry.points) || geometry.points.length < 2) return;
            geometry.points.forEach(updateBounds);
            pendingGeometry.push({
                points: geometry.points,
                closed: geometry.closed !== false,
                segments: Array.isArray(geometry.segments) ? geometry.segments : [],
                strokeColor: state.strokeColor || DEFAULT_STROKE_COLOR,
                strokeWidth: Number.isFinite(+state.strokeWidth) ? Math.max(0, +state.strokeWidth) : 0,
                fill: geometry.closed === false ? null : state.fill,
                layerName
            });
        };

        const parseGroup = (entries, incomingState, layerName) => {
            if (!Array.isArray(entries)) return;
            const transformEntry = entries.find(entry => entry && entry.ty === 'tr');
            const baseTransform = transformEntry
                ? multiplyMatrix(incomingState.transform, matrixFromTransform(transformEntry))
                : incomingState.transform;
            const state = {
                transform: baseTransform,
                strokeColor: incomingState.strokeColor,
                strokeWidth: incomingState.strokeWidth,
                fill: incomingState.fill
            };
            entries.forEach(entry => {
                if (!entry || entry.ty === 'tr') return;
                if (entry.ty === 'gr') {
                    parseGroup(entry.it || [], cloneState(state), layerName);
                    return;
                }
                if (entry.ty === 'st') {
                    const opacity = opacityFrom(entry.o);
                    if (opacity <= 0) {
                        state.strokeWidth = 0;
                    } else {
                        const strokeColor = colorFrom(entry.c, state.strokeColor || DEFAULT_STROKE_COLOR);
                        state.strokeColor = colorWithAlpha(strokeColor, opacity);
                        const width = numberFrom(entry.w, state.strokeWidth);
                        if (Number.isFinite(width)) state.strokeWidth = Math.max(0, width);
                    }
                    return;
                }
                if (entry.ty === 'gs') {
                    const opacity = opacityFrom(entry.o);
                    if (opacity <= 0) {
                        state.strokeWidth = 0;
                    } else {
                        state.strokeColor = gradientToColor(entry, state.strokeColor || DEFAULT_STROKE_COLOR, opacity);
                        const width = numberFrom(entry.w, state.strokeWidth);
                        if (Number.isFinite(width)) state.strokeWidth = Math.max(0, width);
                    }
                    return;
                }
                if (entry.ty === 'fl') {
                    const opacity = opacityFrom(entry.o);
                    if (opacity <= 0) state.fill = null;
                    else {
                        const fillColor = colorFrom(entry.c, state.fill || DEFAULT_STROKE_COLOR);
                        state.fill = colorWithAlpha(fillColor, opacity);
                    }
                    return;
                }
                if (entry.ty === 'gf') {
                    const opacity = opacityFrom(entry.o);
                    state.fill = opacity <= 0 ? null : gradientToColor(entry, state.fill || DEFAULT_STROKE_COLOR, opacity);
                    return;
                }
                if (entry.ty === 'sh' || entry.ty === 'rc' || entry.ty === 'el' || entry.ty === 'sr') {
                    pushShape(entry, state, layerName);
                }
            });
        };

        layers.forEach(layer => {
            if (!layer || layer.ty !== 4) return;
            if (layer.hd || layer.tt) return;
            const opacity = opacityFrom(layer.ks?.o);
            if (opacity <= 0) return;
            const layerMatrix = layerWorldMatrix(layer);
            const baseState = {
                transform: layerMatrix,
                strokeColor: DEFAULT_STROKE_COLOR,
                strokeWidth: 0,
                fill: null
            };
            parseGroup(layer.shapes || [], baseState, layer.nm);
        });

        const hasBounds = Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY)
            && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY);

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

        pendingGeometry.forEach(geo => {
            const layerKey = typeof geo.layerName === 'string' ? geo.layerName.trim() : '';
            const layerGroup = ensureLayerGroup(layerKey);
            let elementLabel = geo.layerName;
            if (layerKey) {
                const count = (layerCounts.get(layerKey) || 0) + 1;
                layerCounts.set(layerKey, count);
                elementLabel = `${layerKey} #${count}`;
            }
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
            if (stagePoints.length < 2) return;
            const path = stagePoints.map(pt => ({
                x: norm(pt.x, targetWidth),
                y: norm(pt.y, targetHeight)
            }));
            const scaledStroke = geo.strokeWidth * uniformScale;
            const element = {
                id: rndId('lt'),
                type: 'shape',
                kind: 'shape',
                color: geo.strokeColor,
                width: Number.isFinite(scaledStroke) ? Math.max(0, scaledStroke) : 0,
                path,
                visible: true
            };
            if (geo.fill && geo.closed !== false) element.fill = geo.fill;
            const segmentEntries = Array.isArray(geo.segments) ? geo.segments : [];
            if (segmentEntries.length) {
                const mappedSegments = segmentEntries.map(seg => {
                    if (!seg || !seg.p1 || !seg.p2) return null;
                    const stageP1 = toStagePoint(seg.p1);
                    const stageP2 = toStagePoint(seg.p2);
                    if (!stageP1 || !stageP2) return null;
                    if (distanceBetween(stageP1, stageP2) <= EPSILON) return null;
                    const result = {
                        kind: seg.kind === 'quadratic' ? 'quadratic' : 'line',
                        p1: { x: norm(stageP1.x, targetWidth), y: norm(stageP1.y, targetHeight) },
                        p2: { x: norm(stageP2.x, targetWidth), y: norm(stageP2.y, targetHeight) }
                    };
                    if (seg.kind === 'quadratic' && seg.cp) {
                        const stageCP = toStagePoint(seg.cp);
                        if (stageCP) {
                            result.cp = { x: norm(stageCP.x, targetWidth), y: norm(stageCP.y, targetHeight) };
                        }
                    }
                    return result;
                }).filter(Boolean);
                if (mappedSegments.length) element.segments = mappedSegments;
            }
            if (elementLabel) element.name = elementLabel;
            items.push(element);
            if (layerGroup && !layerGroup.children.includes(element.id)) {
                layerGroup.children.push(element.id);
            }
        });

        return {
            type: 'LinePack',
            version: 2,
            size: { w: targetWidth, h: targetHeight },
            elements: items,
            animations: []
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
        const snapshotSource = entry.snapshot ?? entry.s ?? entry.items ?? [];
        const snapshot = Array.isArray(snapshotSource)
            ? snapshotSource.map(expandCompactItem).filter(Boolean)
            : [];
        return { t, snapshot };
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
        const keyframes = Array.isArray(keyframesSource)
            ? keyframesSource.map(expandCompactKeyframe).filter(Boolean)
            : [];
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

    function exportPack(minimal = false) {
        const { w, h } = api.getCSSSize ? api.getCSSSize() : { w: canvas.width, h: canvas.height };
        if (minimal) {
            const elements = state.items
                .map(it => serializeItemCompact(it, w, h))
                .filter(Boolean);
            const animations = state.animations.map(anim => {
                const keyframes = (anim.keyframes || []).map(k => ({
                    t: Number.isFinite(+k.t) ? +(+k.t).toFixed(3) : 0,
                    s: (k.snapshot || []).map(it => serializeItemCompact(it, w, h)).filter(Boolean)
                }));
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
                s: [Number.isFinite(+w) ? +(+w).toFixed(3) : 0, Number.isFinite(+h) ? +(+h).toFixed(3) : 0],
                e: elements,
                a: animations
            };
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
            entry.p = [...p1, ...p2];
            return entry;
        }

        if (kind === 'quadratic') {
            const p1 = normPoint(it.p1, w, h);
            const p2 = normPoint(it.p2, w, h);
            const cp = normPoint(it.cp, w, h);
            if (!p1 || !p2 || !cp) return null;
            entry.p = [...p1, ...p2, ...cp];
            return entry;
        }

        if (kind === 'shape') {
            const path = Array.isArray(it.path) ? it.path.map(pt => normPoint(pt, w, h)).filter(Boolean) : [];
            if (path.length) entry.p = path;
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
                if (segments.length) entry.segments = segments;
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
