import { Mat4, Vec4 } from 'playcanvas';
import { sigmoid } from '../color-grade';
import { Splat } from '../splat';
import { State } from '../splat-state';

const MIN_OPACITY = 0.01;
const EPS = 0.3;

const v4 = new Vec4();
const mat = new Mat4();

const ellipseIntersectsRect = (
    px: number, py: number, pz: number,
    qw: number, qx: number, qy: number, qz: number,
    esx: number, esy: number, esz: number,
    model: Mat4,
    view: Mat4,
    proj: Mat4,
    screenW: number,
    screenH: number,
    rectX1: number, rectY1: number, rectX2: number, rectY2: number
): boolean => {
    mat.mul2(view, model);
    const m = mat.data;

    // column-major rows
    const a00 = m[0], a01 = m[4], a02 = m[8];
    const a10 = m[1], a11 = m[5], a12 = m[9];
    const a20 = m[2], a21 = m[6], a22 = m[10];

    v4.set(px, py, pz, 1);
    mat.transformVec4(v4, v4);
    const vx = v4.x;
    const vy = v4.y;
    const vz = v4.z;

    // PlayCanvas: visible gaussians have vz < 0
    if (vz >= -1e-6) {
        return false;
    }

    // rotation matrix from gaussian quaternion
    const qLen = Math.hypot(qx, qy, qz, qw) || 1;
    const nx = qx / qLen;
    const ny = qy / qLen;
    const nz = qz / qLen;
    const nw = qw / qLen;

    const r00 = 1 - 2 * (ny * ny + nz * nz);
    const r01 = 2 * (nx * ny + nw * nz);
    const r02 = 2 * (nx * nz - nw * ny);
    const r10 = 2 * (nx * ny - nw * nz);
    const r11 = 1 - 2 * (nx * nx + nz * nz);
    const r12 = 2 * (ny * nz + nw * nx);
    const r20 = 2 * (nx * nz + nw * ny);
    const r21 = 2 * (ny * nz - nw * nx);
    const r22 = 1 - 2 * (nx * nx + ny * ny);

    // linear * R
    const lr00 = a00 * r00 + a01 * r10 + a02 * r20;
    const lr01 = a00 * r01 + a01 * r11 + a02 * r21;
    const lr02 = a00 * r02 + a01 * r12 + a02 * r22;
    const lr10 = a10 * r00 + a11 * r10 + a12 * r20;
    const lr11 = a10 * r01 + a11 * r11 + a12 * r21;
    const lr12 = a10 * r02 + a11 * r12 + a12 * r22;
    const lr20 = a20 * r00 + a21 * r10 + a22 * r20;
    const lr21 = a20 * r01 + a21 * r11 + a22 * r21;
    const lr22 = a20 * r02 + a21 * r12 + a22 * r22;

    // * S (scale columns)
    const g00 = lr00 * esx, g01 = lr01 * esy, g02 = lr02 * esz;
    const g10 = lr10 * esx, g11 = lr11 * esy, g12 = lr12 * esz;
    const g20 = lr20 * esx, g21 = lr21 * esy, g22 = lr22 * esz;

    const c00 = g00 * g00 + g01 * g01 + g02 * g02;
    const c01 = g00 * g10 + g01 * g11 + g02 * g12;
    const c02 = g00 * g20 + g01 * g21 + g02 * g22;
    const c11 = g10 * g10 + g11 * g11 + g12 * g12;
    const c12 = g10 * g20 + g11 * g21 + g12 * g22;
    const c22 = g20 * g20 + g21 * g21 + g22 * g22;

    const fx = Math.abs(proj.data[0]) * screenW * 0.5;
    const fy = Math.abs(proj.data[5]) * screenH * 0.5;

    // depth positive
    const depth = -vz;
    const safeDepth = Math.max(depth, 0.001);
    const invDepth = 1 / safeDepth;

    const jx0 = fx * invDepth;
    const jx2 = fx * vx * invDepth * invDepth;
    const jy1 = fy * invDepth;
    const jy2 = fy * vy * invDepth * invDepth;

    const u00 = jx0 * c00 + jx2 * c02;
    const u01 = jx0 * c01 + jx2 * c12;
    const u02 = jx0 * c02 + jx2 * c22;
    const u11 = jy1 * c11 + jy2 * c12;
    const u12 = jy1 * c12 + jy2 * c22;

    let cov00 = u00 * jx0 + u02 * jx2;
    let cov01 = u01 * jy1 + u02 * jy2;
    let cov11 = u11 * jy1 + u12 * jy2;

    cov00 += EPS;
    cov11 += EPS;

    const determinant = cov00 * cov11 - cov01 * cov01;
    if (determinant <= 0) {
        return false;
    }

    const mid = 0.5 * (cov00 + cov11);
    const radius = Math.hypot(0.5 * (cov00 - cov11), cov01);
    const lambda1 = mid + radius;
    const lambda2 = Math.max(mid - radius, 0.1);

    const eigenVecX = cov01;
    const eigenVecY = lambda1 - cov00;
    const eigenLen = Math.hypot(eigenVecX, eigenVecY);
    let dirX = 1, dirY = 0;
    if (eigenLen > 1e-9) {
        dirX = eigenVecX / eigenLen;
        dirY = eigenVecY / eigenLen;
    }

    const len1 = 2 * Math.sqrt(2 * lambda1);
    const len2 = 2 * Math.sqrt(2 * lambda2);

    const axis1x = len1 * dirX;
    const axis1y = len1 * dirY;
    const axis2x = len2 * dirY;
    const axis2y = -len2 * dirX;

    // project center: NDC via -vz
    const ndcX = (proj.data[0] * vx) / -vz;
    const ndcY = (proj.data[5] * vy) / -vz;

    const cx = (ndcX * 0.5 + 0.5) * screenW;
    const cy = (1 - (ndcY * 0.5 + 0.5)) * screenH;

    const px1 = rectX1 * screenW;
    const py1 = rectY1 * screenH;
    const px2 = rectX2 * screenW;
    const py2 = rectY2 * screenH;

    const det = axis1x * axis2y - axis2x * axis1y;
    if (Math.abs(det) < 1e-6) {
        return false;
    }
    const inv = 1 / det;
    const m0x = axis2y * inv;
    const m0y = -axis2x * inv;
    const m1x = -axis1y * inv;
    const m1y = axis1x * inv;

    const q11 = m0x * m0x + m1x * m1x;
    const q12 = m0x * m0y + m1x * m1y;
    const q22 = m0y * m0y + m1y * m1y;

    const extentY = Math.abs(axis1y) + Math.abs(axis2y);
    const yMin = Math.max(Math.floor(cy - extentY), Math.floor(py1));
    const yMax = Math.min(Math.ceil(cy + extentY), Math.ceil(py2));

    for (let y = yMin; y <= yMax; y++) {
        const dy = y + 0.5 - cy;
        const disc = q12 * q12 * dy * dy - q11 * (q22 * dy * dy - 1);
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const x0 = cx + (-q12 * dy - sq) / q11;
        const x1 = cx + (-q12 * dy + sq) / q11;
        if (x1 >= px1 && x0 <= px2) {
            return true;
        }
    }

    return false;
};

const filterByEllipse = (
    splat: Splat,
    screenW: number,
    screenH: number,
    rect: { x1: number, y1: number, x2: number, y2: number },
    footprint: number = 1
): Uint8Array => {
    const { splatData } = splat;
    const numSplats = splatData.numSplats;
    const x = splatData.getProp('x') as Float32Array;
    const y = splatData.getProp('y') as Float32Array;
    const z = splatData.getProp('z') as Float32Array;
    const sx = splatData.getProp('scale_0') as Float32Array;
    const sy = splatData.getProp('scale_1') as Float32Array;
    const sz = splatData.getProp('scale_2') as Float32Array;
    const rw = splatData.getProp('rot_0') as Float32Array;
    const rx = splatData.getProp('rot_1') as Float32Array;
    const ry = splatData.getProp('rot_2') as Float32Array;
    const rz = splatData.getProp('rot_3') as Float32Array;
    const opacity = splatData.getProp('opacity') as Float32Array;
    const state = splatData.getProp('state') as Uint8Array;

    if (!x || !y || !z || !sx || !sy || !sz || !rw || !rx || !ry || !rz) {
        console.warn('[filterByEllipse] missing props');
        return null;
    }

    const view = splat.scene.camera.camera.viewMatrix;
    const proj = splat.scene.camera.camera.projectionMatrix;
    const model = splat.worldTransform;

    const rectX1 = Math.min(rect.x1, rect.x2);
    const rectY1 = Math.min(rect.y1, rect.y2);
    const rectX2 = Math.max(rect.x1, rect.x2);
    const rectY2 = Math.max(rect.y1, rect.y2);

    const px1 = rectX1 * screenW;
    const py1 = rectY1 * screenH;
    const px2 = rectX2 * screenW;
    const py2 = rectY2 * screenH;

    const out = new Uint8Array(numSplats);

    for (let i = 0; i < numSplats; i++) {
        if (state[i] & State.deleted) continue;
        if (opacity && sigmoid(opacity[i]) < MIN_OPACITY) continue;

        if (footprint === 0) {
            mat.mul2(view, model);
            v4.set(x[i], y[i], z[i], 1);
            mat.transformVec4(v4, v4);
            if (v4.z >= -1e-6) continue;

            const ndcX = (proj.data[0] * v4.x) / -v4.z;
            const ndcY = (proj.data[5] * v4.y) / -v4.z;
            const cx = (ndcX * 0.5 + 0.5) * screenW;
            const cy = (1 - (ndcY * 0.5 + 0.5)) * screenH;

            if (cx >= px1 && cx <= px2 && cy >= py1 && cy <= py2) {
                out[i] = 255;
            }
        } else {
            if (ellipseIntersectsRect(
                x[i], y[i], z[i],
                rw[i], rx[i], ry[i], rz[i],
                Math.exp(sx[i]), Math.exp(sy[i]), Math.exp(sz[i]),
                model, view, proj,
                screenW, screenH,
                rectX1, rectY1, rectX2, rectY2
            )) {
                out[i] = 255;
            }
        }
    }
    return out;
};

export { filterByEllipse };