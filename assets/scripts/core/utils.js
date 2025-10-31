/**
 * @fileoverview Provides reusable geometry and math helpers shared across
 * LinePack Pro layers, keeping vector and animation calculations consistent.
 */

export const rndId = (p = 'it') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lpt = (A, B, t) => ({
    x: lerp(A.x, B.x, t),
    y: lerp(A.y, B.y, t)
});
export const nearly = (a, b, eps = 6) => Math.abs(a - b) <= eps;

export function rotatePoint(p, c, deg) {
    const rad = deg * Math.PI / 180;
    const s = Math.sin(rad);
    const co = Math.cos(rad);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return {
        x: c.x + dx * co - dy * s,
        y: c.y + dx * s + dy * co
    };
}

export function itemPoints(it) {
    if (it.kind === 'line') return [it.p1, it.p2];
    if (it.kind === 'quadratic') return [it.p1, it.cp, it.p2];
    if (it.kind === 'shape') return it.path;
    return [];
}

export function setItemPoints(it, pts) {
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
        const prevPath = Array.isArray(it.path) ? it.path.map(p => ({ x: p.x, y: p.y })) : [];
        const prevSegments = Array.isArray(it.segments) ? it.segments.map(seg => ({
            ...seg,
            p1: seg?.p1 ? { x: seg.p1.x, y: seg.p1.y } : null,
            p2: seg?.p2 ? { x: seg.p2.x, y: seg.p2.y } : null,
            cp: seg?.cp ? { x: seg.cp.x, y: seg.cp.y } : null
        })) : null;

        it.path = pts;

        if (prevSegments && prevSegments.length && prevPath.length === pts.length) {
            const n = pts.length;
            let dx = 0;
            let dy = 0;
            let isTranslation = n > 0;
            for (let i = 0; i < n; i++) {
                const ddx = pts[i].x - prevPath[i].x;
                const ddy = pts[i].y - prevPath[i].y;
                if (i === 0) {
                    dx = ddx;
                    dy = ddy;
                } else if (Math.abs(ddx - dx) > 1e-6 || Math.abs(ddy - dy) > 1e-6) {
                    isTranslation = false;
                    break;
                }
            }

            const safeIndex = (idx) => {
                if (!Number.isInteger(idx)) return null;
                if (!n) return null;
                let m = idx % n;
                if (m < 0) m += n;
                return m;
            };

            it.segments = prevSegments.map(seg => {
                const next = {
                    ...seg,
                    p1: seg.p1 ? { x: seg.p1.x, y: seg.p1.y } : null,
                    p2: seg.p2 ? { x: seg.p2.x, y: seg.p2.y } : null
                };
                if (seg.cp) next.cp = { x: seg.cp.x, y: seg.cp.y };

                if (isTranslation) {
                    if (next.p1) {
                        next.p1.x += dx;
                        next.p1.y += dy;
                    }
                    if (next.p2) {
                        next.p2.x += dx;
                        next.p2.y += dy;
                    }
                    if (next.cp) {
                        next.cp.x += dx;
                        next.cp.y += dy;
                    }
                    return next;
                }

                const fromIdx = safeIndex(seg._from);
                const toIdx = safeIndex(seg._to);
                let startShift = { dx: 0, dy: 0 };
                let endShift = { dx: 0, dy: 0 };

                if (fromIdx !== null && fromIdx < n) {
                    const newStart = pts[fromIdx];
                    const oldStart = prevPath[fromIdx];
                    startShift = { dx: newStart.x - oldStart.x, dy: newStart.y - oldStart.y };
                    next.p1 = { x: newStart.x, y: newStart.y };
                }
                if (toIdx !== null && toIdx < n) {
                    const newEnd = pts[toIdx];
                    const oldEnd = prevPath[toIdx];
                    endShift = { dx: newEnd.x - oldEnd.x, dy: newEnd.y - oldEnd.y };
                    next.p2 = { x: newEnd.x, y: newEnd.y };
                }

                if (next.cp) {
                    let cpDx = 0;
                    let cpDy = 0;
                    let weight = 0;
                    if (fromIdx !== null && fromIdx < n) {
                        cpDx += startShift.dx;
                        cpDy += startShift.dy;
                        weight += 1;
                    }
                    if (toIdx !== null && toIdx < n) {
                        cpDx += endShift.dx;
                        cpDy += endShift.dy;
                        weight += 1;
                    }
                    if (weight > 0) {
                        next.cp.x += cpDx / weight;
                        next.cp.y += cpDy / weight;
                    }
                }

                return next;
            });
        }
    }
}

export function itemCenter(it) {
    const pts = itemPoints(it);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2
    };
}

export function pointLineDist(p, a, b) {
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

export function quadAt(a, c, b, t) {
    const u = 1 - t;
    return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
    };
}

export function pointQuadNear(p, a, c, b) {
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

export function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) &&
            (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 0.00001) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
