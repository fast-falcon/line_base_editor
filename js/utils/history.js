import { state } from '../state.js';

export function pushHistory() {
  state.history.push(JSON.stringify({ items: state.items, animations: state.animations }));
  state.future.length = 0;
}

export function undo() {
  if (!state.history.length) return;
  const snap = state.history.pop();
  state.future.push(JSON.stringify({ items: state.items, animations: state.animations }));
  const s = JSON.parse(snap);
  state.items = s.items;
  state.animations = s.animations;
}

export function redo() {
  if (!state.future.length) return;
  const snap = state.future.pop();
  state.history.push(JSON.stringify({ items: state.items, animations: state.animations }));
  const s = JSON.parse(snap);
  state.items = s.items;
  state.animations = s.animations;
}