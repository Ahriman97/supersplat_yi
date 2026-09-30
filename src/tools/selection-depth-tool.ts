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
            console.log('[applyButton] clicked');
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

        // --- lifecycle (passive UI, not a modal tool) ---
        this.activate = () => {};
        this.deactivate = () => {};
    }
}

export { SelectionDepthTool };