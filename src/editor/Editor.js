import EditorUI from '../ui.js';
import EditorState from '../state.js';
import { registerShortcuts } from './shortcuts.js';
import { groupSelection, ungroupSelection } from './grouping.js';
import SelectTool from '../tools/SelectTool.js';
import MoveTool from '../tools/MoveTool.js';
import LineTool from '../tools/LineTool.js';
import QuadraticTool from '../tools/QuadraticTool.js';
import RectTool from '../tools/RectTool.js';
import EllipseTool from '../tools/EllipseTool.js';
import undo from '../actions/undo.js';
import redo from '../actions/redo.js';
import clear from '../actions/clear.js';

/**
 * High level editor controller.  The original project kept all logic
 * inside a massive IIFE.  Moving to an ES6 class makes the behaviour
 * easier to understand and enables separation of concerns.
 */
export default class Editor {
  constructor() {
    // Canvas references
    this.toolbar = document.getElementById('toolbar');
    this.stageWrap = document.getElementById('stageWrap');
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    // UI + state modules
    this.ui = new EditorUI();
    this.state = new EditorState();

    // simple id generator for elements
    this.idCounter = 1;

    // currently selected drawing tool
    this.currentTool = 'select';
    this.toolInstance = null;
  }

  /** Initialise editor services and register listeners. */
  init() {
    registerShortcuts(this);
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Wire up basic grouping buttons similar to the original
    // implementation so the split modules still expose the
    // expected behaviour.
    this.ui.groupBtn?.addEventListener('click', () => this.groupSelection());
    this.ui.ungroupBtn?.addEventListener('click', () => this.ungroupSelection());

    // Shape menu toggle
    this.ui.shapeMenuBtn?.addEventListener('click', () => {
      const expanded = this.ui.shapeMenu?.getAttribute('aria-expanded') === 'true';
      this.ui.shapeMenu?.setAttribute('aria-expanded', (!expanded).toString());
    });

    // Tool buttons inside the popup
    this.ui.shapePop?.querySelectorAll('button[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
        this.ui.shapeMenu?.setAttribute('aria-expanded', 'false');
      });
    });

    // Canvas events
    this.canvas.addEventListener('mousedown', e => this.onPointerDown(e));
    this.canvas.addEventListener('mousemove', e => this.onPointerMove(e));
    window.addEventListener('mouseup', e => this.onPointerUp(e));

    // Action buttons
    this.ui.undo?.addEventListener('click', () => {
      undo(this.state);
      this.updateElemList();
      this.redraw();
    });
    this.ui.redo?.addEventListener('click', () => {
      redo(this.state);
      this.updateElemList();
      this.redraw();
    });
    this.ui.clear?.addEventListener('click', () => {
      clear(this.state);
      this.updateElemList();
      this.redraw();
    });

    // Default to line tool so drawing works out of the box
    this.setTool('line');
    this.updateElemList();
  }

  resizeCanvas() {
    const rect = this.stageWrap.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  onPointerDown(e) { this.toolInstance?.start(e); }
  onPointerMove(e) { this.toolInstance?.move(e); }
  onPointerUp(e) { this.toolInstance?.end(e); }

  /** Update current drawing tool. */
  setTool(tool) {
    this.currentTool = tool;
    // reflect active tool in the popup menu
    this.ui.shapePop?.querySelectorAll('button[data-tool]').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.tool === tool);
    });
    const map = {
      select: SelectTool,
      move: MoveTool,
      line: LineTool,
      quadratic: QuadraticTool,
      rect: RectTool,
      ellipse: EllipseTool
    };
    const ToolClass = map[tool] || SelectTool;
    this.toolInstance = new ToolClass(this);
  }

  redraw(preview) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const drawItem = item => {
      ctx.lineWidth = item.strokeWidth;
      ctx.strokeStyle = item.strokeColor;
      ctx.beginPath();
      switch (item.type) {
        case 'line':
          ctx.moveTo(item.x1, item.y1);
          ctx.lineTo(item.x2, item.y2);
          break;
        case 'rect':
          ctx.rect(item.x, item.y, item.w, item.h);
          break;
        case 'ellipse':
          ctx.ellipse(
            item.x + item.w / 2,
            item.y + item.h / 2,
            Math.abs(item.w) / 2,
            Math.abs(item.h) / 2,
            0,
            0,
            Math.PI * 2
          );
          break;
        case 'quadratic':
          const cx = (item.x1 + item.x2) / 2;
          const cy = item.y1;
          ctx.moveTo(item.x1, item.y1);
          ctx.quadraticCurveTo(cx, cy, item.x2, item.y2);
          break;
      }
      ctx.stroke();
      if (this.state.selected.has(item.id)) {
        ctx.strokeStyle = '#9b7bff';
        ctx.stroke();
      }
    };
    this.state.items.forEach(drawItem);
    if (preview) drawItem(preview);
  }

  addItem(item) {
    item.id = `item-${this.idCounter++}`;
    this.state.items.push(item);
    this.state.future = [];
    this.updateElemList();
    this.redraw();
  }

  updateElemList() {
    const list = this.ui.elemList;
    if (!list) return;
    list.innerHTML = '';
    this.state.items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.id = it.id;
      row.setAttribute('aria-selected', this.state.selected.has(it.id));
      const sw = document.createElement('div');
      sw.className = 'sw';
      sw.style.background = it.strokeColor;
      const label = document.createElement('div');
      label.textContent = it.type;
      row.append(sw, label);
      row.addEventListener('click', e => {
        if (!e.shiftKey) this.state.selected.clear();
        if (this.state.selected.has(it.id)) this.state.selected.delete(it.id);
        else this.state.selected.add(it.id);
        this.updateElemList();
        this.redraw();
      });
      list.appendChild(row);
    });
  }

  hitTest(x, y) {
    const nearLine = (x1, y1, x2, y2) => {
      const A = x - x1;
      const B = y - y1;
      const C = x2 - x1;
      const D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;
      if (lenSq !== 0) param = dot / lenSq;
      let xx, yy;
      if (param < 0) { xx = x1; yy = y1; }
      else if (param > 1) { xx = x2; yy = y2; }
      else { xx = x1 + param * C; yy = y1 + param * D; }
      const dx = x - xx;
      const dy = y - yy;
      return dx * dx + dy * dy <= 25; // 5px radius
    };

    for (let i = this.state.items.length - 1; i >= 0; i--) {
      const it = this.state.items[i];
      switch (it.type) {
        case 'line':
          if (nearLine(it.x1, it.y1, it.x2, it.y2)) return it;
          break;
        case 'rect':
        case 'ellipse':
          if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
          break;
        case 'quadratic':
          const minX = Math.min(it.x1, it.x2);
          const maxX = Math.max(it.x1, it.x2);
          const minY = Math.min(it.y1, it.y2);
          const maxY = Math.max(it.y1, it.y2);
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) return it;
          break;
      }
    }
    return null;
  }

  /** Group the currently selected items. */
  groupSelection() {
    groupSelection(this.state);
    this.updateElemList();
    this.redraw();
  }

  /** Ungroup the currently selected groups. */
  ungroupSelection() {
    ungroupSelection(this.state);
    this.updateElemList();
    this.redraw();
  }
}
