import undo from '../actions/undo.js';
import redo from '../actions/redo.js';

/**
 * Registers a minimal set of keyboard shortcuts.  The editor instance
 * passed in is expected to expose methods such as `setTool` and
 * `groupSelection`.
 */

export function registerShortcuts(editor) {
  const shortcuts = {
    g: () => editor.groupSelection(),
    u: () => editor.ungroupSelection(),
    s: () => editor.setTool('select'),
    m: () => editor.setTool('move')
  };

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // handle Ctrl/Meta combos
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) {
            redo(editor.state);
          } else {
            undo(editor.state);
          }
          editor.updateElemList();
          editor.redraw();
          return;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) editor.ungroupSelection(); else editor.groupSelection();
          return;
      }
    }

    const key = e.key.toLowerCase();
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
  });
}

