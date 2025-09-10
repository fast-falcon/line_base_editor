import { state } from '../state.js';
import { pushHistory } from '../utils/history.js';
import { emit } from '../events.js';
import { rndId } from '../utils/helpers.js';

export function groupSelection() {
  const ids = [...state.selected];
  if (!ids.length) return;
  pushHistory();
  const grp = {
    id: rndId('grp'),
    kind: 'group',
    name: 'گروه',
    children: ids.slice(),
    visible: true
  };
  state.items.push(grp);
  state.selected.clear();
  state.selected.add(grp.id);
  emit('draw');
  emit('refreshList');
}

export function ungroupSelection() {
  const groups = state.items.filter(it => state.selected.has(it.id) && it.kind === 'group');
  if (!groups.length) return;
  pushHistory();
  const toRemove = new Set(groups.map(g => g.id));
  state.items = state.items.filter(it => !toRemove.has(it.id));
  for (const id of toRemove) state.selected.delete(id);
  emit('draw');
  emit('refreshList');
}
