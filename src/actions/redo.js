export default function redo(state) {
  const item = state.future.pop();
  if (item) {
    state.items.push(item);
  }
}
