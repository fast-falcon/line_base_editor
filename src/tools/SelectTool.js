export default class SelectTool {
  constructor(editor) {
    this.editor = editor;
  }
  start(e) {
    const hit = this.editor.hitTest(e.offsetX, e.offsetY);
    if (!e.shiftKey) this.editor.state.selected.clear();
    if (hit) {
      if (this.editor.state.selected.has(hit.id) && e.shiftKey) {
        this.editor.state.selected.delete(hit.id);
      } else {
        this.editor.state.selected.add(hit.id);
      }
    }
    this.editor.updateElemList();
    this.editor.redraw();
  }
  move() {}
  end() {}
}
