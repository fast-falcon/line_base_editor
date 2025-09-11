import { state } from '../state.js';
import { emit, on } from '../events.js';
import { pushHistory } from '../utils/history.js';
import { rndId } from '../utils/helpers.js';
import { rebuildTicks, placeCursor, putKeyframe, stepPlay, currentAnim } from './timeline.js';

export function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="tabs">
      <div id="tabElems" class="tab" aria-selected="true">المان‌ها</div>
      <div id="tabAnims" class="tab" aria-selected="false">انیمیشن‌ها</div>
    </div>
    <div id="panelElems" class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="display:flex;gap:6px">
          <button id="toggleAll" class="btn">نمایش</button>
          <button id="deleteSel" class="btn danger">حذف</button>
        </div>
        <small class="muted">برای چند انتخاب <span class="kbd">Shift</span> را نگه دار</small>
      </div>
      <div id="elemList" class="list" style="margin-top:8px"></div>
    </div>
    <div id="panelAnims" class="panel hide">
      <div style="display:grid;gap:8px">
        <div style="display:flex;gap:6px;align-items:center">
          <input id="animName" class="btn" type="text" placeholder="نام کلیپ" style="width: 160px"/>
          <button id="addAnim" class="btn">+ جدید</button>
          <button id="renameAnim" class="btn">تغییر نام</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="animSelect" class="btn" style="min-width: 180px"></select>
          <label>مدت (ثانیه) <input id="animDur" class="btn" type="number" min="1" max="360" value="5" style="width:80px"/></label>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="setKey" class="btn">ثبت کلیدفریم</button>
          <button id="play" class="btn">پخش</button>
          <button id="pause" class="btn">توقف</button>
          <button id="delAnim" class="btn danger">حذف کلیپ</button>
        </div>
      </div>
    </div>
  `;
  // دکمه‌های المان‌ها
  document.getElementById('toggleAll').addEventListener('click', () => {
    const anyHidden = state.items.some(it => it.visible === false);
    state.items.forEach(it => { it.visible = anyHidden; });
    refreshElemList();
    emit('draw');
  });

  // تب‌ها
  sidebar.addEventListener('click', e => {
    if (e.target.classList.contains('tab')) {
      sidebar.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', 'false'));
      sidebar.querySelectorAll('.panel').forEach(p => p.classList.add('hide'));
      e.target.setAttribute('aria-selected', 'true');
      const panelId = e.target.id === 'tabElems' ? 'panelElems' : 'panelAnims';
      document.getElementById(panelId).classList.remove('hide');
    }
  });

  // دکمه‌های انیمیشن‌ها
  const animName = document.getElementById('animName');
  const animSelect = document.getElementById('animSelect');
  const animDur = document.getElementById('animDur');
  document.getElementById('addAnim').addEventListener('click', () => {
    const name = animName.value.trim() || ('کلیپ ' + (state.animations.length + 1));
    const id = rndId('anim');
    state.animations.push({ id, name, duration: +animDur.value || 5, keyframes: [] });
    state.currentAnimId = id;
    refreshAnimSelect();
    placeCursor();
  });
  document.getElementById('renameAnim').addEventListener('click', () => {
    const a = currentAnim();
    if (!a) return;
    a.name = animName.value.trim() || a.name;
    refreshAnimSelect();
  });
  document.getElementById('delAnim').addEventListener('click', () => {
    if (!state.currentAnimId) return;
    state.animations = state.animations.filter(a => a.id !== state.currentAnimId);
    state.currentAnimId = state.animations[0]?.id || null;
    refreshAnimSelect();
    placeCursor();
  });
  animSelect.addEventListener('change', () => {
    state.currentAnimId = animSelect.value;
    const a = currentAnim();
    if (a) {
      animName.value = a.name;
      animDur.value = a.duration;
      rebuildTicks();
      placeCursor();
    }
  });
  animDur.addEventListener('change', () => {
    const a = currentAnim();
    if (a) a.duration = +animDur.value || 5;
    rebuildTicks();
    placeCursor();
  });
  document.getElementById('setKey').addEventListener('click', putKeyframe);
  document.getElementById('play').addEventListener('click', () => {
    const a = currentAnim();
    if (!a || !a.keyframes.length) return;
    state.tl.playing = true;
    state.tl.startTime = performance.now() - state.tl.sec * 1000;
    requestAnimationFrame(stepPlay);
  });
  document.getElementById('pause').addEventListener('click', () => { state.tl.playing = false; });
  on('refreshList', refreshElemList);

  refreshElemList();
  refreshAnimSelect();
}

export function refreshElemList() {
  const list = document.getElementById('elemList');
  list.innerHTML = '';
  state.items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = it.id;
    row.setAttribute('aria-selected', state.selected.has(it.id));
    row.innerHTML = `
      <div class="sw" style="background:${it.kind === 'shape' ? (it.fill || it.color) : it.color}"></div>
      <div class="title">${it.name || (it.kind === 'line' ? 'خط' : it.kind === 'quadratic' ? 'منحنی' : 'شکل')}</div>
      <svg class="icon" viewBox="0 0 24 24"><use href="#${it.visible === false ? 'ico-eyeoff' : 'ico-eye'}"></use></svg>
      <svg class="icon" viewBox="0 0 24 24"><use href="#ico-trash"></use></svg>
    `;
    row.addEventListener('click', e => {
      const add = e.shiftKey;
      if (add) state.selected.add(it.id); else { state.selected.clear(); state.selected.add(it.id); }
      refreshElemList();
      emit('draw');
    });
    row.querySelector('svg').addEventListener('click', e => { e.stopPropagation(); it.visible = !it.visible; refreshElemList(); emit('draw'); });
    row.querySelectorAll('svg')[1].addEventListener('click', e => { e.stopPropagation(); pushHistory(); state.items = state.items.filter(x => x.id !== it.id); state.selected.delete(it.id); refreshElemList(); emit('draw'); });
    list.appendChild(row);
  });
}

export function refreshAnimSelect() {
  const sel = document.getElementById('animSelect');
  sel.innerHTML = '';
  state.animations.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
  if (state.currentAnimId) sel.value = state.currentAnimId;
}