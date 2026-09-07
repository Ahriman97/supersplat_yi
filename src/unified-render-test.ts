import { Entity, MeshInstance } from 'playcanvas';

import { Element, ElementType } from './element';
import type { Scene } from './scene';
import { Splat } from './splat';

const editorModifier = /* glsl */`
uniform sampler2D editorSplatState;
uniform highp usampler2D editorSplatTransform;
uniform sampler2D editorTransformPalette;
uniform vec4 editorClrScale;
uniform vec3 editorClrOffset;
uniform float editorSaturation;
uniform vec4 editorSelectedClr;
uniform vec4 editorLockedClr;
uniform float editorTransparentLocked;

mat4 editorPaletteTransform() {
    uint index = texelFetch(editorSplatTransform, splat.uv, 0).r;
    if (index == 0u) return mat4(1.0);
    int u = int(index % 512u) * 3;
    int v = int(index / 512u);
    mat4 t;
    t[0] = texelFetch(editorTransformPalette, ivec2(u, v), 0);
    t[1] = texelFetch(editorTransformPalette, ivec2(u + 1, v), 0);
    t[2] = texelFetch(editorTransformPalette, ivec2(u + 2, v), 0);
    t[3] = vec4(0.0, 0.0, 0.0, 1.0);
    return transpose(t);
}

vec4 editorQuatMul(vec4 a, vec4 b) {
    return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}

vec4 editorQuatFromMat3(mat3 m) {
    float trace = m[0][0] + m[1][1] + m[2][2];
    vec4 q;
    if (trace > 0.0) {
        float s = sqrt(trace + 1.0) * 2.0;
        q = vec4((m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s);
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
        float s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
        q = vec4(0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s);
    } else if (m[1][1] > m[2][2]) {
        float s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
        q = vec4((m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s);
    } else {
        float s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
        q = vec4((m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s);
    }
    return normalize(q);
}

void modifySplatCenter(inout vec3 center) {
    center = (editorPaletteTransform() * vec4(center, 1.0)).xyz;
}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    mat3 t = mat3(editorPaletteTransform());
    vec3 s = vec3(length(t[0]), length(t[1]), length(t[2]));
    if (all(greaterThan(s, vec3(1e-8)))) {
        rotation = editorQuatMul(editorQuatFromMat3(mat3(t[0] / s.x, t[1] / s.y, t[2] / s.z)), rotation);
        scale *= s;
    }
}

void modifySplatColor(vec3 center, inout vec4 color) {
    uint state = uint(texelFetch(editorSplatState, splat.uv, 0).r * 255.0 + 0.5) & 7u;
    if ((state & 4u) != 0u) { color.a = 0.0; return; }
    color = color * editorClrScale + vec4(editorClrOffset, 0.0);
    vec3 grey = vec3(dot(color.rgb, vec3(0.299, 0.587, 0.114)));
    color.rgb = grey + (color.rgb - grey) * editorSaturation;
    if ((state & 2u) != 0u) {
        color *= editorLockedClr;
        if (editorTransparentLocked > 0.5) color.a = 0.0;
    } else if ((state & 1u) != 0u) {
        color.rgb = mix(color.rgb, editorSelectedClr.rgb, editorSelectedClr.a);
    }
    color.a = clamp(color.a, 0.0, 1.0);
}
`;

type TestEntry = {
    splat: Splat;
    display: Entity;
    original: MeshInstance;
};

// Renders every open splat object through PlayCanvas' shared work buffer so
// their depth order is resolved globally instead of one object at a time.
class UnifiedRenderTest {
    private entries: TestEntry[] = [];
    private active = false;
    private enabled = false;

    constructor(private scene: Scene) {
        const startEnabled = new URL(location.href).searchParams.get('unifiedTest') === '1';
        scene.events.function('view.unifiedSplats', () => this.enabled);
        scene.events.on('view.setUnifiedSplats', (value: boolean) => this.setEnabled(value));
        scene.events.on('scene.elementAdded', (element: Element) => {
            if (this.enabled && element.type === ElementType.splat) {
                // A new placement needs one complete frame before it can
                // replace the editor meshes without producing a blank frame.
                this.active = false;
                this.entries.forEach((entry) => {
                    entry.original.visible = true;
                });
                this.attach(element as Splat);
            }
        });
        scene.events.on('scene.elementRemoved', (element: Element) => {
            if (element.type === ElementType.splat) this.detach(element as Splat);
        });
        scene.events.on('splat.replaced', (splat: Splat) => {
            if (this.enabled) {
                this.detach(splat);
                this.active = false;
                this.attach(splat);
            }
        });
        scene.events.on('prerender', () => this.syncTransforms());
        ['splat.stateChanged', 'splat.positionsChanged', 'splat.tintClr', 'splat.temperature',
            'splat.saturation', 'splat.brightness', 'splat.blackPoint', 'splat.whitePoint',
            'splat.transparency'].forEach((name) => {
            scene.events.on(name, (splat: Splat) => this.markDirty(splat));
        });
        scene.events.on('selection.changed', () => this.entries.forEach(entry => this.markDirty(entry.splat)));
        scene.events.on('view.transparentLocked', () => this.entries.forEach(entry => this.markDirty(entry.splat)));

        const gsplatSystem = (scene.app.systems as any).gsplat;
        gsplatSystem?.on('frame:ready', (
            _camera: unknown,
            layer: unknown,
            ready: boolean,
            loadingCount: number
        ) => {
            if (!this.active && layer === scene.worldLayer && ready && loadingCount === 0 && this.entries.length > 0) {
                this.active = true;
                this.entries.forEach((entry) => {
                    entry.original.visible = false;
                });
                scene.forceRender = true;
            }
        });

        if (startEnabled) this.setEnabled(true);
    }

    private setEnabled(value: boolean) {
        if (value === this.enabled) return;
        this.enabled = value;
        this.active = false;
        if (value) {
            (this.scene.getElementsByType(ElementType.splat) as Splat[]).forEach(splat => this.attach(splat));
        } else {
            [...this.entries].forEach(entry => this.detach(entry.splat));
        }
        this.scene.forceRender = true;
        this.scene.events.fire('view.unifiedSplats', this.enabled);
    }

    private attach(splat: Splat) {
        if (this.entries.some(entry => entry.splat === splat)) return;
        const display = new Entity('unifiedRenderTest');
        display.addComponent('gsplat', { asset: splat.asset, unified: true });
        // The editor's Splat layer uses a custom two-target MRT shader contract.
        // Built-in unified materials target a normal color pass, so test them in
        // the regular World layer instead.
        display.gsplat.layers = [this.scene.worldLayer.id];
        display.gsplat.setWorkBufferModifier({ glsl: editorModifier });
        // Parent directly under the editor splat. This guarantees the unified
        // placement inherits the exact same Z-up/world transform instead of
        // receiving a copied transform after registration with the manager.
        splat.entity.addChild(display);
        this.entries.push({
            splat,
            display,
            original: splat.entity.gsplat.instance.meshInstance
        });
        this.updateParameters(splat);
        this.syncTransforms();
    }

    private detach(splat: Splat) {
        const index = this.entries.findIndex(entry => entry.splat === splat);
        if (index === -1) return;
        const [entry] = this.entries.splice(index, 1);
        entry.original.visible = true;
        entry.display.destroy();
    }

    private syncTransforms() {
        this.entries.forEach(({ splat, display }) => {
            display.enabled = splat.visible;
        });
    }

    private updateParameters(splat: Splat) {
        const entry = this.entries.find(item => item.splat === splat);
        if (!entry) return;
        const component = entry.display.gsplat;
        const events = this.scene.events;
        const selectedClr = events.invoke('selectedClr');
        const lockedClr = events.invoke('lockedClr');
        const selected = events.invoke('selection') === splat;
        const offset = -splat.blackPoint + splat.brightness;
        const scale = 1 / (splat.whitePoint - splat.blackPoint);
        component.setParameter('editorSplatState', splat.stateTexture);
        component.setParameter('editorSplatTransform', splat.transformTexture);
        component.setParameter('editorTransformPalette', splat.transformPalette.texture);
        component.setParameter('editorClrOffset', [offset, offset, offset]);
        component.setParameter('editorClrScale', [
            scale * splat.tintClr.r * (1 + splat.temperature), scale * splat.tintClr.g,
            scale * splat.tintClr.b * (1 - splat.temperature), splat.transparency
        ]);
        component.setParameter('editorSaturation', splat.saturation);
        component.setParameter('editorSelectedClr', selected ?
            [selectedClr.r, selectedClr.g, selectedClr.b, selectedClr.a] : [0, 0, 0, 0]);
        component.setParameter('editorLockedClr', [lockedClr.r, lockedClr.g, lockedClr.b, lockedClr.a]);
        component.setParameter('editorTransparentLocked', events.invoke('view.transparentLocked') ? 1 : 0);
    }

    private markDirty(splat: Splat) {
        const entry = this.entries.find(item => item.splat === splat);
        if (!entry) return;
        this.updateParameters(splat);
        (entry.display.gsplat as any)._placement?.markDirty();
        this.scene.forceRender = true;
    }

    beginLegacyPick(splat: Splat) {
        if (!this.enabled || !this.active) return;
        this.entries.forEach((entry) => {
            entry.original.visible = entry.splat === splat;
        });
    }

    endLegacyPick() {
        if (!this.enabled || !this.active) return;
        this.entries.forEach((entry) => {
            entry.original.visible = false;
        });
        this.scene.forceRender = true;
    }
}

export { UnifiedRenderTest };
