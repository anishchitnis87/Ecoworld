/**
 * src/babylon/terrain.ts — EcoWorld v4 REDESIGNED
 *
 * DESIGN PHILOSOPHY:
 * - Large FLAT central plateau (r < 30) — where school, trees, grass, character live
 * - Mountains rise steeply ONLY at edges (r > 35) — natural valley bowl shape
 * - River cuts organically through the plateau mid-section
 * - Pond depression in plateau at west side
 * - Shadow receiving enabled on terrain mesh
 * - getTerrainHeightAt() exported for all systems to use
 */

import {
    Scene,
    Mesh,
    MeshBuilder,
    StandardMaterial,
    Color3,
    VertexBuffer,
    VertexData,
    ShadowGenerator,
    DirectionalLight,
} from '@babylonjs/core';

import { seededRandom, smoothstep, lerp, lerpColor, clamp } from './engine';

export function getTerrainHeight(x: number, z: number): number {
    return getTerrainHeightAt(x, z);
}

export interface TerrainRef {
    ground: Mesh;
    mat: StandardMaterial;
}

// ─── HEIGHT CACHE ─────────────────────────────────────────────────────────────
let _positions:    Float32Array | null = null;
let _subdivisions  = 0;
let _terrainSize   = 0;

export function getTerrainHeightAt(x: number, z: number): number {
    if (!_positions || _subdivisions === 0) return 0;
    const half = _terrainSize / 2;
    const u = clamp((x + half) / _terrainSize, 0, 1);
    
    // FIX: Invert the Z mapping so it matches Babylon's top-down vertex array!
    // This stops the water and grass from floating.
    const v = clamp((half - z) / _terrainSize, 0, 1);
    
    const cols = _subdivisions + 1;

    const fx = u * _subdivisions;
    const fz = v * _subdivisions;
    const ix = Math.floor(fx); const tx = fx - ix;
    const iz = Math.floor(fz); const tz = fz - iz;

    const ix1 = Math.min(ix + 1, _subdivisions);
    const iz1 = Math.min(iz + 1, _subdivisions);

    const idx = (r: number, c: number) => (r * cols + c) * 3 + 1;
    const h00 = _positions[idx(iz,  ix )];
    const h10 = _positions[idx(iz,  ix1)];
    const h01 = _positions[idx(iz1, ix )];
    const h11 = _positions[idx(iz1, ix1)];

    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

// ─── COLOUR RAMP ──────────────────────────────────────────────────────────────
const TERRAIN_COLORS = [
    new Color3(0.10, 0.22, 0.05),  // THRIVING — lush dark green
    new Color3(0.12, 0.20, 0.05),  // HEALTHY
    new Color3(0.18, 0.20, 0.06),  // STRUGGLING
    new Color3(0.32, 0.22, 0.10),  // CRITICAL
    new Color3(0.14, 0.10, 0.06),  // COLLAPSED
];

function sampleTerrainRamp(healthT: number): Color3 {
    const n  = TERRAIN_COLORS.length - 1;
    const t0 = clamp(healthT, 0, 1) * n;
    const lo = Math.min(Math.floor(t0), n - 1);
    return lerpColor(TERRAIN_COLORS[lo], TERRAIN_COLORS[lo + 1], t0 - lo);
}

// ─── BUILD TERRAIN ────────────────────────────────────────────────────────────

export function buildTerrain(scene: Scene): TerrainRef {
    const SIZE = 140;
    const SUBS = 100;  // higher subdivision = smoother plateau-to-mountain blend
    _terrainSize  = SIZE;
    _subdivisions = SUBS;

    const ground = MeshBuilder.CreateGround(
        'ground',
        { width: SIZE, height: SIZE, subdivisions: SUBS, updatable: true },
        scene,
    );
    ground.renderingGroupId = 1;
    ground.isPickable       = true;
    ground.receiveShadows   = true;

    displaceVertices(ground, SIZE, SUBS);

    ground.useVertexColors = true;

    const mat = new StandardMaterial('terrainMat', scene);
    mat.specularColor = new Color3(0.006, 0.006, 0.006);
    mat.ambientColor  = new Color3(0.05, 0.10, 0.02);
    mat.diffuseColor  = TERRAIN_COLORS[0].clone();
    ground.material   = mat;
    const skirt = MeshBuilder.CreateTorus('terrainSkirt', { 
        diameter: 136, 
        thickness: 4, 
        tessellation: 64 
    }, scene);
    skirt.position.y = -1;
    skirt.scaling.y = 0.1; // Flat on Y
    skirt.material = mat;
    skirt.renderingGroupId = 1;

    return { ground, mat };
}

// ─── NOISE GENERATOR ─────────────────────────────────────────────────────────

function makeValueNoise(seed: number, gridSize: number): (x: number, z: number) => number {
    const rand = seededRandom(seed);
    const G    = gridSize + 2;
    const grid = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) grid[i] = rand() * 2 - 1;

    const ease = (t: number) => t * t * (3 - 2 * t);
    return (x: number, z: number): number => {
        const gx  = ((x / 140 + 0.5) * (gridSize - 1));
        const gz  = ((z / 140 + 0.5) * (gridSize - 1));
        const ix  = Math.floor(gx) % gridSize;
        const iz  = Math.floor(gz) % gridSize;
        const fx  = ease(gx - Math.floor(gx));
        const fz  = ease(gz - Math.floor(gz));
        const ix1 = (ix + 1) % gridSize;
        const iz1 = (iz + 1) % gridSize;
        return lerp(
            lerp(grid[iz  * G + ix], grid[iz  * G + ix1], fx),
            lerp(grid[iz1 * G + ix], grid[iz1 * G + ix1], fx),
            fz,
        );
    };
}

// ─── RIVER SDF ────────────────────────────────────────────────────────────────
/** Sinusoidal river path; returns normalised signed distance from centre (±1 = edge) */
function riverSDF(x: number, z: number): number {
    const zC  = getRiverCentreZ(x);
    const hw  = getRiverHalfWidth(x);
    return (z - zC) / hw;
}

export function getRiverCentreZ(x: number): number {
    return 20 + 4.5 * Math.sin(x * 0.04) + 2.0 * Math.sin(x * 0.10 + 1.1);
}

export function getRiverHalfWidth(x: number): number {
    return 4.0 + 1.5 * Math.sin(x * 0.055 + 0.7) + 0.9 * Math.sin(x * 0.13);
}

export function isInRiver(x: number, z: number): boolean {
    return Math.abs(riverSDF(x, z)) < 1.0;
}

// ─── VERTEX DISPLACEMENT ─────────────────────────────────────────────────────

function displaceVertices(ground: Mesh, size: number, subs: number): void {
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    // Multiple noise octaves for mountain detail
    const coarse = makeValueNoise(7,   8);
    const med    = makeValueNoise(13, 18);
    const fine   = makeValueNoise(29, 36);
    const micro  = makeValueNoise(53, 56);

    // POND position — on the flat plateau
    const POND_X = -20;
    const POND_Z = -10;
    const POND_R =   7;

    // SCHOOL ZONE — keep very flat (school sits at z=-40 to -55, x=-10 to 10)
    const SCHOOL_X  =  0;
    const SCHOOL_Z  = -48;
    const SCHOOL_RX = 25;
    const SCHOOL_RZ = 23;

    const count = positions.length / 3;
    const colors = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        const b = i * 3;
        const x = positions[b];
        const z = positions[b + 2];
        const r = Math.sqrt(x * x + z * z);

        // ── ZONE FACTORS ──────────────────────────────────────────────────
        // plateau: r < 32 = completely flat
        // transition: 32..48 = gentle slope up to mountains
        // mountains: r > 48 = full height
        const plateauFactor = 1.0 - smoothstep(28, 50, r);
        const mountainFactor = smoothstep(32, 62, r);

        // Fine surface noise on plateau (subtle ground undulation, not hills)
        const surfaceNoise = (
            fine(x, z) * 0.18 +
            micro(x, z) * 0.06
        ) * plateauFactor;

        // Mountain height — rises steeply at edges
        const mountainNoise = (
            coarse(x, z) * 8.5 +
            med(x, z)    * 3.2 +
            fine(x, z)   * 0.85
        ) * mountainFactor;

        let dy = surfaceNoise + mountainNoise;

        // ── SCHOOL ZONE FACTOR — computed first so river/pond/mountain below
        // can be suppressed near the school, instead of fighting it ─────────
        const sdX = Math.abs(x - SCHOOL_X) / SCHOOL_RX;
        const sdZ = Math.abs(z - SCHOOL_Z) / SCHOOL_RZ;
        const schoolDist = Math.max(sdX, sdZ); // box distance
        let inSchool = 0;
        if (schoolDist < 1.5) {
            inSchool = 1 - smoothstep(1.0, 1.5, schoolDist);
        }

        // ── RIVER BED (flows through plateau) ─────────────────────────────
        const rDist = riverSDF(x, z);
        const rAbs  = Math.abs(rDist);
        if (rAbs < 1.3) {
            const inRiver = (1 - smoothstep(0.65, 1.3, rAbs)) * (1 - inSchool);
            // Depress river bed below plateau surface
            const depth = inRiver * 1.8;
            dy = lerp(dy, 0, inRiver * 0.95) - depth;
            // Subtle undulation along river floor
            dy += Math.sin(x * 0.25 + z * 0.08) * 0.12 * inRiver;
        }

        // ── POND BOWL ─────────────────────────────────────────────────────
        const pdR = Math.sqrt((x - POND_X) ** 2 + (z - POND_Z) ** 2);
        if (pdR < POND_R + 4) {
            // FIX: suppress the pond bowl near the school. Previously this
            // could carve a steep dip right up against the compound wall
            // (school flatten zone and pond zone were fighting over a very
            // narrow strip of terrain), leaving the wall looking like it
            // floats over a sudden drop with water peeking underneath it.
            const inPond = (1 - smoothstep(POND_R - 1, POND_R + 4, pdR)) * (1 - inSchool);
            dy = lerp(dy, 0, inPond * 0.94) - 1.0 * inPond;
        }

        // ── SCHOOL ZONE — completely flat ─────────────────────────────────
        if (inSchool > 0) {
            dy = lerp(dy, 0, inSchool);
        }
        // FIX: the cliff drop-off below must not pull the ground down under
        // the school — it was previously unconditional, so the far edge of
        // the compound (which sits near r=48) would sink away from the
        // flat building/wall meshes even though they were forced to dy=0.
        if (r > 48) {
            dy -= (r - 48) * 0.4 * (1 - inSchool);
        }

        positions[b + 1] = dy;
        let colR = 1.0, colG = 1.0, colB = 1.0;
        
        // rAbs is normalised distance. 1.0 is the river edge.
        // We make it muddy between 1.0 and 2.5 (the shore)
        if (rAbs < 2.5) {
            const shoreFactor = 1.0 - smoothstep(1.0, 2.5, rAbs);
            colR = lerp(1.0, 0.50, shoreFactor);
            colG = lerp(1.0, 0.40, shoreFactor);
            colB = lerp(1.0, 0.20, shoreFactor);
        }
        
        colors[i * 4 + 0] = colR;
        colors[i * 4 + 1] = colG;
        colors[i * 4 + 2] = colB;
        colors[i * 4 + 3] = 1.0;
    }

    ground.updateVerticesData(VertexBuffer.PositionKind, positions, true);
    ground.setVerticesData(VertexBuffer.ColorKind, colors, true);

    const indices = ground.getIndices();
    if (indices) {
        const normals = new Float32Array(positions.length);
        VertexData.ComputeNormals(positions, indices, normals);
        ground.updateVerticesData(VertexBuffer.NormalKind, normals, true);
    }

    _positions = new Float32Array(positions);
}

// ─── UPDATE COLOUR ────────────────────────────────────────────────────────────

export function updateTerrainColor(ref: TerrainRef, healthT: number): void {
    const c = sampleTerrainRamp(healthT);
    ref.mat.diffuseColor.r = c.r;
    ref.mat.diffuseColor.g = c.g;
    ref.mat.diffuseColor.b = c.b;
    const specLevel = lerp(0.005, 0.035, clamp((healthT - 0.5) * 2, 0, 1));
    ref.mat.specularColor.set(specLevel, specLevel * 0.85, specLevel * 0.70);
}

// ─── SHADOW SETUP ─────────────────────────────────────────────────────────────

export function enableTerrainShadows(ref: TerrainRef, generator: ShadowGenerator): void {
    // Terrain receives shadows from trees, character, school
    ref.ground.receiveShadows = true;
}