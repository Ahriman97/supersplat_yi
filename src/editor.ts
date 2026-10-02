import { MemoryFileSystem } from '@playcanvas/splat-transform';
import { Color, Mat4, path, Quat, Texture, Vec3, Vec4 } from 'playcanvas';

import { EditHistory } from './edit-history';
import { SelectAllOp, SelectNoneOp, SelectInvertOp, SelectOp, DetectShadowsOp, HideSelectionOp, UnhideAllOp, DeleteSelectionOp, ResetOp, MultiOp, AddSplatOp, SetLocalFrameOp, EditOp } from './edit-ops';
import { Element, ElementType } from './element';
import { Events } from './events';
import type { GridPlane } from './infinite-grid';
import { MappedReadFileSystem } from './io';
import { findIsolatedSelectedSplats } from './isolated-splats';
import { Scene } from './scene';
import { Splat } from './splat';
import { writeSplatFile } from './splat-serialize';
import { cloneGaussians } from './clone-stamp';
import { filterByEllipse } from './data-processor/splat-ellipse-filter';

const REFERENCE_PERCENTILE = 0.005;

const removeExtension = (filename: string) => {
    return filename.substring(0, filename.length - path.getExtension(filename).length);
};

// register for editor and scene events
const registerEditorEvents = (events: Events, editHistory: EditHistory, scene: Scene) => {
    const vec = new Vec3();
    const vec2 = new Vec3();
    const vec4 = new Vec4();
    const mat = new Mat4();
    const SH_C0 = 0.28209479177387814;

    const decodeColorChannel = (value: number) => {
        return Math.min(1, Math.max(0, 0.5 + value * SH_C0));
    };

    const selectedSplats = () => {
        const selected = events.invoke('selection') as Splat;
        return selected?.visible ? [selected] : [];
    };

    let lastExportCursor = 0;

    window.addEventListener('beforeunload', (e) => {
        if (!events.invoke('scene.dirty')) return undefined;
        const msg = 'You have unsaved changes. Are you sure you want to leave?';
        e.returnValue = msg;
        return msg;
    });

    events.function('targetSize', () => scene.targetSize);

    events.on('scene.clear', () => {
        scene.clear();
        editHistory.clear();
        lastExportCursor = 0;
    });

    events.on('scene.elementRemoved', (element: Element) => {
        if (element.type === ElementType.splat) {
            editHistory.removeForSplat(element as Splat);
        }
    });

    events.function('scene.dirty', () => editHistory.cursor !== lastExportCursor);

    events.on('doc.saved', () => {
        lastExportCursor = editHistory.cursor;
    });

    [
        'camera.mode', 'camera.overlay', 'camera.splatSize', 'view.outlineSelection', 'view.unifiedSplats',
        'view.centersUseGaussianColor', 'view.bands', 'camera.bound', 'camera.boundDimensions', 'camera.showPoses',
        'camera.showInfo', 'selection.changed', 'tool.coordSpace'
    ].forEach((eventName) => {
        events.on(eventName, () => {
            scene.forceRender = true;
        });
    });

    // grid.visible

    const setGridVisible = (visible: boolean) => {
        if (visible !== scene.grid.visible) {
            scene.grid.visible = visible;
            events.fire('grid.visible', visible);
        }
    };

    events.function('grid.visible', () => scene.grid.visible);
    events.on('grid.setVisible', setGridVisible);
    events.on('grid.toggleVisible', () => setGridVisible(!scene.grid.visible));

    setGridVisible(scene.config.show.grid);

    // grid.plane

    const setGridPlane = (plane: GridPlane) => {
        if (plane !== scene.grid.plane) {
            scene.grid.plane = plane;
            events.fire('grid.plane', plane);
        }
    };

    events.function('grid.plane', () => scene.grid.plane);
    events.on('grid.setPlane', setGridPlane);

    // camera.fovDolly

    let fovDolly = false;
    const setFovDolly = (value: boolean) => {
        if (value !== fovDolly) {
            fovDolly = value;
            events.fire('camera.fovDolly', fovDolly);
        }
    };

    events.function('camera.fovDolly', () => fovDolly);
    events.on('camera.setFovDolly', setFovDolly);

    // camera.fov

    const setCameraFov = (fov: number) => {
        const { camera } = scene;
        if (fov !== camera.fov) {
            const oldFovFactor = camera.fovFactor;
            camera.fov = fov;
            if (!fovDolly) {
                const { controls } = scene.config;
                const k = camera.fovFactor / oldFovFactor;
                const t = camera.distanceTween;
                for (const s of [t.value, t.source, t.target]) {
                    s.distance = Math.max(controls.minZoom, Math.min(controls.maxZoom, s.distance * k));
                }
            }
            events.fire('camera.fov', camera.fov);
        }
    };

    events.function('camera.fov', () => scene.camera.fov);
    events.on('camera.setFov', setCameraFov);

    // camera.tonemapping

    events.function('camera.tonemapping', () => scene.camera.tonemapping);
    events.on('camera.setTonemapping', (value: string) => {
        scene.camera.tonemapping = value;
    });

    // camera.bound

    let bound = scene.config.show.bound;
    const setBoundVisible = (visible: boolean) => {
        if (visible !== bound) {
            bound = visible;
            events.fire('camera.bound', bound);
        }
    };

    events.function('camera.bound', () => bound);
    events.on('camera.setBound', setBoundVisible);
    events.on('camera.toggleBound', () => setBoundVisible(!events.invoke('camera.bound')));

    // camera.boundDimensions

    let boundDimensions = scene.config.show.boundDimensions;
    const setBoundDimensionsVisible = (visible: boolean) => {
        if (visible !== boundDimensions) {
            boundDimensions = visible;
            events.fire('camera.boundDimensions', boundDimensions);
        }
    };

    events.function('camera.boundDimensions', () => boundDimensions);
    events.on('camera.setBoundDimensions', setBoundDimensionsVisible);
    events.on('camera.toggleBoundDimensions', () => setBoundDimensionsVisible(!events.invoke('camera.boundDimensions')));

    // camera.showPoses

    let showPoses = scene.config.show.cameraPoses;
    const setShowPoses = (visible: boolean) => {
        if (visible !== showPoses) {
            showPoses = visible;
            events.fire('camera.showPoses', showPoses);
        }
    };

    events.function('camera.showPoses', () => showPoses);
    events.on('camera.setShowPoses', setShowPoses);
    events.on('camera.toggleShowPoses', () => setShowPoses(!events.invoke('camera.showPoses')));

    // camera.showInfo

    let showInfo = scene.config.show.cameraInfo;
    const setShowInfo = (visible: boolean) => {
        if (visible !== showInfo) {
            showInfo = visible;
            events.fire('camera.showInfo', showInfo);
        }
    };

    events.function('camera.showInfo', () => showInfo);
    events.on('camera.setShowInfo', setShowInfo);
    events.on('camera.toggleShowInfo', () => setShowInfo(!events.invoke('camera.showInfo')));

    // camera.focus

    events.on('camera.focus', () => {
        const toolFocus: { position: Vec3, radius: number } | null = events.invoke('tool.focus');
        if (toolFocus) {
            scene.camera.focus({ focalPoint: toolFocus.position, radius: toolFocus.radius, speed: 1 });
            return;
        }

        const splat = selectedSplats()[0];
        if (splat) {
            const bound = splat.numSelected > 0 ? splat.selectionBound : splat.localBound;
            vec.copy(bound.center);
            const worldTransform = splat.worldTransform;
            worldTransform.transformPoint(vec, vec);
            worldTransform.getScale(vec2);
            scene.camera.focus({
                focalPoint: vec,
                radius: bound.halfExtents.length() * vec2.x,
                speed: 1
            });
        }
    });

    // pivot.reset

    events.on('pivot.reset', (toCenter: boolean) => {
        const splat = selectedSplats()[0];
        if (!splat) return;

        const bound = splat.numSelected > 0 ? splat.selectionBound : splat.localBound;
        const newOrigin = toCenter ? bound.center.clone() : new Vec3();
        const newFrame = new Quat();

        if (splat.localFrameOrigin.equals(newOrigin) && splat.localFrame.equals(newFrame)) return;

        events.fire('edit.add', new SetLocalFrameOp({
            splat,
            oldOrigin: splat.localFrameOrigin.clone(),
            oldFrame: splat.localFrame.clone(),
            newOrigin,
            newFrame
        }));
    });

    events.on('camera.reset', () => {
        const { initialAzim, initialElev, initialZoom } = scene.config.controls;
        const x = Math.sin(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const y = -Math.sin(initialElev * Math.PI / 180);
        const z = Math.cos(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const zoom = initialZoom;
        scene.camera.setPose(new Vec3(x * zoom, y * zoom, z * zoom), new Vec3(0, 0, 0));
    });

    events.on('camera.align', (axis: string) => {
        switch (axis) {
            case 'px': scene.camera.setAzimElev(90, 0); break;
            case 'py': scene.camera.setAzimElev(0, 0); break;
            case 'pz': scene.camera.setAzimElev(0, -90); break;
            case 'nx': scene.camera.setAzimElev(270, 0); break;
            case 'ny': scene.camera.setAzimElev(180, 0); break;
            case 'nz': scene.camera.setAzimElev(0, 90); break;
        }
        scene.camera.ortho = true;
    });

    events.function('selection.splats', () => {
        const splat = events.invoke('selection') as Splat;
        return splat?.numSelected > 0;
    });

    // remember last step for preview
    type LastSelectOp = {
        op: 'add'|'remove'|'set'|'intersect';
        rect: any;
        viewProj: Mat4;  // view × model, frozen at selection time
        rawMask: Uint8Array | null;    // saved from dataProcessor.intersect
        rawIds: Uint32Array<ArrayBuffer> | null;  // for rings path
        fromRings: boolean;
    };

    let lastSelectOp: LastSelectOp | null = null;

    events.on('select.all', () => {
        lastSelectOp = null;
        selectedSplats().forEach((splat) => events.fire('edit.add', new SelectAllOp(splat)));
    });

    events.on('select.none', () => {
        lastSelectOp = null;
        selectedSplats().forEach((splat) => events.fire('edit.add', new SelectNoneOp(splat)));
    });

    events.on('select.invert', () => {
        lastSelectOp = null;
        selectedSplats().forEach((splat) => events.fire('edit.add', new SelectInvertOp(splat)));
    });

    events.on('select.mask', (op: 'add'|'remove'|'set'|'intersect'|'refine', mask: Uint8Array | Uint32Array) => {
        lastSelectOp = null;
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectOp(splat, op, mask));
        });
    });

    const runSelectIntersect = (splat: Splat, op: 'add'|'remove'|'set'|'intersect'|'refine', options: any) => {
        return scene.commandQueue.enqueue(async () => {
            const data = await scene.dataProcessor.intersect(options, splat);
            events.fire('edit.add', new SelectOp(splat, op, data));
            scene.dataProcessor.releaseMask(data);
        });
    };

    events.on('select.bySphere', async (op: 'add'|'remove'|'set'|'intersect', transform: Mat4) => {
        for (const splat of selectedSplats()) {
            await runSelectIntersect(splat, op, { sphere: { transform } });
        }
    });

    events.on('select.byBox', async (op: 'add'|'remove'|'set'|'intersect', transform: Mat4) => {
        for (const splat of selectedSplats()) {
            await runSelectIntersect(splat, op, { box: { transform } });
        }
    });

    // Cut depth
    events.on('edit.addPreview', (makeEditOp: () => EditOp) => {
        editHistory.addPreview(makeEditOp);
    });
    events.on('edit.commitPreview', () => editHistory.commitPreview());
    events.on('edit.cancelPreview', () => editHistory.cancelPreview());

    const applyCutDepthToMask = (
        splat: Splat,
        mask: Uint8Array,
        cutDepth: number,
        viewProj: Mat4
    ) => {
        if (cutDepth <= 0) return;

        const v4 = new Vec4();
        const x = splat.splatData.getProp('x') as Float32Array;
        const y = splat.splatData.getProp('y') as Float32Array;
        const z = splat.splatData.getProp('z') as Float32Array;

        const depths: number[] = [];
        for (let i = 0; i < mask.length; i++) {
            if (!mask[i]) continue;
            v4.set(x[i], y[i], z[i], 1);
            viewProj.transformVec4(v4, v4);
            const depth = -v4.z;
            if (depth > 0) depths.push(depth);
        }
        if (depths.length === 0) return;
        depths.sort((a, b) => a - b);
        // 5% percentile as the reference: ignores floaters near the camera
        const referenceDepth = depths[Math.floor(depths.length * REFERENCE_PERCENTILE)];
        const maxDepth = referenceDepth  + cutDepth;
        for (let i = 0; i < mask.length; i++) {
            if (!mask[i]) continue;
            v4.set(x[i], y[i], z[i], 1);
            viewProj.transformVec4(v4, v4);
            const depth = -v4.z;
            if (depth > maxDepth) mask[i] = 0;
        }
    };

    const applyCutDepthToIds = (
        splat: Splat,
        ids: Uint32Array<ArrayBuffer>,
        cutDepth: number,
        viewProj: Mat4
    ): Uint32Array<ArrayBuffer> => {
        if (cutDepth <= 0 || ids.length === 0) return ids;

        const v4 = new Vec4();
        const x = splat.splatData.getProp('x') as Float32Array;
        const y = splat.splatData.getProp('y') as Float32Array;
        const z = splat.splatData.getProp('z') as Float32Array;

        const depths: number[] = [];
        for (let k = 0; k < ids.length; k++) {
            const i = ids[k];
            v4.set(x[i], y[i], z[i], 1);
            viewProj.transformVec4(v4, v4);
            const depth = -v4.z;
            if (depth > 0) depths.push(depth);
        }
        if (depths.length === 0) return;

        depths.sort((a, b) => a - b);
        // 5% percentile as the reference: ignores floaters near the camera
        const referenceDepth = depths[Math.floor(depths.length * REFERENCE_PERCENTILE)];
        const maxDepth = referenceDepth + cutDepth;
        const filtered: number[] = [];
        for (let k = 0; k < ids.length; k++) {
            const i = ids[k];
            v4.set(x[i], y[i], z[i], 1);
            viewProj.transformVec4(v4, v4);
            const depth = -v4.z;
            if (depth <= maxDepth) filtered.push(i);
        }
        return new Uint32Array(filtered) as Uint32Array<ArrayBuffer>;
    };

    let previewTimer: number | null = null;

    events.on('selection.cutDepth', () => {
        if (!lastSelectOp) return;

        if (previewTimer !== null) {
            clearTimeout(previewTimer);
        }

        previewTimer = window.setTimeout(() => {
            previewTimer = null;
            const cutDepth = events.invoke('selection.cutDepth') as number;
            const { op, viewProj, rawMask, rawIds, fromRings } = lastSelectOp;

            for (const splat of selectedSplats()) {
                if (fromRings && rawIds) {
                    const ids = new Uint32Array(rawIds);
                    const filtered = applyCutDepthToIds(splat, ids, cutDepth, viewProj);
                    events.fire('edit.addPreview', () => new SelectOp(splat, op, filtered));
                } else if (rawMask) {
                    const copy = new Uint8Array(rawMask.length);
                    copy.set(rawMask);
                    applyCutDepthToMask(splat, copy, cutDepth, viewProj);
                    events.fire('edit.addPreview', () => new SelectOp(splat, op, copy));
                }
            }
        }, 80);
    });

    events.on('selection.commit', () => {
    if (!lastSelectOp) return;

    if (previewTimer !== null) {
        clearTimeout(previewTimer);
        previewTimer = null;
    }

    events.fire('edit.commitPreview');
    lastSelectOp = null;
    });

    events.function('select.rect', async (op, rect) => {
        // cancel any pending preview from a previous cutDepth change
        if (previewTimer !== null) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        const useDepth = events.invoke('selection.useDepth') as boolean;
        const footprint = events.invoke('selection.footprint') as number;
        const cutDepth = events.invoke('selection.cutDepth') as number;

        for (const splat of selectedSplats()) {
            const viewProj = new Mat4().mul2(
                scene.camera.camera.viewMatrix,
                splat.worldTransform
            );

            let data: Uint8Array | Uint32Array;
            let isMask = false;
            
            if (footprint > 0) {

                if (useDepth) {
                const { width, height } = scene.targetSize;
                const mask = filterByEllipse(splat, width, height, {
                    x1: Math.min(rect.start.x, rect.end.x),
                    y1: Math.min(rect.start.y, rect.end.y),
                    x2: Math.max(rect.start.x, rect.end.x),
                    y2: Math.max(rect.start.y, rect.end.y)
                }, 1);

                if (mask) {
                    lastSelectOp = {
                        op, rect, viewProj,
                        rawMask: new Uint8Array(mask),
                        rawIds: null,
                        fromRings: false
                    };

                    applyCutDepthToMask(splat, mask, cutDepth, viewProj);
                    data = mask;
                    isMask = true;
                } else {
                    console.warn('[select.rect] filterByEllipse returned null');
                    continue;
                }
            } else {
                scene.camera.pickPrep(splat, op);
                const pick = await scene.camera.pickRect(
                    rect.start.x, rect.start.y,
                    rect.end.x - rect.start.x, rect.end.y - rect.start.y
                );
                data = new Uint32Array(
                    new Set(pick.filter(id => id !== 0xffffffff))
                ).sort();
                isMask = false;
            }
            } else {
                data = await scene.dataProcessor.intersect({
                    rect: { x1: rect.start.x, y1: rect.start.y, x2: rect.end.x, y2: rect.end.y }
                }, splat);
                isMask = true;

                const raw = new Uint8Array(data.length);
                raw.set(data);
                lastSelectOp = {
                    op, rect, viewProj,
                    rawMask: raw,
                    rawIds: null,
                    fromRings: false
                };

                if (useDepth) {
                    applyCutDepthToMask(splat, data, cutDepth, viewProj);
                }
            }

            // events.fire('edit.add', new SelectOp(splat, op, data));
            events.fire('edit.addPreview',  () => new SelectOp(splat, op, data));
            if (isMask) {
                scene.dataProcessor.releaseMask(data as Uint8Array);
            }
        }
    });

    let maskTexture: Texture = null;

    events.function('select.byMask', async (op: 'add'|'remove'|'set'|'intersect', canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
        const useDepth = events.invoke('selection.useDepth') as boolean;
        const footprint = events.invoke('selection.footprint') as number;
        const cutDepth = events.invoke('selection.cutDepth') as number;
        const usePick = footprint > 0;

        for (const splat of selectedSplats()) {
            if (usePick) {
                const mask = context.getImageData(0, 0, canvas.width, canvas.height);

                let mx0 = mask.width - 1;
                let my0 = mask.height - 1;
                let mx1 = 0;
                let my1 = 0;
                for (let y = 0; y < mask.height; ++y) {
                    for (let x = 0; x < mask.width; ++x) {
                        if (mask.data[(y * mask.width + x) * 4 + 3] === 255) {
                            mx0 = Math.min(mx0, x);
                            my0 = Math.min(my0, y);
                            mx1 = Math.max(mx1, x);
                            my1 = Math.max(my1, y);
                        }
                    }
                }

                const nx0 = mx0 / mask.width;
                const ny0 = my0 / mask.height;
                const nx1 = (mx1 + 1) / mask.width;
                const ny1 = (my1 + 1) / mask.height;
                const nw = nx1 - nx0;
                const nh = ny1 - ny0;

                scene.camera.pickPrep(splat, op);
                const pick = await scene.camera.pickRect(nx0, ny0, nw, nh);

                const { width, height } = scene.targetSize;
                const px = Math.floor(nx0 * width);
                const py = Math.floor(ny0 * height);
                const pw = Math.max(1, Math.ceil((nx0 + nw) * width) - px);
                const ph = Math.max(1, Math.ceil((ny0 + nh) * height) - py);

                const selected = new Set<number>();
                for (let y = 0; y < ph; ++y) {
                    for (let x = 0; x < pw; ++x) {
                        const mx = Math.floor((nx0 + x / width) * mask.width);
                        const my = Math.floor((ny0 + y / height) * mask.height);
                        if (mask.data[(my * mask.width + mx) * 4] === 255) {
                            selected.add(pick[(ph - 1 - y) * pw + x]);
                        }
                    }
                }

                let ids = new Uint32Array(
                    Array.from(selected).filter(id => id !== 0xffffffff)
                ).sort();
                const viewProj = new Mat4().mul2(scene.camera.camera.viewMatrix, splat.worldTransform)
                // save raw ids (before cutDepth) for the Apply button
                lastSelectOp = {
                    op, rect: null, viewProj,
                    rawMask: null,
                    rawIds: new Uint32Array(ids),
                    fromRings: true
                };
                if (useDepth) {
                    ids = applyCutDepthToIds(splat, ids, cutDepth, viewProj);
                }
                events.fire('edit.addPreview', () => new SelectOp(splat, op, ids));
            } else {
                if (!maskTexture || maskTexture.width !== canvas.width || maskTexture.height !== canvas.height) {
                    if (maskTexture) maskTexture.destroy();
                    maskTexture = new Texture(scene.graphicsDevice);
                }
                maskTexture.setSource(canvas);

                await scene.commandQueue.enqueue(async () => {
                    const data = await scene.dataProcessor.intersect({ mask: maskTexture }, splat);
                    const viewProj = new Mat4().mul2(scene.camera.camera.viewMatrix, splat.worldTransform);
                    const raw = new Uint8Array(data.length);
                    raw.set(data);
                    lastSelectOp = {
                        op, rect: null, viewProj,
                        rawMask: raw,
                        rawIds: null,
                        fromRings: false
                    };

                    if (useDepth) {
                        applyCutDepthToMask(splat, data, cutDepth, viewProj);
                    }
                    events.fire('edit.addPreview', () => new SelectOp(splat, op, data));
                    scene.dataProcessor.releaseMask(data);
                });
            }
        }
    });

    events.function('select.point', async (op: 'add'|'remove'|'set'|'intersect', point: { x: number, y: number }) => {
        lastSelectOp = null;
        const { width, height } = scene.targetSize;
        const footprint = events.invoke('selection.footprint') as number;
        const usePick = footprint > 0;

        for (const splat of selectedSplats()) {
            const splatData = splat.splatData;

            if (usePick) {
                scene.camera.pickPrep(splat, op);
                const pickResult = await scene.camera.pickRect(point.x, point.y, 1 / width, 1 / height);
                const pickId = pickResult[0];
                if (pickId === 0xffffffff) continue;
                events.fire('edit.addPreview', () => new SelectOp(splat, op, new Uint32Array([pickId])));
            } else {
                const x = splatData.getProp('x');
                const y = splatData.getProp('y');
                const z = splatData.getProp('z');

                const splatSize = events.invoke('camera.splatSize');
                const camera = scene.camera.camera;
                const sx = point.x * width;
                const sy = point.y * height;

                mat.mul2(camera.camera._viewProjMat, splat.worldTransform);

                const numSplats = splatData.numSplats;
                const mask = new Uint8Array(numSplats);
                for (let i = 0; i < numSplats; i++) {
                    vec4.set(x[i], y[i], z[i], 1.0);
                    mat.transformVec4(vec4, vec4);
                    const px = (vec4.x / vec4.w * 0.5 + 0.5) * width;
                    const py = (-vec4.y / vec4.w * 0.5 + 0.5) * height;
                    if (Math.abs(px - sx) < splatSize && Math.abs(py - sy) < splatSize) {
                        mask[i] = 255;
                    }
                }

                events.fire('edit.addPreview', () => new SelectOp(splat, op, mask));
            }
        }
    });

    events.function('select.colorMatch', async (op: 'add'|'remove'|'set', point: { x: number, y: number }, threshold = 0) => {
        lastSelectOp = null;
        const splats = selectedSplats();
        const targetSize = scene.targetSize;
        if (!splats.length || !targetSize || !point) return;

        const { width, height } = targetSize;
        if (!width || !height) return;

        const nx = Math.max(0, Math.min(1, point.x));
        const ny = Math.max(0, Math.min(1, point.y));
        const colorThreshold = Math.min(1, Math.max(0, Number.isFinite(threshold) ? threshold : 0));

        for (const splat of splats) {
            scene.camera.pickPrep(splat, 'set');
            const pickBuffer = await scene.camera.pickRect(nx, ny, 1 / width, 1 / height);
            const pickId = pickBuffer?.[0];
            if (pickId === undefined || pickId === 0xffffffff) continue;

            const reds = splat.splatData.getProp('f_dc_0') as Float32Array;
            const greens = splat.splatData.getProp('f_dc_1') as Float32Array;
            const blues = splat.splatData.getProp('f_dc_2') as Float32Array;
            if (!reds || !greens || !blues || pickId < 0 || pickId >= reds.length) continue;

            const refR = decodeColorChannel(reds[pickId]);
            const refG = decodeColorChannel(greens[pickId]);
            const refB = decodeColorChannel(blues[pickId]);

            const numSplats = splat.splatData.numSplats;
            const mask = new Uint8Array(numSplats);
            for (let i = 0; i < numSplats; i++) {
                if (Math.abs(decodeColorChannel(reds[i]) - refR) <= colorThreshold &&
                    Math.abs(decodeColorChannel(greens[i]) - refG) <= colorThreshold &&
                    Math.abs(decodeColorChannel(blues[i]) - refB) <= colorThreshold) {
                    mask[i] = 255;
                }
            }

            events.fire('edit.add', new SelectOp(splat, op, mask));
        }
    });

    events.on('select.hide', () => {
        selectedSplats().forEach((splat) => events.fire('edit.add', new HideSelectionOp(splat)));
    });

    events.on('select.unhide', () => {
        const ops = (scene.getElementsByType(ElementType.splat) as Splat[])
        .map(splat => new UnhideAllOp(splat))
        .filter(op => !op.ranges.empty);

        if (ops.length > 0) {
            events.fire('edit.add', ops.length === 1 ? ops[0] : new MultiOp(ops));
        }
    });

    events.on('select.isolated', () => {
        const splat = events.invoke('selection') as Splat;
        if (!splat || splat.numSelected === 0) return;
        const isolated = findIsolatedSelectedSplats(splat.splatData);
        events.fire('edit.add', new SelectOp(splat, 'intersect', isolated));
    });

    events.on('select.detectShadows', (threshold = 0.7) => {
        selectedSplats().forEach((splat) => {
            editHistory.add(new DetectShadowsOp(splat, threshold));
        });
        events.fire('showPopup', {
            type: 'info',
            header: 'Поиск теней',
            message: `Смотри в консоли число выделений`
        });
    });

    events.on('clone.test', () => {
        const splat = selectedSplats()[0];
        if (!splat) return;

        const numSplats = splat.splatData.numSplats;
        const donorMask = new Uint8Array(numSplats);
        const holeMask = new Uint8Array(numSplats);

        const donorStart = 0;
        const donorEnd = Math.min(1000, numSplats);
        const holeStart = donorEnd;
        const holeEnd = Math.min(donorEnd + 1000, numSplats);

        for (let i = donorStart; i < donorEnd; i++) donorMask[i] = 255;
        for (let i = holeStart; i < holeEnd; i++) holeMask[i] = 255;

        try {
            const { gsplatData, numDonor, numRest, shBands } = cloneGaussians(splat, donorMask, holeMask);
            const asset = scene.assetLoader.createGSplatAsset(gsplatData, 'clone-test.ply');
            const cloneSplat = new Splat(asset, splat.entity.getLocalRotation().clone());
            editHistory.add(new AddSplatOp(scene, cloneSplat));
        } catch (err) {
            console.error('[Clone Test] ошибка:', err);
        }
    });

    let transparentLocked = false;
    const setTransparentLocked = (value: boolean) => {
        if (value !== transparentLocked) {
            transparentLocked = value;
            scene.forceRender = true;
            events.fire('view.transparentLocked', transparentLocked);
        }
    };

    events.function('view.transparentLocked', () => transparentLocked);
    events.on('view.setTransparentLocked', setTransparentLocked);
    events.on('view.toggleLockedTransparency', () => setTransparentLocked(!transparentLocked));

    events.on('select.delete', () => {
        if (['measure', 'orient'].includes(events.invoke('tool.active'))) return;
        if (events.invoke('polygonSelection.removeLastPoint')) return;
        selectedSplats().forEach((splat) => {
            editHistory.add(new DeleteSelectionOp(splat));
        });
    });

    const performSelectionFunc = async (func: 'duplicate' | 'separate') => {
        const splats = selectedSplats();
        const memFs = new MemoryFileSystem();

        await writeSplatFile(splats, { maxSHBands: 3, selected: true }, 'ply', 'output.ply', {}, memFs);
        const data = memFs.results.get('output.ply');

        if (data) {
            const splat = splats[0];
            const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
            const filename = `${removeExtension(splat.filename)}.ply`;
            const fileSystem = new MappedReadFileSystem();
            fileSystem.addFile(filename, blob);
            const copy = await scene.assetLoader.load(filename, fileSystem);
            if (events.invoke('journal.enabled')) copy.journalPayload = data;

            if (func === 'separate') {
                editHistory.add(new MultiOp([
                    new DeleteSelectionOp(splat),
                    new AddSplatOp(scene, copy)
                ]));
            } else {
                editHistory.add(new AddSplatOp(scene, copy));
            }
        }
    };

    events.on('edit.duplicate', () => performSelectionFunc('duplicate'));
    events.on('edit.separate', () => performSelectionFunc('separate'));

    events.on('scene.reset', () => {
        selectedSplats().forEach((splat) => {
            editHistory.add(new ResetOp(splat));
        });
    });

    // camera control mode

    let controlMode: 'orbit' | 'fly' = 'orbit';
    const setControlMode = (mode: 'orbit' | 'fly') => {
        if (mode !== controlMode) {
            controlMode = mode;
            scene.camera.controlMode = mode;
            events.fire('camera.controlMode', controlMode);
        }
    };

    events.function('camera.controlMode', () => controlMode);
    events.on('camera.setControlMode', setControlMode);
    events.on('camera.toggleControlMode', () => setControlMode(controlMode === 'orbit' ? 'fly' : 'orbit'));

    // camera overlay

    let cameraOverlay = scene.config.camera.overlay;
    const setCameraOverlay = (enabled: boolean) => {
        if (enabled !== cameraOverlay) {
            cameraOverlay = enabled;
            events.fire('camera.overlay', cameraOverlay);
        }
    };

    events.function('camera.overlay', () => cameraOverlay);
    events.on('camera.setOverlay', setCameraOverlay);
    events.on('camera.toggleOverlay', () => setCameraOverlay(!events.invoke('camera.overlay')));

    // splat size

    let splatSize = 2;
    const setSplatSize = (value: number) => {
        if (value !== splatSize) {
            splatSize = value;
            events.fire('camera.splatSize', splatSize);
        }
    };

    events.function('camera.splatSize', () => splatSize);
    events.on('camera.setSplatSize', setSplatSize);

    // camera fly speed

    const setFlySpeed = (value: number) => {
        if (value !== scene.camera.flySpeed) {
            scene.camera.flySpeed = value;
            events.fire('camera.flySpeed', value);
        }
    };

    events.function('camera.flySpeed', () => scene.camera.flySpeed);
    events.on('camera.setFlySpeed', setFlySpeed);

    // view spherical harmonic bands

    let viewBands = scene.config.show.shBands;
    const setViewBands = (value: number) => {
        if (value !== viewBands) {
            viewBands = value;
            events.fire('view.bands', viewBands);
        }
    };

    events.function('view.bands', () => viewBands);
    events.on('view.setBands', setViewBands);

    // centers gaussian color toggle

    let centersUseGaussianColor = false;
    events.function('view.centersUseGaussianColor', () => centersUseGaussianColor);
    events.on('view.setCentersUseGaussianColor', (value: boolean) => {
        centersUseGaussianColor = value;
        events.fire('view.centersUseGaussianColor', value);
    });

    events.function('camera.getPose', () => {
        const camera = scene.camera;
        const position = camera.position;
        const focalPoint = camera.focalPoint;
        return {
            position: { x: position.x, y: position.y, z: position.z },
            target: { x: focalPoint.x, y: focalPoint.y, z: focalPoint.z },
            fov: camera.fov
        };
    });

    events.on('camera.setPose', (pose: { position: Vec3, target: Vec3, fov?: number }, speed = 1) => {
        if (pose.fov !== undefined) {
            events.fire('preferences.suspend');
            try {
                scene.camera.fov = pose.fov;
                events.fire('camera.fov', pose.fov);
            } finally {
                events.fire('preferences.resume');
            }
        }
        scene.camera.setPose(pose.position, pose.target, speed);
    });

    events.fire('camera.fov', scene.camera.fov);
    events.fire('camera.overlay', cameraOverlay);
    events.fire('view.bands', viewBands);
    events.fire('camera.showInfo', showInfo);
    // doc serialization

    events.function('docSerialize.view', () => {
        const packC = (c: Color) => [c.r, c.g, c.b, c.a];
        return {
            bgColor: packC(events.invoke('bgClr')),
            selectedColor: packC(events.invoke('selectedClr')),
            unselectedColor: packC(events.invoke('unselectedClr')),
            lockedColor: packC(events.invoke('lockedClr')),
            shBands: events.invoke('view.bands'),
            centersSize: events.invoke('camera.splatSize'),
            outlineSelection: events.invoke('view.outlineSelection'),
            showGrid: events.invoke('grid.visible'),
            gridPlane: events.invoke('grid.plane'),
            showBound: events.invoke('camera.bound'),
            showBoundDimensions: events.invoke('camera.boundDimensions'),
            showCameraPoses: events.invoke('camera.showPoses'),
            showCameraInfo: events.invoke('camera.showInfo'),
            flySpeed: events.invoke('camera.flySpeed'),
            fovDolly: events.invoke('camera.fovDolly')
        };
    });

    events.function('docDeserialize.view', (docView: any) => {
        events.fire('setBgClr', new Color(docView.bgColor));
        events.fire('setSelectedClr', new Color(docView.selectedColor));
        events.fire('setUnselectedClr', new Color(docView.unselectedColor));
        events.fire('setLockedClr', new Color(docView.lockedColor));
        events.fire('view.setBands', docView.shBands);
        events.fire('camera.setSplatSize', docView.centersSize);
        events.fire('view.setOutlineSelection', docView.outlineSelection);
        events.fire('grid.setVisible', docView.showGrid);
        events.fire('grid.setPlane', docView.gridPlane ?? 'xy');
        events.fire('camera.setBound', docView.showBound);
        events.fire('camera.setBoundDimensions', docView.showBoundDimensions ?? false);
        events.fire('camera.setShowPoses', docView.showCameraPoses ?? false);
        events.fire('camera.setShowInfo', docView.showCameraInfo ?? false);
        events.fire('camera.setFlySpeed', docView.flySpeed);
        events.fire('camera.setFovDolly', docView.fovDolly ?? false);
    });
};

const registerEditorFunctions = (events: Events) => {
    // camera mode (visual: centers/rings)
    let activeMode = 'centers';

    const setCameraMode = (mode: string) => {
        if (mode !== activeMode) {
            activeMode = mode;
            events.fire('camera.mode', activeMode);
        }
    };

    events.function('camera.mode', () => activeMode);
    events.on('camera.setMode', setCameraMode);
    events.on('camera.toggleMode', () => {
        setCameraMode(events.invoke('camera.mode') === 'centers' ? 'rings' : 'centers');
    });

    // selection controls

    let selectionUseDepth = false;
    let selectionFootprint = 0;
    let selectionCutDepth = 0;

    events.function('selection.useDepth', () => selectionUseDepth);
    events.function('selection.cutDepth', () => selectionCutDepth);

    events.on('selection.setUseDepth', (value: boolean) => {
        if (value !== selectionUseDepth) {
            selectionUseDepth = value;
            events.fire('selection.useDepth', value);
        }
    });

    events.on('selection.toggleUseDepth', () => {
        events.fire('selection.setUseDepth', !selectionUseDepth);
    });

    events.on('selection.setCutDepth', (value: number) => {
        const v = Math.max(0, value);
        if (v !== selectionCutDepth) {
            selectionCutDepth = v;
            events.fire('selection.cutDepth', v);
        }
    });

    events.on('selection.cutDepthSmaller', () => {
        events.fire('selection.adjustCutDepth', -250);
    });

    events.on('selection.cutDepthBigger', () => {
        events.fire('selection.adjustCutDepth', 250);
    });

    events.on('selection.adjustCutDepth', (delta: number) => {
        events.fire('selection.setCutDepth', selectionCutDepth + delta);
    });

    events.function('selection.footprint', () => selectionFootprint);

    events.on('selection.setFootprint', (value: number) => {
        if (value !== selectionFootprint) {
            selectionFootprint = value;
            events.fire('selection.footprint', value);
        }
    });

    events.on('selection.toggleFootprint', () => {
        events.fire('selection.setFootprint', selectionFootprint > 0 ? 0 : 1);
    });

    // outline selection

    let outlineSelection = false;

    events.function('view.outlineSelection', () => outlineSelection);
    events.on('view.setOutlineSelection', (value: boolean) => {
        if (value !== outlineSelection) {
            outlineSelection = value;
            events.fire('view.outlineSelection', value);
        }
    });
};

export { registerEditorFunctions, registerEditorEvents };