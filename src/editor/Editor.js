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
    this.ui.undo?.addEventListener('click', () => { undo(this.state); this.redraw(); });
    this.ui.redo?.addEventListener('click', () => { redo(this.state); this.redraw(); });
    this.ui.clear?.addEventListener('click', () => { clear(this.state); this.redraw(); });

    // Default to line tool so drawing works out of the box
    this.setTool('line');
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
    };
    this.state.items.forEach(drawItem);
    if (preview) drawItem(preview);
  }

  /** Group the currently selected items. */
  groupSelection() {
    groupSelection(this.state);
  }

  /** Ungroup the currently selected groups. */
  ungroupSelection() {
    ungroupSelection(this.state);
  }
}
