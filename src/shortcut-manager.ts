import { platform } from 'playcanvas';

import { Events } from './events';
import { Shortcuts, ShortcutBinding } from './shortcuts';

// Mac uses different symbols for modifier keys
const isMac = platform.name === 'osx';

// Default shortcut bindings - the source of truth for key mappings
const defaultShortcuts: Record<string, ShortcutBinding> = {
    // Navigation
    'camera.reset': { codes: ['KeyF'], shift: 'required' },
    'camera.focus': { codes: ['KeyF'] },
    'camera.toggleControlMode': { codes: ['KeyV'] },

    // Show
    // // 'camera.toggleOverlay': { keys: ['Tab'] },
    'camera.toggleVisualisation': { keys: ['Tab'] },
    // // 'camera.toggleMode': { codes: ['KeyM'] },
    'grid.toggleVisible': { codes: ['KeyG'] },
    'camera.toggleShowInfo': { codes: ['KeyI'] },
    'select.hide': { codes: ['KeyH'] },
    'select.unhide': { codes: ['KeyH'], shift: 'required' },
    'view.toggleLockedTransparency': { codes: ['KeyH'], alt: 'required' },

    // Playback
    'timeline.togglePlay': { keys: [' '] },
    'timeline.prevFrame': { keys: [','], repeat: true },
    'timeline.nextFrame': { keys: ['.'], repeat: true },
    'timeline.prevKey': { keys: ['<'], shift: 'optional', repeat: true },
    'timeline.nextKey': { keys: ['>'], shift: 'optional', repeat: true },
    'track.addKey': { keys: ['Enter'] },
    'track.removeKey': { keys: ['Enter'], shift: 'required' },

    // Selection

    'select.all': { codes: ['KeyA'], ctrl: 'required', capture: true },
    'select.none': { codes: ['KeyA'], ctrl: 'required', shift: 'required', capture: true },
    'select.invert': { codes: ['KeyI'], ctrl: 'required' },
    'select.delete': { keys: ['Delete', 'Backspace'] },
    'selection.toggleUseDepth': { codes: ['KeyN'] },
    // //'selection.toggleFootprint': { codes: ['KeyJ'] },
    'selection.toggleFootprint': { codes: ['KeyM'] },
    'selection.cutDepthSmaller': { codes: ['BracketLeft'], shift: 'required', repeat: true },
    'selection.cutDepthBigger': { codes: ['BracketRight'], shift: 'required', repeat: true },

    // Tools
    // 1/2/3 don't fire tool.move/rotate/scale directly: while a shape
    // selection tool (box/sphere) is active they switch its gizmo mode
    // instead of switching tools (see ToolManager)
    'tool.moveShortcut': { keys: ['1'] },
    'tool.rotateShortcut': { keys: ['2'] },
    'tool.scaleShortcut': { keys: ['3'] },
    'tool.rectSelection': { codes: ['KeyR'] },
    'tool.lassoSelection': { codes: ['KeyL'] },
    'tool.polygonSelection': { codes: ['KeyP'] },
    'tool.brushSelection': { codes: ['KeyB'] },
    'tool.samSelection': { codes: ['KeyK'] },
    'tool.floodSelection': { codes: ['KeyO'] },
    'tool.eyedropperSelection': { codes: ['KeyE'], ctrl: 'required', capture: true },
    'tool.brushSelection.smaller': { codes: ['BracketLeft'], repeat: true },
    'tool.brushSelection.bigger': { codes: ['BracketRight'], repeat: true },
    'tool.deactivate': { keys: ['Escape'] },
    'tool.toggleCoordSpace': { codes: ['KeyC'], shift: 'required' },

    // Other
    'edit.undo': { codes: ['KeyZ'], ctrl: 'required', repeat: true, capture: true },
    'edit.redo': { codes: ['KeyZ'], ctrl: 'required', shift: 'required', repeat: true, capture: true },
    'dataPanel.toggle': { codes: ['KeyD'], ctrl: 'required', capture: true },
    'timelinePanel.toggle': { codes: ['KeyT'], ctrl: 'required', capture: true },
    

    // Camera fly keys - use physical positions (codes) for WASD layout on non-QWERTY keyboards
    'camera.fly.forward': { codes: ['KeyW'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.backward': { codes: ['KeyS'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.left': { codes: ['KeyA'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.right': { codes: ['KeyD'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.down': { codes: ['KeyQ'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.up': { codes: ['KeyE'], held: true, shift: 'optional', alt: 'optional' },
    'camera.modifier.fast': { codes: ['ShiftLeft', 'ShiftRight'], held: true, alt: 'optional' },
    'camera.modifier.slow': { codes: ['AltLeft', 'AltRight'], held: true, shift: 'optional' }
};

class ShortcutManager {
    private bindings: Record<string, ShortcutBinding>;

    constructor(events: Events) {
        // Clone the defaults so they can be modified without affecting the originals
        this.bindings = {};
        for (const id in defaultShortcuts) {
            this.bindings[id] = { ...defaultShortcuts[id] };
        }

        // Create shortcuts and register all bindings
        const shortcuts = new Shortcuts(events);
        for (const id in this.bindings) {
            const binding = this.bindings[id];
            shortcuts.register({
                event: id,
                keys: binding.keys,
                codes: binding.codes,
                ctrl: binding.ctrl,
                shift: binding.shift,
                alt: binding.alt,
                held: binding.held,
                repeat: binding.repeat,
                capture: binding.capture
            });
        }
    }

    /**
     * Get a shortcut binding by its event ID.
     */
    get(id: string): ShortcutBinding | undefined {
        return this.bindings[id];
    }

    /**
     * Format a shortcut for display (e.g., "Ctrl + Shift + Z" or "⌘⇧Z" on Mac).
     */
    formatShortcut(id: string): string {
        const binding = this.bindings[id];
        if (!binding) return '';

        const parts: string[] = [];

        // Use Mac symbols: ⌘ (Cmd), ⌥ (Option), ⇧ (Shift)
        if (binding.ctrl === 'required') parts.push(isMac ? '⌘' : 'Ctrl');
        if (binding.alt === 'required') parts.push(isMac ? '⌥' : 'Alt');
        if (binding.shift === 'required') parts.push(isMac ? '⇧' : 'Shift');

        // Get the first key or code for display
        let keyDisplay = binding.keys?.[0] ?? binding.codes?.[0];
        if (!keyDisplay) return '';

        if (keyDisplay === ' ') {
            keyDisplay = 'Space';
        } else if (keyDisplay === 'Escape') {
            keyDisplay = 'Esc';
        } else if (keyDisplay.startsWith('Key')) {
            // Physical key codes like 'KeyW' -> 'W'
            keyDisplay = keyDisplay.slice(3);
        } else if (keyDisplay === 'BracketLeft') {
            keyDisplay = '[';
        } else if (keyDisplay === 'BracketRight') {
            keyDisplay = ']';
        } else if (keyDisplay === 'Comma') {
            keyDisplay = ',';
        } else if (keyDisplay === 'Period') {
            keyDisplay = '.';
        }  else if (keyDisplay.length === 1) {
            keyDisplay = keyDisplay.toUpperCase();
        }

        parts.push(keyDisplay);

        return isMac ? parts.join(' ') : parts.join(' + ');
    }
}

export { ShortcutManager };
