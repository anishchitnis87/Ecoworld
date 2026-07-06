/**
 * src/babylon/postprocess.ts — EcoWorld v4
 *
 * BLACK BOX FLICKER — critical rule:
 *  NEVER toggle bloomEnabled or chromaticAberrationEnabled at runtime.
 *  In Babylon 7, toggling these flags calls _buildPipeline() internally,
 *  which disposes and recreates render targets and calls engine.clear().
 *  That clear produces a black frame — visible as the black box flicker.
 *
 *  Correct pattern: enable both passes permanently at init, then drive
 *  their weight/amount to 0.0 for the "off" state. A pass with weight=0
 *  is visually identical to disabled but never triggers a pipeline rebuild.
 *
 *  Other anti-flicker measures:
 *  - pipeline.samples = 1  (disable MSAA — also triggers _buildPipeline if > 1)
 *  - buildPostProcessing called 500ms after runRenderLoop (not before first frame)
 *  - Entire creation wrapped in try/catch so a failure never crashes the scene
 */

import { Scene, ArcRotateCamera, DefaultRenderingPipeline, ColorCurves } from '@babylonjs/core';
import { lerp } from './engine';

// See FIX note inside updatePostProcessing() below — contrast/exposure
// setters are expensive in this Babylon version, unlike every other
// property touched in that function.
let _lastContrast = 1.05; // must match the init value set in buildPostProcessing
let _lastExposure = 1.00; // must match the init value set in buildPostProcessing
const POSTFX_CHANGE_THRESHOLD = 0.003;

export interface PPRef {
    pipeline: DefaultRenderingPipeline;
}

export function buildPostProcessing(scene: Scene, camera: ArcRotateCamera): PPRef | null {
    try {
        const pipeline = new DefaultRenderingPipeline('ecoPP', true, scene, [camera]);

        // Disable MSAA — samples > 1 triggers _buildPipeline() on creation
        pipeline.samples = 1;

        // FXAA for smooth edges without framebuffer swap
        pipeline.fxaaEnabled = true;

        // ── BLOOM — permanently enabled, weight driven to 0 when "off" ────
        pipeline.bloomEnabled   = true;
        pipeline.bloomThreshold = 0.72;
        pipeline.bloomWeight    = 0.0;   // updatePostProcessing drives this
        pipeline.bloomKernel    = 64;
        pipeline.bloomScale     = 0.5;

        // ── IMAGE PROCESSING ──────────────────────────────────────────────
        pipeline.imageProcessingEnabled = true;

        pipeline.imageProcessing.vignetteEnabled   = true;
        pipeline.imageProcessing.vignetteWeight    = 0.55;
        pipeline.imageProcessing.vignetteBlendMode = 1; // MULTIPLY

        pipeline.imageProcessing.colorCurvesEnabled = true;
        const curves = new ColorCurves();
        curves.globalSaturation = 105;
        pipeline.imageProcessing.colorCurves = curves;

        pipeline.imageProcessing.contrast = 1.05;
        pipeline.imageProcessing.exposure = 1.00;

        // ── CHROMATIC ABERRATION — permanently enabled, amount driven to 0 ─
        pipeline.chromaticAberrationEnabled = true;
        pipeline.chromaticAberration.aberrationAmount = 0;

        return { pipeline };

    } catch (err) {
        console.warn('[EcoWorld] PostProcess pipeline failed, running without it:', err);
        return null;
    }
}

export function updatePostProcessing(ref: PPRef | null, healthT: number): void {
    if (!ref) return;
    const pp = ref.pipeline;

    try {
        // Bloom weight: 0 when degraded, up to 0.22 when thriving.
        // Never toggle bloomEnabled — drive weight to 0 instead.
        pp.bloomWeight = healthT < 0.30
            ? lerp(0.22, 0.0, healthT / 0.30)
            : 0.0;

        // Vignette weight grows as world degrades
        pp.imageProcessing.vignetteWeight = lerp(0.55, 2.80, healthT);

        // Saturation falls toward ash grey at collapse
        if (pp.imageProcessing.colorCurves) {
            pp.imageProcessing.colorCurves.globalSaturation = lerp(105, 28, healthT);
        }

        // FIX: contrast/exposure are NOT plain uniform passthroughs in this
        // Babylon version — their setters unconditionally call
        // _updateParameters(), which fires notifyObservers() ->
        // _markAllSubMeshesAsImageProcessingDirty(), a scene-wide walk over
        // every submesh's material. Confirmed via CPU profile: these two
        // setters alone accounted for 16+ of ~20 seconds in a captured
        // trace, because this function runs every frame and healthT is
        // essentially always fractionally different (continuous lerp in
        // tickHealthT). Every other property here is a cheap plain uniform
        // and does NOT need this guard — only contrast/exposure do.
        const newContrast = lerp(1.05, 0.88, healthT);
        if (Math.abs(newContrast - _lastContrast) > POSTFX_CHANGE_THRESHOLD) {
            pp.imageProcessing.contrast = newContrast;
            _lastContrast = newContrast;
        }

        const newExposure = lerp(1.00, 0.70, healthT);
        if (Math.abs(newExposure - _lastExposure) > POSTFX_CHANGE_THRESHOLD) {
            pp.imageProcessing.exposure = newExposure;
            _lastExposure = newExposure;
        }

        // Chromatic aberration amount: 0 when healthy, up to 9 when collapsed.
        // Never toggle chromaticAberrationEnabled — drive amount to 0 instead.
        pp.chromaticAberration.aberrationAmount = healthT > 0.65
            ? lerp(0, 9, (healthT - 0.65) / 0.35)
            : 0;

    } catch (_) {
        // Never let a PP update error crash the render loop
    }
}
