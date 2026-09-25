import { Button, Container } from '@playcanvas/pcui';
import { Events } from '../events';
import { opFromModifiers } from '../select-op';
import { segmentImage } from '../sam-client';
import { i18n } from '../ui/localization';

// type SamOp = 'set' | 'add' | 'remove' | 'intersect' | 'refine' | 'shadows';
type SamOp = 'set' | 'add' | 'remove' | 'intersect' | 'refine';

class SamSelection {
    activate: () => void;
    deactivate: () => void;

    constructor(
        events: Events, 
        parent: HTMLElement, 
        mask: { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }, 
        canvasContainer: Container
    ) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden');
        svg.id = 'sam-select-svg';
        parent.appendChild(svg);

        const { canvas, context } = mask;
        let busy = false;
        let currentOp: SamOp = 'set';

        const opPanel = new Container({
            id: 'sam-op-panel',
            hidden: true
        });
        // Останавливать pointer-события, чтобы клики на кнопках не доходили до сцены
        opPanel.dom.addEventListener('pointerdown', (e) => e.stopPropagation());
        opPanel.dom.addEventListener('pointerup', (e) => e.stopPropagation());
        opPanel.dom.addEventListener('click', (e) => e.stopPropagation());

    const makeOpButton = (localeKey: string, op: SamOp) => {
        const btn = new Button({ class: 'sam-op-button' });
        i18n.bindText(btn, localeKey);
        btn.dom.addEventListener('click', () => {
            //console.log('[SAM] click, op =', op);
            currentOp = op;
            updateActiveOp();
            //console.log('[SAM] btnSet class:', btnSet.dom.className);
        });
        return btn;
    };

    const btnSet = makeOpButton('tooltip.sam.op-set-short', 'set');
    const btnAdd = makeOpButton('tooltip.sam.op-add-short', 'add');
    const btnRemove = makeOpButton('tooltip.sam.op-remove-short', 'remove');
    const btnRefine = makeOpButton('tooltip.sam.op-refine-short', 'refine');
    //const btnShadows = makeOpButton('tooltip.sam.op-shadows-short', 'shadows');
    // Кнопка-действие "Найти тени" — вызывается сразу, не ждёт клика
    const btnShadows = new Button({ class: 'sam-op-button' });
    i18n.bindText(btnShadows, 'tooltip.sam.op-shadows-short');
    btnShadows.dom.addEventListener('click', () => { 
            btnShadows.class.add('active');
            setTimeout(() => btnShadows.class.remove('active'), 200);
            events.fire('select.detectShadows', 0.7); 
        }
    );

    opPanel.append(btnSet);
    opPanel.append(btnAdd);
    opPanel.append(btnRemove);
    opPanel.append(btnRefine);
    opPanel.append(btnShadows);

    //document.body.appendChild(opPanel.dom);
    canvasContainer.append(opPanel);
    opPanel.hidden = true;

    const updateActiveOp = () => {
        const setActive = (btn: Button, isActive: boolean) => {
            btn.class[isActive ? 'add' : 'remove']('active');
            btn.dom.classList[isActive ? 'add' : 'remove']('active');
        };
        setActive(btnSet, currentOp === 'set');
        setActive(btnAdd, currentOp === 'add');
        setActive(btnRemove, currentOp === 'remove');
        setActive(btnRefine, currentOp === 'refine');
        //setActive(btnShadows, currentOp === 'shadows');
    };
    updateActiveOp();

        // --- Обработчик клика по сцене ---
        const pointerdown = async (e: PointerEvent) => {
            if (e.pointerType === 'mouse' ? e.button !== 0 : !e.isPrimary) return;
            if (busy) return;
            // if (currentOp === 'shadows') {
            //     // Не отправляем в SAM — работаем с уже выделенным
            //     events.fire('select.detectShadows', 0.7);
            //     busy = false;
            //     events.fire('stopSpinner');
            //     return;
            // }

            e.preventDefault();
            e.stopPropagation();

            busy = true;
            events.fire('startSpinner');

            try {
                const width = parent.clientWidth;
                const height = parent.clientHeight;
                if (width === 0 || height === 0) throw new Error('Нулевой размер viewport');

                const nx = e.offsetX / width;
                const ny = e.offsetY / height;

                const rgba = await events.invoke('render.offscreen', width, height) as Uint8Array;

                const clamped = new Uint8ClampedArray(rgba.length);
                clamped.set(rgba);
                const imageData = new ImageData(clamped, width, height);

                const offscreen = new OffscreenCanvas(width, height);
                const ctx = offscreen.getContext('2d');
                if (!ctx) throw new Error('Не удалось создать 2D-контекст');
                ctx.putImageData(imageData, 0, 0);
                const pngBlob = await offscreen.convertToBlob({ type: 'image/png' });

                const { maskBlob, score, time } = await segmentImage(pngBlob, nx, ny);
                //console.log(`[SAM] score=${score.toFixed(4)}, time=${time.toFixed(3)}s, op=${currentOp}`);

                const maskBitmap = await createImageBitmap(maskBlob);
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                context.clearRect(0, 0, width, height);
                context.drawImage(maskBitmap, 0, 0);
                maskBitmap.close();

                // Модификаторы имеют приоритет
                const modOp = opFromModifiers(e);
                let op: 'set' | 'add' | 'remove' | 'intersect' | 'refine';
                if (e.shiftKey && e.ctrlKey) {
                    // Shift+Ctrl → refine (уточнить последнее добавленное)
                    op = 'refine';
                } else if (modOp !== 'set') {
                    // Shift → add, Ctrl → remove
                    op = modOp;
                } else {
                    // Без модификаторов → выбранное в панели
                    op = currentOp;
                }

                await events.invoke('select.byMask', op, canvas, context);
            } catch (error) {
                console.error('[SAM] Ошибка выделения:', error);
                await events.invoke('showPopup', {
                    type: 'error',
                    header: 'SAM Selection',
                    message: `Не удалось выделить объект: ${(error as Error).message ?? error}`
                });
            } finally {
                busy = false;
                events.fire('stopSpinner');
            }
        };

        this.activate = () => {
            svg.classList.remove('hidden');
            parent.style.display = 'block';
            parent.addEventListener('pointerdown', pointerdown);
            opPanel.hidden = false;
        };

        this.deactivate = () => {
            svg.classList.add('hidden');
            parent.style.display = 'none';
            parent.removeEventListener('pointerdown', pointerdown);
            opPanel.hidden = true;
        };
    }
}

export { SamSelection };