import { initToolbar } from './ui/toolbar.js';
import { initSidebar } from './ui/sidebar.js';
import { initCanvas } from './ui/canvas.js';
import { initTimeline } from './ui/timeline.js';
import { on, emit } from './events.js';
import { state } from './state.js';
import { pushHistory, undo, redo } from './utils/history.js';

import { groupSelection, ungroupSelection } from './tools/group.js';
import { exportJSON, importJSON } from './utils/file.js';
import { initManip } from './tools/manip.js';
window.keys = { ctrl: false, shift: false };
window.addEventListener('keydown', e => {
  if (e.key === 'Control') window.keys.ctrl = true;
  if (e.key === 'Shift') window.keys.shift = true;
});
window.addEventListener('keyup', e => {
  if (e.key === 'Control') window.keys.ctrl = false;
  if (e.key === 'Shift') window.keys.shift = false;
});
function main() {
  initToolbar();
  // ثبت رویدادهای دکمه‌های اصلی پس از ایجاد نوار ابزار
  document.getElementById('undo').addEventListener('click', () => {
    pushHistory();
    undo();
    emit('draw');
    emit('refreshList');
  });
  document.getElementById('redo').addEventListener('click', () => {
    pushHistory();
    redo();
    emit('draw');
    emit('refreshList');
  });
  document.getElementById('apply').addEventListener('click', commitDrawing);

  initManip();
  initSidebar();
  initCanvas();
  initTimeline();

  const shortcuts = {
    'h': () => document.getElementById('helpBtn').click(),
    's': () => emit('tool:change', 'select'),
    'm': () => emit('tool:change', 'move'),
    'l': () => emit('tool:change', 'line'),
    'c': () => emit('tool:change', 'quadratic'),
    'r': () => emit('tool:change', 'rect'),
    'e': () => emit('tool:change', 'ellipse'),
    'g': () => emit('group'),
    'u': () => emit('ungroup'),
    'f2': () => renameSelected(),
    'delete': () => deleteSelection(),
    'escape': () => { state.drawing = null; emit('draw'); },
    'enter': () => commitDrawing()
  };

  on('group', groupSelection);
  on('ungroup', ungroupSelection);

  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); pushHistory(); undo(); emit('draw'); emit('refreshList');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && e.shiftKey) {
      e.preventDefault(); pushHistory(); redo(); emit('draw'); emit('refreshList');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault(); downloadBlob(JSON.stringify(exportJSON()), 'drawing.linepack.json');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault(); document.getElementById('fileInput').click();
      return;
    }
    const key = e.key.toLowerCase();
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { state.drawing = null; emit('draw'); }
    if (e.key === 'Enter') { commitDrawing(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); pushHistory(); undo(); emit('draw'); emit('refreshList'); }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); pushHistory(); redo(); emit('draw'); emit('refreshList'); }
    if (e.ctrlKey && e.key.toLowerCase() === 'g' && !e.shiftKey) { e.preventDefault(); groupSelection(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelection(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); downloadBlob(JSON.stringify(exportJSON()), 'drawing.linepack.json'); }

  });

  // دکمه‌های اصلی
  document.getElementById('saveJSON').addEventListener('click', () => downloadBlob(JSON.stringify(exportJSON()), 'drawing.linepack.json'));
  document.getElementById('saveJSONMin').addEventListener('click', () => downloadBlob(JSON.stringify(exportJSON()), 'drawing.min.linepack.json'));
  document.getElementById('exportPNG').addEventListener('click', () => {
    const canvas = document.getElementById('canvas');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'canvas.png';
    a.click();
  });
  document.getElementById('clear').addEventListener('click', () => {
    if (confirm('همه چیز پاک شود؟')) {
      pushHistory();
      state.items = []; state.selected.clear(); emit('draw'); emit('refreshList');
    }
  });
  document.getElementById('deleteSel').addEventListener('click', deleteSelection);
  document.getElementById('helpBtn').addEventListener('click', () => {
    document.getElementById('help').classList.toggle('hide');
  });

  document.getElementById('groupBtn').addEventListener('click', () => emit('group'));
  document.getElementById('ungroupBtn').addEventListener('click', () => emit('ungroup'));
  document.getElementById('fileInput').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      importJSON(JSON.parse(txt));
      emit('draw'); emit('refreshList');
    } catch (err) { alert('فایل معتبر نیست: ' + err.message); }
    e.target.value = '';
  });

}

function deleteSelection() {
  if (!state.selected.size) return;
  pushHistory();
  state.items = state.items.filter(it => !state.selected.has(it.id));
  state.selected.clear();
  emit('draw'); emit('refreshList');
}

function renameSelected() {
  const ids = [...state.selected];
  if (ids.length !== 1) return;
  const item = state.items.find(it => it.id === ids[0]);
  if (!item) return;
  const name = prompt('نام جدید', item.name || '');
  if (name !== null) {
    item.name = name.trim() || item.name;
    emit('draw');
    emit('refreshList');
  }
}

function commitDrawing() {
  if (!state.drawing) return;
  const it = state.drawing;
  delete it.stage; delete it._isEllipse; delete it._center; delete it._edge; delete it._isRect;
  state.items.push(it);
  pushHistory();
  state.drawing = null;
  emit('draw'); emit('refreshList');
}

function downloadBlob(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}

document.addEventListener('DOMContentLoaded', main);
