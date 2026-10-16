import { Mat4, Vec4 } from 'playcanvas';
import { Splat } from '../splat';
import { State } from '../splat-state';

//const MIN_OPACITY = -4.5951;
const EPS = 0.3;

// multiplier on the rough screen-space radius used by phase 0. Must be
// generous: phase 0 is a pure work-saver and any gaussian it rejects is lost
// for good. Bump if gaussians near the rect edge are being dropped.
const RADIUS_PAD_ROUGH = 20;

// cheap per-gaussian upper bound on the screen-space radius (in pixels).
// used to reject gaussians that cannot reach the mask before paying for the
// full computeScreenEllipse.
const PER_SPLAT_PAD = 5;

const v4 = new Vec4();

// ---------------------------------------------------------------------------
// screen-space ellipse of a single gaussian
// ---------------------------------------------------------------------------
type ScreenEllipse = {
    cx: number;
    cy: number;
    len1: number;
    len2: number;
    dirX: number;
    dirY: number;
};

const computeScreenEllipse = (
    px: number, py: number, pz: number,
    qw: number, qx: number, qy: number, qz: number,
    esx: number, esy: number, esz: number,
    viewModel: Mat4,
    proj: Mat4,
    screenW: number,
    screenH: number
): ScreenEllipse | null => {
    const m = viewModel.data;

    const a00 = m[0], a01 = m[4], a02 = m[8];
    const a10 = m[1], a11 = m[5], a12 = m[9];
    const a20 = m[2], a21 = m[6], a22 = m[10];

    v4.set(px, py, pz, 1);
    viewModel.transformVec4(v4, v4);
    const vx = v4.x;
    const vy = v4.y;
    const vz = v4.z;

    if (vz >= -1e-6) {
        return null;
    }

    // const qLen = Math.hypot(qx, qy, qz, qw) || 1;
    const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1; // beware of overflow use hypot if necessary
    const nx = qx / qLen;
    const ny = qy / qLen;
    const nz = qz / qLen;
    const nw = qw / qLen;

    const r00 = 1 - 2 * (ny * ny + nz * nz);
    const r01 = 2 * (nx * ny - nw * nz);  
    const r02 = 2 * (nx * nz + nw * ny);   
    const r10 = 2 * (nx * ny + nw * nz);   
    const r11 = 1 - 2 * (nx * nx + nz * nz);
    const r12 = 2 * (ny * nz - nw * nx);   
    const r20 = 2 * (nx * nz - nw * ny);  
    const r21 = 2 * (ny * nz + nw * nx);
    const r22 = 1 - 2 * (nx * nx + ny * ny);

    const lr00 = a00 * r00 + a01 * r10 + a02 * r20;
    const lr01 = a00 * r01 + a01 * r11 + a02 * r21;
    const lr02 = a00 * r02 + a01 * r12 + a02 * r22;
    const lr10 = a10 * r00 + a11 * r10 + a12 * r20;
    const lr11 = a10 * r01 + a11 * r11 + a12 * r21;
    const lr12 = a10 * r02 + a11 * r12 + a12 * r22;
    const lr20 = a20 * r00 + a21 * r10 + a22 * r20;
    const lr21 = a20 * r01 + a21 * r11 + a22 * r21;
    const lr22 = a20 * r02 + a21 * r12 + a22 * r22;

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
        return null;
    }

    const mid = 0.5 * (cov00 + cov11);
    //const radius = Math.hypot(0.5 * (cov00 - cov11), cov01);
    const a = 0.5 * (cov00 - cov11);
    const radius = Math.sqrt(a * a + cov01 * cov01);

    const lambda1 = mid + radius;
    const lambda2 = Math.max(mid - radius, 0.1);

    const eigenVecX = cov01;
    const eigenVecY = lambda1 - cov00;
    // const eigenLen = Math.hypot(eigenVecX, eigenVecY);
    const eigenLen = Math.sqrt(eigenVecX * eigenVecX + eigenVecY * eigenVecY);
    let dirX = 1, dirY = 0;
    if (eigenLen > 1e-9) {
        dirX = eigenVecX / eigenLen;
        dirY = eigenVecY / eigenLen;
    }

    const len1 = 2 * Math.sqrt(2 * lambda1);
    const len2 = 2 * Math.sqrt(2 * lambda2);

    const ndcX = (proj.data[0] * vx) / -vz;
    const ndcY = (proj.data[5] * vy) / -vz;

    const cx = (ndcX * 0.5 + 0.5) * screenW;
    const cy = (1 - (ndcY * 0.5 + 0.5)) * screenH;

    return { cx, cy, len1, len2, dirX, dirY};
};

// ---------------------------------------------------------------------------
// global max of exp(max(scale_0, scale_1, scale_2)) across the whole splat.
// used as a cheap upper bound for a gaussian's screen-space radius, so phase 0
// can reject far-away gaussians without ever calling Math.exp in the hot loop.
// cached on the splat; invalidated when the splat's scale data changes.
// ---------------------------------------------------------------------------
const ensureGlobalMaxExpScale = (splat: Splat): number => {
    if (splat.globalMaxExpScale !== undefined && splat.globalMaxExpScale !== null) {
        return splat.globalMaxExpScale;
    }
    const splatData = splat.splatData;
    const n = splatData.numSplats;
    const sx = splatData.getProp('scale_0') as Float32Array;
    const sy = splatData.getProp('scale_1') as Float32Array;
    const sz = splatData.getProp('scale_2') as Float32Array;
    let m = 0;
    if (sx && sy && sz) {
        for (let i = 0; i < n; i++) {
            const a = sx[i], b = sy[i], c = sz[i];
            const mx = a > b ? (a > c ? a : c) : (b > c ? b : c);
            if (mx > m) m = mx;
        }
    }
    const result = Math.exp(m);
    splat.globalMaxExpScale = result;
    return result;
};

const filterByEllipse = (
    splat: Splat,
    screenW: number,
    screenH: number,
    rect: { x1: number; y1: number; x2: number; y2: number },
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
    //const opacity = splatData.getProp('opacity') as Float32Array;
    const state = splatData.getProp('state') as Uint8Array;

    if (!x || !y || !z || !sx || !sy || !sz || !rw || !rx || !ry || !rz) {
        console.warn('[filterByEllipse] missing props');
        return null;
    }

    const view = splat.scene.camera.camera.viewMatrix;
    const proj = splat.scene.camera.camera.projectionMatrix;
    const model = splat.worldTransform;

    // console.log('[filter] ortho =', splat.scene.camera.ortho,
    // 'proj[0] =', proj.data[0], 'proj[5] =', proj.data[5],
    // 'screenW =', screenW, 'screenH =', screenH,
    // 'targetSize =', splat.scene.targetSize);

    const viewModel = new Mat4().mul2(view, model);
    const m = viewModel.data;
    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m4 = m[4], m5 = m[5], m6 = m[6];
    const m8 = m[8], m9 = m[9], m10 = m[10];
    const m12 = m[12], m13 = m[13], m14 = m[14];

    const proj00 = proj.data[0];
    const proj05 = proj.data[5];

    const rectX1 = Math.min(rect.x1, rect.x2);
    const rectY1 = Math.min(rect.y1, rect.y2);
    const rectX2 = Math.max(rect.x1, rect.x2);
    const rectY2 = Math.max(rect.y1, rect.y2);

    const px1 = Math.max(0, rectX1 * screenW);
    const py1 = Math.max(0, rectY1 * screenH);
    const px2 = Math.min(screenW, rectX2 * screenW);
    const py2 = Math.min(screenH, rectY2 * screenH);

    const out = new Uint8Array(numSplats);

    for (let i = 0; i < numSplats; i++) {
        if (state[i] & State.deleted) continue;

        const xi = x[i], yi = y[i], zi = z[i];

        // project centre (inline)
        const vx = m0 * xi + m4 * yi + m8 * zi + m12;
        const vy = m1 * xi + m5 * yi + m9 * zi + m13;
        const vz = m2 * xi + m6 * yi + m10 * zi + m14;
        if (vz >= -1e-6) continue;
        const ndcX = (proj00 * vx) / -vz;
        const ndcY = (proj05 * vy) / -vz;
        const cx = (ndcX * 0.5 + 0.5) * screenW;
        const cy = (1 - (ndcY * 0.5 + 0.5)) * screenH;
        // ---- footprint === 0: pure centre-in-rect -------------------------
        if (footprint === 0) {
            if (cx >= 0 && cx <= screenW && cy >= 0 && cy <= screenH &&
                cx >= px1 && cx <= px2 && cy >= py1 && cy <= py2) {
                out[i] = 255;
            }
            continue;
        }

        // phase 0: very rough reject (no exp) — keep it, but generous
        const depth = -vz;
        const dx0 = Math.max(px1 - cx, 0, cx - px2);
        const dy0 = Math.max(py1 - cy, 0, cy - py2);
        const distSq0 = dx0 * dx0 + dy0 * dy0;
        // const proj00 = proj.data[0];
        // const proj05 = proj.data[5];
        const jfx = Math.abs(proj00) * screenW * 0.5;
        const jfy = Math.abs(proj05) * screenH * 0.5;
        const jfMax = jfx > jfy ? jfx : jfy;
        const globalMaxExpScale = ensureGlobalMaxExpScale(splat);
        const roughRadius = globalMaxExpScale * jfMax / Math.max(depth, 0.001) * RADIUS_PAD_ROUGH;
        if (distSq0 > roughRadius * roughRadius) continue;

        // ---- exact screen-space ellipse -----------------------------------
        const esx = Math.exp(sx[i]);
        const esy = Math.exp(sy[i]);
        const esz = Math.exp(sz[i]);

        const e = computeScreenEllipse(
            xi, yi, zi,
            rw[i], rx[i], ry[i], rz[i],
            esx, esy, esz,
            viewModel, proj,
            screenW, screenH
        );

        if (!e) continue;

        // ellipse axes (посчитаны один раз, используются в extent и conic)
        const axis1x = e.len1 * e.dirX;
        const axis1y = e.len1 * e.dirY;
        const axis2x = e.len2 * e.dirY;
        const axis2y = -e.len2 * e.dirX;
        
        const extentX = Math.abs(axis1x) + Math.abs(axis2x);
        const extentY = Math.abs(axis1y) + Math.abs(axis2y);

        // ---- reject if the whole ellipse is offscreen ---------------------
        if (e.cx + extentX < 0 || e.cx - extentX > screenW ||
            e.cy + extentY < 0 || e.cy - extentY > screenH) {
            continue;
        }

        // ---- quick accept: centre inside the user rect --------------------
        if (e.cx >= px1 && e.cx <= px2 && e.cy >= py1 && e.cy <= py2) {
            out[i] = 255;
            continue;
        }

        // ---- exact ellipse vs rect (rasterise rows, no conservative) ------
        const det = axis1x * axis2y - axis2x * axis1y;
        if (Math.abs(det) < 1e-6) continue;

        const inv = 1 / det;
        const m0x = axis2y * inv;
        const m0y = -axis2x * inv;
        const m1x = -axis1y * inv;
        const m1y = axis1x * inv;

        const q11 = m0x * m0x + m1x * m1x;
        const q12 = m0x * m0y + m1x * m1y;
        const q22 = m0y * m0y + m1y * m1y;

        const yMin = Math.max(Math.floor(e.cy - extentY), Math.floor(py1));
        const yMax = Math.min(Math.ceil(e.cy + extentY), Math.ceil(py2));

        for (let y = yMin; y <= yMax; y++) {
            const dyRow = y + 0.5 - e.cy;
            const disc = q12 * q12 * dyRow * dyRow - q11 * (q22 * dyRow * dyRow - 1);
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            const x0 = e.cx + (-q12 * dyRow - sq) / q11;
            const x1 = e.cx + (-q12 * dyRow + sq) / q11;
            if (x1 >= px1 && x0 <= px2) {
                out[i] = 255;
                break;
            }
        }
    }

    return out;
};

// ---------------------------------------------------------------------------
// mask filter (footprint > 0). phase 5 rasterises the screen-space ellipse
// contour into MASK_POINTS samples and checks each against the alpha channel.
// ---------------------------------------------------------------------------
const MASK_POINTS = 16;

const filterByEllipseMask = (
    splat: Splat,
    screenW: number,
    screenH: number,
    mask: { canvas: HTMLCanvasElement, data: Uint8ClampedArray }
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
    //const opacity = splatData.getProp('opacity') as Float32Array;
    const state = splatData.getProp('state') as Uint8Array;

    if (!x || !y || !z || !sx || !sy || !sz || !rw || !rx || !ry || !rz) {
        console.warn('[filterByEllipseMask] missing props');
        return null;
    }

    const maskW = mask.canvas.width;
    const maskH = mask.canvas.height;
    const maskData = mask.data;
    //console.log('[filterByEllipseMask] CALLED, numSplats =', numSplats,
    //    'maskW =', maskW, 'maskH =', maskH,
    //    'screenW =', screenW, 'screenH =', screenH);
    // bbox of the mask (alpha channel)
    let bx0 = maskW, by0 = maskH, bx1 = 0, by1 = 0;
    
    for (let py = 0; py < maskH; py++) {
        const rowOffset = py * maskW * 4;
        for (let px = 0; px < maskW; px++) {
            if (maskData[rowOffset + px * 4 + 3] === 255) {
                if (px < bx0) bx0 = px;
                if (px > bx1) bx1 = px;
                if (py < by0) by0 = py;
                if (py > by1) by1 = py;
            }
        }
    }
    if (bx1 < bx0 || by1 < by0) {
        return new Uint8Array(numSplats);
    }
    const bboxX1 = bx0;
    const bboxY1 = by0;
    const bboxX2 = bx1;
    const bboxY2 = by1;

    const inMask = (px: number, py: number): boolean => {
        const ix = px | 0;
        const iy = py | 0;
        if (ix < 0 || ix >= maskW || iy < 0 || iy >= maskH) return false;
        return maskData[(iy * maskW + ix) * 4 + 3] === 255;
    };

    const view = splat.scene.camera.camera.viewMatrix;
    const proj = splat.scene.camera.camera.projectionMatrix;
    const model = splat.worldTransform;
    // console.log('[filter] ortho =', splat.scene.camera.ortho,
    //     'proj[0] =', proj.data[0], 'proj[5] =', proj.data[5],
    //     'screenW =', screenW, 'screenH =', screenH,
    //     'targetSize =', splat.scene.targetSize);
    const viewModel = new Mat4().mul2(view, model);
    const m = viewModel.data;
    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m4 = m[4], m5 = m[5], m6 = m[6];
    const m8 = m[8], m9 = m[9], m10 = m[10];
    const m12 = m[12], m13 = m[13], m14 = m[14];

    const proj00 = proj.data[0];
    const proj05 = proj.data[5];
    const jfx = Math.abs(proj00) * screenW * 0.5;
    const jfy = Math.abs(proj05) * screenH * 0.5;
    const jfMax = jfx > jfy ? jfx : jfy;


    const globalMaxExpScale = ensureGlobalMaxExpScale(splat);

    const out = new Uint8Array(numSplats);

    const TARGET_ID = 11891470;

    for (let i = 0; i < numSplats; i++) {
        
        if (state[i] & State.deleted) {
            // if (i === TARGET_ID) console.log('[target] REJECT: deleted');
            continue;
        }
        // if (opacity && opacity[i] < MIN_OPACITY) {
        //     // if (i === TARGET_ID) console.log('[target] REJECT: opacity', opacity[i], '<', MIN_OPACITY);
        //     continue;
        // }

        const xi = x[i], yi = y[i], zi = z[i];

        const vx = m0 * xi + m4 * yi + m8 * zi + m12;
        const vy = m1 * xi + m5 * yi + m9 * zi + m13;
        const vz = m2 * xi + m6 * yi + m10 * zi + m14;
        if (vz >= -1e-6) {
        //     if (i === TARGET_ID) console.log('[target] REJECT: behind camera, vz =', vz);
             continue;
        }

        const ndcX = (proj00 * vx) / -vz;
        const ndcY = (proj05 * vy) / -vz;
        const cx = (ndcX * 0.5 + 0.5) * screenW;
        const cy = (1 - (ndcY * 0.5 + 0.5)) * screenH;

        // if (i === TARGET_ID) {
        //     console.log('[target] screen coords: cx =', cx, 'cy =', cy,
        //         'screenW =', screenW, 'screenH =', screenH);
        // }

        // ---- phase 0: rough reject (no exp) --------------------------------
        const depth = -vz;
        //const dx0 = Math.max(bboxX1 - cx, 0, cx - bboxX2);
        //const dy0 = Math.max(bboxY1 - cy, 0, cy - bboxY2);
        
        const roughRadius = globalMaxExpScale * jfMax / Math.max(depth, 0.001) * RADIUS_PAD_ROUGH;
        // reject if far from bbox
        const dx0 = Math.max(bboxX1 - cx, 0, cx - bboxX2);
        const dy0 = Math.max(bboxY1 - cy, 0, cy - bboxY2);
        if (dx0 * dx0 + dy0 * dy0 > roughRadius * roughRadius) continue;

        // reject if far from screen
        if (cx + roughRadius < 0 || cx - roughRadius > screenW ||
            cy + roughRadius < 0 || cy - roughRadius > screenH) continue;
        const distSq0 = dx0 * dx0 + dy0 * dy0;
        // if (cx + roughRadius < 0 || cx - roughRadius > screenW || cy + roughRadius < 0 || cy - roughRadius > screenH) continue;
        // const distSq0 = dx0 * dx0 + dy0 * dy0;
        // if (distSq0 > roughRadius * roughRadius) {
        //     // if (i === TARGET_ID) console.log('[target] REJECT: phase 0, distSq0 =', distSq0, 'roughRadius² =', roughRadius * roughRadius);
        //     continue;
        // }

        // ---- skip micro gaussians (no exp) ---------------------------------
        // if (sx[i] < MIN_LOG_SCALE && sy[i] < MIN_LOG_SCALE && sz[i] < MIN_LOG_SCALE) continue;

        // ---- exact screen-space ellipse ------------------------------------
        const esx = Math.exp(sx[i]);
        const esy = Math.exp(sy[i]);
        const esz = Math.exp(sz[i]);

        // ---- per-splat rough reject (cheap, before the full ellipse) -------
        const perSplatMax = esx > esy ? (esx > esz ? esx : esz) : (esy > esz ? esy : esz);
        const perSplatRadius = perSplatMax * jfMax / Math.max(depth, 0.001) * PER_SPLAT_PAD;
        if (distSq0 > perSplatRadius * perSplatRadius) continue;

        const e = computeScreenEllipse(
            xi, yi, zi,
            rw[i], rx[i], ry[i], rz[i],
            esx, esy, esz,
            viewModel, proj,
            screenW, screenH
        );

        if (!e) {
            // if (i === TARGET_ID) console.log('[target] REJECT: computeScreenEllipse returned null');
            continue;
        }

        // if (i === TARGET_ID) {
        //     console.log('[target] e =', e);
        // }

        // ---- reject if the whole ellipse is offscreen ----------------------
        const extentX = Math.abs(e.len1 * e.dirX) + Math.abs(e.len2 * e.dirY);
        const extentY = Math.abs(e.len1 * e.dirY) + Math.abs(e.len2 * e.dirX);

        if (e.cx + extentX < 0 || e.cx - extentX > screenW ||
            e.cy + extentY < 0 || e.cy - extentY > screenH) {
            // if (i === TARGET_ID) console.log('[target] REJECT: offscreen, extent =', extentX, extentY);
            continue;
        }

        // ---- quick accept: centre inside mask ------------------------------
        if (inMask(e.cx, e.cy)) {
            // if (i === TARGET_ID) console.log('[target] ACCEPT: quick (center in mask)');
            out[i] = 255;
            continue;
        }

        // ---- conservative circle vs mask bbox ------------------------------
        const dx = Math.max(bboxX1 - e.cx, 0, e.cx - bboxX2);
        const dy = Math.max(bboxY1 - e.cy, 0, e.cy - bboxY2);
        const distSq = dx * dx + dy * dy;
        const maxRadius = Math.max(e.len1, e.len2);

        //  if (i === TARGET_ID) {
        //     console.log('[target] bbox =', bboxX1, bboxY1, bboxX2, bboxY2);
        //     console.log('[target] inMask(e.cx, e.cy) =', inMask(e.cx, e.cy));
        //     console.log('[target] distSq =', distSq, 'maxRadius² =', maxRadius * maxRadius);
        // }

        if (distSq <= maxRadius * maxRadius) {
            // ---- exact: rasterise the ellipse contour into MASK_POINTS -----
            const axis1x = e.len1 * e.dirX;
            const axis1y = e.len1 * e.dirY;
            const axis2x = e.len2 * e.dirY;
            const axis2y = -e.len2 * e.dirX;

            let hit = false;
            for (let k = 0; k < MASK_POINTS; k++) {
                const t = (k / MASK_POINTS) * Math.PI * 2;
                const ct = Math.cos(t);
                const st = Math.sin(t);
                const px = e.cx + ct * axis1x + st * axis2x;
                const py = e.cy + ct * axis1y + st * axis2y;
                // if (i === TARGET_ID) {
                //     console.log('[target] point', k, '=', px, py, 'inMask =', inMask(px, py));
                // }
                if (inMask(px, py)) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                out[i] = 255;
            }
            // if (hit) {
            //         if (i === TARGET_ID) console.log('[target] ACCEPT: 16 points hit');
            //         out[i] = 255;
            //     } else {
            //         if (i === TARGET_ID) console.log('[target] REJECT: 16 points no hit');
            //     }
            // } else {
            //     if (i === TARGET_ID) console.log('[target] REJECT: distSq > maxRadius²');
            
        }
    }
    return out;
};

export { filterByEllipse, filterByEllipseMask };
