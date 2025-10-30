function registerInit(ctx) {
    const { ui, api } = ctx;

    ui.tabElems.addEventListener('click', () => {
        ui.tabElems.setAttribute('aria-selected', 'true');
        ui.tabAnims.setAttribute('aria-selected', 'false');
        ui.panelElems.classList.remove('hide');
        ui.panelAnims.classList.add('hide');
    });

    ui.tabAnims.addEventListener('click', () => {
        ui.tabElems.setAttribute('aria-selected', 'false');
        ui.tabAnims.setAttribute('aria-selected', 'true');
        ui.panelElems.classList.add('hide');
        ui.panelAnims.classList.remove('hide');
    });

    ui.apply.addEventListener('click', () => {
        api.applyStyle && api.applyStyle();
    });

    api.refreshElemList && api.refreshElemList();
    api.rebuildTicks && api.rebuildTicks();
    api.updateLoopButton && api.updateLoopButton();
    api.draw && api.draw();
    api.updateFillVisibility && api.updateFillVisibility();

    return {};
}

export { registerInit };
