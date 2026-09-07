import type { FileSystem, Writer } from '@playcanvas/splat-transform';
import { Color, Mat4, Quat, Vec3 } from 'playcanvas';

import {
    AddSplatOp,
    DeleteSelectionOp,
    EntityTransformOp,
    MultiOp,
    ResetOp,
    SetSplatColorAdjustmentOp,
    SplatsTransformOp,
    type EditOp
} from './edit-ops';
import { ElementType } from './element';
import { Events } from './events';
import { IndexRanges } from './index-ranges';
import { MappedReadFileSystem } from './io';
import { Scene } from './scene';
import { Splat } from './splat';
import { SerializeSettings, writeSplatFile } from './splat-serialize';
import { State } from './splat-state';

const MAGIC = 0x53534a31; // SSJ1
const COMMIT = 0x434d4954; // CMIT
const HEADER_SIZE = 24;
const IDLE_DELAY = 30_000;
const MAX_DELAY = 120_000;

type SourceInfo = {
    name: string;
    size: number;
    lastModified: number;
};

type PendingRecord = {
    meta: any;
    payloadSplat?: Splat;
    payloadData?: Uint8Array;
};

const nextFrame = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
});

const openHandleDb = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('supersplat-autosave', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const getStoredHandle = async (key: string): Promise<FileSystemFileHandle | undefined> => {
    const db = await openHandleDb();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('handles').objectStore('handles').get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
};

const storeHandle = async (key: string, handle: FileSystemFileHandle) => {
    const db = await openHandleDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const request = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
};

const sourceKey = (source: SourceInfo) => `${source.name}|${source.size}|${source.lastModified}`;

const journalHasChanges = async (file: File) => {
    if (file.size < HEADER_SIZE + 4) return false;
    const header = new DataView(await file.slice(0, HEADER_SIZE).arrayBuffer());
    if (header.getUint32(0, true) !== MAGIC) return false;
    const firstEnd = HEADER_SIZE + header.getUint32(8, true) + Number(header.getBigUint64(12, true)) + 4;
    return file.size > firstEnd;
};

class StreamPayloadWriter implements Writer {
    bytesWritten = 0;

    constructor(private stream: FileSystemWritableFileStream) {}

    async write(data: Uint8Array) {
        await this.stream.write(data as unknown as ArrayBuffer);
        this.bytesWritten += data.byteLength;
    }

    close() {}

    async abort() {
        // The journal transaction remains uncommitted and is ignored on recovery.
    }
}

class SingleWriterFs implements FileSystem {
    constructor(private writer: Writer) {}
    createWriter() {
        return this.writer;
    }
    mkdir() {
        return Promise.resolve();
    }
}

const transformJson = (splat: Splat) => ({
    position: splat.entity.getLocalPosition().toArray(),
    rotation: splat.entity.getLocalRotation().toArray(),
    scale: splat.entity.getLocalScale().toArray()
});

const colorJson = (splat: Splat) => ({
    tintClr: [splat.tintClr.r, splat.tintClr.g, splat.tintClr.b, splat.tintClr.a],
    temperature: splat.temperature,
    saturation: splat.saturation,
    brightness: splat.brightness,
    blackPoint: splat.blackPoint,
    whitePoint: splat.whitePoint,
    transparency: splat.transparency
});

const registerAutosaveJournal = (scene: Scene, events: Events) => {
    let source: SourceInfo | null = null;
    let baseSplat: Splat | null = null;
    let journalHandle: FileSystemFileHandle | null = null;
    let rememberedHandle: FileSystemFileHandle | null = null;
    let enabled = false;
    let restoring = false;
    let exporting = false;
    let sequence = 0;
    let idleTimer = 0;
    let maxTimer = 0;
    let flushing: Promise<void> | null = null;
    let captureChain = Promise.resolve();
    let pending: PendingRecord[] = [];
    let addedId = 1;
    const addedIds = new WeakMap<Splat, number>();
    const addedKnown = new WeakSet<Splat>();
    const restoredAdded = new Map<number, Splat>();

    const setStatus = (status: string) => events.fire('journal.status', status, enabled);
    const currentSplats = () => scene.getElementsByType(ElementType.splat) as Splat[];
    const ref = (splat: Splat) => (splat === baseSplat ? { base: true } : { added: addedIds.get(splat) });
    const resolveRef = (value: any) => (value?.base ? baseSplat : restoredAdded.get(value?.added));

    const clearTimers = () => {
        window.clearTimeout(idleTimer);
        window.clearTimeout(maxTimer);
        idleTimer = 0;
        maxTimer = 0;
    };

    const writeTransaction = async (stream: FileSystemWritableFileStream, record: PendingRecord, startOffset: number) => {
        const json = new TextEncoder().encode(JSON.stringify(record.meta));
        const headerOffset = startOffset;
        const header = new ArrayBuffer(HEADER_SIZE);
        const view = new DataView(header);
        view.setUint32(0, MAGIC, true);
        view.setUint32(4, 1, true);
        view.setUint32(8, json.byteLength, true);
        view.setBigUint64(12, 0n, true);
        view.setUint32(20, ++sequence, true);
        await stream.write(header);
        await stream.write(json);

        let payloadLength = 0;
        if (record.payloadData) {
            const chunkSize = 16 * 1024 * 1024;
            for (let offset = 0; offset < record.payloadData.byteLength; offset += chunkSize) {
                const chunk = record.payloadData.subarray(offset, Math.min(offset + chunkSize, record.payloadData.byteLength));
                await stream.write(chunk as unknown as ArrayBuffer);
                payloadLength += chunk.byteLength;
                await nextFrame();
            }
        } else if (record.payloadSplat) {
            const writer = new StreamPayloadWriter(stream);
            const fs = new SingleWriterFs(writer);
            const settings: SerializeSettings = { maxSHBands: 3, keepColorTint: true };
            await writeSplatFile([record.payloadSplat], settings, 'ply', 'added.ply', {}, fs);
            payloadLength = writer.bytesWritten;
        }

        const endOffset = headerOffset + HEADER_SIZE + json.byteLength + payloadLength;
        await stream.seek(headerOffset + 12);
        const length = new ArrayBuffer(8);
        new DataView(length).setBigUint64(0, BigInt(payloadLength), true);
        await stream.write(length);
        await stream.seek(endOffset);
        const commit = new ArrayBuffer(4);
        new DataView(commit).setUint32(0, COMMIT, true);
        await stream.write(commit);
        return endOffset + 4;
    };

    const flush = () => {
        clearTimers();
        if (!enabled || !journalHandle || pending.length === 0 || restoring) return;
        if (flushing) return flushing;

        const batch = pending;
        pending = [];
        flushing = (async () => {
            setStatus('saving');
            try {
                const file = await journalHandle.getFile();
                const stream = await journalHandle.createWritable({ keepExistingData: true });
                await stream.seek(file.size);
                let cursor = file.size;
                for (const record of batch) {
                    cursor = await writeTransaction(stream, record, cursor);
                    await nextFrame();
                }
                await stream.close();
                batch.forEach((record) => {
                    if (record.payloadSplat) record.payloadSplat.journalPayload = undefined;
                    record.payloadData = undefined;
                });
                setStatus('saved');
            } catch (error) {
                pending.unshift(...batch);
                setStatus('error');
                console.error('Autosave journal failed', error);
            } finally {
                flushing = null;
                if (pending.length) schedule();
            }
        })();
        return flushing;
    };

    function schedule() {
        if (!enabled || restoring || pending.length === 0) return;
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(flush, IDLE_DELAY);
        if (!maxTimer) maxTimer = window.setTimeout(flush, MAX_DELAY);
        setStatus('pending');
    }

    const queue = (record: PendingRecord) => {
        if (!enabled || restoring) return;
        pending.push(record);
        schedule();
    };

    const captureOne = async (op: EditOp, direction: 'do' | 'undo') => {
        if (op instanceof MultiOp) {
            for (const child of op.ops) await captureOne(child, direction);
        } else if (op instanceof DeleteSelectionOp || op instanceof ResetOp) {
            const splat = op.splat;
            const state = splat.state.data;
            let deleted = false;
            op.ranges.forEach((i) => {
                deleted ||= !!(state[i] & State.deleted);
            });
            queue({ meta: { type: 'deleted', splat: ref(splat), ranges: Array.from(op.ranges.data), deleted } });
        } else if (op instanceof EntityTransformOp) {
            queue({ meta: { type: 'entityTransform', splat: ref(op.splat), value: transformJson(op.splat) } });
        } else if (op instanceof SetSplatColorAdjustmentOp) {
            queue({ meta: { type: 'color', splat: ref(op.splat), value: colorJson(op.splat) } });
        } else if (op instanceof SplatsTransformOp) {
            const splat = op.splat;
            const matrix = op.transform.clone();
            if (direction === 'undo') matrix.invert();
            queue({ meta: { type: 'splatsTransform', splat: ref(splat), ranges: Array.from(op.ranges.data), matrix: Array.from(matrix.data) } });
        } else if (op instanceof AddSplatOp) {
            let id = addedIds.get(op.splat);
            const present = currentSplats().includes(op.splat);
            if (!id) {
                id = addedId++;
                addedIds.set(op.splat, id);
            }
            if (present) {
                if (addedKnown.has(op.splat)) {
                    queue({ meta: { type: 'restoreAdded', id } });
                } else {
                    addedKnown.add(op.splat);
                    queue({
                        meta: { type: 'add', id, filename: op.splat.filename },
                        payloadSplat: op.splat,
                        payloadData: op.splat.journalPayload
                    });
                }
            } else {
                queue({ meta: { type: 'removeAdded', id } });
            }
        }
    };

    events.on('edit.apply', (op: EditOp, direction: 'do' | 'undo') => {
        captureChain = captureChain.then(() => captureOne(op, direction)).catch((error) => {
            console.error('Unable to capture autosave operation', error);
            setStatus('error');
        });
    });

    const applyTransformToRanges = async (splat: Splat, ranges: IndexRanges, matrixData: number[]) => {
        const matrix = new Mat4();
        matrix.data.set(matrixData);
        const indices = splat.transformTexture.lock() as Uint16Array;
        const oldIndices = new Set<number>();
        ranges.forEach(i => oldIndices.add(indices[i]));
        const first = splat.transformPalette.alloc(oldIndices.size);
        const map = new Map<number, number>();
        let offset = 0;
        oldIndices.forEach(old => map.set(old, first + offset++));
        ranges.forEach((i) => {
            indices[i] = map.get(indices[i]);
        });
        splat.transformTexture.unlock();
        const current = new Mat4();
        map.forEach((next, old) => {
            splat.transformPalette.getTransform(old, current);
            current.mul2(matrix, current);
            splat.transformPalette.setTransform(next, current);
        });
        await splat.updatePositions();
    };

    const applyRecord = async (meta: any, payload?: Blob) => {
        if (meta.type === 'header') return;
        if (meta.type === 'add' && payload) {
            const fs = new MappedReadFileSystem();
            const filename = meta.filename || `journal-${meta.id}.ply`;
            fs.addFile(filename, payload);
            const splat = await scene.assetLoader.load(filename, fs);
            if (splat) {
                await scene.add(splat);
                restoredAdded.set(meta.id, splat);
                addedIds.set(splat, meta.id);
                addedId = Math.max(addedId, meta.id + 1);
            }
            return;
        }
        if (meta.type === 'removeAdded') {
            const splat = restoredAdded.get(meta.id);
            if (splat && currentSplats().includes(splat)) scene.remove(splat);
            return;
        }
        if (meta.type === 'restoreAdded') {
            const splat = restoredAdded.get(meta.id);
            if (splat && !currentSplats().includes(splat)) await scene.add(splat);
            return;
        }
        const splat = resolveRef(meta.splat);
        if (!splat) return;
        if (meta.type === 'deleted') {
            const ranges = IndexRanges.fromData(Uint32Array.from(meta.ranges));
            if (meta.deleted) splat.state.setBits(ranges, State.deleted);
            else splat.state.clearBits(ranges, State.deleted);
            await splat.updateState(State.deleted);
        } else if (meta.type === 'entityTransform') {
            const v = meta.value;
            splat.move(new Vec3(v.position), new Quat(v.rotation), new Vec3(v.scale));
        } else if (meta.type === 'color') {
            const v = meta.value;
            splat.tintClr = new Color(v.tintClr);
            splat.temperature = v.temperature;
            splat.saturation = v.saturation;
            splat.brightness = v.brightness;
            splat.blackPoint = v.blackPoint;
            splat.whitePoint = v.whitePoint;
            splat.transparency = v.transparency;
        } else if (meta.type === 'splatsTransform') {
            await applyTransformToRanges(splat, IndexRanges.fromData(Uint32Array.from(meta.ranges)), meta.matrix);
        }
    };

    const restore = async (handle: FileSystemFileHandle) => {
        const file = await handle.getFile();
        let offset = 0;
        restoring = true;
        setStatus('restoring');
        try {
            while (offset + HEADER_SIZE + 4 <= file.size) {
                const header = new DataView(await file.slice(offset, offset + HEADER_SIZE).arrayBuffer());
                if (header.getUint32(0, true) !== MAGIC || header.getUint32(4, true) !== 1) break;
                const jsonLength = header.getUint32(8, true);
                const payloadLength = Number(header.getBigUint64(12, true));
                sequence = Math.max(sequence, header.getUint32(20, true));
                const jsonStart = offset + HEADER_SIZE;
                const payloadStart = jsonStart + jsonLength;
                const commitOffset = payloadStart + payloadLength;
                if (commitOffset + 4 > file.size) break;
                const commit = new DataView(await file.slice(commitOffset, commitOffset + 4).arrayBuffer()).getUint32(0, true);
                if (commit !== COMMIT) break;
                const meta = JSON.parse(await file.slice(jsonStart, payloadStart).text());
                if (meta.type === 'header') {
                    const expected = JSON.stringify(source);
                    if (JSON.stringify(meta.source) !== expected) throw new Error('Journal does not match the opened PLY');
                }
                const payload = payloadLength ? file.slice(payloadStart, commitOffset) : undefined;
                await applyRecord(meta, payload);
                offset = commitOffset + 4;
                await nextFrame();
            }
            setStatus('saved');
        } finally {
            restoring = false;
        }
    };

    const initializeHandle = async (handle: FileSystemFileHandle, truncate: boolean) => {
        journalHandle = handle;
        if (truncate) {
            const stream = await handle.createWritable();
            await writeTransaction(stream, { meta: { type: 'header', source } }, 0);
            await stream.close();
        }
        enabled = true;
        await storeHandle(sourceKey(source), handle);
        setStatus('saved');
    };

    events.function('journal.configure', async () => {
        if (!source || !window.showSaveFilePicker) return;
        try {
            if (rememberedHandle) {
                const permission = await rememberedHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    const file = await rememberedHandle.getFile();
                    if (await journalHasChanges(file)) {
                        const result = await events.invoke('showPopup', {
                            type: 'yesno',
                            header: 'Autosave journal',
                            message: 'A journal was found for this PLY. Restore autosaved changes?'
                        });
                        if (result.action === 'yes') await restore(rememberedHandle);
                    }
                    await initializeHandle(rememberedHandle, false);
                    return;
                }
            }
            const handle = await window.showSaveFilePicker({
                id: 'SuperSplatAutosaveJournal',
                suggestedName: `${source.name}.journal`,
                types: [{ description: 'SuperSplat Journal', accept: { 'application/octet-stream': ['.journal'] } }]
            });
            await initializeHandle(handle, true);
        } catch (error) {
            if (error.name !== 'AbortError') console.error(error);
        }
    });

    events.function('journal.sourceLoaded', async (splat: Splat, info: SourceInfo) => {
        clearTimers();
        pending = [];
        source = info;
        baseSplat = splat;
        journalHandle = null;
        rememberedHandle = null;
        enabled = false;
        sequence = 0;
        setStatus('disabled');
        try {
            const handle = await getStoredHandle(sourceKey(source));
            if (!handle) return;
            rememberedHandle = handle;
            const permission = await handle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') return;
            const file = await handle.getFile();
            if (await journalHasChanges(file)) {
                const result = await events.invoke('showPopup', {
                    type: 'yesno',
                    header: 'Autosave journal',
                    message: 'A journal was found for this PLY. Restore autosaved changes?'
                });
                if (result.action === 'yes') await restore(handle);
            }
            await initializeHandle(handle, false);
        } catch (error) {
            console.error('Unable to open autosave journal', error);
            setStatus('error');
        }
    });

    events.function('journal.flush', async () => {
        await captureChain;
        await flush();
    });
    events.function('journal.enabled', () => enabled);
    events.function('editing.blocked', () => exporting || restoring);
    events.on('journal.setExporting', (value: boolean) => {
        exporting = value;
        events.fire('editing.blocked', exporting || restoring);
    });
};

export { registerAutosaveJournal };
