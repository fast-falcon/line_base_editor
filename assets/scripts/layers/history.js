function registerHistory(ctx) {
    const { state, ui, api } = ctx;

    function pushHistory() {
        state.history.push(JSON.stringify({
            items: state.items,
            animations: state.animations
        }));
        state.future.length = 0;
    }

    function undo() {
        if (!state.history.length) return;
        const snap = state.history.pop();
        state.future.push(JSON.stringify({ items: state.items, animations: state.animations }));
        const s = JSON.parse(snap);
        state.items = s.items;
        state.animations = s.animations;
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
    }

    function redo() {
        if (!state.future.length) return;
        const snap = state.future.pop();
        state.history.push(JSON.stringify({ items: state.items, animations: state.animations }));
        const s = JSON.parse(snap);
        state.items = s.items;
        state.animations = s.animations;
        api.refreshElemList && api.refreshElemList();
        api.draw && api.draw();
    }

    ui.undo.addEventListener('click', undo);
    ui.redo.addEventListener('click', redo);

    const exposed = { pushHistory, undo, redo };
    Object.assign(api, exposed);
    return { exposed };
}

export { registerHistory };
