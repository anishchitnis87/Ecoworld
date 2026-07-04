/**
 * src/babylon/engine.ts — EcoWorld v4
 *
 * BLACK BOX FLICKER ROOT CAUSE & FIX:
 *  The flicker is caused by scene.autoClear=true flushing the canvas to
 *  clearColor (black) at the START of every frame, BEFORE the sky Layer has
 *  drawn. On slower frames this black flush is visible for 1–3 ms = visible
 *  black box flash.
 *
 *  Fix strategy (3-layer defence):
 *  1. scene.autoClear = false — the engine NEVER clears on its own.
 *  2. scene.setRenderingAutoClearDepthStencil(0, true, true, true) — group 0
 *     (sky Layer + sun meshes) performs the ONLY clear. Since the sky Layer
 *     draws first, the very first pixel written to canvas is sky colour, never
 *     black.
 *  3. Groups 1–3 (terrain, water, grass, character, particles) composite ON
 *     TOP with autoClear=false, so they never race against the sky.
 *  4. engine.runRenderLoop is NOT called here — App.tsx starts it INSIDE
 *     scene.executeWhenReady() so the very first rendered frame already has
 *     all meshes built. Zero black pre-scene frames.
 *  5. PostProcess pipeline uses samples=1 (disables MSAA) — Babylon 7 MSAA
 *     re-creates framebuffers mid-frame and can cause a clear glitch.
 */

import {
    Engine,
    Scene,
    ArcRotateCamera,
    DirectionalLight,
    HemisphericLight,
    ShadowGenerator,
    Color3,
    Color4,
    Vector3,
} from '@babylonjs/core';

// ─── Math helpers ────────────────────────────────────────────────────────────

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function clamp(v: number, mn: number, mx: number): number {
    return Math.max(mn, Math.min(mx, v));
}

export function lerpColor(a: Color3, b: Color3, t: number): Color3 {
    return new Color3(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
}

export function smoothstep(e0: number, e1: number, x: number): number {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return (): number => {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ─── EngineRef ───────────────────────────────────────────────────────────────

export interface EngineRef {
    engine:  Engine;
    scene:   Scene;
    camera:  ArcRotateCamera;
    sun:     DirectionalLight;
    amb:     HemisphericLight;
    shadows: ShadowGenerator;
}

// ─── initEngine ──────────────────────────────────────────────────────────────

export function initEngine(canvas: HTMLCanvasElement): EngineRef {

    const engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil:               true,
        adaptToDeviceRatio:    true,
        antialias:             true,
    });

    // Scale down on high-DPI screens so the GPU isn't overloaded
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

    const scene = new Scene(engine);

    // ── ANTI-FLICKER CORE ────────────────────────────────────────────────────
    // Never let Babylon auto-clear to the black clearColor.
    // Rendering group 0 (sky) is the ONLY one that clears, and it draws first.
    scene.autoClear                = false;
    scene.autoClearDepthAndStencil = false;

    // Fallback colour — should never be visible, but set to sky blue just in case
    scene.clearColor = new Color4(0.55, 0.78, 0.98, 1);

    // Group 0 → SKY (Layer + sun sphere): full colour+depth+stencil clear here
    scene.setRenderingAutoClearDepthStencil(0, true,  true,  true);
    // Group 1 → TERRAIN, TREES, CHARACTER, SCHOOL: composite over sky, no clear
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    // Group 2 → WATER, GRASS (alpha): composite, no clear
    scene.setRenderingAutoClearDepthStencil(2, false, false, false);
    // Group 3 → PARTICLES, FOG WALL: composite, no clear
    scene.setRenderingAutoClearDepthStencil(3, false, false, false);
    // ─────────────────────────────────────────────────────────────────────────

    scene.fogMode    = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.018;
    scene.fogColor   = new Color3(0.55, 0.75, 0.92);

    // ── CAMERA ───────────────────────────────────────────────────────────────
    const camera = new ArcRotateCamera(
        'cam',
        -Math.PI / 2,   // alpha — behind character
        1.18,           // beta  — slight downward look
        10,             // radius
        new Vector3(0, 1.5, 0),
        scene,
    );
    camera.lowerRadiusLimit = 3.5;
    camera.upperRadiusLimit = 55;    // can zoom way out to see the full world
    camera.lowerBetaLimit   = 0.15;  // can look up to sky
    camera.upperBetaLimit   = 1.55;  // can look down to feet
    camera.inputs.clear();           // all camera input handled by our code

    // ── SUN (DirectionalLight) ────────────────────────────────────────────────
    const sun = new DirectionalLight('sun', new Vector3(-0.7, -0.55, -0.45), scene);
    sun.intensity = 1.55;
    sun.diffuse   = new Color3(1.00, 0.85, 0.52);
    sun.specular  = new Color3(1.00, 0.80, 0.45);
    sun.position  = new Vector3(50, 40, 30);

    // ── AMBIENT (HemisphericLight) ────────────────────────────────────────────
    const amb = new HemisphericLight('amb', new Vector3(0, 1, 0), scene);
    amb.intensity   = 0.42;
    amb.diffuse     = new Color3(0.45, 0.58, 0.78);
    amb.groundColor = new Color3(0.20, 0.17, 0.08);

    // ── SHADOW GENERATOR ─────────────────────────────────────────────────────
    const shadows = new ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality             = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias                         = 0.002;
    shadows.normalBias                   = 0.06;
    shadows.setDarkness(0.35);

    // ── RESIZE ───────────────────────────────────────────────────────────────
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    // Store so App.tsx can remove it on unmount
    (engine as Engine & { _resizeHandler?: () => void })._resizeHandler = onResize;

    // ── CONTEXT-LOSS BLACK-BOX GUARD ─────────────────────────────────────────
    // WebGL contexts can be lost unpredictably — GPU memory pressure, driver
    // resets, several other tabs competing for GPU. This is far more common
    // on laptops with shared/integrated graphics than on phones, which is why
    // this shows up as a "random black box, only on laptop" symptom: when the
    // context drops, the canvas goes solid black for the handful of frames it
    // takes Babylon to silently rebuild every GL resource.
    //
    // We can't prevent the OS/driver from ever doing this — that decision is
    // made below the browser, let alone our JS. What we CAN do is make sure
    // the user never sees it happen: the instant a loss is detected, cover the
    // canvas with a plain div in the same sky colour as scene.clearColor, and
    // only remove that cover once the context is restored AND a few frames
    // have actually been rendered again (not the instant it's "restored" —
    // Babylon reports restoration before the rebuilt scene has necessarily
    // painted, so removing the cover immediately would just trade one black
    // flash for a flash of a half-rebuilt scene).
    const lossOverlay = document.createElement('div');
    lossOverlay.style.position      = 'fixed';
    lossOverlay.style.inset         = '0';
    lossOverlay.style.background    = '#8cc7fa'; // matches scene.clearColor fallback below
    lossOverlay.style.zIndex        = '100';      // above every other UI layer in the app
    lossOverlay.style.display       = 'none';
    lossOverlay.style.pointerEvents = 'none';
    canvas.parentElement?.appendChild(lossOverlay);

    engine.onContextLostObservable.add(() => {
        lossOverlay.style.display = 'block';
    });

    engine.onContextRestoredObservable.add(() => {
        let framesSinceRestore = 0;
        const waitForRepaint = scene.onAfterRenderObservable.add(() => {
            framesSinceRestore++;
            if (framesSinceRestore >= 3) {
                lossOverlay.style.display = 'none';
                scene.onAfterRenderObservable.remove(waitForRepaint);
            }
        });
    });

    // Clean up the overlay element if the scene is ever disposed
    scene.onDisposeObservable.add(() => {
        lossOverlay.remove();
    });

    // NOTE: engine.runRenderLoop is intentionally NOT called here.
    // App.tsx calls it inside scene.executeWhenReady() AFTER all meshes are built,
    // so the very first rendered frame is a fully populated scene — zero black flash.

    return { engine, scene, camera, sun, amb, shadows };
}

// ─── Lighting colour ramps ─────────────────────────────────────────────────
// FIX: these five arrays used to be rebuilt from scratch inside
// updateLighting() on EVERY frame — ~25 `new Color3()` allocations per call,
// 60 times a second, for data that never actually changes (only the
// interpolation blend `fr` between entries changes). That's pure GC
// pressure with zero benefit, and a real contributor to stutter in
// constrained environments like a WebView. Hoisted to module scope so
// they're allocated exactly once.
const SUN_DIFFUSE_RAMP: Color3[] = [
    new Color3(1.00,0.85,0.52), new Color3(0.98,0.82,0.48),
    new Color3(0.88,0.76,0.42), new Color3(0.70,0.58,0.30),
    new Color3(0.38,0.30,0.16),
];
const SUN_SPECULAR_RAMP: Color3[] = [
    new Color3(1.00,0.80,0.45), new Color3(0.98,0.76,0.40),
    new Color3(0.88,0.70,0.35), new Color3(0.70,0.52,0.25),
    new Color3(0.38,0.26,0.12),
];
const SUN_INTENSITY_RAMP = [1.55, 1.45, 1.05, 0.60, 0.22];

const AMBIENT_DIFFUSE_RAMP: Color3[] = [
    new Color3(0.45,0.58,0.78), new Color3(0.42,0.54,0.72),
    new Color3(0.38,0.38,0.35), new Color3(0.28,0.24,0.16),
    new Color3(0.14,0.11,0.07),
];
const AMBIENT_GROUND_RAMP: Color3[] = [
    new Color3(0.20,0.17,0.08), new Color3(0.18,0.15,0.07),
    new Color3(0.16,0.13,0.05), new Color3(0.12,0.09,0.03),
    new Color3(0.06,0.04,0.02),
];
const AMBIENT_INTENSITY_RAMP = [0.42, 0.42, 0.52, 0.62, 0.72];

const FOG_COLOR_RAMP: Color3[] = [
    new Color3(0.55,0.75,0.92), new Color3(0.52,0.70,0.85),
    new Color3(0.48,0.46,0.40), new Color3(0.42,0.30,0.14),
    new Color3(0.12,0.08,0.04),
];
const FOG_DENSITY_RAMP = [0.018, 0.020, 0.028, 0.040, 0.062];

// ─── updateLighting ──────────────────────────────────────────────────────────
// Called every frame from App.tsx render loop.
// Animates sun arc + reacts to healthT.

export function updateLighting(ref: EngineRef, healthT: number, worldTime: number): void {
    const { sun, amb, scene } = ref;

    // Slow cinematic sun arc — golden-hour raking light, never overhead noon
    const az  = worldTime * 0.004;
    const el  = Math.PI / 10 + Math.sin(worldTime * 0.003 + 0.8) * (Math.PI / 14);
    const dir = new Vector3(
        Math.cos(az) * Math.cos(el),
        -Math.sin(el) - 0.18,
        Math.sin(az) * Math.cos(el),
    ).normalize();
    sun.direction = dir;
    sun.position  = dir.scale(-90);

    // 5-stop health ramp (THRIVING → COLLAPSED)
    const s    = clamp(healthT, 0, 1) * 4;
    const lo   = Math.min(Math.floor(s), 3);
    const fr   = s - lo;

    sun.diffuse   = lerpColor(SUN_DIFFUSE_RAMP[lo],  SUN_DIFFUSE_RAMP[lo+1],  fr);
    sun.specular  = lerpColor(SUN_SPECULAR_RAMP[lo], SUN_SPECULAR_RAMP[lo+1], fr);
    sun.intensity = lerp(SUN_INTENSITY_RAMP[lo], SUN_INTENSITY_RAMP[lo+1], fr);

    amb.diffuse     = lerpColor(AMBIENT_DIFFUSE_RAMP[lo], AMBIENT_DIFFUSE_RAMP[lo+1], fr);
    amb.groundColor = lerpColor(AMBIENT_GROUND_RAMP[lo],  AMBIENT_GROUND_RAMP[lo+1],  fr);
    amb.intensity   = lerp(AMBIENT_INTENSITY_RAMP[lo], AMBIENT_INTENSITY_RAMP[lo+1], fr);

    scene.fogColor   = lerpColor(FOG_COLOR_RAMP[lo], FOG_COLOR_RAMP[lo+1], fr);
    scene.fogDensity = lerp(FOG_DENSITY_RAMP[lo], FOG_DENSITY_RAMP[lo+1], fr);

    ref.shadows.setDarkness(lerp(0.35, 0.55, healthT));
}

// ─── getSunDirection ─────────────────────────────────────────────────────────

export function getSunDirection(ref: EngineRef): Vector3 {
    return ref.sun.direction.negate().normalize();
}
