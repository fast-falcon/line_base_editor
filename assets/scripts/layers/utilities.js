function registerUtilities(ctx) {
    const { state, ui, canvas, stageWrap, utils } = ctx;
    const { dist, itemPoints } = utils;

    function itemsByIds(ids) {
        return ids
            .map(id => state.items.find(it => it.id === id))
            .filter(Boolean);
    }

    function selectionBBox() {
        const pts = [];
        for (const it of itemsByIds([...state.selected])) {
            const list = itemPoints(it);
            if (Array.isArray(list)) pts.push(...list);
        }
        if (!pts.length) return null;
        let minX = pts[0].x;
        let minY = pts[0].y;
        let maxX = pts[0].x;
        let maxY = pts[0].y;
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        return {
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2
        };
    }

    function pointLineDist(p, a, b) {
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

    function quadAt(a, c, b, t) {
        const u = 1 - t;
        return {
            x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
            y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
        };
    }

    function pointQuadNear(p, a, c, b) {
        let min = Infinity;
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

    function pointInPolygon(p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x;
            const yi = poly[i].y;
            const xj = poly[j].x;
            const yj = poly[j].y;
            const inter = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-9) + xi);
            if (inter) inside = !inside;
        }
        return inside;
    }

    function getCSSSize() {
        return {
            w: stageWrap.clientWidth,
            h: stageWrap.clientHeight
        };
    }

    function getCssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    const exposed = {
        itemsByIds,
        selectionBBox,
        pointLineDist,
        pointQuadNear,
        pointInPolygon,
        getCSSSize,
        getCssVar
    };

    Object.assign(ctx.api, exposed);

    return { exposed };
}

export { registerUtilities };
