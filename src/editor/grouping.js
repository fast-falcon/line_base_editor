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
  state.items.push({ id: groupId, kind: 'group', children: selected });
  state.selected = new Set([groupId]);
}

