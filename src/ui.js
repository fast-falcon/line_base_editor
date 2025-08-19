export default class EditorUI {
  constructor() {
    // tools
    this.shapeMenu = document.getElementById('shapeMenu');
    this.shapeMenuBtn = document.getElementById('shapeMenuBtn');
    this.shapePop = document.getElementById('shapePop');
    // draw props
    this.strokeWidth = document.getElementById('strokeWidth');
    this.strokeColor = document.getElementById('strokeColor');
    this.fillWrap = document.getElementById('fillWrap');
    this.fillColor = document.getElementById('fillColor');
    this.rotDeg = document.getElementById('rotDeg');
    // history / file
    this.undo = document.getElementById('undo');
    this.redo = document.getElementById('redo');
    this.fileInput = document.getElementById('fileInput');
    this.saveJSON = document.getElementById('saveJSON');
    this.saveJSONMin = document.getElementById('saveJSONMin');
    this.exportPNG = document.getElementById('exportPNG');
    this.clear = document.getElementById('clear');
    // sidebar
    this.tabElems = document.getElementById('tabElems');
    this.tabAnims = document.getElementById('tabAnims');
    this.panelElems = document.getElementById('panelElems');
    this.panelAnims = document.getElementById('panelAnims');
    this.elemList = document.getElementById('elemList');
    this.toggleAll = document.getElementById('toggleAll');
    this.deleteSel = document.getElementById('deleteSel');
    this.groupBtn = document.getElementById('groupBtn');
    this.ungroupBtn = document.getElementById('ungroupBtn');
    // timeline (bottom)
    this.timeline = document.getElementById('timeline');
    this.ticks = document.getElementById('ticks');
    this.cursor = document.getElementById('cursor');
    this.playhead = document.getElementById('playhead');
    this.tlAddKey = document.getElementById('tlAddKey');
    this.tlPlay = document.getElementById('tlPlay');
    // anim panel
    this.animName = document.getElementById('animName');
    this.animDur = document.getElementById('animDur');
    this.animSelect = document.getElementById('animSelect');
    this.addAnim = document.getElementById('addAnim');
    this.renameAnim = document.getElementById('renameAnim');
    this.setKey = document.getElementById('setKey');
    this.play = document.getElementById('play');
    this.pause = document.getElementById('pause');
    this.delAnim = document.getElementById('delAnim');
    // selection visuals
    this.ghost = document.getElementById('ghost');
    this.rotHandle = document.getElementById('rotHandle');
    // apply
    this.apply = document.getElementById('apply');
    this.help = document.getElementById('help');
    this.fillEnabled = document.getElementById('fillEnabled');
    this.fillMode = document.getElementById('fillMode');
    // extra refs
    this.helpBtn = document.getElementById('helpBtn');
  }
}
