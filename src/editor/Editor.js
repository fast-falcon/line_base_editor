import EditorUI from '../ui.js';
import EditorState from '../state.js';
import { registerShortcuts } from './shortcuts.js';
import { groupSelection } from './grouping.js';

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
  }

  /** Initialise editor services and register listeners. */
  init() {
    registerShortcuts(this);
  }

  /** Update current drawing tool. */
  setTool(tool) {
    this.currentTool = tool;
  }

  /** Group the currently selected items. */
  groupSelection() {
    groupSelection(this.state);
  }
}

