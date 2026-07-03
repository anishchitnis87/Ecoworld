/**
 * src/babylon/water.ts — EcoWorld v4 FIXED
 *
 * FIXES:
 * 1. River mesh is ORGANIC — follows the sinusoidal curve from terrain.ts
 * instead of a flat rectangular CreateGround plane.
 * 2. River mesh uses VertexData with cross-sections along the curve — looks
 * like a real winding river with natural banks.
 * 3. Pond mesh is a circular disc, not a rectangle.
 * 4. Both meshes are at renderingGroupId = 1 (same as terrain).
 * 5. Water Y positions follow terrain depression so there's no gap.
 */

import {
    Scene,
    Mesh,
    MeshBuilder,
    ShaderMaterial,
    VertexData,
    Vector3,
    Engine,
    Effect,
} from '@babylonjs/core';

import { lerp, clamp } from './engine';
import { getRiverCentreZ, getRiverHalfWidth, getTerrainHeightAt } from './terrain';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WaterRef {
    riverMesh: Mesh;
    pondMesh:  Mesh;
    riverMat:  ShaderMaterial;
    pondMat:   ShaderMaterial;
}

// ─────────────────────────────────────────────
// GLSL Shaders
// ─────────────────────────────────────────────

const WATER_VERT = /* glsl */`
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4  worldViewProjection;
uniform float uTime;
uniform float uWaveAmp;

varying vec2  vUv;
varying float vWave;

void main() {
  vec3 pos = position;

  float w1 = sin(pos.x * 0.45 + uTime * 1.2)        * uWaveAmp;
  float w2 = sin(pos.z * 0.35 + uTime * 0.9 + 1.57) * uWaveAmp * 0.7;
  float w3 = sin((pos.x + pos.z) * 0.22 + uTime * 0.6) * uWaveAmp * 0.4;

  pos.y += w1 + w2 + w3;
  vWave  = (w1 + w2 + w3) / (uWaveAmp * 1.7 + 0.001);
  vUv    = uv;

  gl_Position = worldViewProjection * vec4(pos, 1.0);
}
`;

const WATER_FRAG = /* glsl */`
precision highp float;

varying vec2  vUv;
varying float vWave;

uniform float uTime;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform float uHealthT;

float ss(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  // Caustic shimmer
  float caustic = sin(vUv.x * 18.0 + uTime * 2.3)
                * sin(vUv.y * 18.0 + uTime * 1.8) * 0.05;

  // Foam at crests — diminishes as world collapses
  float foam = ss(0.55, 1.0, vWave) * (1.0 - uHealthT * 0.9);

  // Flow ripple along UV
  float ripple = sin(vUv.x * 6.0 - uTime * 1.5) * 0.025
               * sin(vUv.y * 4.0 + uTime * 0.8) * (1.0 - uHealthT * 0.6);

  vec3 w = mix(uDeep, uShallow, clamp(vWave * 0.5 + 0.5 + caustic + ripple, 0.0, 1.0));
  w = mix(w, vec3(0.93, 0.97, 1.0), foam * 0.45);

  // Subtle edge darkening (depth cue)
  float edgeDark = ss(0.0, 0.15, vUv.x) * ss(1.0, 0.85, vUv.x)
                 * ss(0.0, 0.15, vUv.y) * ss(1.0, 0.85, vUv.y);
  w *= 0.82 + edgeDark * 0.22;

  float alpha = 0.88 + ripple * 0.04;
  gl_FragColor = vec4(w, alpha);
}
`;

// ─────────────────────────────────────────────
// 5-state water colour data
// ─────────────────────────────────────────────

interface WaterState {
    deep:    [number, number, number];
    shallow: [number, number, number];
    waveAmp: number;
}

const WATER_STATES: WaterState[] = [
    { deep: [0.02, 0.30, 0.72], shallow: [0.22, 0.72, 0.96], waveAmp: 0.14 }, // THRIVING
    { deep: [0.03, 0.26, 0.64], shallow: [0.18, 0.64, 0.88], waveAmp: 0.11 }, // HEALTHY
    { deep: [0.14, 0.26, 0.20], shallow: [0.26, 0.40, 0.28], waveAmp: 0.08 }, // STRUGGLING
    { deep: [0.16, 0.10, 0.04], shallow: [0.28, 0.18, 0.07], waveAmp: 0.05 }, // CRITICAL
    { deep: [0.04, 0.03, 0.02], shallow: [0.09, 0.05, 0.02], waveAmp: 0.03 }, // COLLAPSED
];

function sampleWaterRamp(healthT: number): WaterState {
    const n       = WATER_STATES.length - 1;
    const scaled  = clamp(healthT, 0, 1) * n;
    const lo      = Math.min(Math.floor(scaled), n - 1);
    const t       = scaled - lo;
    const a       = WATER_STATES[lo];
    const b       = WATER_STATES[lo + 1];
    return {
        deep:    [lerp(a.deep[0], b.deep[0], t), lerp(a.deep[1], b.deep[1], t), lerp(a.deep[2], b.deep[2], t)],
        shallow: [lerp(a.shallow[0], b.shallow[0], t), lerp(a.shallow[1], b.shallow[1], t), lerp(a.shallow[2], b.shallow[2], t)],
        waveAmp: lerp(a.waveAmp, b.waveAmp, t),
    };
}

// ─────────────────────────────────────────────
// makeMaterial
// ─────────────────────────────────────────────

function makeMaterial(name: string, scene: Scene): ShaderMaterial {
    const mat = new ShaderMaterial(
        name, scene,
        { vertex: 'ecoWater', fragment: 'ecoWater' },
        {
            attributes: ['position', 'uv'],
            uniforms: ['worldViewProjection', 'uTime', 'uWaveAmp', 'uDeep', 'uShallow', 'uHealthT'],
        },
    );
    mat.backFaceCulling = false;
    mat.alphaMode       = Engine.ALPHA_COMBINE;
    mat.needAlphaBlending = () => true;
    mat.alpha = 0.95;

    const init = WATER_STATES[0];
    mat.setFloat('uTime',    0);
    mat.setFloat('uWaveAmp', init.waveAmp);
    mat.setFloat('uHealthT', 0);
    mat.setArray3('uDeep',    init.deep);
    mat.setArray3('uShallow', init.shallow);
    return mat;
}

// ─────────────────────────────────────────────
// buildRiverMesh — organic winding shape
// ─────────────────────────────────────────────

function buildRiverMesh(scene: Scene): Mesh {
    const STEPS    = 60;   
    const CROSS    = 8;    
    const X_START  = -60;
    const X_END    =  60;

    const positions: number[] = [];
    const uvs:       number[] = [];
    const indices:   number[] = [];

    for (let s = 0; s <= STEPS; s++) {
        const t  = s / STEPS;
        const x  = X_START + (X_END - X_START) * t;
        const zC = getRiverCentreZ(x);
        const hw = getRiverHalfWidth(x);

        const dx_  = 1.0;
        const dzdt = -3.5 * 0.045 * Math.cos(x * 0.045) - 1.8 * 0.11 * Math.cos(x * 0.11 + 1.2);
        const len  = Math.sqrt(dx_ * dx_ + dzdt * dzdt);
        const tx_  = dx_  / len;
        const tz_  = dzdt / len;
        const px   = -tz_;
        const pz   =  tx_;

        // FIX: Sample the deepest point of the riverbed, then set a FLAT water level
        const bedY = getTerrainHeightAt(x, zC);
        const waterY = bedY + 1.4; // 1.4 units above the deep center

        for (let c = 0; c < CROSS; c++) {
            const frac   = c / (CROSS - 1);         
            const offset = (frac - 0.5) * 2.0 * hw; 
            const wx     = x  + px * offset;
            const wz     = zC + pz * offset;
            
            // Apply the flat waterY to the whole cross-section
            positions.push(wx, waterY, wz);
            uvs.push(frac, t * 8); 
        }
    }

    for (let s = 0; s < STEPS; s++) {
        for (let c = 0; c < CROSS - 1; c++) {
            const a = s * CROSS + c;
            const b = a + 1;
            const d = (s + 1) * CROSS + c;
            const e = d + 1;
            indices.push(a, d, b);
            indices.push(b, d, e);
            indices.push(a, b, d);
            indices.push(b, e, d);
        }
    }

    const mesh = new Mesh('river', scene);
    const vd   = new VertexData();
    vd.positions = new Float32Array(positions);
    vd.uvs       = new Float32Array(uvs);
    vd.indices   = new Uint32Array(indices);
    vd.applyToMesh(mesh, false);

    // FIX: Match terrain rendering group
    mesh.renderingGroupId = 1; 
    mesh.isPickable       = false;
    return mesh;
}

// ─────────────────────────────────────────────
// buildPondMesh — circular disc
// ─────────────────────────────────────────────

function buildPondMesh(scene: Scene): Mesh {
    // FIX: Synced exact coordinates with the pond bowl in terrain.ts
    const POND_X = -20;
    const POND_Z = -10;
    const POND_R =  7.0;
    const SEGS   = 28;

    const positions: number[] = [];
    const uvs:       number[] = [];
    const indices:   number[] = [];

    // FIX: Sample the deepest point and set a FLAT water level
    const bedY = getTerrainHeightAt(POND_X, POND_Z);
    const waterY = bedY + 0.85; 

    // Centre vertex
    positions.push(POND_X, waterY, POND_Z);
    uvs.push(0.5, 0.5);

    for (let i = 0; i <= SEGS; i++) {
        const ang = (i / SEGS) * Math.PI * 2;
        const px  = POND_X + Math.cos(ang) * POND_R;
        const pz  = POND_Z + Math.sin(ang) * POND_R;
        
        // Use flat waterY for the edges too
        positions.push(px, waterY, pz);
        uvs.push(0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5);
    }

    for (let i = 0; i < SEGS; i++) {
        indices.push(0, i + 1, i + 2);
        indices.push(0, i + 2, i + 1); // back face
    }

    const mesh = new Mesh('pond', scene);
    const vd   = new VertexData();
    vd.positions = new Float32Array(positions);
    vd.uvs       = new Float32Array(uvs);
    vd.indices   = new Uint32Array(indices);
    vd.applyToMesh(mesh, false);

    // FIX: Match terrain rendering group
    mesh.renderingGroupId = 1; 
    mesh.isPickable       = false;
    return mesh;
}

// ─────────────────────────────────────────────
// buildWater
// ─────────────────────────────────────────────

export function buildWater(scene: Scene): WaterRef {
    Effect.ShadersStore['ecoWaterVertexShader']   = WATER_VERT;
    Effect.ShadersStore['ecoWaterFragmentShader'] = WATER_FRAG;

    const riverMesh = buildRiverMesh(scene);
    const riverMat  = makeMaterial('riverMat', scene);
    riverMesh.material = riverMat;
    riverMesh.alphaIndex = 1;

    const pondMesh = buildPondMesh(scene);
    const pondMat  = makeMaterial('pondMat', scene);
    pondMesh.material = pondMat;
    pondMesh.alphaIndex = 1;

    return { riverMesh, pondMesh, riverMat, pondMat };
}

// ─────────────────────────────────────────────
// updateWater
// ─────────────────────────────────────────────

export function updateWater(ref: WaterRef, healthT: number, time: number): void {
    const s = sampleWaterRamp(healthT);
    for (const mat of [ref.riverMat, ref.pondMat] as ShaderMaterial[]) {
        mat.setFloat('uTime',    time);
        mat.setFloat('uWaveAmp', s.waveAmp);
        mat.setFloat('uHealthT', healthT);
        mat.setArray3('uDeep',    s.deep);
        mat.setArray3('uShallow', s.shallow);
    }
}