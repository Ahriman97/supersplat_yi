import { GSplatData } from 'playcanvas';

import { State } from './splat-state';

// Solid ellipsoids use the same principal radii as the rendered Gaussian:
// exp(scale_0..2), rotated by rot_0..3 (w, x, y, z).
// A sweep on the world-space AABBs removes the overwhelming majority of pairs;
// the remaining candidates use the Perram-Wertheim overlap criterion.
const findIsolatedSelectedSplats = (data: GSplatData): Uint32Array => {
    const count = data.numSplats;
    const state = data.getProp('state') as Uint8Array;
    const x = data.getProp('x') as Float32Array;
    const y = data.getProp('y') as Float32Array;
    const z = data.getProp('z') as Float32Array;
    const sx = data.getProp('scale_0') as Float32Array;
    const sy = data.getProp('scale_1') as Float32Array;
    const sz = data.getProp('scale_2') as Float32Array;
    const rw = data.getProp('rot_0') as Float32Array;
    const rx = data.getProp('rot_1') as Float32Array;
    const ry = data.getProp('rot_2') as Float32Array;
    const rz = data.getProp('rot_3') as Float32Array;

    if (!x || !y || !z || !sx || !sy || !sz || !rw || !rx || !ry || !rz) {
        return new Uint32Array();
    }

    // Build a conservative boundary around the current selection first. An
    // unselected splat whose bounding sphere cannot reach this boundary cannot
    // possibly overlap any selected ellipsoid, so it never enters the more
    // expensive AABB construction, sorting, or exact overlap pass.
    let selectionMinX = Infinity;
    let selectionMaxX = -Infinity;
    let selectionMinY = Infinity;
    let selectionMaxY = -Infinity;
    let selectionMinZ = Infinity;
    let selectionMaxZ = -Infinity;
    let selectedCount = 0;
    for (let i = 0; i < count; i++) {
        if (state[i] !== State.selected) continue;
        const radius = Math.exp(Math.max(sx[i], sy[i], sz[i]));
        selectionMinX = Math.min(selectionMinX, x[i] - radius);
        selectionMaxX = Math.max(selectionMaxX, x[i] + radius);
        selectionMinY = Math.min(selectionMinY, y[i] - radius);
        selectionMaxY = Math.max(selectionMaxY, y[i] + radius);
        selectionMinZ = Math.min(selectionMinZ, z[i] - radius);
        selectionMaxZ = Math.max(selectionMaxZ, z[i] + radius);
        selectedCount++;
    }
    if (selectedCount === 0) return new Uint32Array();

    const minX = new Float64Array(count);
    const maxX = new Float64Array(count);
    const minY = new Float64Array(count);
    const maxY = new Float64Array(count);
    const minZ = new Float64Array(count);
    const maxZ = new Float64Array(count);
    // Symmetric shape matrix R * diag(radius^2) * R^T, packed xx,xy,xz,yy,yz,zz.
    const shape = new Float64Array(count * 6);
    const order: number[] = [];
    const isolated = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        if (state[i] & State.deleted) continue;

        const ax = Math.exp(sx[i]);
        const ay = Math.exp(sy[i]);
        const az = Math.exp(sz[i]);
        if (state[i] !== State.selected) {
            const radius = Math.max(ax, ay, az);
            if (x[i] + radius < selectionMinX || x[i] - radius > selectionMaxX ||
                y[i] + radius < selectionMinY || y[i] - radius > selectionMaxY ||
                z[i] + radius < selectionMinZ || z[i] - radius > selectionMaxZ) {
                continue;
            }
        }

        let qw = rw[i];
        let qx = rx[i];
        let qy = ry[i];
        let qz = rz[i];
        const qLen = Math.hypot(qw, qx, qy, qz) || 1;
        qw /= qLen;
        qx /= qLen;
        qy /= qLen;
        qz /= qLen;

        const r00 = 1 - 2 * (qy * qy + qz * qz);
        const r01 = 2 * (qx * qy - qz * qw);
        const r02 = 2 * (qx * qz + qy * qw);
        const r10 = 2 * (qx * qy + qz * qw);
        const r11 = 1 - 2 * (qx * qx + qz * qz);
        const r12 = 2 * (qy * qz - qx * qw);
        const r20 = 2 * (qx * qz - qy * qw);
        const r21 = 2 * (qy * qz + qx * qw);
        const r22 = 1 - 2 * (qx * qx + qy * qy);

        const a2 = ax * ax;
        const b2 = ay * ay;
        const c2 = az * az;
        const o = i * 6;
        shape[o] = r00 * r00 * a2 + r01 * r01 * b2 + r02 * r02 * c2;
        shape[o + 1] = r00 * r10 * a2 + r01 * r11 * b2 + r02 * r12 * c2;
        shape[o + 2] = r00 * r20 * a2 + r01 * r21 * b2 + r02 * r22 * c2;
        shape[o + 3] = r10 * r10 * a2 + r11 * r11 * b2 + r12 * r12 * c2;
        shape[o + 4] = r10 * r20 * a2 + r11 * r21 * b2 + r12 * r22 * c2;
        shape[o + 5] = r20 * r20 * a2 + r21 * r21 * b2 + r22 * r22 * c2;

        const hx = Math.sqrt(shape[o]);
        const hy = Math.sqrt(shape[o + 3]);
        const hz = Math.sqrt(shape[o + 5]);
        minX[i] = x[i] - hx;
        maxX[i] = x[i] + hx;
        minY[i] = y[i] - hy;
        maxY[i] = y[i] + hy;
        minZ[i] = z[i] - hz;
        maxZ[i] = z[i] + hz;
        isolated[i] = state[i] === State.selected ? 1 : 0;
        order.push(i);
    }

    order.sort((a, b) => minX[a] - minX[b]);

    const overlap = (a: number, b: number): boolean => {
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const dz = z[b] - z[a];
        const ao = a * 6;
        const bo = b * 6;

        // F(lambda) is concave on [0, 1]. Its maximum is > 1 exactly when a
        // separating surface exists; touching therefore counts as overlap.
        const criterion = (lambda: number) => {
            const inv = 1 - lambda;
            const m00 = inv * shape[ao] + lambda * shape[bo];
            const m01 = inv * shape[ao + 1] + lambda * shape[bo + 1];
            const m02 = inv * shape[ao + 2] + lambda * shape[bo + 2];
            const m11 = inv * shape[ao + 3] + lambda * shape[bo + 3];
            const m12 = inv * shape[ao + 4] + lambda * shape[bo + 4];
            const m22 = inv * shape[ao + 5] + lambda * shape[bo + 5];
            const c00 = m11 * m22 - m12 * m12;
            const c01 = m02 * m12 - m01 * m22;
            const c02 = m01 * m12 - m02 * m11;
            const c11 = m00 * m22 - m02 * m02;
            const c12 = m01 * m02 - m00 * m12;
            const c22 = m00 * m11 - m01 * m01;
            const det = m00 * c00 + m01 * c01 + m02 * c02;
            if (!(det > 0)) return 0;
            const quadratic = (
                dx * (c00 * dx + c01 * dy + c02 * dz) +
                dy * (c01 * dx + c11 * dy + c12 * dz) +
                dz * (c02 * dx + c12 * dy + c22 * dz)
            ) / det;
            return lambda * inv * quadratic;
        };

        let lo = 0;
        let hi = 1;
        for (let step = 0; step < 18; step++) {
            const third = (hi - lo) / 3;
            const l = lo + third;
            const r = hi - third;
            if (criterion(l) < criterion(r)) lo = l;
            else hi = r;
        }
        return criterion((lo + hi) * 0.5) <= 1 + 1e-6;
    };

    const active: number[] = [];
    for (const current of order) {
        let write = 0;
        for (let n = 0; n < active.length; n++) {
            const other = active[n];
            if (maxX[other] < minX[current]) continue;
            active[write++] = other;

            // Once neither endpoint can affect the result, only retain it for
            // later selected splats; no exact test is needed for this pair.
            if (!isolated[current] && !isolated[other]) continue;
            if (maxY[other] < minY[current] || maxY[current] < minY[other] ||
                maxZ[other] < minZ[current] || maxZ[current] < minZ[other]) continue;
            if (overlap(other, current)) {
                isolated[other] = 0;
                isolated[current] = 0;
            }
        }
        active.length = write;
        active.push(current);
    }

    const result: number[] = [];
    for (let i = 0; i < count; i++) {
        if (isolated[i]) result.push(i);
    }
    return Uint32Array.from(result);
};

export { findIsolatedSelectedSplats };
