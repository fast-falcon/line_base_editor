export default function undo(state) {
  const last = state.items.pop();
  if (last) {
    state.future.push(last);
    state.selected?.delete?.(last.id);
  }
}
