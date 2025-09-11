# Manual Test Plan

## Undo/Redo history

1. Open `old.html` in a modern browser.
2. Draw several shapes.
3. Ensure the **Undo** button activates once there is history.
4. Press `Ctrl+Z` or click **Undo** repeatedly until all shapes disappear.
5. Press `Ctrl+Shift+Z` or click **Redo** to restore shapes, verifying multiple cycles return drawings accurately.
6. Confirm buttons disable when no further undo/redo is available.
