import { state } from '../state.js';
import { emit } from '../events.js';

const MAX_STACK = 50;

export function pushHistory() {
  state.history.push(
    JSON.stringify({ items: state.items, animations: state.animations })
  );
  if (state.history.length > MAX_STACK) state.history.shift();
  state.future.length = 0;
  emit('history:update');
}

export function undo() {
  if (!state.history.length) return;
  const snap = state.history.pop();
  state.future.push(
    JSON.stringify({ items: state.items, animations: state.animations })
  );
  const s = JSON.parse(snap);
  state.items = s.items;
  state.animations = s.animations;
  emit('history:update');
  emit('draw');
  emit('refreshList');
}

export function redo() {
  if (!state.future.length) return;
  const snap = state.future.pop();
  state.history.push(
    JSON.stringify({ items: state.items, animations: state.animations })
  );
  const s = JSON.parse(snap);
  state.items = s.items;
  state.animations = s.animations;
  emit('history:update');
  emit('draw');
  emit('refreshList');
}
