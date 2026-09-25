import { Splat } from './splat';
import { State } from './splat-state';

const SH_C0 = 0.28209479177387814;

const decodeColorChannel = (value: number): number => {
    return Math.min(1, Math.max(0, 0.5 + value * SH_C0));
};

const luminance = (r: number, g: number, b: number): number => {
    return 0.299 * r + 0.587 * g + 0.114 * b;
};

export type DetectShadowsOptions = {
    // Порог: гауссиан считается тенью, если его яркость < threshold * avgLuminance
    // 0.7 = 70% от средней яркости выделения
    threshold?: number;

    // Если false — анализирует все выделенные гауссианы
    // Если true — только те, что рядом с "дырами" (не выделенными)
    onlyNearHoles?: boolean;
};

export type DetectShadowsResult = {
    // Маска: 255 = тень, 0 = не тень
    mask: Uint8Array;

    // Средняя яркость выделенной области
    avgLuminance: number;

    // Количество найденных теней
    count: number;
};

/**
 * Находит "теневые" гауссианы внутри выделения.
 *
 * Тень — это гауссиан, у которого яркость значительно ниже средней
 * яркости выделенной области. Такие гауссианы обычно являются остатками
 * от удалённых объектов (тени на асфальте).
 */
export const detectShadows = (
    splat: Splat,
    options: DetectShadowsOptions = {}
): DetectShadowsResult => {
    const threshold = options.threshold ?? 0.7;

    const splatData = splat.splatData;
    const state = splat.state.data;
    const numSplats = splatData.numSplats;

    const reds = splatData.getProp('f_dc_0') as Float32Array;
    const greens = splatData.getProp('f_dc_1') as Float32Array;
    const blues = splatData.getProp('f_dc_2') as Float32Array;

    if (!reds || !greens || !blues) {
        throw new Error('Splat data не содержит цветовых каналов (f_dc_*)');
    }

    // Шаг 1: считаем среднюю яркость выделенных гауссианов
    let sumLuminance = 0;
    let countSelected = 0;

    for (let i = 0; i < numSplats; i++) {
        if (state[i] === State.selected) {
            const r = decodeColorChannel(reds[i]);
            const g = decodeColorChannel(greens[i]);
            const b = decodeColorChannel(blues[i]);
            sumLuminance += luminance(r, g, b);
            countSelected++;
        }
    }

    if (countSelected === 0) {
        return {
            mask: new Uint8Array(numSplats),
            avgLuminance: 0,
            count: 0
        };
    }

    const avgLuminance = sumLuminance / countSelected;
    const shadowThreshold = avgLuminance * threshold;

    // Шаг 2: находим тёмные гауссианы
    const mask = new Uint8Array(numSplats);
    let count = 0;

    for (let i = 0; i < numSplats; i++) {
        if (state[i] !== State.selected) continue;

        const r = decodeColorChannel(reds[i]);
        const g = decodeColorChannel(greens[i]);
        const b = decodeColorChannel(blues[i]);
        const lum = luminance(r, g, b);

        if (lum < shadowThreshold) {
            mask[i] = 255;
            count++;
        }
    }

    return {
        mask,
        avgLuminance,
        count
    };
};