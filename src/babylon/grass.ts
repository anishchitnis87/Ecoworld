/**
 * src/babylon/grass.ts — EcoWorld v4
 *
 * KEY DESIGN:
 *  - All sun properties (direction, color, intensity) are LIVE shader uniforms,
 *    updated every frame from engine.ts getSunDirection() / sun.diffuse / sun.intensity.
 *  - Dead grass under a collapsing sky looks DRY, DARK, and FLAT — not sun-drenched.
 *  - Diffuse is flattened at bad health (flatness = healthT²) to simulate overcast.
 *  - SSS tint shifts golden-green → dry ochre → near-zero at collapsed.
 *  - Wind turbulence increases with air score degradation.
 *  - Fog color and distance track health — smog closes in as ecosystem collapses.
 */

import {
    Scene,
    Mesh,
    ShaderMaterial,
    VertexData,
    Engine,
    Effect,
    Vector3,
    Color3,
} from '@babylonjs/core';
import { seededRandom } from './engine';
import { getRiverCentreZ, getRiverHalfWidth, getTerrainHeight } from './terrain';

export interface GrassRef {
    mesh: Mesh;
    mat: ShaderMaterial;
}

// ─── VERTEX SHADER ────────────────────────────────────────────────────────────
const GRASS_VERT = /* glsl */`
precision highp float;

attribute vec3  position;
attribute vec2  uv;
attribute float aRandom;
attribute float aBladeHeight;
attribute vec2  aWorldPos;

uniform mat4  world;
uniform mat4  worldViewProjection;
uniform float uTime;
uniform float uWindStrength;
uniform float uWindTurbulence;
uniform float uHealthDeath;
uniform vec3  uPlayerPos;
uniform vec3  uCameraPos;

varying vec2  vUv;
varying float vHealthDeath;
varying float vRandom;
varying vec3  vWorldPos;
varying float vDist;
varying float vBladeHeight;

void main() {
    vec3  pos = position;
    float h   = uv.y;   // 0=base, 1=tip

    // --- MACRO WIND (large slow waves)
    float macro = sin(aWorldPos.x * 0.018 + uTime * 0.25) *
                  cos(aWorldPos.y * 0.018 + uTime * 0.25) * 0.6;

    // --- MEDIUM WIND (sheet motion)
    float p1 = aWorldPos.x * 0.14 + aWorldPos.y * 0.10 + uTime * 1.30 + aRandom * 6.2832;
    float p2 = aWorldPos.x * 0.66 - aWorldPos.y * 0.08 + uTime * 0.76 + aRandom * 3.14;
    float gust  = 0.55 + 0.45 * sin(uTime * 0.19 + aWorldPos.x * 0.035);
    float sheet = (sin(p1) * 0.72 + sin(p2) * 0.28) * gust;

    // --- MICRO WIND + TURBULENCE
    float micro = sin(aWorldPos.x * 1.7 + aWorldPos.y * 1.3 + uTime * 6.0 + aRandom * 12.0) * 0.15;
    float turb  = sin(aWorldPos.x * 3.2 + uTime * 11.0 * (1.0 + uWindTurbulence) + aRandom * 8.0)
                * cos(aWorldPos.y * 2.8 + uTime * 7.5 + aRandom * 5.0)
                * uWindTurbulence * 0.35;

    float wind = (macro + sheet + micro + turb) * uWindStrength * h * h;
    pos.x += wind * 0.58;
    pos.z += wind * 0.30;

    // ━━━━ HEALTH DROOP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    float droop = uHealthDeath * h * h * aBladeHeight * 1.15;
    pos.x += droop * (aRandom - 0.5) * 0.85;
    pos.z += droop * (aRandom * 0.6 - 0.3) * 0.65;
    pos.y -= droop * 0.72;

    // ━━━━ LENGTH DIE-BACK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Surviving blades also get visibly shorter, not just darker —
    // a parched, grazed-down meadow rather than a tall dead one.
    // (Additive, like droop above, so it shortens height-above-ground
    // without disturbing the terrain-following base position.)
    float shrinkAmt = uHealthDeath * 0.62 * h * h * aBladeHeight;
    pos.y -= shrinkAmt;

    // ━━━━ PLAYER PUSH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    vec2  toP  = aWorldPos - uPlayerPos.xz;
    float dist = length(toP) + 0.001;
    float push = smoothstep(1.9, 0.25, dist) * h * h * 1.15;
    pos.xz    += normalize(toP) * push;

    // ━━━━ OUTPUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    vec4 worldPos4 = world * vec4(pos, 1.0);
    vWorldPos    = worldPos4.xyz;
    vDist        = length(uCameraPos - worldPos4.xyz);
    vUv          = uv;
    vHealthDeath = uHealthDeath;
    vRandom      = aRandom;
    vBladeHeight = aBladeHeight;
    gl_Position  = worldViewProjection * vec4(pos, 1.0);
}
`;

// ─── FRAGMENT SHADER ──────────────────────────────────────────────────────────
const GRASS_FRAG = /* glsl */`
precision highp float;

varying vec2  vUv;
varying float vHealthDeath;
varying float vRandom;
varying vec3  vWorldPos;
varying float vDist;
varying float vBladeHeight;

uniform vec3  uSunDir;        // live direction TO sun — NEVER hardcoded
uniform vec3  uSunColor;      // live amber-gold → sickly ochre
uniform float uSunIntensity;  // live, drops with health
uniform vec3  uAmbientColor;  // blue sky → smog brown ramp
uniform vec3  uFogColor;      // blue haze → dirty brown ramp
uniform float uFogStart;
uniform float uFogEnd;
uniform float uHealthDeath;
uniform vec3  uCameraPos;
uniform vec3  uGroundColor;
uniform float uSSSStrength;
uniform vec3  uSSSTint;       // golden-green healthy → dry ochre dead

float sc(float x) { return x * x * (3.0 - 2.0 * x); }

void main() {
    // 1. BLADE SILHOUETTE
    float cx   = abs(vUv.x * 2.0 - 1.0);
    float edge = 1.0 - sc(cx);
    edge       = edge * edge;
    float tip  = 1.0 - vUv.y * vUv.y * (0.68 + 0.32 * vUv.y);
    float a    = edge * tip;
    if (a < 0.015) discard;

    // ━━━━ DENSITY DIE-BACK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // As the world collapses (vHealthDeath -> 1) a growing fraction of
    // blades (chosen per-blade via their random seed) die back completely —
    // the meadow thins out instead of just changing colour.
    float dieFrac = vHealthDeath * 0.88;
    if (vRandom < dieFrac) discard;

    // 2. BASE COLOR — healthy → dead gradient along blade height
    vec3 root_h = vec3(0.04,  0.10,  0.015);
    vec3 mid_h  = vec3(0.16,  0.40,  0.11);
    vec3 tip_h  = vec3(0.58,  0.82,  0.32);

    vec3 root_d = vec3(0.12,  0.09,  0.02);
    vec3 mid_d  = vec3(0.38,  0.28,  0.06);
    vec3 tip_d  = vec3(0.55,  0.42,  0.13);

    vec3 c_root = mix(root_h, root_d, vHealthDeath);
    vec3 c_mid  = mix(mid_h,  mid_d,  vHealthDeath);
    vec3 c_tip  = mix(tip_h,  tip_d,  vHealthDeath);

    vec3 baseColor;
    if (vUv.y < 0.4) {
        baseColor = mix(c_root, c_mid, sc(vUv.y / 0.4));
    } else {
        baseColor = mix(c_mid, c_tip, sc((vUv.y - 0.4) / 0.6));
    }

    // Per-blade micro hue variation
    float hv = (vRandom - 0.5) * 0.07;
    baseColor.r += hv * 0.18;
    baseColor.g += hv * (1.0 - vHealthDeath * 0.6) * 0.55;

    // 3. GROUND COLOR BLEEDING + AO
    vec3 groundBlend = mix(uGroundColor, baseColor, vUv.y);
    groundBlend *= 0.30 + 0.70 * vUv.y;

    // 4. LIGHTING — live sun, flattened at bad health
    // Fake curved normal for volumetric blade shading
    vec3 N = normalize(vec3(
        (vUv.x - 0.5) * 1.5,
        0.75 + 0.25 * vUv.y,
        0.28
    ));

    // Diffuse — uses live uSunDir so shading matches rotating sun
    float diffuse = dot(N, uSunDir) * 0.5 + 0.5;
    diffuse = smoothstep(0.0, 1.0, diffuse);

    // FLATTEN diffuse at bad health — overcast feel, dead grass not sun-drenched
    float flatness = vHealthDeath * vHealthDeath;
    diffuse = mix(diffuse, 0.58, flatness * 0.75);

    // Specular
    vec3  viewDir = normalize(uCameraPos - vWorldPos);
    float spec    = pow(clamp(dot(reflect(-uSunDir, N), viewDir), 0.0, 1.0), 22.0);
    vec3  specC   = uSunColor * spec * vUv.y * (1.0 - vHealthDeath * 0.95) * 0.20;

    // Combine lighting
    vec3 sunContrib = uSunColor * uSunIntensity * diffuse * 0.88;
    vec3 ambContrib = uAmbientColor * (0.42 + flatness * 0.30);

    vec3 lit = groundBlend * (sunContrib + ambContrib) + specC;

    // 5. SUBSURFACE SCATTERING
    float sssRaw = clamp(dot(-viewDir, uSunDir), 0.0, 1.0);
    float sssStr = pow(sssRaw, 2.5) * pow(vUv.y, 2.0) * uSSSStrength * 0.38;
    lit += uSSSTint * uSunColor * sssStr;

    // Tip rim: golden-green healthy → dry ochre dead
    vec3 rimTint = mix(vec3(0.70, 0.90, 0.45), vec3(0.55, 0.38, 0.10), vHealthDeath);
    lit += pow(vUv.y, 3.5) * 0.09 * uSSSStrength * rimTint;

    // 6. DISTANCE LOD
    float lodFade  = smoothstep(18.0, 48.0, vDist);
    vec3  lodTarget = mix(lit, uFogColor * 0.90, 0.38);
    lit  = mix(lit, lodTarget, lodFade * 0.50);
    a   *= 1.0 - lodFade * 0.20;

    // 7. ATMOSPHERIC FOG
    float fogT = smoothstep(uFogStart, uFogEnd, vDist);
    fogT       = fogT * fogT;
    lit        = mix(lit, uFogColor, fogT * 0.86);

    gl_FragColor = vec4(lit, a);
}
`;

// ─── EXCLUSION ZONES ─────────────────────────────────────────────────────────
const POND_X = -20;
const POND_Z = -10;
const POND_R = 9;

// School compound — keep grass out
const SCHOOL_X = 0;
const SCHOOL_Z = -48;
const SCHOOL_RX = 16;
const SCHOOL_RZ = 14;

function excluded(x: number, z: number): boolean {
    // Use actual sinusoidal river from terrain.ts — margin of +2 units
    const rCentreZ = getRiverCentreZ(x);
    const rHalfW   = getRiverHalfWidth(x) + 2.0;
    if (Math.abs(z - rCentreZ) < rHalfW) return true;

    // Pond depression
    const dx = x - POND_X;
    const dz = z - POND_Z;
    if (dx * dx + dz * dz < POND_R * POND_R) return true;

    // School compound
    if (Math.abs(x - SCHOOL_X) < SCHOOL_RX && Math.abs(z - SCHOOL_Z) < SCHOOL_RZ) return true;

    return false;
}

// ─── BUILD ───────────────────────────────────────────────────────────────────
export function buildGrassField(
    scene: Scene,
    quality: 'low' | 'medium' | 'high',
): GrassRef {
    const BLADE_COUNT = quality === 'high' ? 380000
        : quality === 'medium' ? 260000
        : 90000;
    const FIELD_R = 44;

    Effect.ShadersStore['ecoGrassVertexShader']   = GRASS_VERT;
    Effect.ShadersStore['ecoGrassFragmentShader'] = GRASS_FRAG;

    const pos:   number[] = [];
    const uvArr: number[] = [];
    const idx:   number[] = [];
    const aRnd:  number[] = [];
    const aH:    number[] = [];
    const aWP:   number[] = [];

    const rng  = seededRandom(0xE1A510);
    const rng2 = seededRandom(0x6A5513);
    const rng3 = seededRandom(0xF00BAA);
    const rng4 = seededRandom(0xCAFE55);

    // Calculate grid size dynamically to maintain your high/medium/low BLADE_COUNT targets
    // while distributing them evenly (1-2 blades per cell) to prevent empty patches (Bug 13)
    const GRID_SIZE = Math.floor(Math.sqrt(BLADE_COUNT / 1.5)); 
    const CELL_SIZE = (FIELD_R * 2) / GRID_SIZE;

    for (let gx = 0; gx < GRID_SIZE; gx++) {
        for (let gz = 0; gz < GRID_SIZE; gz++) {
            // Place 2-3 blades per cell (slightly fuller than before, still
            // intentionally a touch under the old reference's density per user request)
            const bladesInCell = rng() > 0.4 ? 3 : 2;

            for (let bIdx = 0; bIdx < bladesInCell; bIdx++) {
                // Cell center
                const cx = -FIELD_R + gx * CELL_SIZE + CELL_SIZE / 2;
                const cz = -FIELD_R + gz * CELL_SIZE + CELL_SIZE / 2;

                // ±0.4 random offset
                const bx = cx + (rng() * 0.8 - 0.4);
                const bz = cz + (rng() * 0.8 - 0.4);

                // Skip outside main circular field
                if (bx * bx + bz * bz > FIELD_R * FIELD_R) continue;

                // 1. Sample terrain height (Bug 12)
                const ty = getTerrainHeight(bx, bz);

                // 2. Exclusions (Bug 13)
                if (ty > 5.0) continue; // Above mountain line
                if (bz >= 33.5 && bz <= 42.5) continue; // River patch
                
                const dx = bx - (-22);
                const dz = bz - 18;
                if (dx * dx + dz * dz < 49) continue; // Pond bowl (radius < 7)

                // Original exclusions (school compound, organic river curve)
                if (excluded(bx, bz)) continue;

                const rand   = rng2();
                const isTall = rand > 0.30;
                let bladeH = isTall ? 0.30 + rng3() * 0.42 : 0.08 + rng3() * 0.22;

                // 3. Clamp blade height so it never floats above terrain (Bug 12)
                // NOTE: raised the flat-ground floor from 0.18 -> 0.75 so blades on
                // flat terrain (ty ~ 0) reach their intended natural length instead
                // of being crushed to a stub. Slope behaviour (ty * 0.9) unchanged.
                bladeH = Math.min(bladeH, Math.max(0.75, ty * 0.9));

                const baseW  = isTall ? 0.032 + rng3() * 0.024 : 0.042 + rng3() * 0.030;
                const taper  = 0.12 + rng4() * 0.18;
                const leanX  = (rng4() * 2 - 1) * 0.20;
                const leanZ  = (rng4() * 2 - 1) * 0.13;

                for (let cross = 0; cross < 2; cross++) {
                    const rot  = cross * (Math.PI * 0.5) + rng4() * 0.30;
                    const cosR = Math.cos(rot);
                    const sinR = Math.sin(rot);
                    const hw   = baseW * 0.5;
                    const tipW = baseW * taper * 0.5;
                    const tipX = bx + Math.sin(leanX) * bladeH * 0.22;
                    const tipZ = bz + Math.sin(leanZ) * bladeH * 0.16;
                    const vi   = pos.length / 3;

                    // 4. Ground vertices to 'ty' instead of '0.0' (Bug 12)
                    pos.push(bx - hw * cosR, ty, bz - hw * sinR);
                    uvArr.push(0, 0); aRnd.push(rand); aH.push(bladeH); aWP.push(bx, bz);

                    pos.push(bx + hw * cosR, ty, bz + hw * sinR);
                    uvArr.push(1, 0); aRnd.push(rand); aH.push(bladeH); aWP.push(bx, bz);

                    pos.push(tipX + tipW * cosR, ty + bladeH, tipZ + tipW * sinR);
                    uvArr.push(1, 1); aRnd.push(rand); aH.push(bladeH); aWP.push(bx, bz);

                    pos.push(tipX - tipW * cosR, ty + bladeH, tipZ - tipW * sinR);
                    uvArr.push(0, 1); aRnd.push(rand); aH.push(bladeH); aWP.push(bx, bz);

                    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
                    idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
                }
            }
        }
    }

    const mesh = new Mesh('grassField', scene);
    const vd   = new VertexData();
    vd.positions = new Float32Array(pos);
    vd.uvs       = new Float32Array(uvArr);
    vd.indices   = new Uint32Array(idx);
    vd.applyToMesh(mesh, false);

    mesh.setVerticesData('aRandom',      new Float32Array(aRnd), false, 1);
    mesh.setVerticesData('aBladeHeight', new Float32Array(aH),   false, 1);
    mesh.setVerticesData('aWorldPos',    new Float32Array(aWP),  false, 2);

    mesh.doNotSyncBoundingInfo    = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable               = false;
    mesh.renderingGroupId         = 1;

    const mat = new ShaderMaterial(
        'grassMat', scene,
        { vertex: 'ecoGrass', fragment: 'ecoGrass' },
        {
            attributes: ['position', 'uv', 'aRandom', 'aBladeHeight', 'aWorldPos'],
            uniforms: [
                'world', 'worldViewProjection',
                'uTime', 'uWindStrength', 'uWindTurbulence', 'uHealthDeath',
                'uPlayerPos', 'uCameraPos',
                'uSunDir', 'uSunColor', 'uSunIntensity',
                'uAmbientColor', 'uGroundColor',
                'uFogColor', 'uFogStart', 'uFogEnd',
                'uSSSStrength', 'uSSSTint',
            ],
        },
    );

    mat.backFaceCulling = false;
    mat.alphaMode       = Engine.ALPHA_DISABLE; // grass uses discard in shader — no blending needed (prevents black bbox artifact)
    

    // ── Initial uniform values (overwritten every frame by updateGrass) ──
    mat.setFloat('uTime',           0);
    mat.setFloat('uWindStrength',   0.22);
    mat.setFloat('uWindTurbulence', 0.0);
    mat.setFloat('uHealthDeath',    0);
    mat.setFloat('uSunIntensity',   1.55);
    mat.setFloat('uSSSStrength',    1.0);
    mat.setFloat('uFogStart',       18.0);
    mat.setFloat('uFogEnd',         52.0);

    mat.setVector3('uPlayerPos', Vector3.Zero());
    mat.setVector3('uCameraPos', new Vector3(0, 8, -12));
    mat.setVector3('uSunDir',    new Vector3(0.6, 0.8, 0.3).normalize());

    mat.setColor3('uSunColor',     new Color3(1.0, 0.85, 0.52));
    mat.setColor3('uAmbientColor', new Color3(0.38, 0.52, 0.68));
    mat.setColor3('uGroundColor',  new Color3(0.05, 0.12, 0.02));
    mat.setColor3('uSSSTint',      new Color3(0.70, 0.95, 0.40));
    mat.setColor3('uFogColor',     new Color3(0.52, 0.72, 0.92));

    mesh.material = mat;
    return { mesh, mat };
}

// ─── HEALTH RAMP TABLES ──────────────────────────────────────────────────────

const GROUND_COLORS = [
    new Color3(0.05, 0.12, 0.02), // 0.00 THRIVING
    new Color3(0.05, 0.12, 0.02), // 0.25 HEALTHY
    new Color3(0.08, 0.14, 0.02), // 0.50 STRUGGLING
    new Color3(0.22, 0.16, 0.05), // 0.75 CRITICAL
    new Color3(0.10, 0.07, 0.02), // 1.00 COLLAPSED
];

const AMBIENT_COLORS = [
    new Color3(0.38, 0.52, 0.68), // 0.00 THRIVING
    new Color3(0.36, 0.50, 0.64), // 0.25 HEALTHY
    new Color3(0.36, 0.36, 0.32), // 0.50 STRUGGLING
    new Color3(0.26, 0.22, 0.13), // 0.75 CRITICAL
    new Color3(0.12, 0.09, 0.05), // 1.00 COLLAPSED
];

const SSS_TINTS = [
    new Color3(0.70, 0.95, 0.40), // 0.00 THRIVING
    new Color3(0.70, 0.92, 0.38), // 0.25 HEALTHY
    new Color3(0.80, 0.82, 0.25), // 0.50 STRUGGLING
    new Color3(0.68, 0.55, 0.16), // 0.75 CRITICAL
    new Color3(0.45, 0.32, 0.08), // 1.00 COLLAPSED
];

const FOG_COLORS = [
    new Color3(0.52, 0.72, 0.92), // 0.00 THRIVING
    new Color3(0.50, 0.68, 0.86), // 0.25 HEALTHY
    new Color3(0.48, 0.48, 0.42), // 0.50 STRUGGLING
    new Color3(0.40, 0.32, 0.16), // 0.75 CRITICAL
    new Color3(0.14, 0.10, 0.05), // 1.00 COLLAPSED
];

function sampleRamp(arr: Color3[], healthT: number): Color3 {
    const n  = arr.length - 1;
    const t0 = Math.max(0, Math.min(1, healthT)) * n;
    const lo = Math.min(Math.floor(t0), n - 1);
    const f  = t0 - lo;
    const a  = arr[lo];
    const b  = arr[lo + 1];
    return new Color3(
        a.r + (b.r - a.r) * f,
        a.g + (b.g - a.g) * f,
        a.b + (b.b - a.b) * f,
    );
}

function airToWind(air: number): { strength: number; turbulence: number } {
    if (air >= 80) return { strength: 0.22, turbulence: 0.0 };
    if (air >= 50) {
        const t = (80 - air) / 30;
        return { strength: 0.22 + t * 0.28, turbulence: t * 0.3 };
    }
    if (air >= 20) {
        const t = (50 - air) / 30;
        return { strength: 0.50 + t * 0.22, turbulence: 0.3 + t * 0.4 };
    }
    return { strength: 0.72, turbulence: 0.7 };
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

/**
 * @param ref          GrassRef from buildGrassField
 * @param healthT      0.0 (thriving) → 1.0 (collapsed)
 * @param time         world time in seconds
 * @param playerPos    character world position
 * @param airScore     0–100 air quality score
 * @param sunDirToSun  direction FROM scene TO sun (from getSunDirection())
 * @param sunColor     live sun diffuse color (from sun.diffuse)
 * @param sunIntensity live sun intensity (from sun.intensity)
 * @param scene        optional Babylon Scene for camera position
 */
export function updateGrass(
    ref: GrassRef,
    healthT: number,
    time: number,
    playerPos: Vector3,
    airScore: number,
    sunDirToSun: Vector3,
    sunColor: Color3,
    sunIntensity: number,
    scene?: Scene,
): void {
    const wind = airToWind(airScore);

    ref.mat.setFloat('uTime',           time);
    ref.mat.setFloat('uWindStrength',   wind.strength);
    ref.mat.setFloat('uWindTurbulence', wind.turbulence);
    ref.mat.setFloat('uHealthDeath',    healthT);
    ref.mat.setFloat('uSunIntensity',   sunIntensity);
    ref.mat.setFloat('uSSSStrength',    Math.max(0, 1.0 - healthT * 0.88));

    ref.mat.setVector3('uPlayerPos', playerPos);
    ref.mat.setVector3('uSunDir',    sunDirToSun);
    ref.mat.setColor3('uSunColor',   sunColor);

    ref.mat.setColor3('uGroundColor',  sampleRamp(GROUND_COLORS,  healthT));
    ref.mat.setColor3('uAmbientColor', sampleRamp(AMBIENT_COLORS, healthT));
    ref.mat.setColor3('uSSSTint',      sampleRamp(SSS_TINTS,      healthT));
    ref.mat.setColor3('uFogColor',     sampleRamp(FOG_COLORS,     healthT));

    // Fog distance tightens as health drops — smog closes in
    ref.mat.setFloat('uFogStart', 18.0);
    ref.mat.setFloat('uFogEnd',   Math.max(22, 52.0 - healthT * 30.0));

    if (scene?.activeCamera) {
        ref.mat.setVector3('uCameraPos', scene.activeCamera.position);
    }
}