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
          <button id="toggleAll" class="btn" title="نمایش/مخفی همه">نمایش</button>
          <button id="deleteSel" class="btn danger" title="حذف انتخاب‌شده‌ها (Delete)">حذف</button>
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

  const allGroups = state.items.filter(it => it.kind === 'group');
  const childSet = new Set(allGroups.flatMap(g => g.children || []));
  const topGroups = allGroups.filter(g => !childSet.has(g.id));

  for (const group of topGroups) {
    const groupRow = createRow(group, true);
    list.appendChild(groupRow);
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'group-children';
    appendChildren(childrenContainer, group);
    list.appendChild(childrenContainer);
  }

  const ungrouped = state.items.filter(it => !childSet.has(it.id) && it.kind !== 'group');
  for (const item of ungrouped) {
    const row = createRow(item);
    list.appendChild(row);
  }
}

function createRow(it, isGroup = false) {
  const row = document.createElement('div');
  row.className = `row${isGroup ? ' group-row' : ''}`;
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

  row.addEventListener('click', ev => {
    const add = ev.shiftKey;
    if (add) state.selected.add(it.id); else { state.selected.clear(); state.selected.add(it.id); }
    refreshElemList();
    emit('draw');
  });

  eye.addEventListener('click', ev => {
    ev.stopPropagation();
    it.visible = it.visible === false ? true : false;
    if (it.kind === 'group') {
      const syncVisible = grp => {
        (grp.children || []).forEach(childId => {
          const child = state.items.find(item => item.id === childId);
          if (!child) return;
          child.visible = grp.visible;
          if (child.kind === 'group') syncVisible(child);
        });
      };
      syncVisible(it);
    }
    refreshElemList();
    emit('draw');
  });

  del.addEventListener('click', ev => {
    ev.stopPropagation();
    pushHistory();
    if (it.kind === 'group') {
      const childIds = it.children || [];
      state.items = state.items.filter(item => item.id !== it.id && !childIds.includes(item.id));
      childIds.forEach(id => state.selected.delete(id));
    } else {
      state.items = state.items.filter(x => x.id !== it.id);
    }
    state.selected.delete(it.id);
    emit('draw');
    emit('refreshList');
  });

  return row;
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

function niceName(it) {
  return it.name || (it.kind === 'line' ? 'خط' : it.kind === 'quadratic' ? 'منحنی' : 'شکل');
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