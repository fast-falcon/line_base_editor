export default class EditorState {
  constructor() {
    this.tool = 'select';
    this.items = [];
    this.selected = new Set();
    this.drawing = null;
    this.history = [];
    this.future = [];
    this.animations = [];
    this.currentAnimId = null;
    this.tl = {
      sec: 0,
      playing: false,
      startTime: 0
    };
  }
}
