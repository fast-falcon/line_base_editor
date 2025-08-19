export default class MoveTool {
  constructor(editor) {
    this.editor = editor;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
  }
  start(e) {
    const hit = this.editor.hitTest(e.offsetX, e.offsetY);
    if (hit) {
      if (!this.editor.state.selected.has(hit.id)) {
        this.editor.state.selected.clear();
        this.editor.state.selected.add(hit.id);
        this.editor.updateElemList();
      }
      this.dragging = true;
      this.lastX = e.offsetX;
      this.lastY = e.offsetY;
    }
  }
  move(e) {
    if (!this.dragging) return;
    const dx = e.offsetX - this.lastX;
    const dy = e.offsetY - this.lastY;
    this.lastX = e.offsetX;
    this.lastY = e.offsetY;
    for (const item of this.editor.state.items) {
      if (!this.editor.state.selected.has(item.id)) continue;
      switch (item.type) {
        case 'line':
          item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy; break;
        case 'rect':
        case 'ellipse':
          item.x += dx; item.y += dy; break;
        case 'quadratic':
          item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy; break;
      }
    }
    this.editor.redraw();
  }
  end() {
    this.dragging = false;
  }
}
