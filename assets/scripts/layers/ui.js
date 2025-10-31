/**
 * @fileoverview Synchronizes LinePack Pro UI panels with the editor state,
 * including the layer list, overlays, and contextual controls.
 */

function registerUI(ctx) {
    const { state, ui, api, utils } = ctx;
    const { itemPoints } = utils;

    function niceName(it) {
        return it.name || (it.kind === 'line' ? 'خط' : it.kind === 'quadratic' ? 'منحنی' : 'شکل');
    }

    function appendChildren(container, parent) {
        for (const childId of (parent.children || [])) {
            const child = state.items.find(it => it.id === childId);
            if (!child) continue;
            const row = createRow(child, child.kind === 'group');
            container.appendChild(row);
            if (child.kind === 'group') {
                const sub = document.createElement('div');
                sub.className = 'group-children';
                appendChildren(sub, child);
                container.appendChild(sub);
            }
        }
    }

    function createRow(it, isGroup = false) {
        const row = document.createElement('div');
        row.className = `row ${isGroup ? 'group-row' : ''}`;
        row.dataset.id = it.id;
        row.setAttribute('aria-selected', state.selected.has(it.id));
        const sw = document.createElement('div');
        sw.className = 'sw';
        sw.style.background = it.kind === 'shape' ? (it.fill || it.color) : it.color;
        row.appendChild(sw);
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = niceName(it);
        row.appendChild(title);
        const eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        eye.setAttribute('viewBox', '0 0 24 24');
        eye.classList.add('icon');
        eye.innerHTML = `<use href="#${it.visible === false ? 'ico-eyeoff' : 'ico-eye'}"></use>`;
        eye.style.cursor = 'pointer';
        row.appendChild(eye);
        const del = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        del.setAttribute('viewBox', '0 0 24 24');
        del.classList.add('icon');
        del.innerHTML = '<use href="#ico-trash"></use>';
        del.style.cursor = 'pointer';
        row.appendChild(del);
        row.addEventListener('click', (ev) => {
            const add = ev.shiftKey;
            api.ensureSelected && api.ensureSelected(it.id, add);
            api.draw && api.draw();
        });
        eye.addEventListener('click', (ev) => {
            ev.stopPropagation();
            it.visible = it.visible === false ? true : false;
            refreshElemList();
            api.draw && api.draw();
        });
        del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            api.pushHistory && api.pushHistory();
            if (it.kind === 'group') {
                const children = it.children || [];
                state.items = state.items.filter(item => item.id !== it.id && !children.includes(item.id));
            } else {
                state.items = state.items.filter(x => x.id !== it.id);
            }
            state.selected.delete(it.id);
            refreshElemList();
            api.draw && api.draw();
        });
        return row;
    }

    function refreshElemList() {
        ui.elemList.innerHTML = '';
        const allGroups = state.items.filter(it => it.kind === 'group');
        const childSet = new Set(allGroups.flatMap(g => g.children || []));
        const topGroups = allGroups.filter(g => !childSet.has(g.id));
        for (const group of topGroups) {
            const groupRow = createRow(group, true);
            ui.elemList.appendChild(groupRow);
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'group-children';
            appendChildren(childrenContainer, group);
            ui.elemList.appendChild(childrenContainer);
        }
        const ungrouped = state.items.filter(it => !childSet.has(it.id) && it.kind !== 'group');
        for (const item of ungrouped) {
            const row = createRow(item);
            ui.elemList.appendChild(row);
        }
    }

    function updateFillVisibility() {
        const hasShape = [...state.selected].some(id => (state.items.find(i => i.id === id)?.kind === 'shape'));
        ui.fillWrap.style.opacity = hasShape ? 1 : 0.4;
        ui.fillWrap.style.pointerEvents = hasShape ? 'auto' : 'none';
    }

    function updateGhost() {
        const box = api.selectionBBox ? api.selectionBBox() : null;
        const handles = ui.scaleHandles || [];
        if (!box || state.tool !== 'select') {
            ui.ghost.classList.add('hide');
            ui.rotHandle.classList.add('hide');
            handles.forEach(h => h.classList.add('hide'));
            return;
        }
        ui.ghost.classList.remove('hide');
        ui.rotHandle.classList.remove('hide');
        ui.ghost.style.left = box.x + 'px';
        ui.ghost.style.top = box.y + 'px';
        ui.ghost.style.width = Math.max(0, box.w) + 'px';
        ui.ghost.style.height = Math.max(0, box.h) + 'px';
        ui.rotHandle.style.left = (box.cx - 8) + 'px';
        ui.rotHandle.style.top = (box.y - 26) + 'px';
        const positions = {
            nw: { x: box.x, y: box.y },
            ne: { x: box.x + box.w, y: box.y },
            se: { x: box.x + box.w, y: box.y + box.h },
            sw: { x: box.x, y: box.y + box.h }
        };
        handles.forEach(handle => {
            const dir = handle.dataset.dir;
            const pos = positions[dir];
            if (!pos) {
                handle.classList.add('hide');
                return;
            }
            handle.classList.remove('hide');
            handle.style.left = (pos.x - 7) + 'px';
            handle.style.top = (pos.y - 7) + 'px';
        });
    }

    ui.helpBtn.addEventListener('click', () => {
        ui.help.classList.toggle('hide');
    });

    const helpContent = `
            <strong>راهنما و کلیدهای میانبر</strong>
            <ul>
                <li><span class="kbd">H</span>: نمایش/مخفی راهنما</li>
                <li><span class="kbd">S</span>: ابزار انتخاب</li>
                <li><span class="kbd">M</span>: ابزار جابجایی</li>
                <li><span class="kbd">L</span>: ابزار خط</li>
                <li><span class="kbd">C</span>: ابزار منحنی</li>
                <li><span class="kbd">R</span>: ابزار مستطیل</li>
                <li><span class="kbd">E</span>: ابزار بیضی</li>
                <li><span class="kbd">G</span>: گروه‌بندی المان‌ها</li>
                <li><span class="kbd">U</span>: باز کردن گروه</li>
                <li><span class="kbd">F2</span>: تغییر نام المان/گروه</li>
                <li><span class="kbd">Delete</span>: حذف انتخاب‌شده‌ها</li>
                <li><span class="kbd">Ctrl+S</span>: ذخیره پروژه</li>
                <li><span class="kbd">Ctrl+O</span>: باز کردن پروژه</li>
                <li>در تایم‌لاین از دکمهٔ <span class="badge">حلقه</span> برای روشن/خاموش کردن پخش چرخه‌ای استفاده کن</li>
                <li><span class="kbd">Escape</span>: لغو عملیات جاری</li>
                <li><span class="kbd">Enter</span>: اعمال رسم جاری</li>
            </ul>
            <div>فرمت ذخیره: <span class="badge">LinePack+Anim v2</span></div>
        `;
    ui.help.innerHTML = helpContent;
    ui.help.classList.add('hide');

    ui.fillColor.addEventListener('input', () => {
        if (state.drawing && state.drawing.kind === 'shape') {
            state.drawing.fill = ui.fillColor.value;
            api.draw && api.draw();
        }
    });

    ui.groupBtn.addEventListener('click', () => api.groupSelection && api.groupSelection());
    ui.ungroupBtn.addEventListener('click', () => api.ungroupSelection && api.ungroupSelection());
    ui.toggleAll.addEventListener('click', () => {
        const anyHidden = state.items.some(it => it.visible === false);
        for (const it of state.items) it.visible = anyHidden;
        refreshElemList();
        api.draw && api.draw();
    });
    ui.deleteSel.addEventListener('click', () => api.deleteSelection && api.deleteSelection());

    ui.rotHandle.addEventListener('mousedown', (e) => {
        const box = api.selectionBBox ? api.selectionBBox() : null;
        if (!box) return;
        const mp = api.mousePos ? api.mousePos(e) : { x: e.clientX, y: e.clientY };
        const base = Math.atan2(mp.y - box.cy, mp.x - box.cx) * 180 / Math.PI;
        const rot0 = new Map();
        (api.selectionLeafItems ? api.selectionLeafItems() : []).forEach(it => rot0.set(it.id, it.rot || 0));
        ctx.dragging = { type: 'rotate', base, rot0 };
        ui.rotHandle.style.cursor = 'grabbing';
        api.pushHistory && api.pushHistory();
    });

    function cornerPos(box, dir) {
        if (!box) return null;
        const lookup = {
            nw: { x: box.x, y: box.y },
            ne: { x: box.x + box.w, y: box.y },
            se: { x: box.x + box.w, y: box.y + box.h },
            sw: { x: box.x, y: box.y + box.h }
        };
        return lookup[dir] || null;
    }

    (ui.scaleHandles || []).forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dir = handle.dataset.dir;
            const box = api.selectionBBox ? api.selectionBBox() : null;
            if (!box) return;
            const center = { x: box.cx, y: box.cy };
            const corner = cornerPos(box, dir);
            if (!corner) return;
            const baseVec = { x: corner.x - center.x, y: corner.y - center.y };
            const baseLen = Math.hypot(baseVec.x, baseVec.y) || 1;
            const points0 = new Map();
            (api.selectionLeafItems ? api.selectionLeafItems() : []).forEach(it => {
                const pts = itemPoints(it).map(p => ({ x: p.x, y: p.y }));
                points0.set(it.id, pts);
            });
            ctx.dragging = { type: 'scale', dir, center, baseVec, baseLen, points0 };
            api.pushHistory && api.pushHistory();
        });
    });

    ui.rotDeg.addEventListener('change', () => {
        const deg = +ui.rotDeg.value || 0;
        for (const it of api.itemsByIds ? api.itemsByIds([...state.selected]) : []) it.rot = deg;
        api.draw && api.draw();
        updateGhost();
    });

    ui.shapeMenuBtn.addEventListener('click', () => {
        const open = ui.shapeMenu.getAttribute('aria-expanded') === 'true';
        ui.shapeMenu.setAttribute('aria-expanded', String(!open));
    });

    ui.shapePop.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-tool]');
        if (!btn) return;
        api.setTool && api.setTool(btn.dataset.tool);
        ui.shapeMenu.setAttribute('aria-expanded', 'false');
    });

    function updateLoopButton() {
        if (!ui.loopToggle) return;
        ui.loopToggle.setAttribute('aria-pressed', state.tl.loop ? 'true' : 'false');
        ui.loopToggle.textContent = state.tl.loop ? 'حلقه: روشن' : 'حلقه: خاموش';
    }

    const exposed = {
        refreshElemList,
        updateFillVisibility,
        updateGhost,
        updateLoopButton
    };

    Object.assign(api, exposed);
    return { exposed };
}

export { registerUI };
