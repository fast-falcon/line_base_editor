/**
 * @fileoverview Powers the animation timeline for LinePack Pro, including
 * keyframe management, playback control, and cursor rendering.
 */

function registerTimeline(ctx) {
    const { state, ui, utils, api } = ctx;
    const { clamp, rndId, lerp, lpt } = utils;
    const TL_MARGIN = 24;

    function formatSeconds(sec) {
        const rounded = +(+sec).toFixed(2);
        return rounded.toString();
    }

    function currentDuration() {
        const anim = currentAnim();
        return anim ? (anim.duration || 5) : (+ui.animDur.value || 5);
    }

    function getTimelineMetrics() {
        const body = ui.timeline.querySelector('.tl-body');
        const rect = body.getBoundingClientRect();
        const usable = Math.max(1, rect.width - TL_MARGIN * 2);
        return { rect, usable };
    }

    function rebuildTicks() {
        const dur = Math.max(0.001, currentDuration());
        ui.ticks.innerHTML = '';
        const steps = Math.max(1, Math.ceil(dur));
        for (let s = 0; s <= steps; s++) {
            const t = Math.min(s, dur);
            const div = document.createElement('div');
            div.className = 'tick' + (s % 5 === 0 ? ' l' : '');
            div.style.left = secToX(t) + 'px';
            const lab = document.createElement('div');
            lab.className = 'lab';
            lab.textContent = formatSeconds(t) + 's';
            div.appendChild(lab);
            ui.ticks.appendChild(div);
        }
        placeCursor();
    }

    function secToX(sec) {
        const dur = Math.max(0.001, currentDuration());
        const { usable } = getTimelineMetrics();
        const rel = clamp((sec / dur) * usable, 0, usable);
        return TL_MARGIN + rel;
    }

    function xToSec(x) {
        const dur = Math.max(0.001, currentDuration());
        const { usable } = getTimelineMetrics();
        const rel = clamp(x - TL_MARGIN, 0, usable);
        return clamp((rel / usable) * dur, 0, dur);
    }

    function ensurePreviewBackup() {
        if (!state.tl.previewing) {
            state.tl.previewBackup = snapshotState();
            state.tl.previewing = true;
        }
    }

    function restorePreviewBackup() {
        if (state.tl.previewing && state.tl.previewBackup) {
            state.items = JSON.parse(JSON.stringify(state.tl.previewBackup));
            api.refreshElemList && api.refreshElemList();
            api.draw && api.draw();
            state.tl.previewBackup = null;
        }
        state.tl.previewing = false;
        api.updateFillVisibility && api.updateFillVisibility();
        api.updateGhost && api.updateGhost();
    }

    function placeCursor() {
        const dur = Math.max(0.001, currentDuration());
        state.tl.sec = clamp(state.tl.sec, 0, dur);
        ui.cursor.style.left = secToX(state.tl.sec) + 'px';
        ui.cursor.classList.toggle('has-kf', hasKeyAt(state.tl.sec));
        if (!state.tl.playing) ui.playhead.style.left = secToX(state.tl.sec) + 'px';
        renderKeyframeList();
    }

    function currentAnim() {
        if (!state.currentAnimId) return null;
        return state.animations.find(a => a.id === state.currentAnimId) || null;
    }

    function syncAnimControls() {
        const anim = currentAnim();
        if (anim) {
            ui.animName.value = anim.name;
            ui.animDur.value = anim.duration;
        } else {
            ui.animName.value = '';
            ui.animDur.value = 5;
        }
    }

    function refreshAnimSelect() {
        const anim = currentAnim();
        if (!anim && state.animations.length) {
            state.currentAnimId = state.animations[0].id;
        }
        renderAnimList();
        renderKeyframeList();
        syncAnimControls();
    }

    function snapshotState() {
        return JSON.parse(JSON.stringify(state.items));
    }

    function putKeyframe() {
        const anim = currentAnim();
        if (!anim) return;
        const t = +state.tl.sec;
        const snap = snapshotState();
        const idx = anim.keyframes.findIndex(k => Math.abs(k.t - t) < 1e-4);
        if (idx >= 0) anim.keyframes[idx].snapshot = snap;
        else anim.keyframes.push({ t, snapshot: snap });
        anim.keyframes.sort((a, b) => a.t - b.t);
        renderKeyframeList();
        renderAnimList();
        placeCursor();
    }

    function hasKeyAt(sec) {
        const anim = currentAnim();
        if (!anim) return false;
        return anim.keyframes.some(k => Math.abs(k.t - sec) < 1e-2);
    }

    function tweenItem(a, b, t) {
        const o = JSON.parse(JSON.stringify(a));
        o.color = a.color;
        o.width = lerp(a.width, b.width, t);
        o.rot = lerp(a.rot || 0, b.rot || 0, t);
        if (a.kind === 'line' && b.kind === 'line') {
            o.p1 = lpt(a.p1, b.p1, t);
            o.p2 = lpt(a.p2, b.p2, t);
        }
        if (a.kind === 'quadratic' && b.kind === 'quadratic') {
            o.p1 = lpt(a.p1, b.p1, t);
            o.cp = lpt(a.cp, b.cp, t);
            o.p2 = lpt(a.p2, b.p2, t);
        }
        if (a.kind === 'shape' && b.kind === 'shape') {
            const n = Math.min(a.path.length, b.path.length);
            const path = [];
            for (let i = 0; i < n; i++) path.push(lpt(a.path[i], b.path[i], t));
            o.path = path;
            o.fill = t < 0.5 ? a.fill : b.fill;
        }
        return o;
    }

    function snapshotAt(anim, sec) {
        const ks = anim.keyframes;
        if (!ks.length) return null;
        if (ks.length === 1) return JSON.parse(JSON.stringify(ks[0].snapshot));
        if (sec <= ks[0].t) return JSON.parse(JSON.stringify(ks[0].snapshot));
        if (sec >= ks[ks.length - 1].t) return JSON.parse(JSON.stringify(ks[ks.length - 1].snapshot));
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
            if (!o2) return JSON.parse(JSON.stringify(o1));
            return tweenItem(o1, o2, tt);
        });
        for (const o2 of k2.snapshot) {
            if (!out.find(x => x.id === o2.id)) out.push(JSON.parse(JSON.stringify(o2)));
        }
        return out;
    }

    function applyTimelineSec(sec, { preview = true } = {}) {
        const anim = currentAnim();
        const baseDur = anim ? (anim.duration || 5) : (+ui.animDur.value || 5);
        const dur = Math.max(0.001, baseDur);
        const clamped = clamp(sec, 0, dur);
        state.tl.sec = clamped;
        if (!anim || !anim.keyframes.length) {
            placeCursor();
            return;
        }
        const snap = snapshotAt(anim, clamped);
        if (!snap) return;
        if (preview) ensurePreviewBackup();
        state.items = JSON.parse(JSON.stringify(snap));
        const validIds = new Set(state.items.map(o => o.id));
        for (const id of [...state.selected]) if (!validIds.has(id)) state.selected.delete(id);
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
        api.updateFillVisibility && api.updateFillVisibility();
        api.updateGhost && api.updateGhost();
        placeCursor();
    }

    function renderAnimList() {
        ui.animList.innerHTML = '';
        if (!state.animations.length) {
            const empty = document.createElement('div');
            empty.className = 'anim-empty';
            empty.textContent = 'هنوز انیمیشنی ساخته نشده است';
            ui.animList.appendChild(empty);
            return;
        }
        state.animations.forEach(anim => {
            const row = document.createElement('div');
            row.className = 'anim-row';
            if (anim.id === state.currentAnimId) row.classList.add('active');
            const title = document.createElement('div');
            title.className = 'title';
            const nameEl = document.createElement('div');
            nameEl.textContent = anim.name;
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = `${anim.keyframes.length} کلیدفریم · ${formatSeconds(anim.duration)}s`;
            title.appendChild(nameEl);
            title.appendChild(meta);
            row.appendChild(title);
            const actions = document.createElement('div');
            actions.className = 'actions';
            const selectBtn = document.createElement('button');
            selectBtn.className = 'btn sm';
            selectBtn.textContent = 'انتخاب';
            selectBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                selectAnimation(anim.id);
            });
            actions.appendChild(selectBtn);
            row.appendChild(actions);
            row.addEventListener('click', () => selectAnimation(anim.id));
            ui.animList.appendChild(row);
        });
    }

    function selectAnimation(id) {
        if (state.currentAnimId === id) return;
        restorePreviewBackup();
        state.currentAnimId = id;
        state.tl.sec = 0;
        state.tl.playing = false;
        syncAnimControls();
        rebuildTicks();
        renderAnimList();
        renderKeyframeList();
        placeCursor();
        const anim = currentAnim();
        if (anim && anim.keyframes.length) applyTimelineSec(anim.keyframes[0].t);
    }

    function renderKeyframeList() {
        ui.keyframeList.innerHTML = '';
        const anim = currentAnim();
        if (!anim || !anim.keyframes.length) {
            const empty = document.createElement('div');
            empty.className = 'kf-empty';
            empty.textContent = anim ? 'هیچ کلیدفریمی ثبت نشده است' : 'برای مشاهده کلیدفریم ابتدا یک انیمیشن را انتخاب کن';
            ui.keyframeList.appendChild(empty);
            return;
        }
        anim.keyframes.forEach(kf => {
            const row = document.createElement('div');
            row.className = 'keyframe-row';
            if (Math.abs(kf.t - state.tl.sec) < 1e-2) row.classList.add('active');
            const title = document.createElement('div');
            title.className = 'title';
            const time = document.createElement('span');
            time.textContent = `ثانیه ${formatSeconds(kf.t)}`;
            time.title = 'برای ویرایش دوبار کلیک کن';
            time.addEventListener('dblclick', () => editKeyframeTime(kf, time, row));
            title.appendChild(time);
            row.appendChild(title);
            const actions = document.createElement('div');
            actions.className = 'actions';
            const gotoBtn = document.createElement('button');
            gotoBtn.className = 'btn sm';
            gotoBtn.textContent = 'نمایش';
            gotoBtn.addEventListener('click', () => {
                state.tl.playing = false;
                applyTimelineSec(kf.t);
            });
            const delBtn = document.createElement('button');
            delBtn.className = 'btn sm danger';
            delBtn.textContent = 'حذف';
            delBtn.addEventListener('click', () => deleteKeyframe(kf));
            actions.appendChild(gotoBtn);
            actions.appendChild(delBtn);
            row.appendChild(actions);
            ui.keyframeList.appendChild(row);
        });
    }

    function editKeyframeTime(kf, timeEl, row) {
        const anim = currentAnim();
        if (!anim) return;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'btn keyframe-time-input';
        input.step = '0.1';
        input.min = '0';
        input.max = String(anim.duration || currentDuration());
        input.value = kf.t.toFixed(2);
        const commit = (save) => {
            if (!save) {
                row.replaceChild(timeEl, input);
                return;
            }
            let val = parseFloat(input.value);
            if (Number.isNaN(val)) val = kf.t;
            val = clamp(val, 0, anim.duration || currentDuration());
            kf.t = +val;
            anim.keyframes.sort((a, b) => a.t - b.t);
            for (let i = anim.keyframes.length - 1; i >= 0; i--) {
                const item = anim.keyframes[i];
                if (item === kf) continue;
                if (Math.abs(item.t - kf.t) < 1e-4) anim.keyframes.splice(i, 1);
            }
            row.replaceChild(timeEl, input);
            renderKeyframeList();
            renderAnimList();
            applyTimelineSec(val);
            rebuildTicks();
        };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') commit(true);
            if (ev.key === 'Escape') commit(false);
        });
        input.addEventListener('blur', () => commit(true));
        row.replaceChild(input, timeEl);
        input.focus();
        input.select();
    }

    function deleteKeyframe(kf) {
        const anim = currentAnim();
        if (!anim) return;
        const idx = anim.keyframes.indexOf(kf);
        if (idx >= 0) anim.keyframes.splice(idx, 1);
        renderKeyframeList();
        renderAnimList();
        if (!anim.keyframes.length) {
            restorePreviewBackup();
            state.tl.sec = 0;
            placeCursor();
            return;
        }
        const nextSec = clamp(state.tl.sec, anim.keyframes[0].t, anim.keyframes[anim.keyframes.length - 1].t);
        applyTimelineSec(nextSec);
        rebuildTicks();
    }

    function stepPlay(now) {
        if (!state.tl.playing) return;
        const anim = currentAnim();
        if (!anim) {
            state.tl.playing = false;
            return;
        }
        const durSec = Math.max(0.001, anim.duration || 5);
        const durMs = durSec * 1000;
        const elapsed = now - state.tl.startTime;
        const ks = anim.keyframes;
        if (!ks.length) {
            state.tl.playing = false;
            return;
        }
        const capped = state.tl.loop ? (elapsed % durMs) : Math.min(elapsed, durMs);
        const tMs = capped / 1000;
        const endReached = !state.tl.loop && elapsed >= durMs - 0.5;
        const snap = snapshotAt(anim, tMs);
        if (!snap) {
            state.tl.playing = false;
            return;
        }
        const bak = state.items;
        state.items = snap;
        api.draw && api.draw();
        state.items = bak;
        state.tl.sec = clamp(tMs, 0, durSec);
        ui.playhead.style.left = secToX(endReached ? durSec : state.tl.sec) + 'px';
        ui.cursor.style.left = secToX(state.tl.sec) + 'px';
        ui.cursor.classList.toggle('has-kf', hasKeyAt(state.tl.sec));
        if (endReached) {
            state.tl.playing = false;
            return;
        }
        requestAnimationFrame(stepPlay);
    }

    ui.timeline.addEventListener('click', (e) => {
        const bodyRect = ui.timeline.querySelector('.tl-body').getBoundingClientRect();
        if (e.clientY < bodyRect.top || e.clientY > bodyRect.bottom) return;
        const sec = +xToSec(e.clientX - bodyRect.left).toFixed(2);
        state.tl.playing = false;
        applyTimelineSec(sec);
    });

    ui.loopToggle.addEventListener('click', () => {
        state.tl.loop = !state.tl.loop;
        if (!state.tl.loop && state.tl.playing) {
            state.tl.startTime = performance.now() - state.tl.sec * 1000;
        }
        api.updateLoopButton && api.updateLoopButton();
    });

    ui.addAnim.addEventListener('click', () => {
        restorePreviewBackup();
        const name = ui.animName.value.trim() || ('کلیپ ' + (state.animations.length + 1));
        const id = rndId('anim');
        const anim = { id, name, duration: +ui.animDur.value || 5, keyframes: [] };
        state.animations.push(anim);
        state.currentAnimId = id;
        syncAnimControls();
        renderAnimList();
        renderKeyframeList();
        rebuildTicks();
        placeCursor();
    });

    ui.renameAnim.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim) return;
        anim.name = ui.animName.value.trim() || anim.name;
        renderAnimList();
    });

    ui.delAnim.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim) return;
        state.animations = state.animations.filter(a => a.id !== anim.id);
        restorePreviewBackup();
        state.currentAnimId = state.animations[0]?.id || null;
        state.tl.sec = 0;
        state.tl.playing = false;
        syncAnimControls();
        renderAnimList();
        renderKeyframeList();
        rebuildTicks();
        placeCursor();
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
    });

    ui.animDur.addEventListener('change', () => {
        const anim = currentAnim();
        const val = +ui.animDur.value || 5;
        if (anim) anim.duration = val;
        rebuildTicks();
        renderAnimList();
        placeCursor();
    });

    ui.setKey.addEventListener('click', putKeyframe);
    ui.tlAddKey.addEventListener('click', putKeyframe);

    ui.play.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim || !anim.keyframes.length) return;
        state.tl.playing = true;
        state.tl.startTime = performance.now() - state.tl.sec * 1000;
        requestAnimationFrame(stepPlay);
    });

    ui.pause.addEventListener('click', () => {
        state.tl.playing = false;
        ui.playhead.style.left = secToX(state.tl.sec) + 'px';
    });

    ui.tlPlay.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim || !anim.keyframes.length) return;
        state.tl.playing = !state.tl.playing;
        if (state.tl.playing) {
            state.tl.startTime = performance.now() - state.tl.sec * 1000;
            requestAnimationFrame(stepPlay);
        } else {
            ui.playhead.style.left = secToX(state.tl.sec) + 'px';
        }
    });

    const exposed = {
        rebuildTicks,
        placeCursor,
        currentAnim,
        refreshAnimSelect,
        snapshotState,
        putKeyframe,
        hasKeyAt,
        stepPlay,
        renderKeyframeList,
        applyTimelineSec
    };

    Object.assign(api, exposed, { restorePreviewBackup });
    refreshAnimSelect();
    return { exposed };
}

export { registerTimeline };
