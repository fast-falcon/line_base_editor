export default class LineTool {
  constructor(editor) {
    this.editor = editor;
    this.drawing = false;
    this.startX = 0;
    this.startY = 0;
  }
  start(e) {
    const { offsetX, offsetY } = e;
    this.startX = offsetX;
    this.startY = offsetY;
    this.drawing = true;
  }
  move(e) {
    if (!this.drawing) return;
    const { offsetX, offsetY } = e;
    const preview = {
      type: 'line',
      x1: this.startX,
      y1: this.startY,
      x2: offsetX,
      y2: offsetY,
      strokeWidth: this.editor.ui.strokeWidth.valueAsNumber || 1,
      strokeColor: this.editor.ui.strokeColor.value
    };
    this.editor.redraw(preview);
  }
  end(e) {
    if (!this.drawing) return;
    this.drawing = false;
    const { offsetX, offsetY } = e;
    this.editor.state.items.push({
      type: 'line',
      x1: this.startX,
      y1: this.startY,
      x2: offsetX,
      y2: offsetY,
      strokeWidth: this.editor.ui.strokeWidth.valueAsNumber || 1,
      strokeColor: this.editor.ui.strokeColor.value
    });
    this.editor.redraw();
  }
}
