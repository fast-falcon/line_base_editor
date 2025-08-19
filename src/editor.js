import Editor from './editor/Editor.js';

// Entry point for the editor application. This file used to contain
// a very large procedural implementation.  It now simply creates the
// high level Editor class defined in `editor/Editor.js` and initializes
// it.

const editor = new Editor();
editor.init();

