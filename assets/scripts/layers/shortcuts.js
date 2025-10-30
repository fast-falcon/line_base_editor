function registerShortcuts(ctx) {
    const { ui, api } = ctx;
    const shortcuts = {
        'h': () => ui.helpBtn?.click(),
        's': () => api.setTool && api.setTool('select'),
        'm': () => api.setTool && api.setTool('move'),
        'l': () => api.setTool && api.setTool('line'),
        'c': () => api.setTool && api.setTool('quadratic'),
        'r': () => api.setTool && api.setTool('rect'),
        'e': () => api.setTool && api.setTool('ellipse'),
        'g': () => api.groupSelection && api.groupSelection(),
        'u': () => api.ungroupSelection && api.ungroupSelection(),
        'f2': () => api.renameSelected && api.renameSelected(),
        'delete': () => api.deleteSelection && api.deleteSelection(),
        'escape': () => api.cancelDrawing && api.cancelDrawing(),
        'enter': () => api.commitDrawing && api.commitDrawing()
    };

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            ui.saveJSON?.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            ui.fileInput?.click();
        }
        const key = e.key.toLowerCase();
        if (shortcuts[key]) {
            e.preventDefault();
            shortcuts[key]();
        }
    });

    return {};
}

export { registerShortcuts };
