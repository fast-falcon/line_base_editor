/**
 * @fileoverview Aggregates all modular LinePack Pro layers into the public
 * runtime object, wiring shared context and exposing layer-level APIs.
 */

import { createContext } from './context.js';
import { registerUtilities } from './utilities.js';
import { registerSelection } from './selection.js';
import { registerGrouping } from './grouping.js';
import { registerRendering } from './rendering.js';
import { registerInput } from './input.js';
import { registerUI } from './ui.js';
import { registerTimeline } from './timeline.js';
import { registerHistory } from './history.js';
import { registerFileSystem } from './files.js';
import { registerShortcuts } from './shortcuts.js';
import { registerInit } from './init.js';

const LinePackPro = (() => {
    const ctx = createContext();
    const modules = {};

    modules.utilities = registerUtilities(ctx).exposed;
    modules.selection = registerSelection(ctx).exposed;
    modules.grouping = registerGrouping(ctx).exposed;
    modules.rendering = registerRendering(ctx).exposed;
    modules.input = registerInput(ctx).exposed;
    modules.ui = registerUI(ctx).exposed;
    modules.timeline = registerTimeline(ctx).exposed;
    modules.history = registerHistory(ctx).exposed;
    modules.files = registerFileSystem(ctx).exposed;

    registerShortcuts(ctx);
    registerInit(ctx);

    const { utils, ui, state } = ctx;

    const UtilityLayerModule = {
        rndId: utils.rndId,
        clamp: utils.clamp,
        dist: utils.dist,
        lerp: utils.lerp,
        lpt: utils.lpt,
        nearly: utils.nearly,
        rotatePoint: utils.rotatePoint,
        itemPoints: utils.itemPoints,
        setItemPoints: utils.setItemPoints,
        itemCenter: utils.itemCenter,
        selectionBBox: modules.utilities.selectionBBox,
        itemsByIds: modules.utilities.itemsByIds,
        pointLineDist: modules.utilities.pointLineDist,
        pointQuadNear: modules.utilities.pointQuadNear,
        pointInPolygon: modules.utilities.pointInPolygon,
        getCSSSize: modules.utilities.getCSSSize,
        getCssVar: modules.utilities.getCssVar
    };

    const DataLayerModule = {
        state,
        pushHistory: modules.history.pushHistory,
        undo: modules.history.undo,
        redo: modules.history.redo,
        snapshotState: modules.timeline.snapshotState,
        selectionLeafItems: modules.selection.selectionLeafItems,
        exportPack: modules.files.exportPack,
        importPack: modules.files.importPack
    };

    const LogicLayerModule = {
        draw: modules.rendering.draw,
        renderItem: modules.rendering.renderItem,
        buildShapeFromSelection: modules.selection.buildShapeFromSelection,
        groupSelection: modules.grouping.groupSelection,
        ungroupSelection: modules.selection.ungroupSelection,
        autoDetectClosedShapes: modules.selection.autoDetectClosedShapes,
        applyStyle: modules.selection.applyStyle,
        deleteSelection: modules.selection.deleteSelection,
        ensureSelected: modules.selection.ensureSelected,
        setTool: modules.selection.setTool,
        commitDrawing: modules.input.commitDrawing,
        cancelDrawing: modules.input.cancelDrawing,
        updateGhost: modules.ui.updateGhost,
        hitTestItem: modules.input.hitTestItem,
        hitTestHandle: modules.input.hitTestHandle,
        mousePos: modules.input.mousePos,
        snapIfNeeded: modules.input.snapIfNeeded
    };

    const AnimationSystemModule = {
        rebuildTicks: modules.timeline.rebuildTicks,
        placeCursor: modules.timeline.placeCursor,
        currentAnim: modules.timeline.currentAnim,
        refreshAnimSelect: modules.timeline.refreshAnimSelect,
        putKeyframe: modules.timeline.putKeyframe,
        hasKeyAt: modules.timeline.hasKeyAt,
        stepPlay: modules.timeline.stepPlay,
        renderKeyframeList: modules.timeline.renderKeyframeList,
        applyTimelineSec: modules.timeline.applyTimelineSec,
        restorePreviewBackup: ctx.api.restorePreviewBackup
    };

    const InputSystemModule = {
        mousePos: modules.input.mousePos,
        snapIfNeeded: modules.input.snapIfNeeded,
        ensureSelected: modules.selection.ensureSelected,
        hitTestItem: modules.input.hitTestItem,
        hitTestHandle: modules.input.hitTestHandle
    };

    const FileSystemModule = {
        exportPack: modules.files.exportPack,
        importPack: modules.files.importPack,
        downloadBlob: modules.files.downloadBlob
    };

    const UILayerModule = {
        UI: ui,
        refreshElemList: modules.ui.refreshElemList,
        updateFillVisibility: modules.ui.updateFillVisibility,
        updateGhost: modules.ui.updateGhost,
        updateLoopButton: modules.ui.updateLoopButton
    };

    return {
        UtilityLayer: UtilityLayerModule,
        DataLayer: DataLayerModule,
        LogicLayer: LogicLayerModule,
        AnimationSystem: AnimationSystemModule,
        InputSystem: InputSystemModule,
        FileSystem: FileSystemModule,
        UILayer: UILayerModule
    };
})();

window.LinePackPro = LinePackPro;

export { LinePackPro };
