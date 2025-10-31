/**
 * @fileoverview Powers the animation timeline for LinePack Pro, including
 * keyframe management, playback control, and cursor rendering.
 */

function registerTimeline(ctx) {
    const { state, ui, utils, api } = ctx;
    const { clamp, rndId, lerp, lpt } = utils;

    function rebuildTicks() {
        const dur = +ui.animDur.value || 5;
        ui.ticks.innerHTML = '';
        const body = ui.timeline.querySelector('.tl-body');
        const rect = body.getBoundingClientRect();
        const W = rect.width;
        for (let s = 0; s <= dur; s++) {
            const x = (s / dur) * W;
            const div = document.createElement('div');
            div.className = 'tick' + (s % 5 === 0 ? ' l' : '');
            div.style.left = x + 'px';
            const lab = document.createElement('div');
            lab.className = 'lab';
            lab.textContent = s + 's';
            div.appendChild(lab);
            ui.ticks.appendChild(div);
        }
        placeCursor();
    }

    function secToX(sec) {
        const dur = +ui.animDur.value || 5;
        const rect = ui.timeline.querySelector('.tl-body').getBoundingClientRect();
        return clamp((sec / dur) * rect.width, 0, rect.width);
    }

    function xToSec(x) {
        const dur = +ui.animDur.value || 5;
        const rect = ui.timeline.querySelector('.tl-body').getBoundingClientRect();
        return clamp((x / rect.width) * dur, 0, dur);
    }

    function placeCursor() {
        const dur = +ui.animDur.value || 5;
        state.tl.sec = clamp(state.tl.sec, 0, dur);
        ui.cursor.style.left = secToX(state.tl.sec) + 'px';
        ui.cursor.classList.toggle('has-kf', hasKeyAt(state.tl.sec));
    }

    function currentAnim() {
        return state.animations.find(a => a.id === state.currentAnimId) || null;
    }

    function refreshAnimSelect() {
        ui.animSelect.innerHTML = '';
        state.animations.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name;
            ui.animSelect.appendChild(opt);
        });
        if (state.currentAnimId) ui.animSelect.value = state.currentAnimId;
    }

    function snapshotState() {
        return JSON.parse(JSON.stringify(state.items));
    }

    function putKeyframe() {
        const anim = currentAnim();
        if (!anim) return;
        const t = state.tl.sec;
        const snap = snapshotState();
        const idx = anim.keyframes.findIndex(k => Math.abs(k.t - t) < 1e-6);
        if (idx >= 0) anim.keyframes[idx].snapshot = snap;
        else anim.keyframes.push({ t, snapshot: snap });
        anim.keyframes.sort((a, b) => a.t - b.t);
        placeCursor();
    }

    function hasKeyAt(sec) {
        const anim = currentAnim();
        if (!anim) return false;
        return anim.keyframes.some(k => Math.abs(k.t - sec) < 1e-6);
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
        state.tl.sec = Math.min(Math.floor(tMs), Math.round(durSec));
        let k1 = ks[0];
        let k2 = ks[ks.length - 1];
        for (let i = 0; i < ks.length - 1; i++) {
            if (tMs >= ks[i].t && tMs <= ks[i + 1].t) {
                k1 = ks[i];
                k2 = ks[i + 1];
                break;
            }
        }
        const span = Math.max(1e-6, k2.t - k1.t);
        const tt = clamp((tMs - k1.t) / span, 0, 1);
        const map2 = new Map(k2.snapshot.map(o => [o.id, o]));
        const out = k1.snapshot.map(o1 => {
            const o2 = map2.get(o1.id);
            if (!o2) return JSON.parse(JSON.stringify(o1));
            return tweenItem(o1, o2, tt);
        });
        for (const o2 of k2.snapshot) {
            if (!out.find(x => x.id === o2.id)) out.push(JSON.parse(JSON.stringify(o2)));
        }
        const bak = state.items;
        state.items = out;
        api.draw && api.draw();
        state.items = bak;
        if (endReached) state.tl.sec = Math.round(durSec);
        ui.playhead.style.left = secToX(endReached ? durSec : tMs) + 'px';
        placeCursor();
        if (endReached) {
            state.tl.playing = false;
            return;
        }
        requestAnimationFrame(stepPlay);
    }

    ui.timeline.addEventListener('click', (e) => {
        const bodyRect = ui.timeline.querySelector('.tl-body').getBoundingClientRect();
        if (e.clientY < bodyRect.top || e.clientY > bodyRect.bottom) return;
        state.tl.sec = Math.round(xToSec(e.clientX - bodyRect.left));
        placeCursor();
    });

    ui.loopToggle.addEventListener('click', () => {
        state.tl.loop = !state.tl.loop;
        if (!state.tl.loop && state.tl.playing) {
            state.tl.startTime = performance.now() - state.tl.sec * 1000;
        }
        api.updateLoopButton && api.updateLoopButton();
    });

    ui.addAnim.addEventListener('click', () => {
        const name = ui.animName.value.trim() || ('کلیپ ' + (state.animations.length + 1));
        const id = rndId('anim');
        const anim = { id, name, duration: +ui.animDur.value || 5, keyframes: [] };
        state.animations.push(anim);
        state.currentAnimId = id;
        refreshAnimSelect();
        ui.animSelect.value = id;
        ui.animName.value = anim.name;
        placeCursor();
    });

    ui.renameAnim.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim) return;
        anim.name = ui.animName.value.trim() || anim.name;
        refreshAnimSelect();
    });

    ui.delAnim.addEventListener('click', () => {
        if (!state.currentAnimId) return;
        state.animations = state.animations.filter(a => a.id !== state.currentAnimId);
        state.currentAnimId = state.animations[0]?.id || null;
        refreshAnimSelect();
        placeCursor();
    });

    ui.animSelect.addEventListener('change', () => {
        state.currentAnimId = ui.animSelect.value || null;
        const anim = currentAnim();
        if (anim) {
            ui.animName.value = anim.name;
            ui.animDur.value = anim.duration;
        }
        rebuildTicks();
        placeCursor();
    });

    ui.animDur.addEventListener('change', () => {
        const anim = currentAnim();
        if (anim) anim.duration = +ui.animDur.value || 5;
        rebuildTicks();
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
    });

    ui.tlPlay.addEventListener('click', () => {
        const anim = currentAnim();
        if (!anim || !anim.keyframes.length) return;
        state.tl.playing = !state.tl.playing;
        if (state.tl.playing) {
            state.tl.startTime = performance.now() - state.tl.sec * 1000;
            requestAnimationFrame(stepPlay);
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
        stepPlay
    };

    Object.assign(api, exposed);
    return { exposed };
}

export { registerTimeline };
