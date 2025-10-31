# LinePack Renderer (Standalone)

This folder contains a self-contained copy of the runtime-only renderer that can load exported LinePack JSON files on any HTML canvas. Use it when you want to replay animations outside of the main LinePack editor UI.

## Files

- `LinePackRenderer.js` – ES module exposing the `LinePackRenderer` class.
- `sample/` – Minimal example showing how to load a pack JSON file and play an animation.

## Getting started

Open `sample/index.html` in a modern browser via a local web server (for example `npx serve standalone-renderer/sample`). The page loads `sample-pack.json`, instantiates `LinePackRenderer`, and plays the `Demo` animation.
