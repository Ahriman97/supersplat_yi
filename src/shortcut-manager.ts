import { platform } from 'playcanvas';

import { Events } from './events';
import { Shortcuts, ShortcutBinding, type ModifierState } from './shortcuts';

// Mac uses different symbols for modifier keys
const isMac = platform.name === 'osx';

// user rebindings, by shortcut id: the key part and modifiers of a binding.
// An empty binding (no keys, no codes) leaves the action unassigned
const STORAGE_KEY = 'supersplat-shortcuts';
type BindingOverride = Pick<ShortcutBinding, 'keys' | 'codes' | 'ctrl' | 'shift' | 'alt'>;

// the physical keys a default `keys` entry fires on (US layout), for
// detecting a clash with a binding by code
const keyCodes: Record<string, string[]> = {
    ' ': ['Space'],
    'Enter': ['Enter', 'NumpadEnter'],
    '[': ['BracketLeft'],
    ']': ['BracketRight'],
    ',': ['Comma'],
    '.': ['Period'],
    '<': ['Comma'],
    '>': ['Period']
};

const codesOf = (binding: ShortcutBinding) => {
    const result = new Set(binding.codes ?? []);
    for (const key of binding.keys ?? []) {
        if (/^[a-z]$/i.test(key)) {
            result.add(`Key${key.toUpperCase()}`);
        } else if (/^\d$/.test(key)) {
            result.add(`Digit${key}`);
            result.add(`Numpad${key}`);
        } else {
            (keyCodes[key] ?? [key]).forEach(code => result.add(code));
        }
    }
    return result;
};

// two modifier requirements a single key press can satisfy together
const compatible = (a: ModifierState, b: ModifierState) => {
    const required = (s: ModifierState) => s === 'required';
    const forbidden = (s: ModifierState) => !s || s === 'forbidden';
    return !((required(a) && forbidden(b)) || (forbidden(a) && required(b)));
};

// display names of physical keys that aren't letters or digits
const codeNames: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '\'',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    NumpadAdd: 'Num +',
    NumpadSubtract: 'Num -',
    NumpadMultiply: 'Num *',
    NumpadDivide: 'Num /',
    NumpadDecimal: 'Num .',
    NumpadEnter: 'Num Enter'
};

const loadOverrides = (): Record<string, BindingOverride> => {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return stored && typeof stored === 'object' ? stored : {};
    } catch {
        return {};
    }
};

// Default shortcut bindings - the source of truth for key mappings
const defaultShortcuts: Record<string, ShortcutBinding> = {
    // Navigation
    'camera.reset': { keys: ['f'], shift: 'required' },
    'camera.focus': { keys: ['f'] },
    'camera.toggleControlMode': { keys: ['v'] },

    // Axis views on the numeric keypad, by physical key so the top-row digits
    // (tool shortcuts below) stay separate. Ctrl looks from the negative side
    'camera.viewX': { codes: ['Numpad1'] },
    'camera.viewY': { codes: ['Numpad3'] },
    'camera.viewZ': { codes: ['Numpad7'] },
    'camera.viewNegX': { codes: ['Numpad1'], ctrl: 'required', capture: true },
    'camera.viewNegY': { codes: ['Numpad3'], ctrl: 'required', capture: true },
    'camera.viewNegZ': { codes: ['Numpad7'], ctrl: 'required', capture: true },

    // Show
    'grid.toggleVisible': { keys: ['g'] },
    'camera.toggleShowInfo': { keys: ['i'] },
    'select.hide': { keys: ['h'] },
    'select.unhide': { keys: ['h'], shift: 'required' },
    'view.toggleHideLocked': { keys: ['h'], alt: 'required' },
    'view.toggleLockedTransparency': { keys: ['h'], alt: 'required' }, // твой кастом

    // Playback
    'timeline.togglePlay': { keys: [' '] },
    'timeline.prevFrame': { keys: [','], repeat: true },
    'timeline.nextFrame': { keys: ['.'], repeat: true },
    'timeline.prevKey': { keys: ['<'], shift: 'optional', repeat: true },
    'timeline.nextKey': { keys: ['>'], shift: 'optional', repeat: true },
    'track.addKey': { keys: ['Enter'] },
    'track.removeKey': { keys: ['Enter'], shift: 'required' },

    // Selection
    'select.all': { keys: ['a'], ctrl: 'required', capture: true },
    'select.none': { keys: ['a'], ctrl: 'required', shift: 'required', capture: true },
    'select.invert': { keys: ['i'], ctrl: 'required' },
    'select.delete': { keys: ['Delete', 'Backspace'] },
    'selection.toggleUseDepth': { keys: ['n'] },
    'selection.toggleFootprint': { keys: ['m'] },
    'selection.cutDepthSmaller': { keys: ['['], shift: 'required', repeat: true }, // твой кастом
    'selection.cutDepthBigger': { keys: [']'], shift: 'required', repeat: true }, // твой кастом
    'view.toggleEditView': { keys: ['Tab'] },

    // Tools
    'tool.moveShortcut': { keys: ['1'] },
    'tool.rotateShortcut': { keys: ['2'] },
    'tool.scaleShortcut': { keys: ['3'] },
    'tool.rectSelection': { keys: ['r'] },
    'tool.lassoSelection': { keys: ['l'] },
    'tool.polygonSelection': { keys: ['p'] },
    'tool.brushSelection': { keys: ['b'] },
    'tool.sphereBrushSelection': { keys: ['b'], shift: 'required' },
    'tool.floodSelection': { keys: ['o'] },
    'tool.eyedropperSelection': { keys: ['e'], ctrl: 'required', capture: true },
    'tool.samSelection': { keys: ['k'] }, // твой кастом
    'tool.brushSelection.smaller': { keys: ['['], repeat: true },
    'tool.brushSelection.bigger': { keys: [']'], repeat: true },
    'tool.deactivate': { keys: ['Escape'] },
    'tool.toggleCoordSpace': { keys: ['c'], shift: 'required' },

    // Other
    'edit.undo': { keys: ['z'], ctrl: 'required', repeat: true, capture: true },
    'edit.redo': { keys: ['z'], ctrl: 'required', shift: 'required', repeat: true, capture: true },
    'dataPanel.toggle': { keys: ['d'], ctrl: 'required', capture: true },
    'timelinePanel.toggle': { keys: ['t'], ctrl: 'required', capture: true },
    'scene.reexport': { keys: ['e'], ctrl: 'required', shift: 'required', capture: true },

    // Camera fly keys
    'camera.fly.forward': { codes: ['KeyW'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.backward': { codes: ['KeyS'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.left': { codes: ['KeyA'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.right': { codes: ['KeyD'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.down': { codes: ['KeyQ'], held: true, shift: 'optional', alt: 'optional' },
    'camera.fly.up': { codes: ['KeyE'], held: true, shift: 'optional', alt: 'optional' },
    'camera.modifier.fast': { codes: ['ShiftLeft', 'ShiftRight'], held: true, alt: 'optional' },
    'camera.modifier.slow': { codes: ['AltLeft', 'AltRight'], held: true, shift: 'optional' },

    // Actions with no key by default, for the user to assign
    'shortcut.new': { capture: true },
    'shortcut.open': { capture: true },
    'shortcut.save': { capture: true },
    'shortcut.saveAs': { capture: true },
    'shortcut.import': { capture: true },
    'shortcut.exportPly': { capture: true },
    'shortcut.commitJournal': { capture: true },
    'appearancePanel.toggleVisible': {},
    'settingsPanel.toggleVisible': {},
    'overlaysPanel.toggleVisible': {},
    'scene.toggleSolo': {},
    'show.shortcuts': {},
    'tool.sphereSelection': {},
    'tool.boxSelection': {},
    'tool.measure': {},
    'tool.orient': {},
    'pivot.reset': {},
    'edit.duplicate': {},
    'edit.separate': {},
    'scene.reset': {},
    'shortcut.exportSog': { capture: true },
    'shortcut.exportSpz': { capture: true },
    'shortcut.exportSplat': { capture: true },
    'shortcut.exportViewer': { capture: true },
    'shortcut.publish': { capture: true },
    'shortcut.renderImage': { capture: true },
    'shortcut.renderVideo': { capture: true },
    'shortcut.toggleGaussians': {},
    'shortcut.toggleCenters': {},
    'shortcut.toggleRings': {},
    'shortcut.toggleSelectionOutline': {},
    'shortcut.toggleBound': {},
    'shortcut.toggleCameraPoses': {},
    'shortcut.toggleOrtho': {}
};

class ShortcutManager {
    private events: Events;
    private bindings: Record<string, ShortcutBinding>;
    private registered: Record<string, ShortcutBinding & { event: string }> = {};
    private overrides: Record<string, BindingOverride>;

    constructor(events: Events) {
        this.events = events;
        this.overrides = loadOverrides();

        this.bindings = {};
        for (const id in defaultShortcuts) {
            const override = this.overrides[id];
            this.bindings[id] = override ? { ...defaultShortcuts[id], keys: undefined, codes: undefined, ...override } : { ...defaultShortcuts[id] };
        }

        const shortcuts = new Shortcuts(events);
        for (const id in this.bindings) {
            const binding = this.bindings[id];
            const options = {
                event: id,
                keys: binding.keys,
                codes: binding.codes,
                ctrl: binding.ctrl,
                shift: binding.shift,
                alt: binding.alt,
                held: binding.held,
                repeat: binding.repeat,
                capture: binding.capture
            };
            this.registered[id] = options;
            shortcuts.register(options);
        }
    }

    get(id: string): ShortcutBinding | undefined {
        return this.bindings[id];
    }

    isCustomized(id: string) {
        return !!this.overrides[id];
    }

    bindingFromEvent(id: string, e: KeyboardEvent): BindingOverride {
        const defaults = defaultShortcuts[id] ?? {};
        const mod = (pressed: boolean, fallback: ModifierState) => (pressed ? 'required' : (fallback === 'optional' ? 'optional' : 'forbidden'));
        return {
            codes: [e.code],
            ctrl: mod(e.ctrlKey || e.metaKey, defaults.ctrl),
            shift: mod(e.shiftKey, defaults.shift),
            alt: mod(e.altKey, defaults.alt)
        };
    }

    conflicts(id: string, binding: BindingOverride) {
        const codes = codesOf(binding);
        return Object.keys(this.bindings).filter((other) => {
            if (other === id) return false;
            const b = this.bindings[other];
            return [...codesOf(b)].some(code => codes.has(code)) &&
                compatible(b.ctrl, binding.ctrl) && compatible(b.shift, binding.shift) && compatible(b.alt, binding.alt);
        });
    }

    set(id: string, binding: BindingOverride | null) {
        if (!this.bindings[id]) return;
        this.overrides[id] = binding ?? { codes: [] };
        this.apply(id, { ...defaultShortcuts[id], keys: undefined, codes: undefined, ...this.overrides[id] });
        this.save();
    }

    reset(id?: string) {
        const ids = id ? [id] : Object.keys(this.overrides);
        for (const i of ids) {
            if (!this.bindings[i]) continue;
            delete this.overrides[i];
            this.apply(i, { ...defaultShortcuts[i] });
        }
        this.save();
    }

    private apply(id: string, binding: ShortcutBinding) {
        this.bindings[id] = binding;
        const { keys, codes, ctrl, shift, alt } = binding;
        Object.assign(this.registered[id], { keys, codes, ctrl, shift, alt });
        this.events.fire('shortcuts.changed', id);
    }

    private save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
        } catch {
            // storage unavailable: the change holds for this session only
        }
    }

    formatShortcut(id: string): string {
        return this.formatBinding(this.bindings[id]);
    }

    formatBinding(binding: BindingOverride): string {
        if (!binding) return '';

        const parts: string[] = [];

        if (binding.ctrl === 'required') parts.push(isMac ? '⌘' : 'Ctrl');
        if (binding.alt === 'required') parts.push(isMac ? '⌥' : 'Alt');
        if (binding.shift === 'required') parts.push(isMac ? '⇧' : 'Shift');

        let keyDisplay = binding.keys?.[0] ?? binding.codes?.[0];
        if (!keyDisplay) return '';

        if (keyDisplay === ' ') {
            keyDisplay = 'Space';
        } else if (keyDisplay === 'Escape') {
            keyDisplay = 'Esc';
        } else if (codeNames[keyDisplay]) {
            keyDisplay = codeNames[keyDisplay];
        } else if (keyDisplay.startsWith('Key')) {
            keyDisplay = keyDisplay.slice(3);
        } else if (keyDisplay.startsWith('Digit')) {
            keyDisplay = keyDisplay.slice(5);
        } else if (keyDisplay.startsWith('Numpad')) {
            keyDisplay = `Num ${keyDisplay.slice(6)}`;
        } else if (keyDisplay.length === 1) {
            keyDisplay = keyDisplay.toUpperCase();
        }

        parts.push(keyDisplay);

        return isMac ? parts.join(' ') : parts.join(' + ');
    }
}

export { ShortcutManager };