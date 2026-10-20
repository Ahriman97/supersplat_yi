import { Button, Container, Label } from '@playcanvas/pcui';

import { Events } from '../events';
import { ShortcutManager } from '../shortcut-manager';
import { i18n } from './localization';

// Popup display configuration - maps shortcuts to categories and locale keys
// This is separate from the shortcut bindings themselves (separation of concerns)
interface ShortcutDisplayItem {
    id: string;           // event ID to look up in ShortcutManager
    localeKey: string;    // localization key for the action description
}

interface HintDisplayItem {
    displayKey: string;   // what to show in the key column
    localeKey: string;    // localization key for the action description
}

interface CategoryConfig {
    localeKey: string;
    shortcuts: ShortcutDisplayItem[];
    hints?: HintDisplayItem[];
}

// Display configuration for the shortcuts popup
const popupConfig: Record<string, CategoryConfig> = {
    navigation: {
        localeKey: 'popup.shortcuts.navigation',
        shortcuts: [
            { id: 'camera.reset', localeKey: 'popup.shortcuts.reset-camera' },
            { id: 'camera.focus', localeKey: 'popup.shortcuts.focus-camera' },
            { id: 'camera.toggleControlMode', localeKey: 'popup.shortcuts.toggle-control-mode' },
            { id: 'camera.viewX', localeKey: 'popup.shortcuts.view-x' },
            { id: 'camera.viewY', localeKey: 'popup.shortcuts.view-y' },
            { id: 'camera.viewZ', localeKey: 'popup.shortcuts.view-z' },
            { id: 'camera.viewNegX', localeKey: 'popup.shortcuts.view-neg-x' },
            { id: 'camera.viewNegY', localeKey: 'popup.shortcuts.view-neg-y' },
            { id: 'camera.viewNegZ', localeKey: 'popup.shortcuts.view-neg-z' }
        ]
    },
    camera: {
        localeKey: 'popup.shortcuts.camera',
        shortcuts: [
            { id: 'camera.fly.forward', localeKey: 'popup.shortcuts.fly-forward' },
            { id: 'camera.fly.backward', localeKey: 'popup.shortcuts.fly-backward' },
            { id: 'camera.fly.left', localeKey: 'popup.shortcuts.fly-left' },
            { id: 'camera.fly.right', localeKey: 'popup.shortcuts.fly-right' },
            { id: 'camera.fly.down', localeKey: 'popup.shortcuts.fly-down' },
            { id: 'camera.fly.up', localeKey: 'popup.shortcuts.fly-up' }
        ],
        hints: [
            { displayKey: 'Shift + Wheel', localeKey: 'popup.shortcuts.fly-speed-wheel' },
            { displayKey: 'Alt + Wheel', localeKey: 'popup.shortcuts.fly-height-wheel' },
            { displayKey: 'Shift', localeKey: 'popup.shortcuts.fly-speed-fast' },
            { displayKey: 'Alt', localeKey: 'popup.shortcuts.fly-speed-slow' }
        ]
    },
    show: {
        localeKey: 'popup.shortcuts.show',
        shortcuts: [
            { id: 'grid.toggleVisible', localeKey: 'popup.shortcuts.toggle-grid' },
            { id: 'view.toggleEditView', localeKey: 'popup.shortcuts.toggle-edit-view' },
            { id: 'camera.toggleShowInfo', localeKey: 'popup.shortcuts.toggle-camera-info' },
            { id: 'select.hide', localeKey: 'popup.shortcuts.lock-selected-splats' },
            { id: 'select.unhide', localeKey: 'popup.shortcuts.unlock-all-splats' },
            { id: 'view.toggleHideLocked', localeKey: 'popup.shortcuts.toggle-hidden-transparency' },
            { id: 'scene.toggleSolo', localeKey: 'tooltip.scene.solo' },
            { id: 'shortcut.toggleGaussians', localeKey: 'popup.shortcuts.toggle-gaussians' },
            { id: 'shortcut.toggleCenters', localeKey: 'popup.shortcuts.toggle-centers' },
            { id: 'shortcut.toggleRings', localeKey: 'popup.shortcuts.toggle-rings' },
            { id: 'shortcut.toggleSelectionOutline', localeKey: 'popup.shortcuts.toggle-selection-outline' },
            { id: 'shortcut.toggleBound', localeKey: 'popup.shortcuts.toggle-bound' },
            { id: 'shortcut.toggleCameraPoses', localeKey: 'popup.shortcuts.toggle-camera-poses' },
            { id: 'shortcut.toggleOrtho', localeKey: 'popup.shortcuts.toggle-ortho' }
        ]
    },
    selection: {
        localeKey: 'popup.shortcuts.selection',
        shortcuts: [
            { id: 'select.all', localeKey: 'popup.shortcuts.select-all' },
            { id: 'select.none', localeKey: 'popup.shortcuts.deselect-all' },
            { id: 'select.invert', localeKey: 'popup.shortcuts.invert-selection' },
            { id: 'select.delete', localeKey: 'popup.shortcuts.delete-selected-splats' },
            { id: 'selection.toggleUseDepth', localeKey: 'popup.shortcuts.toggle-depth' },
            { id: 'selection.toggleFootprint', localeKey: 'popup.shortcuts.toggle-footprint' }
        ],
        hints: [
            { displayKey: 'Shift', localeKey: 'popup.shortcuts.add-to-selection' },
            { displayKey: 'Ctrl', localeKey: 'popup.shortcuts.remove-from-selection' },
            { displayKey: 'Shift + Ctrl', localeKey: 'popup.shortcuts.intersect-selection' }
        ]
    },
    tools: {
        localeKey: 'popup.shortcuts.tools',
        shortcuts: [
            { id: 'tool.moveShortcut', localeKey: 'popup.shortcuts.move' },
            { id: 'tool.rotateShortcut', localeKey: 'popup.shortcuts.rotate' },
            { id: 'tool.scaleShortcut', localeKey: 'popup.shortcuts.scale' },
            { id: 'tool.rectSelection', localeKey: 'popup.shortcuts.rectangle-selection' },
            { id: 'tool.lassoSelection', localeKey: 'popup.shortcuts.lasso-selection' },
            { id: 'tool.polygonSelection', localeKey: 'popup.shortcuts.polygon-selection' },
            { id: 'tool.brushSelection', localeKey: 'popup.shortcuts.brush-selection' },
            { id: 'tool.sphereBrushSelection', localeKey: 'popup.shortcuts.sphere-brush-selection' },
            { id: 'tool.floodSelection', localeKey: 'popup.shortcuts.flood-selection' },
            { id: 'tool.eyedropperSelection', localeKey: 'popup.shortcuts.eyedropper-selection' },
            { id: 'tool.sphereSelection', localeKey: 'tooltip.bottom-toolbar.sphere-selection' },
            { id: 'tool.boxSelection', localeKey: 'tooltip.bottom-toolbar.box-selection' },
            { id: 'tool.measure', localeKey: 'tooltip.bottom-toolbar.measure' },
            { id: 'tool.orient', localeKey: 'tooltip.bottom-toolbar.orient' },
            { id: 'pivot.reset', localeKey: 'popup.shortcuts.reset-pivot' },
            { id: 'tool.deactivate', localeKey: 'popup.shortcuts.deactivate-tool' },
            { id: 'tool.toggleCoordSpace', localeKey: 'popup.shortcuts.toggle-gizmo-coordinate-space' }
        ],
        hints: [
            { displayKey: '[ ]', localeKey: 'popup.shortcuts.brush-size' },
            { displayKey: 'Alt + Wheel', localeKey: 'popup.shortcuts.brush-size' },
            { displayKey: 'Enter', localeKey: 'popup.shortcuts.close-polygon' },
            { displayKey: 'Backspace', localeKey: 'popup.shortcuts.remove-last-polygon-point' },
            { displayKey: 'Backspace', localeKey: 'popup.shortcuts.remove-tool-point' }
        ]
    },
    playback: {
        localeKey: 'popup.shortcuts.playback',
        shortcuts: [
            { id: 'timeline.togglePlay', localeKey: 'popup.shortcuts.play-pause' },
            { id: 'timeline.prevFrame', localeKey: 'popup.shortcuts.prev-frame' },
            { id: 'timeline.nextFrame', localeKey: 'popup.shortcuts.next-frame' },
            { id: 'timeline.prevKey', localeKey: 'popup.shortcuts.prev-key' },
            { id: 'timeline.nextKey', localeKey: 'popup.shortcuts.next-key' },
            { id: 'track.addKey', localeKey: 'popup.shortcuts.add-key' },
            { id: 'track.removeKey', localeKey: 'popup.shortcuts.remove-key' }
        ],
        hints: [
            { displayKey: 'Ctrl + Click', localeKey: 'popup.shortcuts.stamp-key' },
            { displayKey: 'Shift + Drag', localeKey: 'popup.shortcuts.copy-key' }
        ]
    },
    other: {
        localeKey: 'popup.shortcuts.other',
        shortcuts: [
            { id: 'edit.undo', localeKey: 'popup.shortcuts.undo' },
            { id: 'edit.redo', localeKey: 'popup.shortcuts.redo' },
            { id: 'dataPanel.toggle', localeKey: 'popup.shortcuts.toggle-data-panel' },
            { id: 'timelinePanel.toggle', localeKey: 'popup.shortcuts.toggle-timeline-panel' },
            { id: 'appearancePanel.toggleVisible', localeKey: 'popup.shortcuts.toggle-appearance-panel' },
            { id: 'settingsPanel.toggleVisible', localeKey: 'popup.shortcuts.toggle-settings-panel' },
            { id: 'overlaysPanel.toggleVisible', localeKey: 'popup.shortcuts.toggle-overlays-panel' },
            { id: 'show.shortcuts', localeKey: 'menu.help.shortcuts' },
            { id: 'scene.reexport', localeKey: 'popup.shortcuts.reexport' }
        ]
    },
    edit: {
        localeKey: 'popup.shortcuts.edit',
        shortcuts: [
            { id: 'edit.duplicate', localeKey: 'menu.edit.duplicate' },
            { id: 'edit.separate', localeKey: 'menu.edit.separate' },
            { id: 'scene.reset', localeKey: 'menu.select.reset' }
        ]
    },
    file: {
        localeKey: 'popup.shortcuts.file',
        shortcuts: [
            { id: 'shortcut.new', localeKey: 'menu.file.new' },
            { id: 'shortcut.open', localeKey: 'menu.file.open' },
            { id: 'shortcut.save', localeKey: 'menu.file.save' },
            { id: 'shortcut.saveAs', localeKey: 'menu.file.save-as' },
            { id: 'shortcut.import', localeKey: 'menu.file.import' },
            { id: 'shortcut.exportPly', localeKey: 'popup.shortcuts.export-ply' },
            { id: 'shortcut.exportSog', localeKey: 'popup.shortcuts.export-sog' },
            { id: 'shortcut.exportSpz', localeKey: 'popup.shortcuts.export-spz' },
            { id: 'shortcut.exportSplat', localeKey: 'popup.shortcuts.export-splat' },
            { id: 'shortcut.exportViewer', localeKey: 'popup.shortcuts.export-viewer' },
            { id: 'shortcut.publish', localeKey: 'menu.file.publish' },
            { id: 'shortcut.renderImage', localeKey: 'popup.shortcuts.render-image' },
            { id: 'shortcut.renderVideo', localeKey: 'popup.shortcuts.render-video' },
            { id: 'shortcut.commitJournal', localeKey: 'menu.file.commit-journal' }
        ]
    }
};

// Category display order
const categoryOrder = ['navigation', 'camera', 'show', 'selection', 'tools', 'edit', 'playback', 'file', 'other'];

class ShortcutsPopup extends Container {
    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'shortcuts-popup',
            class: 'blocks-shortcuts',
            hidden: true,
            tabIndex: -1
        };

        super(args);

        // Get the shortcut manager from events
        const shortcutManager: ShortcutManager = events.invoke('shortcutManager');

        // the shortcut waiting for its new key press, if any
        let capturing: { id: string, key: Label } = null;

        const actionName = (id: string) => {
            for (const config of Object.values(popupConfig)) {
                const item = config.shortcuts.find(s => s.id === id);
                if (item) return i18n.t(item.localeKey);
            }
            return id;
        };

        const keyLabels = new Map<string, { key: Label, clear: Button, reset: Button }>();

        const refresh = (id: string) => {
            const row = keyLabels.get(id);
            if (!row) return;
            const text = shortcutManager.formatShortcut(id);
            row.key.text = text || '—';
            row.key.class[shortcutManager.isCustomized(id) ? 'add' : 'remove']('customized');
            row.clear.hidden = !text;
            row.reset.hidden = !shortcutManager.isCustomized(id);
        };

        const stopCapture = () => {
            if (!capturing) return;
            capturing.key.class.remove('capturing');
            const { id } = capturing;
            capturing = null;
            refresh(id);
        };

        const startCapture = (id: string, key: Label) => {
            stopCapture();
            capturing = { id, key };
            key.class.add('capturing');
            key.text = i18n.t('popup.shortcuts.press-keys');
            this.dom.focus();
        };

        const assign = async (id: string, e: KeyboardEvent) => {
            const binding = shortcutManager.bindingFromEvent(id, e);
            const conflicts = shortcutManager.conflicts(id, binding);
            stopCapture();
            if (conflicts.length > 0) {
                const result = await events.invoke('showPopup', {
                    type: 'yesno',
                    header: i18n.t('popup.shortcuts.conflict-title'),
                    message: i18n.t('popup.shortcuts.conflict', {
                        keys: shortcutManager.formatBinding(binding),
                        actions: conflicts.map(actionName).join(', '),
                        action: actionName(id)
                    })
                });
                this.dom.focus();
                if (result?.action !== 'yes') return;
                conflicts.forEach(other => shortcutManager.set(other, null));
            }
            shortcutManager.set(id, binding);
        };

        // Handle keyboard events to prevent global shortcuts from firing
        this.dom.addEventListener('keydown', (e: KeyboardEvent) => {
            e.stopPropagation();
            if (capturing) {
                e.preventDefault();
                if (e.repeat) return;
                if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    stopCapture();
                } else if (!/^(?:Control|Shift|Alt|Meta|OS)/.test(e.code)) {
                    // modifiers alone wait for the key they go with
                    assign(capturing.id, e);
                }
                return;
            }
            if (e.key === 'Escape') {
                this.hidden = true;
            }
        });

        events.on('shortcuts.changed', refresh);

        // Close when clicking outside dialog
        this.on('click', () => {
            this.hidden = true;
        });

        const dialog = new Container({
            id: 'dialog'
        });

        // Prevent clicks inside dialog from closing
        dialog.on('click', (event: MouseEvent) => {
            event.stopPropagation();
        });

        // Header
        const header = new Label({
            id: 'header'
        });
        i18n.bindText(header, () => i18n.t('popup.shortcuts.title').toUpperCase());

        // Content
        const content = new Container({
            id: 'content'
        });

        // Build the shortcut list from the popup display configuration
        for (const categoryId of categoryOrder) {
            const config = popupConfig[categoryId];
            if (!config) continue;

            // Add category header
            const headerLabel = new Label({
                class: 'shortcut-header-label'
            });
            i18n.bindText(headerLabel, config.localeKey);

            const headerEntry = new Container({
                class: 'shortcut-header'
            });

            headerEntry.append(headerLabel);
            content.append(headerEntry);

            // Add shortcuts for this category
            for (const item of config.shortcuts) {
                if (!shortcutManager.get(item.id)) continue;  // Skip if shortcut not found

                // click the key to assign a new one
                const key = new Label({
                    class: ['shortcut-key', 'shortcut-key-editable']
                });
                key.dom.addEventListener('click', () => startCapture(item.id, key));

                const action = new Label({
                    class: 'shortcut-action'
                });
                i18n.bindText(action, item.localeKey);

                const clear = new Button({
                    class: 'shortcut-button',
                    text: '×'
                });
                i18n.onChange(() => clear.dom.setAttribute('title', i18n.t('popup.shortcuts.clear')), clear);
                clear.on('click', () => {
                    stopCapture();
                    shortcutManager.set(item.id, null);
                });

                const reset = new Button({
                    class: 'shortcut-button',
                    text: '↺'
                });
                i18n.onChange(() => reset.dom.setAttribute('title', i18n.t('popup.shortcuts.reset')), reset);
                reset.on('click', () => {
                    stopCapture();
                    shortcutManager.reset(item.id);
                });

                const entry = new Container({
                    class: 'shortcut-entry'
                });

                entry.append(key);
                entry.append(action);
                entry.append(clear);
                entry.append(reset);
                content.append(entry);

                keyLabels.set(item.id, { key, clear, reset });
                refresh(item.id);
            }

            // Add hints for this category (non-shortcut display items)
            if (config.hints) {
                for (const hint of config.hints) {
                    const key = new Label({
                        class: 'shortcut-key',
                        text: hint.displayKey
                    });

                    const action = new Label({
                        class: 'shortcut-action'
                    });
                    i18n.bindText(action, hint.localeKey);

                    const entry = new Container({
                        class: 'shortcut-entry'
                    });

                    entry.append(key);
                    entry.append(action);
                    content.append(entry);
                }
            }
        }

        // footer: how to edit, and resetting everything
        const footer = new Container({
            id: 'footer'
        });
        const hint = new Label({
            class: 'shortcut-hint'
        });
        i18n.bindText(hint, 'popup.shortcuts.edit-hint');
        const resetAll = new Button({
            class: 'shortcut-reset-all'
        });
        i18n.bindText(resetAll, 'popup.shortcuts.reset-all');
        resetAll.on('click', () => {
            stopCapture();
            shortcutManager.reset();
        });
        footer.append(hint);
        footer.append(resetAll);

        this.stopCapture = stopCapture;

        dialog.append(header);
        dialog.append(content);
        dialog.append(footer);

        this.append(dialog);
    }

    private stopCapture: () => void;

    set hidden(value: boolean) {
        this.stopCapture?.();
        super.hidden = value;
        if (!value) {
            // Take keyboard focus so shortcuts stop working
            this.dom.focus();
        }
    }

    get hidden(): boolean {
        return super.hidden;
    }
}

export { ShortcutsPopup };
