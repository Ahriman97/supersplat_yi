import { Button, Container, Label, NumericInput } from '@playcanvas/pcui';
import { Events } from '../events';

// Selection-depth tool: owns the cut-depth input and the apply button.
// Shown when selection.useDepth is on.
class SelectionDepthTool {
    activate: () => void;
    deactivate: () => void;

    private static readonly STEP = 250;

    constructor(events: Events, canvasContainer: Container) {
        let cutDepth = 0;

        // --- UI ---
        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        const label = new Label({
            class: 'select-toolbar-label',
            text: 'Cut depth'
        });

        const input = new NumericInput({
            class: 'select-toolbar-input',
            value: 0,
            precision: 1,
            min: 0,
            step: SelectionDepthTool.STEP,
            width: 120
        });

        // apply button: commits the current preview with the entered cutDepth
        const applyButton = new Button({
            class: 'select-toolbar-button',
            text: 'Apply'
        });

        selectToolbar.append(label);
        selectToolbar.append(input);
        selectToolbar.append(applyButton);
        canvasContainer.append(selectToolbar);
        // track physical Ctrl so macOS pinch (synthetic ctrlKey) doesn't trigger
        let physicalCtrlDown = false;
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control') physicalCtrlDown = true;
        }, { capture: true });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control') physicalCtrlDown = false;
        }, { capture: true });
        window.addEventListener('blur', () => { physicalCtrlDown = false; });

        // Ctrl + wheel over the canvas adjusts cutDepth while the panel is visible.
        // capture phase + stopImmediatePropagation ensures the camera controller
        // (also listening on #canvas-container) never sees this event.
        canvasContainer.dom.addEventListener('wheel', (e) => {
            if (selectToolbar.hidden) return;
            if (!e.ctrlKey || !physicalCtrlDown) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const direction = e.deltaY > 0 ? -1 : 1;
            events.fire('selection.adjustCutDepth', direction * 1);
        }, { capture: true, passive: false });
        // --- state ---
        const syncInput = (value: number) => {
            cutDepth = value;
            input.value = value;
        };

        events.on('selection.cutDepth', syncInput);

        input.on('change', (value: number) => {
            events.fire('selection.setCutDepth', value);
        });

        applyButton.on('click', () => {
            events.fire('selection.commit');
        });

        // --- visibility follows useDepth ---
        events.on('selection.useDepth', (value: boolean) => {
            selectToolbar.hidden = !value;
            if (value) {
                syncInput((events.invoke('selection.cutDepth') as number) ?? 0);
            }
        });

        selectToolbar.hidden = !(events.invoke('selection.useDepth') as boolean);

        // --- hotkeys ---
        events.on('selection.cutDepthSmaller', () => {
            events.fire('selection.adjustCutDepth', -SelectionDepthTool.STEP);
        });
        events.on('selection.cutDepthBigger', () => {
            events.fire('selection.adjustCutDepth', SelectionDepthTool.STEP);
        });

        // Enter commits the current preview (only while the panel is visible)
        input.dom.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                events.fire('selection.commit');
            }
        });

        const onGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            if (selectToolbar.hidden) return;
            if (e.repeat) return;

            const active = document.activeElement as HTMLElement | null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            events.fire('selection.commit');
        };

        window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
        // --- lifecycle (passive UI, not a modal tool) ---
        this.activate = () => {};
        this.deactivate = () => {};
    }
}

export { SelectionDepthTool };