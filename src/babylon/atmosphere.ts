/**
 * src/babylon/atmosphere.ts — EcoWorld v4 ENHANCED
 *
 * Environmental atmosphere driven by health/air score.
 * 
 * ADDITIONS (Bug 32):
 *  - Fog wall cylinder (radius=65, height=20) — inward-facing gradient that
 *    hides terrain edges by fading from opaque at bottom to transparent at top.
 *    Color syncs with scene.fogColor based on health state.
 *  - 4 backdrop hill silhouettes at r=60-70 beyond terrain edge — low-poly
 *    dome shapes that give illusion of infinite world extending into the haze.
 *
 * React + Vite + Babylon.js 7.
 * TypeScript strict mode. No 'any'. Complete file, zero truncation.
 */

import {
    Scene,
    ParticleSystem,
    Mesh,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Color4,
    Vector3,
    Texture,
    TransformNode,
} from '@babylonjs/core';
import { lerp, clamp } from './engine';
import type { SeedStage } from '@/types';

// ─── EXPORTS REQUIRED ────────────────────────────────────────────────────────

export interface AtmosphereRef {
    smogSystem: ParticleSystem;
    dustSystem: ParticleSystem;
    shimmerMesh: Mesh;
    fogWall: Mesh;
    backdropHills: Mesh[];
}

// ─── BANYAN SEED GROWTH ───────────────────────────────────────────────────────
// FIX: was 'ORB' — backend sends "GLOWING_ORB" (EcoZoneService.deriveSeedStage).
// Must match SeedStage in @/types and SEED_EMOJI in components/TopBar.tsx.
const BANYAN_SCALES: Record<SeedStage, number> = {
    NONE:             0.08,
    GLOWING_ORB:      0.18,
    SAPLING:          0.35,
    YOUNG_TREE:       0.58,
    GUARDIAN_TREE:    0.82,
    ANCIENT_GUARDIAN: 1.00,
};
let _banyanNode:     TransformNode | null = null;
let _targetScale     = 0.08;
let _currentScale    = 0.08;

export function setTargetSeedStage(stage: SeedStage): void {
    _targetScale = BANYAN_SCALES[stage] ?? 0.08;
}


// ─── BUILD FOG WALL ──────────────────────────────────────────────────────────
// Large inward-facing cylinder at terrain edges. Opaque at bottom, transparent
// at top — hides the hard terrain edge and gives illusion of infinite haze.

function buildFogWall(scene: Scene): Mesh {
    const fogWall = MeshBuilder.CreateCylinder('fogWall', {
        diameterTop: 130,
        diameterBottom: 130,
        height: 20,
        tessellation: 48,
        sideOrientation: Mesh.BACKSIDE,  // render INWARD facing
    }, scene);
    fogWall.position.y = 5;  // centered vertically around terrain
    fogWall.renderingGroupId = 3;
    fogWall.isPickable = false;

    const fogMat = new StandardMaterial('fogWallMat', scene);
    fogMat.disableLighting = true;
    fogMat.backFaceCulling = false;
    // Start with the healthy fog color — synced with scene.fogColor
    fogMat.emissiveColor = new Color3(0.55, 0.75, 0.92);
    fogMat.diffuseColor = new Color3(0, 0, 0);
    fogMat.specularColor = new Color3(0, 0, 0);
    fogMat.alpha = 0.65;  // semi-transparent overall — the gradient comes from vertex alpha
    fogWall.material = fogMat;

    // Apply vertex alpha gradient: opaque at bottom, transparent at top
    const positions = fogWall.getVerticesData('position');
    if (positions) {
        const vertexCount = positions.length / 3;
        const colors = new Float32Array(vertexCount * 4);

        for (let i = 0; i < vertexCount; i++) {
            const y = positions[i * 3 + 1]; // local Y coordinate
            // Normalise y from [-10, 10] to [0, 1] (bottom to top)
            const normalizedY = clamp((y + 10) / 20, 0, 1);
            // Bottom = opaque (alpha=1), Top = transparent (alpha=0)
            const alpha = 1.0 - normalizedY * normalizedY;  // quadratic falloff

            colors[i * 4 + 0] = 1.0; // R
            colors[i * 4 + 1] = 1.0; // G
            colors[i * 4 + 2] = 1.0; // B
            colors[i * 4 + 3] = alpha;
        }

        fogWall.setVerticesData('color', colors, true);
        fogWall.useVertexColors = true;
        fogWall.hasVertexAlpha = true;
        fogMat.needAlphaBlending = () => true;
    }

    return fogWall;
}

// ─── BUILD BACKDROP HILLS ────────────────────────────────────────────────────
// 4 large low-poly hill shapes at r=60-70 beyond terrain edge.
// These distant silhouettes make the world look infinite.

function buildBackdropHills(scene: Scene): Mesh[] {
    const hills: Mesh[] = [];

    const hillConfigs = [
        { angle: 0.4,   radius: 65, scaleX: 18, scaleY: 4.5, scaleZ: 12 },
        { angle: 1.8,   radius: 68, scaleX: 22, scaleY: 5.8, scaleZ: 15 },
        { angle: 3.2,   radius: 62, scaleX: 20, scaleY: 3.8, scaleZ: 14 },
        { angle: 4.8,   radius: 70, scaleX: 16, scaleY: 6.2, scaleZ: 11 },
    ];

    const hillMat = new StandardMaterial('hillMat', scene);
    hillMat.diffuseColor = new Color3(0.25, 0.32, 0.22);
    hillMat.specularColor = new Color3(0, 0, 0);
    hillMat.ambientColor = new Color3(0.12, 0.16, 0.10);
    hillMat.emissiveColor = new Color3(0.04, 0.06, 0.04);
    // Hills should look hazy/distant
    hillMat.alpha = 0.55;

    for (let i = 0; i < hillConfigs.length; i++) {
        const cfg = hillConfigs[i];
        const hill = MeshBuilder.CreateSphere(`backdropHill_${i}`, {
            diameter: 2.0,
            segments: 6,  // low-poly for silhouette look
        }, scene);

        hill.scaling.set(cfg.scaleX, cfg.scaleY, cfg.scaleZ);
        hill.position.set(
            Math.cos(cfg.angle) * cfg.radius,
            -1.5,  // base sits below terrain for natural blending
            Math.sin(cfg.angle) * cfg.radius,
        );
        hill.material = hillMat;
        hill.renderingGroupId = 1;
        hill.isPickable = false;
        hill.receiveShadows = false;

        hills.push(hill);
    }

    return hills;
}


// ─── BUILD ATMOSPHERE ────────────────────────────────────────────────────────

export function buildAtmosphere(scene: Scene, banyanNode: TransformNode): AtmosphereRef {
    _banyanNode   = banyanNode;
    _currentScale = _targetScale; // snap on load

    // ── SYSTEM 1 — SMOG PARTICLE SYSTEM ──────────────────────────────────────
    // FIX: capacity was 1800. This is a CPU-simulated ParticleSystem (not
    // GPU-accelerated), and it scales UP specifically as the zone's health
    // *degrades* — which happens automatically via nightly decay whenever
    // eco actions stop being logged. A zone that looks fine today can drift
    // into "smoggy" territory a few days later purely from inactivity,
    // silently loading up to 1800 alpha-blended, depth-sorted particles
    // that weren't there during an earlier test on a healthier zone.
    // Capped to a ceiling that's still visually smoggy but far cheaper.
    const smogSystem = new ParticleSystem('smog', 700, scene);
    smogSystem.emitter = new Vector3(0, 8, 0);

    // Box emitter with custom bounds
    smogSystem.createBoxEmitter(
        new Vector3(-0.5, 0.5, -0.5),
        new Vector3(0.5, 1.0, 0.5),
        new Vector3(-50, 0, -50),
        new Vector3(50, 6, 50)
    );

    // Particle texture from white circle data URI
    const tex = new Texture(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAUUlEQVR42mNgGAWjgP///wEAAAD//wMA+0ABCTqAAAAAAElFTkSuQmCC',
        scene
    );
    smogSystem.particleTexture = tex;

    smogSystem.minSize = 0.8;
    smogSystem.maxSize = 2.2;
    smogSystem.minLifeTime = 8;
    smogSystem.maxLifeTime = 14;
    smogSystem.minEmitPower = 0.06;
    smogSystem.maxEmitPower = 0.20;
    smogSystem.gravity = new Vector3(0, 0.015, 0); // slight upward drift
    smogSystem.emitRate = 0; // Starts at 0 (no smog when healthy)

    // Smog Color Ramp: brownish grey, transparent
    smogSystem.color1 = new Color4(0.35, 0.30, 0.22, 0.0);
    smogSystem.color2 = new Color4(0.28, 0.24, 0.18, 0.0);
    smogSystem.colorDead = new Color4(0.20, 0.16, 0.12, 0.0);

    smogSystem.start();

    // ── SYSTEM 2 — DUST/ASH PARTICLES ───────────────────────────────────────
    // FIX: capacity was 600 — same reasoning as smogSystem above.
    const dustSystem = new ParticleSystem('dust', 280, scene);
    dustSystem.emitter = new Vector3(0, 1, 0);

    // Box emitter with custom bounds
    dustSystem.createBoxEmitter(
        new Vector3(-0.5, 0.5, -0.5),
        new Vector3(0.5, 1.0, 0.5),
        new Vector3(-40, 0, -40),
        new Vector3(40, 0.5, 40)
    );

    dustSystem.particleTexture = tex;
    dustSystem.minSize = 0.08;
    dustSystem.maxSize = 0.22;
    dustSystem.minLifeTime = 4;
    dustSystem.maxLifeTime = 9;
    dustSystem.minEmitPower = 0.3;
    dustSystem.maxEmitPower = 0.8;
    dustSystem.gravity = new Vector3(0.02, 0.05, 0.01); // drift upward + sideways
    dustSystem.emitRate = 0; // Starts at 0

    // Sandy tan dust colors
    dustSystem.color1 = new Color4(0.55, 0.48, 0.35, 0.0);
    dustSystem.color2 = new Color4(0.45, 0.38, 0.28, 0.0);
    dustSystem.colorDead = new Color4(0.35, 0.28, 0.20, 0.0);

    dustSystem.start();

    // ── SYSTEM 3 — HEAT SHIMMER PLANE ───────────────────────────────────────
    const shimmerMesh = MeshBuilder.CreateGround('shimmer', { width: 80, height: 80, subdivisions: 2 }, scene);
    shimmerMesh.position.y = 0.05;
    shimmerMesh.renderingGroupId = 3;
    shimmerMesh.isPickable = false;

    const shimmerMat = new StandardMaterial('shimmerMat', scene);
    shimmerMat.alpha = 0.0; // starts invisible
    shimmerMat.wireframe = false;
    shimmerMat.emissiveColor = new Color3(0.55, 0.48, 0.35);
    shimmerMat.disableLighting = true;
    shimmerMat.backFaceCulling = false;
    shimmerMesh.material = shimmerMat;

    // ── SYSTEM 4 — FOG WALL (Bug 32) ────────────────────────────────────────
    const fogWall = buildFogWall(scene);

    // ── SYSTEM 5 — BACKDROP HILLS (Bug 32) ──────────────────────────────────
    const backdropHills = buildBackdropHills(scene);

    return {
        smogSystem,
        dustSystem,
        shimmerMesh,
        fogWall,
        backdropHills,
    };
}

// ─── UPDATE ATMOSPHERE ───────────────────────────────────────────────────────

export function updateAtmosphere(ref: AtmosphereRef, healthT: number, worldTime: number): void {
    const hT = clamp(healthT, 0, 1);

    // ── SYSTEM 1 — SMOG UPDATE ───────────────────────────────────────────────
    if (hT < 0.45) {
        ref.smogSystem.emitRate = 0;
        ref.smogSystem.color1.a = 0.0;
        ref.smogSystem.color2.a = 0.0;
        ref.smogSystem.colorDead.a = 0.0;
    } else {
        const progress = (hT - 0.45) / 0.55;
        ref.smogSystem.emitRate = Math.round(progress * 700); // was 1800 — see capacity note in buildAtmosphere
        const particleAlpha = progress * 0.22;
        ref.smogSystem.color1.a = particleAlpha;
        ref.smogSystem.color2.a = particleAlpha;
        ref.smogSystem.colorDead.a = 0.0;
    }

    // ── SYSTEM 2 — DUST UPDATE ───────────────────────────────────────────────
    if (hT < 0.70) {
        ref.dustSystem.emitRate = 0;
        ref.dustSystem.color1.a = 0.0;
        ref.dustSystem.color2.a = 0.0;
        ref.dustSystem.colorDead.a = 0.0;
    } else {
        const dustProgress = (hT - 0.70) / 0.30;
        ref.dustSystem.emitRate = Math.round(dustProgress * 140); // was 180 — see capacity note in buildAtmosphere
        const dustAlpha = dustProgress * 0.55;
        ref.dustSystem.color1.a = dustAlpha;
        ref.dustSystem.color2.a = dustAlpha;
        ref.dustSystem.colorDead.a = 0.0;
    }

    // ── SYSTEM 3 — HEAT SHIMMER UPDATE ───────────────────────────────────────
    const shimmerMat = ref.shimmerMesh.material as StandardMaterial;
    if (shimmerMat) {
        if (hT < 0.75) {
            shimmerMat.alpha = 0.0;
        } else {
            const shimmerProgress = (hT - 0.75) / 0.25;
            const base = shimmerProgress * 0.06;
            const flicker = Math.sin(worldTime * 11.0) * Math.sin(worldTime * 8.3) * 0.018;
            shimmerMat.alpha = Math.max(0, base + flicker * shimmerProgress);
        }
    }

    // ── SYSTEM 4 — FOG WALL UPDATE (Bug 32) ─────────────────────────────────
    // Sync fog wall color with scene fog color (which changes with health)
    const fogWallMat = ref.fogWall.material as StandardMaterial;
    if (fogWallMat) {
        // 5-stop fog color ramp matching engine.ts
        const FOG_COLORS = [
            new Color3(0.55, 0.75, 0.92),  // THRIVING
            new Color3(0.52, 0.70, 0.85),  // HEALTHY
            new Color3(0.48, 0.46, 0.40),  // STRUGGLING
            new Color3(0.42, 0.30, 0.14),  // CRITICAL
            new Color3(0.12, 0.08, 0.04),  // COLLAPSED
        ];

        const n = FOG_COLORS.length - 1;
        const s = clamp(hT, 0, 1) * n;
        const lo = Math.min(Math.floor(s), n - 1);
        const fr = s - lo;
        const fogCol = new Color3(
            lerp(FOG_COLORS[lo].r, FOG_COLORS[lo + 1].r, fr),
            lerp(FOG_COLORS[lo].g, FOG_COLORS[lo + 1].g, fr),
            lerp(FOG_COLORS[lo].b, FOG_COLORS[lo + 1].b, fr),
        );

        fogWallMat.emissiveColor = fogCol;
        // Fog wall becomes more opaque as health degrades — smog closes in
        fogWallMat.alpha = lerp(0.45, 0.85, hT);
    }

    // ── SYSTEM 5 — BACKDROP HILLS UPDATE ─────────────────────────────────────
    // Hills get darker/hazier as health degrades
    if (ref.backdropHills.length > 0) {
        const hillMat = ref.backdropHills[0].material as StandardMaterial;
        if (hillMat) {
            // From green-ish to dark brown as health degrades
            const hillR = lerp(0.25, 0.12, hT);
            const hillG = lerp(0.32, 0.10, hT);
            const hillB = lerp(0.22, 0.06, hT);
            hillMat.diffuseColor.set(hillR, hillG, hillB);
            hillMat.emissiveColor.set(hillR * 0.15, hillG * 0.15, hillB * 0.15);
            // Hills fade more into haze as world degrades
            hillMat.alpha = lerp(0.55, 0.25, hT);
        }
    }

    // ── BANYAN SEED GROWTH ────────────────────────────────────────────────────
    _currentScale = lerp(_currentScale, _targetScale, 0.018);
    if (_banyanNode) {
        _banyanNode.scaling.setAll(_currentScale);
    }

}