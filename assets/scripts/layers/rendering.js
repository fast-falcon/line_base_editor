function registerRendering(ctx) {
    const { state, ui, utils, stageWrap, canvas, ctx: canvasCtx, dpr, toolbar, api } = ctx;
    const { itemCenter, itemPoints } = utils;

    function drawGrid() {
        const w = stageWrap.clientWidth;
        const h = stageWrap.clientHeight;
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvasCtx.lineWidth = 1;
        const stroke = api.getCssVar ? api.getCssVar('--grid') : '#444';
        canvasCtx.strokeStyle = stroke || '#444';
        const step = 32;
        canvasCtx.beginPath();
        for (let x = 0; x <= w; x += step) {
            canvasCtx.moveTo(x + 0.5, 0);
            canvasCtx.lineTo(x + 0.5, h);
        }
        for (let y = 0; y <= h; y += step) {
            canvasCtx.moveTo(0, y + 0.5);
            canvasCtx.lineTo(w, y + 0.5);
        }
        canvasCtx.stroke();
        canvasCtx.restore();
    }

    function drawHandles(points) {
        canvasCtx.save();
        for (const p of points) {
            canvasCtx.beginPath();
            canvasCtx.fillStyle = 'rgba(255,200,87,0.95)';
            canvasCtx.strokeStyle = '#3b2f00';
            canvasCtx.lineWidth = 1;
            canvasCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            canvasCtx.fill();
            canvasCtx.stroke();
        }
        canvasCtx.restore();
    }

    function renderItem(item, showHandles = false) {
        if (item.visible === false) return;
        canvasCtx.save();
        canvasCtx.lineCap = 'round';
        canvasCtx.lineJoin = 'round';
        canvasCtx.strokeStyle = item.color;
        canvasCtx.lineWidth = item.width;
        const rot = item.rot || 0;
        const cen = itemCenter(item);
        canvasCtx.translate(cen.x, cen.y);
        canvasCtx.rotate((rot * Math.PI) / 180);
        canvasCtx.translate(-cen.x, -cen.y);
        if (item.kind === 'line') {
            canvasCtx.beginPath();
            canvasCtx.moveTo(item.p1.x, item.p1.y);
            canvasCtx.lineTo(item.p2.x, item.p2.y);
            canvasCtx.stroke();
            if (showHandles) drawHandles([item.p1, item.p2]);
        } else if (item.kind === 'quadratic') {
            canvasCtx.beginPath();
            canvasCtx.moveTo(item.p1.x, item.p1.y);
            canvasCtx.quadraticCurveTo(item.cp.x, item.cp.y, item.p2.x, item.p2.y);
            canvasCtx.stroke();
            if (showHandles) {
                canvasCtx.save();
                canvasCtx.setLineDash([5, 4]);
                canvasCtx.lineWidth = 1;
                canvasCtx.strokeStyle = 'rgba(155,123,255,0.7)';
                canvasCtx.beginPath();
                canvasCtx.moveTo(item.p1.x, item.p1.y);
                canvasCtx.lineTo(item.cp.x, item.cp.y);
                canvasCtx.moveTo(item.p2.x, item.p2.y);
                canvasCtx.lineTo(item.cp.x, item.cp.y);
                canvasCtx.stroke();
                canvasCtx.restore();
                drawHandles([item.p1, item.cp, item.p2]);
            }
        } else if (item.kind === 'shape') {
            const path = item.path;
            if (!path.length) {
                canvasCtx.restore();
                return;
            }
            canvasCtx.beginPath();
            canvasCtx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) {
                canvasCtx.lineTo(path[i].x, path[i].y);
            }
            canvasCtx.closePath();
            if (item.fill) {
                canvasCtx.fillStyle = item.fill;
                canvasCtx.fill();
            }
            if (item.width > 0) canvasCtx.stroke();
            if (showHandles) drawHandles(path);
        }
        canvasCtx.restore();
    }

    function draw() {
        drawGrid();
        for (const it of state.items) {
            const selected = state.selected.has(it.id) && state.tool === 'select';
            renderItem(it, selected);
        }
        if (state.drawing) {
            canvasCtx.save();
            canvasCtx.setLineDash([6, 6]);
            canvasCtx.globalAlpha = 0.95;
            renderItem(state.drawing, true);
            canvasCtx.restore();
        }
        api.updateGhost && api.updateGhost();
    }

    function sizeStage() {
        const tb = toolbar.getBoundingClientRect();
        const full = document.documentElement.getBoundingClientRect();
        const tlH = ui.timeline.getBoundingClientRect().height || 0;
        const h = full.height - tb.height - tlH;
        stageWrap.style.height = h + 'px';
        canvas.width = Math.floor(stageWrap.clientWidth * dpr);
        canvas.height = Math.floor(stageWrap.clientHeight * dpr);
        canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.style.bottom = '0px';
        draw();
    }

    window.addEventListener('resize', sizeStage);
    sizeStage();

    const exposed = { draw, renderItem, drawGrid, drawHandles, sizeStage };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerRendering };
