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
        it.path = pts;
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
