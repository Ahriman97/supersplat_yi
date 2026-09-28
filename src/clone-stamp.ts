import { GSplatData } from 'playcanvas';
import { Splat } from './splat';

// количество SH-коэффициентов на RGB канал для разных SH_BANDS
const SH_COEFFS_PER_CHANNEL: Record<number, number> = { 0: 0, 1: 3, 2: 8, 3: 15 };

type CloneResult = {
    gsplatData: GSplatData;
    numDonor: number;
    numHole: number;
    shBands: number;
    numRest: number;
};

/**
 * Создаёт новый GSplatData из копии гауссианов донора, сдвинутых в дыру.
 *
 * @param splat      — исходный splat
 * @param donorMask  — Uint8Array, 255 = донор
 * @param holeMask   — Uint8Array, 255 = дыра
 * @returns          — новый GSplatData + метаданные
 */
export const cloneGaussians = (
    splat: Splat,
    donorMask: Uint8Array,
    holeMask: Uint8Array
): CloneResult => {
    const splatData = splat.splatData;
    const numSplats = splatData.numSplats;

    // определяем SH_BANDS исходного splat
    const shBands = (splat.entity.gsplat.instance.resource as any).shBands ?? 0;
    const shCoeffs = SH_COEFFS_PER_CHANNEL[shBands] ?? 0;
    const numRest = shCoeffs * 3;

    console.log(`[Clone] SH_BANDS = ${shBands}, f_rest count = ${numRest}`);

    // получаем базовые свойства
    const x = splatData.getProp('x') as Float32Array;
    const y = splatData.getProp('y') as Float32Array;
    const z = splatData.getProp('z') as Float32Array;
    const f_dc_0 = splatData.getProp('f_dc_0') as Float32Array;
    const f_dc_1 = splatData.getProp('f_dc_1') as Float32Array;
    const f_dc_2 = splatData.getProp('f_dc_2') as Float32Array;
    const opacity = splatData.getProp('opacity') as Float32Array;
    const scale_0 = splatData.getProp('scale_0') as Float32Array;
    const scale_1 = splatData.getProp('scale_1') as Float32Array;
    const scale_2 = splatData.getProp('scale_2') as Float32Array;
    const rot_0 = splatData.getProp('rot_0') as Float32Array;
    const rot_1 = splatData.getProp('rot_1') as Float32Array;
    const rot_2 = splatData.getProp('rot_2') as Float32Array;
    const rot_3 = splatData.getProp('rot_3') as Float32Array;

    // SH-коэффициенты
    const fRest: Float32Array[] = [];
    for (let i = 0; i < numRest; i++) {
        fRest.push(splatData.getProp(`f_rest_${i}`) as Float32Array);
    }

    // считаем центры донора и дыры
    let donorMinX = Infinity, donorMinY = Infinity, donorMinZ = Infinity;
    let donorMaxX = -Infinity, donorMaxY = -Infinity, donorMaxZ = -Infinity;
    let donorCount = 0;

    let holeMinX = Infinity, holeMinY = Infinity, holeMinZ = Infinity;
    let holeMaxX = -Infinity, holeMaxY = -Infinity, holeMaxZ = -Infinity;
    let holeCount = 0;

    for (let i = 0; i < numSplats; i++) {
        if (donorMask[i] === 255) {
            if (x[i] < donorMinX) donorMinX = x[i];
            if (y[i] < donorMinY) donorMinY = y[i];
            if (z[i] < donorMinZ) donorMinZ = z[i];
            if (x[i] > donorMaxX) donorMaxX = x[i];
            if (y[i] > donorMaxY) donorMaxY = y[i];
            if (z[i] > donorMaxZ) donorMaxZ = z[i];
            donorCount++;
        }
        if (holeMask[i] === 255) {
            if (x[i] < holeMinX) holeMinX = x[i];
            if (y[i] < holeMinY) holeMinY = y[i];
            if (z[i] < holeMinZ) holeMinZ = z[i];
            if (x[i] > holeMaxX) holeMaxX = x[i];
            if (y[i] > holeMaxY) holeMaxY = y[i];
            if (z[i] > holeMaxZ) holeMaxZ = z[i];
            holeCount++;
        }
    }

    if (donorCount === 0) {
        throw new Error('Маска донора пустая');
    }
    if (holeCount === 0) {
        throw new Error('Маска дыры пустая');
    }

    const donorCenterX = (donorMinX + donorMaxX) / 2;
    const donorCenterY = (donorMinY + donorMaxY) / 2;
    const donorCenterZ = (donorMinZ + donorMaxZ) / 2;

    const holeCenterX = (holeMinX + holeMaxX) / 2;
    const holeCenterY = (holeMinY + holeMaxY) / 2;
    const holeCenterZ = (holeMinZ + holeMaxZ) / 2;

    const offsetX = holeCenterX - donorCenterX;
    const offsetY = holeCenterY - donorCenterY;
    const offsetZ = holeCenterZ - donorCenterZ;

    console.log(`[Clone] donor: ${donorCount} гауссианов, центр (${donorCenterX.toFixed(3)}, ${donorCenterY.toFixed(3)}, ${donorCenterZ.toFixed(3)})`);
    console.log(`[Clone] hole:  ${holeCount} гауссианов, центр (${holeCenterX.toFixed(3)}, ${holeCenterY.toFixed(3)}, ${holeCenterZ.toFixed(3)})`);
    console.log(`[Clone] offset: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)}, ${offsetZ.toFixed(3)})`);

    // создаём свойства для нового GSplatData
    const properties: any[] = [
        { type: 'float', name: 'x', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'y', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'z', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'f_dc_0', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'f_dc_1', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'f_dc_2', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'opacity', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'scale_0', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'scale_1', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'scale_2', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'rot_0', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'rot_1', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'rot_2', storage: new Float32Array(donorCount), byteSize: 4 },
        { type: 'float', name: 'rot_3', storage: new Float32Array(donorCount), byteSize: 4 }
    ];

    // SH-свойства
    for (let i = 0; i < numRest; i++) {
        properties.push({
            type: 'float',
            name: `f_rest_${i}`,
            storage: new Float32Array(donorCount),
            byteSize: 4
        });
    }

    // карта свойств для быстрого доступа
    const props: any = {};
    for (const p of properties) {
        props[p.name] = p.storage;
    }

    // копируем донора со сдвигом
    let idx = 0;
    for (let i = 0; i < numSplats; i++) {
        if (donorMask[i] !== 255) continue;

        props.x[idx] = x[i] + offsetX;
        props.y[idx] = y[i] + offsetY;
        props.z[idx] = z[i] + offsetZ;
        props.f_dc_0[idx] = f_dc_0[i];
        props.f_dc_1[idx] = f_dc_1[i];
        props.f_dc_2[idx] = f_dc_2[i];
        props.opacity[idx] = opacity[i];
        props.scale_0[idx] = scale_0[i];
        props.scale_1[idx] = scale_1[i];
        props.scale_2[idx] = scale_2[i];
        props.rot_0[idx] = rot_0[i];
        props.rot_1[idx] = rot_1[i];
        props.rot_2[idx] = rot_2[i];
        props.rot_3[idx] = rot_3[i];

        for (let s = 0; s < numRest; s++) {
            props[`f_rest_${s}`][idx] = fRest[s][i];
        }

        idx++;
    }

    // создаём GSplatData
    const gsplatData = new GSplatData([{
        name: 'vertex',
        count: donorCount,
        properties
    }]);

    console.log(`[Clone] создано ${donorCount} гауссианов`);

    return {
        gsplatData,
        numDonor: donorCount,
        numHole: holeCount,
        shBands,
        numRest
    };
};