/**
 * @fileoverview Builds the shared dependency context passed to every LinePack
 * Pro layer, bundling DOM handles, state, and utility helpers in one place.
 */

import { toolbar, stageWrap, canvas, ctx, DPR, UI } from '../core/dom.js';
import { state as appState } from '../core/state.js';
import { rndId, clamp, dist, lerp, lpt, nearly, rotatePoint, itemPoints, setItemPoints, itemCenter } from '../core/utils.js';

function createContext() {
    UI.helpBtn = document.getElementById('helpBtn');
    const api = {};
    return {
        state: appState,
        ui: UI,
        toolbar,
        stageWrap,
        canvas,
        ctx,
        dpr: DPR,
        utils: {
            rndId,
            clamp,
            dist,
            lerp,
            lpt,
            nearly,
            rotatePoint,
            itemPoints,
            setItemPoints,
            itemCenter
        },
        api
    };
}

export { createContext };
