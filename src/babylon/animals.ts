/**
 * src/babylon/animals.ts — EcoWorld v4 BEAUTIFUL ANIMALS
 * 6 Indian species — much more detailed and realistic geometry.
 * All grounded on terrain via getTerrainHeightAt.
 *
 * FIXES APPLIED:
 * - Completely rebuilt Fox Tail hierarchy so the pivot hinge is correct.
 * - Tail tip now correctly attaches to the end of the tail without inverting.
 */

import {
    Scene,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Vector3,
    TransformNode,
    Mesh,
} from '@babylonjs/core';
import { lerp, seededRandom } from './engine';
import { getTerrainHeightAt } from './terrain';
import { treePositions, treeAlive } from './trees';
import type { EcoScores } from '@/types';

// ─── MATERIAL HELPER ─────────────────────────────────────────────────────────

function mat(name: string, col: Color3, scene: Scene, spec = 0.03, emissive = 0.05): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor  = col.clone();
    m.specularColor = new Color3(spec, spec, spec);
    m.ambientColor  = col.scale(0.30);
    if (emissive > 0) m.emissiveColor = col.scale(emissive);
    return m;
}

function taperedCyl(name: string, dTop: number, dBot: number, h: number, scene: Scene): Mesh {
    return MeshBuilder.CreateCylinder(name, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 10 }, scene);
}

// ─── MODULE STATE ────────────────────────────────────────────────────────────

interface DeerState  { root: TransformNode; legNodes: TransformNode[]; neckNode: TransformNode; tailMesh: Mesh; vx: number; vz: number; speed: number; phase: number; }
interface FoxState   { root: TransformNode; legNodes: TransformNode[]; tailNode: TransformNode; vx: number; vz: number; speed: number; sleeping: boolean; }
interface BirdState  { root: TransformNode; wingLNode: TransformNode; wingRNode: TransformNode; orbitR: number; orbitH: number; orbitSpeed: number; phase: number; tailMesh: Mesh; }
interface ButterflyState { root: TransformNode; wingLNode: TransformNode; wingRNode: TransformNode; t8phase: number; ox: number; oz: number; baseY: number; }
interface DragonflyState { root: TransformNode; wingLNode: TransformNode; wingRNode: TransformNode; orbitPhase: number; orbitX: number; orbitZ: number; baseY: number; }
interface PeacockState {
    root: TransformNode;
    legs: TransformNode[];
    fan: TransformNode[];
    vx: number;
    vz: number;
    speed: number;
    ox: number;
    oz: number;
    roamR: number;
    fanOpenState: boolean;
}

let _deer:        DeerState[]        = [];
let _foxes:       FoxState[]         = [];
let _birds:       BirdState[]        = [];
let _butterflies: ButterflyState[]   = [];
let _peacocks: PeacockState[] = [];
let _dragonflies: DragonflyState[]   = [];
let _scene:       Scene;
let _lastTime = 0;

// ─── SPAWNING RULES ──────────────────────────────────────────────────────────

// FIX: isExcluded() used to be called every single frame inside the deer/
// fox/peacock movement loops to test the *roam boundary* — but it also
// contained a "within 5 units of the player" check meant only for picking
// safe spawn points. That meant: every frame the player walked near an
// animal, the animal's boundary logic saw "out of bounds!" and hard-snapped
// its velocity to point back at the herd's center/home — and because the
// predicted next-step position hovers right on that 5-unit line, the snap
// flickered on/off every frame (looking like the animal freezing and
// flipping to an "opposite" heading). Any other animal that wandered near
// that flickering one then froze too, via groundAvoid() treating it as an
// obstacle. Splitting these apart fixes it: isOutOfBounds() (terrain/water/
// school only) is what the per-frame movement loop should use; the player
// check now lives only in isExcludedForSpawn(), used once when an animal is
// (re)placed, never inside the per-frame steering logic.
function isOutOfBounds(x: number, z: number, allowRiver = false): boolean {
    if (Math.hypot(x - (-20), z - (-10)) < 8) return true;
    if (!allowRiver && z >= 33.5 && z <= 42.5) return true;
    if (z < -35 && Math.abs(x) < 26) return true;
    return false;
}

function isExcludedForSpawn(x: number, z: number, allowRiver = false): boolean {
    const p = _scene?.getNodeByName('charRoot') as TransformNode;
    if (p && Math.hypot(x - p.position.x, z - p.position.z) < 5) return true;
    return isOutOfBounds(x, z, allowRiver);
}

// Back-compat alias for any remaining spawn-time call sites in this file.
function isExcluded(x: number, z: number, allowRiver = false): boolean {
    return isExcludedForSpawn(x, z, allowRiver);
}

// ─── SHARED COLLISION HELPERS ─────────────────────────────────────────────────
// Real-life animals don't walk through tree trunks, water, or each other.
// These helpers give every ground-walking species (deer / fox / peacock) the
// same physically grounded "bounce off the obstacle" response, and give the
// flying / fluttering species (birds / butterflies / dragonflies) a soft
// horizontal nudge so they never visually clip through a trunk or canopy.

/** Reflects a velocity vector off any tree trunk closer than `radius`. Skips trees that have already died off. */
function treeAvoid(nx: number, nz: number, vx: number, vz: number, radius: number): { vx: number; vz: number; hit: boolean } {
    let avx = vx, avz = vz, hit = false;
    for (let i = 0; i < treePositions.length; i++) {
        if (treeAlive[i] === false) continue; // tree is gone — nothing here to bounce off
        const tree = treePositions[i];
        const dist = Math.hypot(nx - tree.x, nz - tree.z);
        if (dist > 0.0001 && dist < radius) {
            const nxN = (nx - tree.x) / dist;
            const nzN = (nz - tree.z) / dist;
            const dot = avx * nxN + avz * nzN;
            if (dot < 0) {
                avx -= 2 * dot * nxN;
                avz -= 2 * dot * nzN;
                hit = true;
            }
        }
    }
    return { vx: avx, vz: avz, hit };
}

/** Reflects a velocity vector off every other ground animal closer than `radius`. */
function groundAvoid(nx: number, nz: number, vx: number, vz: number, selfRoot: TransformNode, radius: number): { vx: number; vz: number; hit: boolean } {
    let avx = vx, avz = vz, hit = false;
    const test = (ox: number, oz: number, oroot: TransformNode) => {
        if (oroot === selfRoot) return;
        const dist = Math.hypot(nx - ox, nz - oz);
        if (dist > 0.0001 && dist < radius) {
            const nxN = (nx - ox) / dist;
            const nzN = (nz - oz) / dist;
            const dot = avx * nxN + avz * nzN;
            if (dot < 0) {
                avx -= 2 * dot * nxN;
                avz -= 2 * dot * nzN;
                hit = true;
            }
        }
    };
    for (const d of _deer)     if (d.root.isEnabled())    test(d.root.position.x, d.root.position.z, d.root);
    for (const f of _foxes)    if (f.root.isEnabled())    test(f.root.position.x, f.root.position.z, f.root);
    for (const p of _peacocks) if (p.root.isEnabled())    test(p.root.position.x, p.root.position.z, p.root);
    return { vx: avx, vz: avz, hit };
}

/** One-shot positional push for flying/fluttering species — keeps them from sinking into a trunk. Skips dead trees. */
function pushOffTrees(px: number, pz: number, radius: number): { x: number; z: number } {
    let x = px, z = pz;
    for (let i = 0; i < treePositions.length; i++) {
        if (treeAlive[i] === false) continue;
        const tree = treePositions[i];
        const dx = x - tree.x, dz = z - tree.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.0001 && dist < radius) {
            const push = radius - dist;
            x += (dx / dist) * push;
            z += (dz / dist) * push;
        }
    }
    return { x, z };
}

// ─── SPECIES 1 — DEER (Indian Spotted Deer / Chital) ─────────────────────────

function buildDeer(scene: Scene, idx: number): DeerState {
    const root = new TransformNode(`deer_${idx}`, scene);
    root.rotation.y = 0; 
    const rand = seededRandom(idx * 37 + 1);

    const bodyMat  = mat(`deer_body_${idx}`, new Color3(0.72, 0.48, 0.25), scene, 0.02);
    const spotMat  = mat(`deer_spot_${idx}`, new Color3(1, 1, 1), scene, 0.01, 0.8);
    const legMat   = mat(`deer_leg_${idx}`,  new Color3(0.58, 0.38, 0.18), scene, 0.02);
    const noseMat  = mat(`deer_nose_${idx}`, new Color3(0.25, 0.14, 0.10), scene, 0.01);
    const eyeMat   = mat(`deer_eye_${idx}`,  new Color3(0.10, 0.06, 0.03), scene, 0.01);
    const antlerMat = mat(`deer_antler_${idx}`, new Color3(0.42, 0.28, 0.14), scene, 0.02);

    const body = MeshBuilder.CreateSphere(`deer_body_${idx}`, { diameterX: 0.38, diameterY: 0.38, diameterZ: 0.72, segments: 8 }, scene);
    body.material = bodyMat;
    body.position.set(0, 0.62, 0);
    body.parent = root;
    body.isPickable = false;

    const rump = MeshBuilder.CreateSphere(`deer_rump_${idx}`, { diameterX: 0.34, diameterY: 0.34, diameterZ: 0.32, segments: 6 }, scene);
    rump.material = bodyMat;
    rump.position.set(0, 0.66, -0.28);
    rump.parent = root;
    rump.isPickable = false;

    const rumpWhite = MeshBuilder.CreateSphere(`deer_rumpw_${idx}`, { diameterX: 0.26, diameterY: 0.28, diameterZ: 0.22, segments: 5 }, scene);
    rumpWhite.material = mat(`deer_rw_${idx}`, new Color3(0.94, 0.90, 0.82), scene);
    rumpWhite.position.set(0, 0.66, -0.38);
    rumpWhite.parent = root;
    rumpWhite.isPickable = false;

    const spotOffsets: [number,number,number][] = [
        [0.12, 0.78, 0.05], [-0.12, 0.78, -0.05],
        [0.08, 0.72, 0.12], [-0.08, 0.70, -0.10],
        [0.14, 0.74, 0.18], [-0.16, 0.76, 0.10],
    ];
    for (let s = 0; s < spotOffsets.length; s++) {
        const sp = MeshBuilder.CreateSphere(`deer_spot_${idx}_${s}`, { diameter: 0.055, segments: 4 }, scene);
        sp.material = spotMat;
        sp.position.set(...spotOffsets[s]);
        sp.parent = root;
        sp.isPickable = false;
    }

    const neckNode = new TransformNode(`deer_neckN_${idx}`, scene);
    neckNode.parent = root;
    neckNode.position.set(0, 0.68, 0.28);
    neckNode.rotation.x = 0.42;

    const neck = taperedCyl(`deer_neck_${idx}`, 0.10, 0.13, 0.28, scene);
    neck.material = bodyMat;
    neck.position.y = 0.14;
    neck.parent = neckNode;
    neck.isPickable = false;

    const head = MeshBuilder.CreateSphere(`deer_head_${idx}`, { diameterX: 0.20, diameterY: 0.18, diameterZ: 0.22, segments: 7 }, scene);
    head.material = bodyMat;
    head.position.set(0, 0.30, 0);
    head.parent = neckNode;
    head.isPickable = false;

    const snout = taperedCyl(`deer_snout_${idx}`, 0.075, 0.09, 0.13, scene);
    snout.material = bodyMat;
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.26, 0.10);
    snout.parent = neckNode;
    snout.isPickable = false;

    const noseP = MeshBuilder.CreateSphere(`deer_noseP_${idx}`, { diameter: 0.048, segments: 4 }, scene);
    noseP.material = noseMat;
    noseP.position.set(0, 0.26, 0.165);
    noseP.parent = neckNode;
    noseP.isPickable = false;

    for (const [side, sx] of [[-1, -0.10], [1, 0.10]] as [number,number][]) {
        const ear = MeshBuilder.CreateSphere(`deer_ear_${idx}_${side}`, { diameterX: 0.06, diameterY: 0.14, diameterZ: 0.10, segments: 5 }, scene);
        ear.material = bodyMat;
        ear.rotation.z = side * 0.55;
        ear.position.set(sx, 0.38, 0);
        ear.parent = neckNode;
        ear.isPickable = false;
        
        const innerEar = MeshBuilder.CreateSphere(`deer_iear_${idx}_${side}`, { diameterX: 0.04, diameterY: 0.09, diameterZ: 0.055, segments: 4 }, scene);
        innerEar.material = mat(`deer_iear_m_${idx}_${side}`, new Color3(0.88, 0.68, 0.68), scene);
        innerEar.rotation.z = side * 0.55;
        innerEar.position.set(sx * 0.9, 0.38, 0.01);
        innerEar.parent = neckNode;
        innerEar.isPickable = false;
    }

    for (const [side, ex] of [[-1, -0.09], [1, 0.09]] as [number,number][]) {
        const eyeW = MeshBuilder.CreateSphere(`deer_eyeW_${idx}_${side}`, { diameter: 0.052, segments: 5 }, scene);
        eyeW.material = mat(`deer_eyeWm_${idx}_${side}`, new Color3(0.90, 0.85, 0.72), scene);
        eyeW.position.set(ex, 0.32, 0.095);
        eyeW.parent = neckNode;
        eyeW.isPickable = false;
        const eyeI = MeshBuilder.CreateSphere(`deer_eyeI_${idx}_${side}`, { diameter: 0.035, segments: 4 }, scene);
        eyeI.material = eyeMat;
        eyeI.position.set(ex, 0.32, 0.106);
        eyeI.parent = neckNode;
        eyeI.isPickable = false;
    }

    if (idx < 2) {
        for (const [side, sx] of [[-1, -0.07], [1, 0.07]] as [number, number][]) {
            const mainBeam = taperedCyl(`deer_antB_${idx}_${side}`, 0.012, 0.020, 0.30, scene);
            mainBeam.material = antlerMat;
            mainBeam.rotation.z = side * 0.3;
            mainBeam.rotation.x = -0.2;
            mainBeam.position.set(sx, 0.44, 0);
            mainBeam.parent = neckNode;
            mainBeam.isPickable = false;
            
            for (const [tx, ty, tz] of [[sx * 1.5, 0.28, 0.05], [sx * 2.0, 0.20, -0.04]] as [number,number,number][]) {
                const tine = taperedCyl(`deer_tine_${idx}_${side}_${tx}`, 0.008, 0.014, 0.14, scene);
                tine.material = antlerMat;
                tine.rotation.z = side * 0.7;
                tine.rotation.x = 0.3;
                tine.position.set(tx * 0.055, 0.44 + ty * 0.35, tz);
                tine.parent = neckNode;
                tine.isPickable = false;
            }
        }
    }

    const tailMesh = MeshBuilder.CreateSphere(`deer_tail_${idx}`, { diameterX: 0.07, diameterY: 0.11, diameterZ: 0.09, segments: 4 }, scene);
    tailMesh.material = mat(`deer_tailm_${idx}`, new Color3(0.96, 0.92, 0.88), scene);
    tailMesh.position.set(0, 0.70, -0.40);
    tailMesh.parent = root;
    tailMesh.isPickable = false;

    const legNodes: TransformNode[] = [];
    const legPositions: [number,number,number][] = [
        [-0.12, 0.48, -0.18], [0.12, 0.48, -0.18],
        [-0.12, 0.48,  0.18], [0.12, 0.48,  0.18],
    ];
    for (let li = 0; li < 4; li++) {
        const [lx, ly, lz] = legPositions[li];
        const legNode = new TransformNode(`deer_legN_${idx}_${li}`, scene);
        legNode.parent = root;
        legNode.position.set(lx, ly, lz);
        legNodes.push(legNode);

        const upper = taperedCyl(`deer_uleg_${idx}_${li}`, 0.058, 0.072, 0.24, scene);
        upper.material = legMat;
        upper.position.y = -0.12;
        upper.parent = legNode;
        upper.isPickable = false;

        const lower = taperedCyl(`deer_lleg_${idx}_${li}`, 0.035, 0.050, 0.24, scene);
        lower.material = legMat;
        lower.position.y = -0.34;
        lower.parent = legNode;
        lower.isPickable = false;

        const hoof = MeshBuilder.CreateBox(`deer_hoof_${idx}_${li}`, { width: 0.055, height: 0.050, depth: 0.075 }, scene);
        hoof.material = mat(`deer_hoof_m_${idx}_${li}`, new Color3(0.18, 0.12, 0.08), scene);
        hoof.position.set(0, -0.48, 0.01);
        hoof.parent = legNode;
        hoof.isPickable = false;
    }

    const rand2 = seededRandom(idx * 11);
    let x = 0, z = 0, tries = 0;
    do {
        x = -35 + rand2() * 60;
        z = -30 + rand2() * 45;
        tries++;
    } while (isExcluded(x, z) && tries < 50);
    root.position.set(x, 0, z);

    const speed = 1.2 + rand2() * 0.8;
    return { root, legNodes, neckNode, tailMesh, vx: speed, vz: 0, speed: speed, phase: rand2() * Math.PI * 2 };
}

// ─── SPECIES 2 — FOX (Indian Fox) ─────────────────────────────────────────────

function buildFox(scene: Scene, idx: number): FoxState {
    const root = new TransformNode(`fox_${idx}`, scene);
    root.rotation.y = 0;
    const rand = seededRandom(idx * 53 + 7);

    const bodyMat = mat(`fox_body_${idx}`, new Color3(0.80, 0.40, 0.14), scene, 0.02);
    const bellyMat = mat(`fox_belly_${idx}`, new Color3(0.92, 0.82, 0.72), scene, 0.01);
    const legMat  = mat(`fox_leg_${idx}`,  new Color3(0.65, 0.30, 0.10), scene, 0.02);
    const noseMat = mat(`fox_nose_${idx}`, new Color3(0.18, 0.10, 0.08), scene, 0.01);
    const eyeMat  = mat(`fox_eye_${idx}`,  new Color3(0.22, 0.35, 0.08), scene, 0.01, 0.08);

    const body = MeshBuilder.CreateSphere(`fox_body_${idx}`, { diameterX: 0.28, diameterY: 0.26, diameterZ: 0.52, segments: 8 }, scene);
    body.material = bodyMat;
    body.position.set(0, 0.32, 0);
    body.parent = root;
    body.isPickable = false;

    const belly = MeshBuilder.CreateSphere(`fox_belly_${idx}`, { diameterX: 0.22, diameterY: 0.16, diameterZ: 0.38, segments: 6 }, scene);
    belly.material = bellyMat;
    belly.position.set(0, 0.26, 0);
    belly.parent = root;
    belly.isPickable = false;

    const neck = taperedCyl(`fox_neck_${idx}`, 0.088, 0.10, 0.16, scene);
    neck.material = bodyMat;
    neck.rotation.x = 0.35; 
    neck.position.set(0, 0.42, 0.22);
    neck.parent = root;
    neck.isPickable = false;

    const head = MeshBuilder.CreateSphere(`fox_head_${idx}`, { diameterX: 0.20, diameterY: 0.17, diameterZ: 0.20, segments: 7 }, scene);
    head.material = bodyMat;
    head.position.set(0, 0.48, 0.32);
    head.parent = root;
    head.isPickable = false;

    const snout = taperedCyl(`fox_snout_${idx}`, 0.040, 0.065, 0.18, scene);
    snout.material = bodyMat;
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.44, 0.47);
    snout.parent = root;
    snout.isPickable = false;

    const nose = MeshBuilder.CreateSphere(`fox_nose_${idx}`, { diameter: 0.038, segments: 4 }, scene);
    nose.material = noseMat;
    nose.position.set(0, 0.44, 0.56);
    nose.parent = root;
    nose.isPickable = false;

    for (const [side, sx] of [[-1, -0.08], [1, 0.08]] as [number,number][]) {
        const ear = MeshBuilder.CreateCylinder(`fox_ear_${idx}_${side}`, { diameterTop: 0.005, diameterBottom: 0.075, height: 0.10, tessellation: 6 }, scene);
        ear.material = bodyMat;
        ear.rotation.z = side * 0.18;
        ear.position.set(sx, 0.56, 0.28);
        ear.parent = root;
        ear.isPickable = false;
        
        const innerEar = MeshBuilder.CreateCylinder(`fox_iear_${idx}_${side}`, { diameterTop: 0.002, diameterBottom: 0.042, height: 0.08, tessellation: 5 }, scene);
        innerEar.material = mat(`fox_iear_m_${idx}_${side}`, new Color3(0.92, 0.68, 0.62), scene);
        innerEar.rotation.z = side * 0.18;
        innerEar.position.set(sx, 0.56, 0.285);
        innerEar.parent = root;
        innerEar.isPickable = false;
    }

    for (const [side, ex] of [[-1, -0.07], [1, 0.07]] as [number,number][]) {
        const eyeW = MeshBuilder.CreateSphere(`fox_eyeW_${idx}_${side}`, { diameter: 0.042, segments: 5 }, scene);
        eyeW.material = mat(`fox_eyeWm_${idx}_${side}`, new Color3(0.90, 0.85, 0.72), scene);
        eyeW.position.set(ex, 0.50, 0.37);
        eyeW.parent = root;
        eyeW.isPickable = false;
        
        const eyeI = MeshBuilder.CreateSphere(`fox_eyeI_${idx}_${side}`, { diameter: 0.028, segments: 4 }, scene);
        eyeI.material = eyeMat;
        eyeI.position.set(ex, 0.50, 0.378);
        eyeI.parent = root;
        eyeI.isPickable = false;
    }

    // ── FIX: REBUILT FOX TAIL HIERARCHY ──
    // The pivot node attaches to the butt and handles all tail rotation
    const tailNode = new TransformNode(`fox_tailN_${idx}`, scene);
    tailNode.parent = root;
    tailNode.position.set(0, 0.36, -0.32);
    // Positive rotation around X points the bottom of the cylinder down and back
    tailNode.rotation.x = 0.65; 

    // The orange tail base hangs perfectly down from the pivot node
    const tailBase = taperedCyl(`fox_tailB_${idx}`, 0.14, 0.08, 0.36, scene);
    tailBase.material = bodyMat;
    tailBase.position.set(0, -0.18, 0); // Centers the top of the cylinder perfectly on the pivot
    tailBase.parent = tailNode;
    tailBase.isPickable = false;

    // The white tip attaches perfectly at the bottom of the tail
    const tailTip = MeshBuilder.CreateSphere(`fox_tailT_${idx}`, { diameter: 0.18, segments: 6 }, scene);
    tailTip.material = mat(`fox_tailTm_${idx}`, new Color3(0.96, 0.96, 0.94), scene);
    tailTip.scaling.set(1, 1.3, 1); // Make it slightly elongated/fluffy
    tailTip.position.set(0, -0.36, 0); // Position exactly at the bottom of the tail
    tailTip.parent = tailNode;
    tailTip.isPickable = false;

    const legNodes: TransformNode[] = [];
    const legPos: [number,number,number][] = [
        [-0.10, 0.20, -0.12], [0.10, 0.20, -0.12],
        [-0.10, 0.20,  0.12], [0.10, 0.20,  0.12],
    ];
    for (let li = 0; li < 4; li++) {
        const [lx, ly, lz] = legPos[li];
        const legNode = new TransformNode(`fox_legN_${idx}_${li}`, scene);
        legNode.parent = root;
        legNode.position.set(lx, ly, lz);
        legNodes.push(legNode);

        const leg = taperedCyl(`fox_leg_${idx}_${li}`, 0.030, 0.042, 0.20, scene);
        leg.material = legMat;
        leg.position.y = -0.10;
        leg.parent = legNode;
        leg.isPickable = false;

        const paw = MeshBuilder.CreateSphere(`fox_paw_${idx}_${li}`, { diameter: 0.05, segments: 4 }, scene);
        paw.material = legMat;
        paw.scaling.set(1, 0.6, 1.2);
        paw.position.set(0, -0.20, 0.012);
        paw.parent = legNode;
        paw.isPickable = false;
    }

    let x = 0, z = 0, tries = 0;
    do {
        x = 10 + rand() * 30;
        z = -40 + rand() * 45;
        tries++;
    } while (isExcluded(x, z) && tries < 50);
    root.position.set(x, 0, z);

    const speed = 1.5 + rand();
    return { root, legNodes, tailNode, vx: speed, vz: 0, speed: speed, sleeping: false };
}

// ─── SPECIES 3 — BIRDS ────────────────────────────────────────────────────────

const BIRD_COLORS = [
    new Color3(0.12, 0.48, 0.82),  
    new Color3(0.12, 0.55, 0.28),  
    new Color3(0.78, 0.28, 0.12),  
    new Color3(0.85, 0.68, 0.12),  
    new Color3(0.42, 0.14, 0.68),  
];
const WING_COLORS = [
    new Color3(0.08, 0.30, 0.62),
    new Color3(0.08, 0.38, 0.18),
    new Color3(0.55, 0.18, 0.08),
    new Color3(0.68, 0.52, 0.08),
    new Color3(0.28, 0.08, 0.50),
];

function buildBird(scene: Scene, idx: number): BirdState {
    const root = new TransformNode(`bird_${idx}`, scene);
    root.rotation.y = 0;
    const rand = seededRandom(idx * 61 + 13);
    const col  = BIRD_COLORS[idx % BIRD_COLORS.length];
    const wcol = WING_COLORS[idx % WING_COLORS.length];
    const bMat = mat(`bird_body_${idx}`, col, scene, 0.02, 0.08);
    const wMat = mat(`bird_wing_${idx}`, wcol, scene, 0.01, 0.06);
    const eyeMat = mat(`bird_eye_${idx}`, new Color3(0.08, 0.05, 0.03), scene, 0.0, 0.10);

    const body = MeshBuilder.CreateSphere(`bird_body_${idx}`, { diameterX: 0.20, diameterY: 0.16, diameterZ: 0.30, segments: 7 }, scene);
    body.material = bMat;
    body.parent = root;
    body.isPickable = false;

    const breast = MeshBuilder.CreateSphere(`bird_breast_${idx}`, { diameterX: 0.16, diameterY: 0.13, diameterZ: 0.16, segments: 6 }, scene);
    breast.material = mat(`bird_brm_${idx}`, col.scale(1.3).add(new Color3(0.1,0.1,0.1)), scene, 0.01, 0.05);
    breast.position.set(0, -0.02, 0.08);
    breast.parent = root;
    breast.isPickable = false;

    const head = MeshBuilder.CreateSphere(`bird_head_${idx}`, { diameter: 0.14, segments: 7 }, scene);
    head.material = bMat;
    head.position.set(0, 0.06, 0.19);
    head.parent = root;
    head.isPickable = false;

    const beak = taperedCyl(`bird_beak_${idx}`, 0.006, 0.022, 0.10, scene);
    beak.material = mat(`bird_beakm_${idx}`, new Color3(0.28, 0.22, 0.10), scene, 0.01);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.04, 0.28);
    beak.parent = root;
    beak.isPickable = false;

    for (const ex of [-0.06, 0.06]) {
        const eye = MeshBuilder.CreateSphere(`bird_eye_${idx}_${ex}`, { diameter: 0.028, segments: 4 }, scene);
        eye.material = eyeMat;
        eye.position.set(ex, 0.07, 0.20);
        eye.parent = root;
        eye.isPickable = false;
        
        const shine = MeshBuilder.CreateSphere(`bird_shine_${idx}_${ex}`, { diameter: 0.010, segments: 3 }, scene);
        shine.material = mat(`bird_shine_m_${idx}_${ex}`, new Color3(1,1,1), scene, 0, 0.8);
        shine.position.set(ex * 1.1, 0.073, 0.21);
        shine.parent = root;
        shine.isPickable = false;
    }

    const wingLNode = new TransformNode(`bird_wLN_${idx}`, scene);
    wingLNode.parent = root;
    wingLNode.position.set(-0.10, 0, 0);

    const primL = MeshBuilder.CreateBox(`bird_primL_${idx}`, { width: 0.38, height: 0.025, depth: 0.18 }, scene);
    primL.material = wMat;
    primL.position.set(-0.19, 0, -0.04);
    primL.parent = wingLNode;
    primL.isPickable = false;

    const tipL = MeshBuilder.CreateBox(`bird_tipL_${idx}`, { width: 0.14, height: 0.018, depth: 0.09 }, scene);
    tipL.material = wMat;
    tipL.position.set(-0.44, 0, -0.08);
    tipL.rotation.y = -0.25;
    tipL.parent = wingLNode;
    tipL.isPickable = false;

    const wingRNode = new TransformNode(`bird_wRN_${idx}`, scene);
    wingRNode.parent = root;
    wingRNode.position.set(0.10, 0, 0);

    const primR = MeshBuilder.CreateBox(`bird_primR_${idx}`, { width: 0.38, height: 0.025, depth: 0.18 }, scene);
    primR.material = wMat;
    primR.position.set(0.19, 0, -0.04);
    primR.parent = wingRNode;
    primR.isPickable = false;

    const tipR = MeshBuilder.CreateBox(`bird_tipR_${idx}`, { width: 0.14, height: 0.018, depth: 0.09 }, scene);
    tipR.material = wMat;
    tipR.position.set(0.44, 0, -0.08);
    tipR.rotation.y = 0.25;
    tipR.parent = wingRNode;
    tipR.isPickable = false;

    const tailMesh = MeshBuilder.CreateBox(`bird_tail_${idx}`, { width: 0.10, height: 0.018, depth: 0.22 }, scene);
    tailMesh.material = wMat;
    tailMesh.position.set(0, 0, -0.19);
    tailMesh.parent = root;
    tailMesh.isPickable = false;

    if (idx === 0) {
        const longTail = taperedCyl(`bird_ltail_${idx}`, 0.006, 0.012, 0.55, scene);
        longTail.material = bMat;
        longTail.rotation.x = Math.PI / 2;
        longTail.position.set(0, 0, -0.30);
        longTail.parent = root;
        longTail.isPickable = false;
    }

    const orbitR = 10 + rand() * 20;
    const orbitH = 7 + rand() * 7;
    root.position.set(Math.cos(rand() * Math.PI * 2) * orbitR, orbitH, Math.sin(rand() * Math.PI * 2) * orbitR);

    return { root, wingLNode, wingRNode, orbitR, orbitH, orbitSpeed: 0.24 + rand() * 0.20, phase: rand() * Math.PI * 2, tailMesh };
}

// ─── SPECIES 4 — BUTTERFLIES ─────────────────────────────────────────────────

const BF_COLORS = [
    new Color3(0.98, 0.88, 0.10), new Color3(0.98, 0.50, 0.08), 
    new Color3(0.18, 0.42, 0.95), new Color3(0.96, 0.40, 0.65), 
    new Color3(0.92, 0.92, 0.92), new Color3(0.58, 0.18, 0.88), 
];
const BF_PATTERN = [
    new Color3(0.28, 0.18, 0.04), new Color3(0.12, 0.08, 0.02),
    new Color3(0.06, 0.14, 0.42), new Color3(0.52, 0.08, 0.22),
    new Color3(0.38, 0.38, 0.38), new Color3(0.22, 0.05, 0.42),
];

function buildButterfly(scene: Scene, idx: number): ButterflyState {
    const root = new TransformNode(`bf_${idx}`, scene);
    root.rotation.y = 0;
    const rand = seededRandom(idx * 71 + 19);
    const col  = BF_COLORS[Math.floor(idx / 2) % BF_COLORS.length];
    const pcol = BF_PATTERN[Math.floor(idx / 2) % BF_PATTERN.length];

    const bMat = mat(`bf_wing_${idx}`, col, scene, 0.01, 0.06);
    bMat.alpha = 0.88;
    const pMat = mat(`bf_pat_${idx}`, pcol, scene, 0.01, 0.03);
    pMat.alpha = 0.75;

    const abdomen = taperedCyl(`bf_abd_${idx}`, 0.016, 0.028, 0.16, scene);
    abdomen.material = mat(`bf_abd_m_${idx}`, pcol, scene, 0.01, 0.03);
    abdomen.rotation.x = Math.PI / 2;
    abdomen.position.z = -0.10;
    abdomen.parent = root;
    abdomen.isPickable = false;

    const bfHead = MeshBuilder.CreateSphere(`bf_head_${idx}`, { diameter: 0.036, segments: 4 }, scene);
    bfHead.material = mat(`bf_hm_${idx}`, pcol, scene, 0.01, 0.04);
    bfHead.position.z = 0.04;
    bfHead.parent = root;
    bfHead.isPickable = false;

    for (const ax of [-0.018, 0.018]) {
        const ant = taperedCyl(`bf_ant_${idx}_${ax}`, 0.002, 0.004, 0.10, scene);
        ant.material = pMat;
        ant.rotation.z = ax > 0 ? -0.4 : 0.4;
        ant.position.set(ax, 0.05, 0.04);
        ant.parent = root;
        ant.isPickable = false;
        
        const knob = MeshBuilder.CreateSphere(`bf_knob_${idx}_${ax}`, { diameter: 0.014, segments: 3 }, scene);
        knob.material = pMat;
        knob.position.set(ax * 1.5, 0.10, 0.04);
        knob.parent = root;
        knob.isPickable = false;
    }

    const wingLNode = new TransformNode(`bf_wLN_${idx}`, scene);
    wingLNode.parent = root;
    const wingRNode = new TransformNode(`bf_wRN_${idx}`, scene);
    wingRNode.parent = root;

    const fwL = MeshBuilder.CreateBox(`bf_fwL_${idx}`, { width: 0.22, height: 0.006, depth: 0.18 }, scene);
    fwL.material = bMat;
    fwL.position.set(-0.11, 0, 0.02);
    fwL.rotation.y = 0.15;
    fwL.parent = wingLNode;
    fwL.isPickable = false;

    const fwR = MeshBuilder.CreateBox(`bf_fwR_${idx}`, { width: 0.22, height: 0.006, depth: 0.18 }, scene);
    fwR.material = bMat;
    fwR.position.set(0.11, 0, 0.02);
    fwR.rotation.y = -0.15;
    fwR.parent = wingRNode;
    fwR.isPickable = false;

    const hwL = MeshBuilder.CreateBox(`bf_hwL_${idx}`, { width: 0.16, height: 0.005, depth: 0.14 }, scene);
    hwL.material = bMat;
    hwL.position.set(-0.09, 0, -0.06);
    hwL.rotation.y = 0.3;
    hwL.parent = wingLNode;
    hwL.isPickable = false;

    const hwR = MeshBuilder.CreateBox(`bf_hwR_${idx}`, { width: 0.16, height: 0.005, depth: 0.14 }, scene);
    hwR.material = bMat;
    hwR.position.set(0.09, 0, -0.06);
    hwR.rotation.y = -0.3;
    hwR.parent = wingRNode;
    hwR.isPickable = false;

    for (let p = 0; p < 3; p++) {
        const dot = MeshBuilder.CreateSphere(`bf_dot_${idx}_${p}`, { diameter: 0.028, segments: 3 }, scene);
        dot.material = pMat;
        dot.position.set(-0.08 - p * 0.04, 0.005, 0.02 + (p % 2) * 0.05);
        dot.parent = wingLNode;
        dot.isPickable = false;
        
        const dotR = dot.clone(`bf_dotR_${idx}_${p}`);
        dotR.position.x = 0.08 + p * 0.04;
        dotR.parent = wingRNode;
        dotR.isPickable = false;
    }

    const ox = (rand() - 0.5) * 32;
    const oz = (rand() - 0.5) * 32;
    const baseY = 0.8 + rand() * 1.5;
    root.position.set(ox, baseY, oz);
    return { root, wingLNode, wingRNode, t8phase: rand() * Math.PI * 2, ox, oz, baseY };
}

// ─── SPECIES 5 — PEACOCK ─────────────────────────────────────────────────────

function buildPeacock(scene: Scene, idx: number): PeacockState {
    const root = new TransformNode(`peacock_${idx}`, scene);
    const legs: TransformNode[] = [];
    const fan: TransformNode[] = [];

    const bodyMat    = mat(`pk_body_${idx}`,    new Color3(0.08, 0.38, 0.52), scene, 0.04, 0.10);
    const neckMat    = mat(`pk_neck_${idx}`,    new Color3(0.08, 0.30, 0.62), scene, 0.04, 0.12);
    const headMat    = mat(`pk_head_${idx}`,    new Color3(0.08, 0.32, 0.58), scene, 0.03, 0.10);
    const crownMat   = mat(`pk_crown_${idx}`,   new Color3(0.12, 0.68, 0.42), scene, 0.02, 0.18);
    const featherMat = mat(`pk_feat_${idx}`,    new Color3(0.08, 0.52, 0.35), scene, 0.03, 0.12);
    const eyeSpotMat = mat(`pk_eyespot_${idx}`, new Color3(0.20, 0.62, 0.90), scene, 0.02, 0.22);
    const legMat     = mat(`pk_leg_${idx}`,     new Color3(0.48, 0.42, 0.28), scene, 0.02);

    const body = MeshBuilder.CreateSphere(`pk_body_${idx}`, { diameterX: 0.32, diameterY: 0.30, diameterZ: 0.55, segments: 8 }, scene);
    body.material = bodyMat;
    body.position.set(0, 0.40, 0);
    body.parent = root;
    body.isPickable = false;

    const belly = MeshBuilder.CreateSphere(`pk_belly_${idx}`, { diameterX: 0.28, diameterY: 0.20, diameterZ: 0.40, segments: 6 }, scene);
    belly.material = mat(`pk_bellyM_${idx}`, new Color3(0.12, 0.28, 0.40), scene, 0.02, 0.06);
    belly.position.set(0, 0.34, 0);
    belly.parent = root;
    belly.isPickable = false;

    const neck = taperedCyl(`pk_neck_${idx}`, 0.08, 0.10, 0.30, scene);
    neck.material = neckMat;
    neck.rotation.x = 0.30; 
    neck.position.set(0, 0.55, 0.22);
    neck.parent = root;
    neck.isPickable = false;

    const head = MeshBuilder.CreateSphere(`pk_head_${idx}`, { diameter: 0.16, segments: 7 }, scene);
    head.material = headMat;
    head.position.set(0, 0.70, 0.34);
    head.parent = root;
    head.isPickable = false;

    for (let i = 0; i < 7; i++) {
        const ang = ((i - 3) / 6) * 0.8;
        const crest = taperedCyl(`pk_crest_${idx}_${i}`, 0.005, 0.010, 0.10, scene);
        crest.material = crownMat;
        crest.position.set(0, 0.76, 0.34);
        crest.rotation.x = ang; 
        crest.parent = root;
        crest.isPickable = false;
        
        const ball = MeshBuilder.CreateSphere(`pk_crball_${idx}_${i}`, { diameter: 0.022, segments: 3 }, scene);
        ball.material = crownMat;
        ball.position.set(0, 0.81, 0.34 + Math.sin(ang)*0.05);
        ball.parent = root;
        ball.isPickable = false;
    }

    const beak = taperedCyl(`pk_beak_${idx}`, 0.006, 0.018, 0.09, scene);
    beak.material = mat(`pk_beakM_${idx}`, new Color3(0.35, 0.28, 0.12), scene, 0.01);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.68, 0.44);
    beak.parent = root;
    beak.isPickable = false;

    for (const ex of [-0.065, 0.065]) {
        const eyeW = MeshBuilder.CreateSphere(`pk_eyeW_${idx}_${ex}`, { diameter: 0.036, segments: 4 }, scene);
        eyeW.material = mat(`pk_eyeWm_${idx}_${ex}`, new Color3(0.96, 0.92, 0.80), scene);
        eyeW.position.set(ex, 0.72, 0.38);
        eyeW.parent = root;
        eyeW.isPickable = false;
        
        const eyeI = MeshBuilder.CreateSphere(`pk_eyeI_${idx}_${ex}`, { diameter: 0.022, segments: 4 }, scene);
        eyeI.material = mat(`pk_eyeIm_${idx}_${ex}`, new Color3(0.08, 0.05, 0.02), scene);
        eyeI.position.set(ex * 1.1, 0.72, 0.385);
        eyeI.parent = root;
        eyeI.isPickable = false;
    }

    const legPositions: [number,number][] = [[-0.08, 0], [0.08, 0]];
    for (let li = 0; li < 2; li++) {
        const [lx, lz] = legPositions[li];
        const legNode = new TransformNode(`pk_legN_${idx}_${li}`, scene);
        legNode.parent = root;
        legNode.position.set(lx, 0.24, lz);
        legs.push(legNode);

        const upper = taperedCyl(`pk_uleg_${idx}_${li}`, 0.024, 0.030, 0.12, scene);
        upper.material = legMat;
        upper.position.y = -0.06;
        upper.parent = legNode;
        upper.isPickable = false;

        const lower = taperedCyl(`pk_lleg_${idx}_${li}`, 0.016, 0.022, 0.12, scene);
        lower.material = legMat;
        lower.position.set(0, -0.18, 0);
        lower.parent = legNode;
        lower.isPickable = false;

        for (const [fx, fz] of [[0.04, 0.05], [-0.02, 0.04], [0, -0.04]] as [number,number][]) {
            const toe = taperedCyl(`pk_toe_${idx}_${li}_${fx}`, 0.004, 0.008, 0.06, scene);
            toe.material = legMat;
            toe.rotation.x = Math.PI / 2;
            toe.position.set(fx, -0.24, fz);
            toe.parent = legNode;
            toe.isPickable = false;
        }
    }

    for (let i = 0; i < 16; i++) {
        const ang = ((i - 7.5) / 15) * Math.PI * 0.72;
        const fanNode = new TransformNode(`pk_fan_${idx}_${i}`, scene);
        fanNode.parent = root;
        fanNode.position.set(0, 0.40, -0.28);
        fanNode.rotation.z = ang;
        fan.push(fanNode);

        const shaft = taperedCyl(`pk_shaft_${idx}_${i}`, 0.008, 0.014, 0.62, scene);
        shaft.material = featherMat;
        shaft.position.y = 0.31;
        shaft.parent = fanNode;
        shaft.isPickable = false;

        const vane = MeshBuilder.CreateBox(`pk_vane_${idx}_${i}`, { width: 0.055, height: 0.42, depth: 0.008 }, scene);
        vane.material = featherMat;
        vane.position.y = 0.36;
        vane.parent = fanNode;
        vane.isPickable = false;

        const eyeSpot = MeshBuilder.CreateSphere(`pk_espot_${idx}_${i}`, { diameter: 0.075, segments: 5 }, scene);
        eyeSpot.material = eyeSpotMat;
        eyeSpot.scaling.set(1, 0.3, 1);
        eyeSpot.position.set(0, 0.60, 0.005);
        eyeSpot.parent = fanNode;
        eyeSpot.isPickable = false;

        const eyeCore = MeshBuilder.CreateSphere(`pk_ecore_${idx}_${i}`, { diameter: 0.040, segments: 4 }, scene);
        eyeCore.material = mat(`pk_ecoremM_${idx}_${i}`, new Color3(0.10, 0.14, 0.58), scene, 0.02, 0.20);
        eyeCore.scaling.set(1, 0.3, 1);
        eyeCore.position.set(0, 0.60, 0.010);
        eyeCore.parent = fanNode;
        eyeCore.isPickable = false;
    }

    const rand = seededRandom(idx * 113 + 42);
    let ox = 0, oz = 0, tries = 0;
    do {
        ox = -20 + rand() * 40;
        oz = -20 + rand() * 40;
        tries++;
    } while (isExcluded(ox, oz) && tries < 50);

    root.position.set(ox, 0, oz);

    const dir = rand() * Math.PI * 2;
    const speed = 0.7 + rand() * 0.5;

    return {
        root,
        legs,
        fan,
        vx: Math.sin(dir) * speed,
        vz: Math.cos(dir) * speed,
        speed,
        ox,
        oz,
        roamR: 6 + rand() * 3,
        fanOpenState: false,
    };
}

// ─── SPECIES 6 — DRAGONFLIES ─────────────────────────────────────────────────

function buildDragonfly(scene: Scene, idx: number): DragonflyState {
    const root = new TransformNode(`df_${idx}`, scene);
    const rand = seededRandom(idx * 89 + 31);

    const bodyMat = mat(`df_body_${idx}`, new Color3(0.12, 0.52, 0.92), scene, 0.04, 0.35);
    const wMat    = mat(`df_wing_${idx}`, new Color3(0.75, 0.90, 1.0), scene, 0.06, 0.15);
    wMat.alpha = 0.68;

    const thorax = MeshBuilder.CreateSphere(`df_thorax_${idx}`, { diameterX: 0.06, diameterY: 0.05, diameterZ: 0.06, segments: 5 }, scene);
    thorax.material = bodyMat;
    thorax.parent = root;
    thorax.isPickable = false;

    for (let s = 0; s < 5; s++) {
        const seg = MeshBuilder.CreateSphere(`df_seg_${idx}_${s}`, { diameterX: 0.052 - s * 0.006, diameterY: 0.040 - s * 0.004, diameterZ: 0.052 - s * 0.006, segments: 5 }, scene);
        seg.material = s % 2 === 0
            ? bodyMat
            : mat(`df_segB_${idx}_${s}`, new Color3(0.08, 0.38, 0.72), scene, 0.03, 0.25);
        seg.position.z = -0.055 - s * 0.05;
        seg.parent = root;
        seg.isPickable = false;
    }

    const head = MeshBuilder.CreateSphere(`df_head_${idx}`, { diameter: 0.055, segments: 5 }, scene);
    head.material = bodyMat;
    head.position.z = 0.060;
    head.parent = root;
    head.isPickable = false;

    for (const ex of [-0.028, 0.028]) {
        const eye = MeshBuilder.CreateSphere(`df_eye_${idx}_${ex}`, { diameter: 0.038, segments: 5 }, scene);
        eye.material = mat(`df_eyeM_${idx}_${ex}`, new Color3(0.32, 0.62, 0.28), scene, 0.04, 0.18);
        eye.position.set(ex, 0, 0.058);
        eye.parent = root;
        eye.isPickable = false;
    }

    const wingLNode = new TransformNode(`df_wLN_${idx}`, scene);
    wingLNode.parent = root;
    const wingRNode = new TransformNode(`df_wRN_${idx}`, scene);
    wingRNode.parent = root;

    const fwL = MeshBuilder.CreateBox(`df_fwL_${idx}`, { width: 0.28, height: 0.008, depth: 0.08 }, scene);
    fwL.material = wMat;
    fwL.position.set(-0.14, 0.01, 0.015);
    fwL.parent = wingLNode;
    fwL.isPickable = false;

    const fwR = MeshBuilder.CreateBox(`df_fwR_${idx}`, { width: 0.28, height: 0.008, depth: 0.08 }, scene);
    fwR.material = wMat;
    fwR.position.set(0.14, 0.01, 0.015);
    fwR.parent = wingRNode;
    fwR.isPickable = false;

    const hwL = MeshBuilder.CreateBox(`df_hwL_${idx}`, { width: 0.26, height: 0.007, depth: 0.09 }, scene);
    hwL.material = wMat;
    hwL.rotation.y = 0.12;
    hwL.position.set(-0.13, -0.008, -0.015);
    hwL.parent = wingLNode;
    hwL.isPickable = false;

    const hwR = MeshBuilder.CreateBox(`df_hwR_${idx}`, { width: 0.26, height: 0.007, depth: 0.09 }, scene);
    hwR.material = wMat;
    hwR.rotation.y = -0.12;
    hwR.position.set(0.13, -0.008, -0.015);
    hwR.parent = wingRNode;
    hwR.isPickable = false;

    const ox = -12 + rand() * 24;
    const oz = 28  + rand() * 12;
    root.position.set(ox, 0.9 + rand() * 0.8, oz);
    return { root, wingLNode, wingRNode, orbitPhase: rand() * Math.PI * 2, orbitX: ox, orbitZ: oz, baseY: 0.6 + rand() * 1.2 };
}

// ─── BUILD ALL ANIMALS ────────────────────────────────────────────────────────

export function buildAnimals(scene: Scene): void {
    _scene = scene;
    _lastTime = 0;
    
    for (let i = 0; i < 6; i++) _deer.push(buildDeer(scene, i));
    for (let i = 0; i < 4; i++) _foxes.push(buildFox(scene, i));
    for (let i = 0; i < 10; i++) _birds.push(buildBird(scene, i));
    for (let i = 0; i < 20; i++) _butterflies.push(buildButterfly(scene, i));
    for (let i = 0; i < 5; i++) _peacocks.push(buildPeacock(scene, i));
    for (let i = 0; i < 8; i++) _dragonflies.push(buildDragonfly(scene, i));
}

// ─── UPDATE ALL ANIMALS ───────────────────────────────────────────────────────

export function updateAnimals(healthT: number, worldTime: number, _scores: EcoScores): void {
    const dt = Math.min(worldTime - _lastTime || 0.016, 0.1); 
    _lastTime = worldTime;
    const t = worldTime;

    // ── DEER ──────────────────────────────────────────────────────────────────
    // Population thinning: as the world's health declines (healthT rises),
    // the chital herd shrinks — fewer deer roam the plains, simulating real
    // population collapse rather than the whole species vanishing at once.
    const deerVisible =
        healthT < 0.15 ? 6 :
        healthT < 0.35 ? 5 :
        healthT < 0.50 ? 4 :
        healthT < 0.65 ? 3 :
        healthT < 0.80 ? 2 :
        healthT < 0.95 ? 1 : 0;

    for (let di = 0; di < _deer.length; di++) {
        const d = _deer[di];
        const enabled = di < deerVisible;
        d.root.setEnabled(enabled);
        if (!enabled) continue;

        const speedMult = healthT < 0.50 ? 1.0 : healthT < 0.75 ? 0.45 : 0.12;
        let nx = d.root.position.x + d.vx * dt * speedMult;
        let nz = d.root.position.z + d.vz * dt * speedMult;
        let reflected = false;

        const ta = treeAvoid(nx, nz, d.vx, d.vz, 1.0);
        if (ta.hit) { d.vx = ta.vx; d.vz = ta.vz; reflected = true; }

        const ga = groundAvoid(nx, nz, d.vx, d.vz, d.root, 1.1);
        if (ga.hit) { d.vx = ga.vx; d.vz = ga.vz; reflected = true; }

        if (isOutOfBounds(nx, nz) || nx < -35 || nx > 25 || nz < -30 || nz > 15) {
            const toCenterX = 0 - nx;
            const toCenterZ = 0 - nz;
            const len = Math.hypot(toCenterX, toCenterZ) || 1;
            d.vx = (toCenterX / len) * d.speed;
            d.vz = (toCenterZ / len) * d.speed;
            reflected = true;
        }

        if (reflected) {
            const mag = Math.hypot(d.vx, d.vz) || 1;
            d.vx = (d.vx / mag) * d.speed;
            d.vz = (d.vz / mag) * d.speed;
            nx = d.root.position.x + d.vx * dt * speedMult;
            nz = d.root.position.z + d.vz * dt * speedMult;
        }

        d.root.position.x = nx;
        d.root.position.z = nz;
        d.root.position.y = getTerrainHeightAt(nx, nz); 
        d.root.rotation.y = Math.atan2(d.vx, d.vz); 

        const legSwing = Math.sin(t * 4.2 * speedMult + d.phase) * 0.55 * speedMult;
        d.legNodes[0].rotation.x =  legSwing;
        d.legNodes[1].rotation.x = -legSwing;
        d.legNodes[2].rotation.x = -legSwing;
        d.legNodes[3].rotation.x =  legSwing;

        d.neckNode.rotation.x = 0.5 + Math.sin(t * 4.2 * speedMult + d.phase + 0.5) * 0.06 * speedMult;
        d.tailMesh.rotation.y = Math.sin(t * 2.5) * 0.3;
    }

    // ── FOXES ─────────────────────────────────────────────────────────────────
    // Foxes thin out exactly like the deer herd as the score drops.
    const foxVisible =
        healthT < 0.20 ? 4 :
        healthT < 0.40 ? 3 :
        healthT < 0.60 ? 2 :
        healthT < 0.85 ? 1 : 0;

    for (let fi = 0; fi < _foxes.length; fi++) {
        const f = _foxes[fi];
        const enabled = fi < foxVisible;
        f.root.setEnabled(enabled);
        if (!enabled) continue;

        if (healthT >= 0.85) {
            f.sleeping = true;
            f.root.rotation.x = 0.5;
            continue;
        }
        f.sleeping = false;
        f.root.rotation.x = 0;
        
        const slowMult = healthT < 0.65 ? 1.0 : 0.35;
        let nx = f.root.position.x + f.vx * dt * slowMult;
        let nz = f.root.position.z + f.vz * dt * slowMult;
        let reflected = false;

        const ta = treeAvoid(nx, nz, f.vx, f.vz, 1.0);
        if (ta.hit) { f.vx = ta.vx; f.vz = ta.vz; reflected = true; }

        const ga = groundAvoid(nx, nz, f.vx, f.vz, f.root, 1.0);
        if (ga.hit) { f.vx = ga.vx; f.vz = ga.vz; reflected = true; }
        
        if (isOutOfBounds(nx, nz) || nx < 10 || nx > 40 || nz < -40 || nz > 5) {
            const toCenterX = 25 - nx; 
            const toCenterZ = -15 - nz;
            const len = Math.hypot(toCenterX, toCenterZ) || 1;
            f.vx = (toCenterX / len) * f.speed;
            f.vz = (toCenterZ / len) * f.speed;
            reflected = true;
        }

        if (reflected) {
            const mag = Math.hypot(f.vx, f.vz) || 1;
            f.vx = (f.vx / mag) * f.speed;
            f.vz = (f.vz / mag) * f.speed;
            nx = f.root.position.x + f.vx * dt * slowMult;
            nz = f.root.position.z + f.vz * dt * slowMult;
        }

        f.root.position.x = nx;
        f.root.position.z = nz;
        f.root.position.y = getTerrainHeightAt(nx, nz);
        f.root.rotation.y = Math.atan2(f.vx, f.vz);

        const legSwing = Math.sin(t * 5.2 * slowMult) * 0.48 * slowMult;
        f.legNodes[0].rotation.x =  legSwing;
        f.legNodes[1].rotation.x = -legSwing;
        f.legNodes[2].rotation.x = -legSwing;
        f.legNodes[3].rotation.x =  legSwing;

        f.tailNode.rotation.y = Math.sin(t * 3.0) * 0.35;
    }

    // ── BIRDS ─────────────────────────────────────────────────────────────────
    // Bird flocks shrink as the score drops — fewer wings in the sky.
    const birdVisible =
        healthT < 0.20 ? 10 :
        healthT < 0.40 ? 8 :
        healthT < 0.55 ? 6 :
        healthT < 0.70 ? 4 :
        healthT < 0.85 ? 2 :
        healthT < 0.97 ? 1 : 0;

    for (let bi = 0; bi < _birds.length; bi++) {
        const b = _birds[bi];
        const enabled = bi < birdVisible;
        b.root.setEnabled(enabled);
        if (!enabled) continue;

        const flapSpeed  = healthT < 0.40 ? 5.5 : healthT < 0.70 ? 3.8 : 7.5;
        const targetH    = healthT < 0.40 ? b.orbitH : healthT < 0.70 ? b.orbitH * 0.65 : b.orbitH * 0.38;
        b.phase += b.orbitSpeed * dt * 0.5;
        
        let px = Math.cos(b.phase) * b.orbitR;
        let pz = Math.sin(b.phase) * b.orbitR;
        // Low-flying birds (near collapse) can dip near canopy height — keep them off the trunks.
        const pushed = pushOffTrees(px, pz, 0.8);
        px = pushed.x; pz = pushed.z;

        // Birds shouldn't fly through each other either — nudge away from
        // any already-placed bird this frame that's close both horizontally
        // and in altitude.
        for (let oj = 0; oj < bi; oj++) {
            const ob = _birds[oj];
            if (!ob.root.isEnabled()) continue;
            const dx = px - ob.root.position.x, dz = pz - ob.root.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.0001 && dist < 1.3 && Math.abs((b.orbitH) - (ob.orbitH)) < 2.5) {
                const push = 1.3 - dist;
                px += (dx / dist) * push;
                pz += (dz / dist) * push;
            }
        }

        b.root.position.x = px;
        b.root.position.z = pz;
        const h = getTerrainHeightAt(px, pz);
        b.root.position.y = h + targetH + Math.sin(t * 1.4 + b.phase) * 0.9;
        
        const vx = -Math.sin(b.phase) * b.orbitR;
        const vz = Math.cos(b.phase) * b.orbitR;
        b.root.rotation.y = Math.atan2(vx, vz); 

        const flapAmt = Math.sin(t * flapSpeed + b.phase) * 0.58;
        b.wingLNode.rotation.z = -flapAmt;
        b.wingRNode.rotation.z =  flapAmt;
        b.root.rotation.z = Math.sin(b.phase + 0.5) * 0.18;
        b.tailMesh.rotation.x = Math.sin(t * flapSpeed * 0.5 + b.phase) * 0.12;
    }

    // ── BUTTERFLIES ───────────────────────────────────────────────────────────
    const bfVisible =
        healthT < 0.15 ? 20 :
        healthT < 0.30 ? 16 :
        healthT < 0.45 ? 12 :
        healthT < 0.60 ? 8 :
        healthT < 0.75 ? 5 :
        healthT < 0.90 ? 2 : 0;
    for (let i = 0; i < _butterflies.length; i++) {
        const b = _butterflies[i];
        b.root.setEnabled(i < bfVisible);
        if (i >= bfVisible) continue;
        
        b.t8phase += dt * 1.2;
        let px = b.ox + Math.sin(b.t8phase * 0.8) * 2.8;
        let pz = b.oz + Math.cos(b.t8phase * 0.9) * 2.2;
        const pushed = pushOffTrees(px, pz, 0.55);
        px = pushed.x; pz = pushed.z;

        // Butterflies shouldn't flutter through each other either.
        for (let oj = 0; oj < i; oj++) {
            const ob = _butterflies[oj];
            if (!ob.root.isEnabled()) continue;
            const dx = px - ob.root.position.x, dz = pz - ob.root.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.0001 && dist < 0.5) {
                const push = 0.5 - dist;
                px += (dx / dist) * push;
                pz += (dz / dist) * push;
            }
        }
        
        b.root.position.x = px;
        b.root.position.z = pz;
        const h = getTerrainHeightAt(px, pz);
        b.root.position.y = h + b.baseY + Math.sin(b.t8phase * 2.2) * 0.45;
        
        const velX = Math.cos(b.t8phase * 0.8) * 2.8 * 0.8;
        const velZ = -Math.sin(b.t8phase * 0.9) * 2.2 * 0.9;
        if (Math.abs(velX) + Math.abs(velZ) > 0.01) {
            b.root.rotation.y = Math.atan2(velX, velZ); 
        }
        
        const flapAmt = Math.abs(Math.sin(t * 8.0 + b.t8phase)) * 1.1;
        b.wingLNode.rotation.y = -flapAmt;
        b.wingRNode.rotation.y =  flapAmt;
    }

    
    // ── PEACOCK ───────────────────────────────────────────────────────────────
    // Peacocks vanish from the world gradually as it loses its charm.
    const peacockVisible =
        healthT < 0.25 ? 5 :
        healthT < 0.45 ? 4 :
        healthT < 0.60 ? 3 :
        healthT < 0.75 ? 2 :
        healthT < 0.90 ? 1 : 0;

    for (let pi = 0; pi < _peacocks.length; pi++) {
        const p = _peacocks[pi];
        const enabled = pi < peacockVisible;
        p.root.setEnabled(enabled);
        if (!enabled) continue;

        const speedMult = healthT < 0.45 ? 1.0 : healthT < 0.70 ? 0.5 : 0.2;
        let nx = p.root.position.x + p.vx * dt * speedMult;
        let nz = p.root.position.z + p.vz * dt * speedMult;
        let reflected = false;

        const ta = treeAvoid(nx, nz, p.vx, p.vz, 0.95);
        if (ta.hit) { p.vx = ta.vx; p.vz = ta.vz; reflected = true; }

        const ga = groundAvoid(nx, nz, p.vx, p.vz, p.root, 1.1);
        if (ga.hit) { p.vx = ga.vx; p.vz = ga.vz; reflected = true; }

        const distFromHome = Math.hypot(nx - p.ox, nz - p.oz);
        if (isOutOfBounds(nx, nz) || distFromHome > p.roamR) {
            const toHomeX = p.ox - nx;
            const toHomeZ = p.oz - nz;
            const len = Math.hypot(toHomeX, toHomeZ) || 1;
            p.vx = (toHomeX / len) * p.speed;
            p.vz = (toHomeZ / len) * p.speed;
            reflected = true;
        }

        if (reflected) {
            const mag = Math.hypot(p.vx, p.vz) || 1;
            p.vx = (p.vx / mag) * p.speed;
            p.vz = (p.vz / mag) * p.speed;
            nx = p.root.position.x + p.vx * dt * speedMult;
            nz = p.root.position.z + p.vz * dt * speedMult;
        }

        p.root.position.x = nx;
        p.root.position.z = nz;
        p.root.position.y = getTerrainHeightAt(nx, nz);
        p.root.rotation.y = Math.atan2(p.vx, p.vz);

        const playerPos = (_scene?.getNodeByName('charRoot') as TransformNode | null)?.position;
        const distToPlayer = playerPos ? Math.hypot(nx - playerPos.x, nz - playerPos.z) : Infinity;
        // Hysteresis band, not a single hard threshold: this is what was
        // causing the fan (and the player-near-an-animal "tweaking"/flicker)
        // — if the player hovers right at the boundary distance, a single
        // cutoff flips state every frame. A gap between the open-distance
        // and close-distance means the fan only changes state once per real
        // approach/retreat, not every frame while standing near the line.
        if (distToPlayer < 6.5) p.fanOpenState = true;
        else if (distToPlayer > 9.0) p.fanOpenState = false;
        const fanOpen = p.fanOpenState || healthT < 0.35;
        const fanTarget = fanOpen ? 1.0 : 0.12;
        for (let i = 0; i < p.fan.length; i++) {
            const f = p.fan[i];
            const baseAng = ((i - 5.5) / 11) * Math.PI * 0.8;
            f.rotation.z = lerp(f.rotation.z, baseAng * fanTarget, 0.04);
            f.rotation.x = lerp(f.rotation.x, fanOpen ? -0.35 : -0.85, 0.04);
            if (fanOpen) {
                f.rotation.z += Math.sin(t * 1.8 + i * 0.4) * 0.02;
            }
        }

        const legWalk = Math.sin(t * 2.5) * 0.28;
        if (p.legs.length > 1) {
            p.legs[0].rotation.x =  legWalk;
            p.legs[1].rotation.x = -legWalk;
        }
    }

    // ── DRAGONFLIES ───────────────────────────────────────────────────────────
    const dfVisible =
        healthT < 0.20 ? 8 :
        healthT < 0.35 ? 6 :
        healthT < 0.50 ? 4 :
        healthT < 0.65 ? 3 :
        healthT < 0.80 ? 1 : 0;
    for (let i = 0; i < _dragonflies.length; i++) {
        const d = _dragonflies[i];
        d.root.setEnabled(i < dfVisible);
        if (i >= dfVisible) continue;
        
        d.orbitPhase += dt * 2.1;
        let px = d.orbitX + Math.cos(d.orbitPhase) * 2.8;
        let pz = d.orbitZ + Math.sin(d.orbitPhase) * 1.8;
        const pushed = pushOffTrees(px, pz, 0.5);
        px = pushed.x; pz = pushed.z;
        
        d.root.position.x = px;
        d.root.position.z = pz;
        const h = getTerrainHeightAt(px, pz);
        d.root.position.y = h + d.baseY;
        
        const vx = -Math.sin(d.orbitPhase) * 2.8;
        const vz =  Math.cos(d.orbitPhase) * 1.8;
        d.root.rotation.y = Math.atan2(vx, vz); 
        
        const flapAmt = Math.sin(t * 22 + i) * 0.45;
        d.wingLNode.rotation.z = -flapAmt;
        d.wingRNode.rotation.z =  flapAmt;
    }
}

// ─── PLAYER COLLISION QUERY ────────────────────────────────────────────────────
// Lets character.ts block the player's movement against currently-visible
// ground animals (deer / fox / peacock), without character.ts needing to know
// anything about animal internals. Flying species are deliberately excluded —
// they're overhead, not underfoot.
export function getGroundAnimalColliders(): { x: number; z: number; r: number }[] {
    const list: { x: number; z: number; r: number }[] = [];
    for (const d of _deer)     if (d.root.isEnabled()) list.push({ x: d.root.position.x, z: d.root.position.z, r: 0.55 });
    for (const f of _foxes)    if (f.root.isEnabled()) list.push({ x: f.root.position.x, z: f.root.position.z, r: 0.42 });
    for (const p of _peacocks) if (p.root.isEnabled()) list.push({ x: p.root.position.x, z: p.root.position.z, r: 0.48 });
    return list;
}