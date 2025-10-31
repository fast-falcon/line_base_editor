/**
 * @fileoverview Defines the shared reactive state container consumed by the
 * LinePack Pro modules, ensuring every layer works with the same data model.
 */

export const state = {
    tool: 'select',
    items: [],
    selected: new Set(),
    drawing: null,
    history: [],
    future: [],
    animations: [],
    currentAnimId: null,
    tl: {
        sec: 0,
        playing: false,
        startTime: 0,
        loop: true
    }
};
