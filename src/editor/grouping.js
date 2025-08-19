/**
 * Naive grouping helper.  It converts the currently selected items
 * into a single group record and selects that new group.  The previous
 * implementation included a very elaborate geometry analyser which was
 * responsible for much of the size of the old file.  By isolating the
 * behaviour into this module we keep the core editor class small and
 * focused.
 */
export function groupSelection(state) {
  const selected = Array.from(state.selected || []);
  if (selected.length < 2) return;

  const groupId = `group-${Date.now()}`;
  state.items.push({ id: groupId, type: 'group', children: selected });
  state.selected = new Set([groupId]);
}

/**
 * Ungroup currently selected group items.  This mirrors the basic
 * behaviour from the original monolithic implementation where a
 * group element could be removed to reveal its children without
 * any additional geometry processing.
 */
export function ungroupSelection(state) {
  const groups = Array.from(state.selected || [])
    .map(id => state.items.find(it => it.id === id))
    .filter(it => it && it.type === 'group');
  if (groups.length === 0) return;

  for (const group of groups) {
    state.items = state.items.filter(it => it.id !== group.id);
    state.selected.delete(group.id);
  }
}

