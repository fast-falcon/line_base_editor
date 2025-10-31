/**
 * @fileoverview Collects and exports cached DOM references for the modular
 * LinePack Pro runtime so that individual layer registrars can interact with
 * the interface without repeatedly querying the document.
 */

export const toolbar = document.getElementById('toolbar');
export const stageWrap = document.getElementById('stageWrap');
export const canvas = document.getElementById('canvas');
export const ctx = canvas.getContext('2d');
export const DPR = Math.max(1, window.devicePixelRatio || 1);

export const UI = {
    shapeMenu: document.getElementById('shapeMenu'),
    shapeMenuBtn: document.getElementById('shapeMenuBtn'),
    shapePop: document.getElementById('shapePop'),
    strokeWidth: document.getElementById('strokeWidth'),
    strokeColor: document.getElementById('strokeColor'),
    fillWrap: document.getElementById('fillWrap'),
    fillColor: document.getElementById('fillColor'),
    rotDeg: document.getElementById('rotDeg'),
    undo: document.getElementById('undo'),
    redo: document.getElementById('redo'),
    fileInput: document.getElementById('fileInput'),
    saveJSON: document.getElementById('saveJSON'),
    saveJSONMin: document.getElementById('saveJSONMin'),
    exportPNG: document.getElementById('exportPNG'),
    clear: document.getElementById('clear'),
    tabElems: document.getElementById('tabElems'),
    tabAnims: document.getElementById('tabAnims'),
    panelElems: document.getElementById('panelElems'),
    panelAnims: document.getElementById('panelAnims'),
    elemList: document.getElementById('elemList'),
    toggleAll: document.getElementById('toggleAll'),
    deleteSel: document.getElementById('deleteSel'),
    groupBtn: document.getElementById('groupBtn'),
    ungroupBtn: document.getElementById('ungroupBtn'),
    timeline: document.getElementById('timeline'),
    ticks: document.getElementById('ticks'),
    cursor: document.getElementById('cursor'),
    playhead: document.getElementById('playhead'),
    tlAddKey: document.getElementById('tlAddKey'),
    loopToggle: document.getElementById('toggleLoop'),
    tlPlay: document.getElementById('tlPlay'),
    animName: document.getElementById('animName'),
    animDur: document.getElementById('animDur'),
    animSelect: document.getElementById('animSelect'),
    addAnim: document.getElementById('addAnim'),
    renameAnim: document.getElementById('renameAnim'),
    setKey: document.getElementById('setKey'),
    play: document.getElementById('play'),
    pause: document.getElementById('pause'),
    delAnim: document.getElementById('delAnim'),
    ghost: document.getElementById('ghost'),
    rotHandle: document.getElementById('rotHandle'),
    scaleHandles: Array.from(document.querySelectorAll('.scale-h')),
    apply: document.getElementById('apply'),
    help: document.getElementById('help'),
    fillEnabled: document.getElementById('fillEnabled'),
    fillMode: document.getElementById('fillMode'),
    helpBtn: document.getElementById('helpBtn')
};
