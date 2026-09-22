import { Events } from '../events';
import { opFromModifiers } from '../select-op';
import { segmentImage } from '../sam-client';

class SamSelection {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, parent: HTMLElement, mask: { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }) {
        // SVG-оверлей для перехвата кликов (как у BrushSelection)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden');
        svg.id = 'sam-select-svg';
        parent.appendChild(svg);

        const { canvas, context } = mask;
        let busy = false;

        const pointerdown = async (e: PointerEvent) => {
            // Только левая кнопка мыши или primary touch
            if (e.pointerType === 'mouse' ? e.button !== 0 : !e.isPrimary) return;
            if (busy) return;

            e.preventDefault();
            e.stopPropagation();

            busy = true;
            events.fire('startSpinner');

            try {
                // 1. Размеры viewport
                const width = parent.clientWidth;
                const height = parent.clientHeight;

                if (width === 0 || height === 0) {
                    throw new Error('Нулевой размер viewport');
                }

                // 2. Нормализованные координаты клика (0..1)
                const nx = e.offsetX / width;
                const ny = e.offsetY / height;

                // 3. Рендер сцены в offscreen (RGBA)
                const rgba = await events.invoke('render.offscreen', width, height) as Uint8Array;

                // 4. RGBA → ImageData → PNG Blob
                const clamped = new Uint8ClampedArray(rgba.length);
                clamped.set(rgba);
                const imageData = new ImageData(clamped, width, height);
                const offscreen = new OffscreenCanvas(width, height);
                const ctx = offscreen.getContext('2d');
                if (!ctx) throw new Error('Не удалось создать 2D-контекст');
                ctx.putImageData(imageData, 0, 0);
                const pngBlob = await offscreen.convertToBlob({ type: 'image/png' });

                // 5. Отправка на SAM-сервер
                const { maskBlob, score, time } = await segmentImage(pngBlob, nx, ny);
                console.log(`[SAM] score=${score.toFixed(4)}, time=${time.toFixed(3)}s`);

                // 6. Маска → ImageBitmap → offscreen-canvas
                const maskBitmap = await createImageBitmap(maskBlob);

                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                context.clearRect(0, 0, width, height);
                context.drawImage(maskBitmap, 0, 0);
                maskBitmap.close();

                // 7. Применить выделение через существующий механизм
                await events.invoke(
                    'select.byMask',
                    opFromModifiers(e),
                    canvas,
                    context
                );
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
        };

        this.deactivate = () => {
            svg.classList.add('hidden');
            parent.style.display = 'none';
            parent.removeEventListener('pointerdown', pointerdown);
        };
    }
}

export { SamSelection };