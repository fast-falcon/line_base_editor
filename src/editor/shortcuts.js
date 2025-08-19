/**
 * Registers a minimal set of keyboard shortcuts.  The editor instance
 * passed in is expected to expose methods such as `setTool` and
 * `groupSelection`.
 */
export function registerShortcuts(editor) {
  const shortcuts = {
    g: () => editor.groupSelection(),
    s: () => editor.setTool('select'),
    m: () => editor.setTool('move')
  };

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
  });
}

