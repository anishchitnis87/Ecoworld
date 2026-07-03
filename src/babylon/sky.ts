/**
 * src/babylon/sky.ts
 * EcoWorld v4 — Cinematic sky with realistic Indian smog/aerosol deterioration.
 *
 * deterioration philosophy:
 *   - Thriving: clear deep blue
 *   - Healthy: light blue, minor haze
 *   - Struggling: washed-out milky blue (aerosol light scattering)
 *   - Critical: heavy tan-yellow smog (dust + aerosol mix, Delhi smog season)
 *   - Collapsed: oppressive brown-grey near-dark particulate
 */

import {
    Scene,
    Mesh,
    MeshBuilder,
    StandardMaterial,
    DynamicTexture,
    Layer,
    Color3,
    Color4,
    Vector3,
} from '@babylonjs/core';

import { lerp, lerpColor, clamp } from './engine';
import type { EngineRef } from './engine';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SkyRef {
    layer: Layer;
    sunMesh: Mesh;
    sunMat: StandardMaterial;
    sunHaloMesh: Mesh;
    sunHaloMat: StandardMaterial;
    tex: DynamicTexture;
}

interface SkyState {
    zenith: Color3;
    midSky: Color3;
    horizon: Color3;
    hazeBand: Color3;
    hazeOpacity: number;
    sunEmissive: Color3;
    sunScale: number;
    haloOpacity: number;
    haloColor: Color3;
}

// ─────────────────────────────────────────────
// Sky States (5 stops, healthT 0→1)
// ─────────────────────────────────────────────

const SKY_STATES: SkyState[] = [
    {   // THRIVING (0.00) — vivid clear Indian sky
        zenith: new Color3(0.15, 0.42, 0.92),
        midSky: new Color3(0.32, 0.60, 0.98),
        horizon: new Color3(0.62, 0.82, 0.98),
        hazeBand: new Color3(0.70, 0.88, 1.00),
        hazeOpacity: 0.0,
        sunEmissive: new Color3(1.00, 0.92, 0.68),
        sunScale: 1.0,
        haloOpacity: 0.22,
        haloColor: new Color3(1.00, 0.88, 0.55),
    },
    {   // HEALTHY (0.25) — light blue with minor haze
        zenith: new Color3(0.18, 0.45, 0.88),
        midSky: new Color3(0.34, 0.62, 0.94),
        horizon: new Color3(0.65, 0.82, 0.96),
        hazeBand: new Color3(0.78, 0.88, 0.95),
        hazeOpacity: 0.08,
        sunEmissive: new Color3(0.98, 0.88, 0.62),
        sunScale: 1.0,
        haloOpacity: 0.18,
        haloColor: new Color3(0.98, 0.85, 0.50),
    },
    {   // STRUGGLING (0.50) — milky washed-out blue, aerosol whitening
        zenith: new Color3(0.28, 0.48, 0.72),
        midSky: new Color3(0.50, 0.62, 0.75),
        horizon: new Color3(0.72, 0.72, 0.66),
        hazeBand: new Color3(0.82, 0.78, 0.64),
        hazeOpacity: 0.45,
        sunEmissive: new Color3(0.92, 0.84, 0.58),
        sunScale: 0.88,
        haloOpacity: 0.10,
        haloColor: new Color3(0.90, 0.80, 0.50),
    },
    {   // CRITICAL (0.75) — heavy pollution, dirty yellow-tan (Delhi smog look)
        zenith: new Color3(0.30, 0.36, 0.45),
        midSky: new Color3(0.48, 0.46, 0.38),
        horizon: new Color3(0.62, 0.55, 0.35),
        hazeBand: new Color3(0.60, 0.50, 0.28),
        hazeOpacity: 0.80,
        sunEmissive: new Color3(0.80, 0.68, 0.35),
        sunScale: 0.65,
        haloOpacity: 0.04,
        haloColor: new Color3(0.75, 0.60, 0.30),
    },
    {   // COLLAPSED (1.00) — near-dark, opaque particulate
        zenith: new Color3(0.10, 0.09, 0.07),
        midSky: new Color3(0.15, 0.12, 0.08),
        horizon: new Color3(0.20, 0.15, 0.08),
        hazeBand: new Color3(0.18, 0.13, 0.07),
        hazeOpacity: 1.0,
        sunEmissive: new Color3(0.28, 0.20, 0.08),
        sunScale: 0.45,
        haloOpacity: 0.0,
        haloColor: new Color3(0.25, 0.18, 0.08),
    },
];

// ─────────────────────────────────────────────
// Interpolation & Painting Helpers
// ─────────────────────────────────────────────

function sampleSkyRamp(healthT: number): SkyState {
    const n = SKY_STATES.length - 1;
    const s = clamp(healthT, 0, 1) * n;
    const lo = Math.min(Math.floor(s), n - 1);
    const t = s - lo;
    const a = SKY_STATES[lo];
    const b = SKY_STATES[lo + 1];
    return {
        zenith: lerpColor(a.zenith, b.zenith, t),
        midSky: lerpColor(a.midSky, b.midSky, t),
        horizon: lerpColor(a.horizon, b.horizon, t),
        hazeBand: lerpColor(a.hazeBand, b.hazeBand, t),
        hazeOpacity: lerp(a.hazeOpacity, b.hazeOpacity, t),
        sunEmissive: lerpColor(a.sunEmissive, b.sunEmissive, t),
        sunScale: lerp(a.sunScale, b.sunScale, t),
        haloOpacity: lerp(a.haloOpacity, b.haloOpacity, t),
        haloColor: lerpColor(a.haloColor, b.haloColor, t),
    };
}

function toCSS(c: Color3, alpha = 1): string {
    const r = Math.round(Math.min(c.r, 1) * 255);
    const g = Math.round(Math.min(c.g, 1) * 255);
    const b = Math.round(Math.min(c.b, 1) * 255);
    return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(2)})` : `rgb(${r},${g},${b})`;
}

const TEX_W = 4;
const TEX_H = 512;

function paintGradient(tex: DynamicTexture, state: SkyState): void {
    const ctx = tex.getContext() as CanvasRenderingContext2D;

    // Main sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0.00, toCSS(state.zenith));
    grad.addColorStop(0.40, toCSS(state.midSky));
    grad.addColorStop(0.70, toCSS(state.horizon));
    grad.addColorStop(1.00, toCSS(state.horizon));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // If hazeOpacity > 0.01: draw additional linear gradient over bottom 45% of canvas
    if (state.hazeOpacity > 0.01) {
        const hazeGrad = ctx.createLinearGradient(0, TEX_H * 0.55, 0, TEX_H);
        hazeGrad.addColorStop(0.0, toCSS(state.hazeBand, 0));
        hazeGrad.addColorStop(1.0, toCSS(state.hazeBand, state.hazeOpacity));
        ctx.fillStyle = hazeGrad;
        ctx.fillRect(0, TEX_H * 0.55, TEX_W, TEX_H * 0.45);
    }

    tex.update();
}

// ─────────────────────────────────────────────
// buildSky
// ─────────────────────────────────────────────

export function buildSky(scene: Scene): SkyRef {
    const tex = new DynamicTexture(
        'skyTex',
        { width: TEX_W, height: TEX_H },
        scene,
        false,
    );

    const layer = new Layer('skyLayer', null, scene, true);
    layer.texture = tex;
    layer.isBackground = true;

    const init = SKY_STATES[0];
    paintGradient(tex, init);

    // Update clearColor to match sky horizon — this is the fallback colour shown
    // in the rare gap before the background Layer draws. Never re-enable autoClear
    // here — engine.ts sets autoClear=false intentionally to prevent black flicker.
    scene.clearColor = new Color4(init.horizon.r, init.horizon.g, init.horizon.b, 1);

    // Sun disk: MeshBuilder.CreateSphere('sun', { diameter: 5, segments: 10 })
    const sunMesh = MeshBuilder.CreateSphere('sun', { diameter: 5, segments: 10 }, scene);
    sunMesh.isPickable = false;
    sunMesh.infiniteDistance = true;
    sunMesh.renderingGroupId = 0;

    const sunMat = new StandardMaterial('sunMat', scene);
    sunMat.emissiveColor = init.sunEmissive.clone();
    sunMat.disableLighting = true;
    sunMesh.material = sunMat;

    // Sun halo: MeshBuilder.CreateSphere('sunHalo', { diameter: 14, segments: 8 })
    const sunHaloMesh = MeshBuilder.CreateSphere('sunHalo', { diameter: 14, segments: 8 }, scene);
    sunHaloMesh.isPickable = false;
    sunHaloMesh.infiniteDistance = true;
    sunHaloMesh.renderingGroupId = 0;

    const sunHaloMat = new StandardMaterial('sunHaloMat', scene);
    sunHaloMat.emissiveColor = init.haloColor.clone();
    sunHaloMat.disableLighting = true;
    sunHaloMat.alpha = init.haloOpacity;
    sunHaloMesh.material = sunHaloMat;

    return { layer, sunMesh, sunMat, sunHaloMesh, sunHaloMat, tex };
}

// ─────────────────────────────────────────────
// updateSky
// ─────────────────────────────────────────────

export function updateSky(
    ref: SkyRef,
    healthT: number,
    scene: Scene,
    sunDirToSun: Vector3,
): void {
    const s = sampleSkyRamp(healthT);

    paintGradient(ref.tex, s);

    scene.clearColor = new Color4(s.horizon.r, s.horizon.g, s.horizon.b, 1);

    // Position sun mesh and halo mesh
    ref.sunMesh.position = sunDirToSun.scale(180);
    ref.sunHaloMesh.position = sunDirToSun.scale(180);

    // Apply scaling
    ref.sunMesh.scaling.setAll(s.sunScale);
    ref.sunHaloMesh.scaling.setAll(s.sunScale);

    // Apply colors and transparency
    ref.sunMat.emissiveColor.copyFrom(s.sunEmissive);
    ref.sunHaloMat.emissiveColor.copyFrom(s.haloColor);
    ref.sunHaloMat.alpha = s.haloOpacity;

    // Set visibility
    ref.sunMesh.isVisible = sunDirToSun.y > -0.08;
    ref.sunHaloMesh.isVisible = sunDirToSun.y > -0.08 && s.haloOpacity > 0.01;
}