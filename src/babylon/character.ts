/**
 * src/babylon/character.ts — EcoWorld v4 BEAUTIFUL CHARACTER
 *
 * CHARACTER DESIGN:
 * - Indian school boy/girl aged ~8-10
 * - Proper school uniform: white shirt, dark navy pants/skirt, black shoes
 * - Round cute face with brown skin, big expressive eyes, smile
 * - Black hair with proper shape (side-parted, slightly puffy)
 * - Green school backpack with straps visible
 * - Realistic proportions for a child (bigger head relative to body)
 * - Smooth walk/run animation with arm swing
 * - Casts shadows on terrain
 */

import {
    Scene,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Vector3,
    TransformNode,
    Mesh,
    ArcRotateCamera,
    Ray,
    ShadowGenerator,
} from '@babylonjs/core';
import { lerp } from './engine';
import { treePositions, treeAlive } from './trees';
import { getGroundAnimalColliders } from './animals';

// ─── TERRAIN HEIGHT LOOKUP ────────────────────────────────────────────────────
let _scene: Scene | null = null;

export function getTerrainY(x: number, z: number): number {
    if (!_scene) return 0;
    const ray = new Ray(new Vector3(x, 25, z), new Vector3(0, -1, 0), 35);
    const hit = _scene.pickWithRay(ray, (m) => m.name === 'ground');
    return hit?.pickedPoint?.y ?? 0;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface CharacterRef {
    root:    TransformNode;
    pelvis:  TransformNode;
    torso:   Mesh;
    head:    Mesh;
    uArmL:   TransformNode; lArmL: Mesh;
    uArmR:   TransformNode; lArmR: Mesh;
    uLegL:   TransformNode; lLegL: Mesh;
    uLegR:   TransformNode; lLegR: Mesh;
    allMeshes: Mesh[];
}

export const joystickState = { x: 0, z: 0, magnitude: 0, touchActive: false };
export let camYaw    = 0;
export let camPitch  = 0.82;  // lower angle = more horizon visible
export let camRadius = 10.0;  // target radius — set by wheel/pinch, lerped in updateCamera

export function setCamYaw(v: number):    void { camYaw = v; }
export function getCamYaw(): number           { return camYaw; }
export function setCamPitch(v: number):  void { camPitch = Math.max(0.30, Math.min(1.55, v)); }
export function getCamPitch(): number         { return camPitch; }
export function setCamRadius(v: number): void { camRadius = Math.max(3.5, Math.min(55, v)); }
export function getCamRadius(): number        { return camRadius; }
export function resetCamera(): void           { camYaw = 0; camPitch = 0.82; camRadius = 10.0; }

let _animBlend  = 0.0;
let _animTime   = 0.0;
let _targetRotY = 0.0;

// ─── MATERIAL HELPERS ─────────────────────────────────────────────────────────

function mkMat(name: string, col: Color3, scene: Scene, spec = 0.04, emissive = 0.06): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor  = col.clone();
    m.specularColor = new Color3(spec, spec, spec);
    m.ambientColor  = col.scale(0.35);
    m.emissiveColor = col.scale(emissive);
    return m;
}

// ─── BUILD CHARACTER ──────────────────────────────────────────────────────────

export function buildCharacter(scene: Scene): CharacterRef {
    _scene = scene;

    // ── COLOURS — Indian school uniform ───────────────────────────────────
    const skinCol  = new Color3(0.80, 0.55, 0.35);  // warm Indian skin tone (slightly lighter)
    const hairCol  = new Color3(0.08, 0.05, 0.04);  // near-black hair
    const shirtCol = new Color3(0.94, 0.94, 0.90);  // white school shirt
    const pantCol  = new Color3(0.08, 0.10, 0.28);  // navy blue pants
    const shoeCol  = new Color3(0.10, 0.08, 0.07);  // black shoes
    const sockCol  = new Color3(0.90, 0.90, 0.88);  // white socks
    const packCol  = new Color3(0.12, 0.40, 0.18);  // green backpack
    const badgeCol = new Color3(0.08, 0.62, 0.30);  // school badge green
    const eyeCol   = new Color3(0.10, 0.06, 0.04);  // dark brown eyes
    const lipCol   = new Color3(0.72, 0.38, 0.28);  // lips
    const beltCol  = new Color3(0.25, 0.20, 0.15);  // leather belt

    const skinMat  = mkMat('c_skin',  skinCol,  scene, 0.02, 0.07);
    const hairMat  = mkMat('c_hair',  hairCol,  scene, 0.06, 0.04);
    const shirtMat = mkMat('c_shirt', shirtCol, scene, 0.05, 0.10);
    const pantMat  = mkMat('c_pant',  pantCol,  scene, 0.03, 0.05);
    const shoeMat  = mkMat('c_shoe',  shoeCol,  scene, 0.08, 0.04);
    const sockMat  = mkMat('c_sock',  sockCol,  scene, 0.02, 0.08);
    const packMat  = mkMat('c_pack',  packCol,  scene, 0.03, 0.06);
    const badgeMat = mkMat('c_badge', badgeCol, scene, 0.02, 0.18);
    const eyeMat   = mkMat('c_eye',   eyeCol,   scene, 0.02, 0.05);
    const lipMat   = mkMat('c_lip',   lipCol,   scene, 0.02, 0.06);
    const beltMat  = mkMat('c_belt',  beltCol,  scene, 0.05, 0.03);
    const scleraMat = mkMat('c_scl', new Color3(0.95, 0.92, 0.90), scene, 0.02, 0.12);
    const noseMat  = mkMat('c_nose', skinCol.scale(0.85), scene, 0.01, 0.04);

    const allMeshes: Mesh[] = [];
    const rg = (m: Mesh): Mesh => {
        m.renderingGroupId = 2;
        m.receiveShadows   = true;
        m.isPickable       = false;
        allMeshes.push(m);
        return m;
    };

    // ── ROOT ──────────────────────────────────────────────────────────────
    const root = new TransformNode('charRoot', scene);
    root.position.set(0, 0, -31);  // spawn just outside school gate, facing +Z (into school)

    const pelvis = new TransformNode('pelvis', scene);
    pelvis.parent   = root;
    pelvis.position.y = 0;

    // ── SCALE: child proportions ──────────────────────────────────────────
    // Total height ~1.35m: legs 0.5, torso 0.38, neck+head 0.47
    // Child: head is ~1/5 of body (vs adult 1/7), shorter limbs

    // ── UPPER LEGS ────────────────────────────────────────────────────────
    const uLegLNode = new TransformNode('uLegL', scene);
    uLegLNode.parent   = pelvis;
    // FIX: Raised hip pivot to connect properly to torso
    uLegLNode.position.set(-0.09, 0.50, 0);

    const uLegLMesh = rg(MeshBuilder.CreateCylinder('uLegLMesh', { height: 0.24, diameterTop: 0.105, diameterBottom: 0.088, tessellation: 8 }, scene));
    uLegLMesh.material = pantMat;
    uLegLMesh.position.y = -0.12;   // mesh centre sits 0.12 below the pivot
    uLegLMesh.parent = uLegLNode;

    const uLegRNode = new TransformNode('uLegR', scene);
    uLegRNode.parent   = pelvis;
    // FIX: Raised hip pivot to connect properly to torso
    uLegRNode.position.set(0.09, 0.50, 0);

    const uLegRMesh = rg(MeshBuilder.CreateCylinder('uLegRMesh', { height: 0.24, diameterTop: 0.105, diameterBottom: 0.088, tessellation: 8 }, scene));
    uLegRMesh.material = pantMat;
    uLegRMesh.position.y = -0.12;
    uLegRMesh.parent = uLegRNode;

    // ── LOWER LEGS — parented to upper leg nodes so knee bends correctly ──
    const lLegL = rg(MeshBuilder.CreateCylinder('lLegL', { height: 0.26, diameterTop: 0.088, diameterBottom: 0.082, tessellation: 8 }, scene));
    lLegL.material = pantMat;
    lLegL.position.set(0, -0.24, 0);   // hangs below upper-leg pivot by full upper-leg length
    lLegL.parent = uLegLNode;

    const lLegR = rg(MeshBuilder.CreateCylinder('lLegR', { height: 0.26, diameterTop: 0.088, diameterBottom: 0.082, tessellation: 8 }, scene));
    lLegR.material = pantMat;
    lLegR.position.set(0, -0.24, 0);
    lLegR.parent = uLegRNode;

    // Socks — FIX: parented to lower leg nodes
    const sockL = rg(MeshBuilder.CreateCylinder('sockL', { height: 0.09, diameterTop: 0.085, diameterBottom: 0.082, tessellation: 8 }, scene));
    sockL.material = sockMat;
    sockL.position.set(0, -0.175, 0);
    sockL.parent = lLegL;

    const sockR = rg(sockL.clone('sockR'));
    sockR.position.set(0, -0.175, 0);
    sockR.parent = lLegR;

    // Shoes — FIX: parented to lower leg nodes
    const footL = rg(MeshBuilder.CreateBox('footL', { width: 0.10, height: 0.065, depth: 0.18 }, scene));
    footL.material = shoeMat;
    footL.position.set(0, -0.235, 0.03);
    footL.parent = lLegL;
    
    // Shoe toe bump
    const toeBumpL = rg(MeshBuilder.CreateSphere('toeBumpL', { diameter: 0.075, segments: 5 }, scene));
    toeBumpL.material = shoeMat;
    toeBumpL.scaling.set(1.2, 0.75, 1.0);
    toeBumpL.position.set(0, -0.228, 0.10);
    toeBumpL.parent = lLegL;

    const footR = rg(footL.clone('footR'));
    footR.position.set(0, -0.235, 0.03);
    footR.parent = lLegR;
    
    const toeBumpR = rg(toeBumpL.clone('toeBumpR'));
    toeBumpR.position.set(0, -0.228, 0.10);
    toeBumpR.parent = lLegR;

    // Belt
    const belt = rg(MeshBuilder.CreateTorus('belt', { diameter: 0.30, thickness: 0.03, tessellation: 20 }, scene));
    belt.material  = beltMat;
    belt.scaling.z = 0.55;
    belt.position.set(0, 0.53, 0);
    belt.parent = pelvis;

    // ── TORSO ─────────────────────────────────────────────────────────────
    const torso = rg(MeshBuilder.CreateBox('torso', { width: 0.30, height: 0.38, depth: 0.16 }, scene));
    torso.material = shirtMat;
    torso.position.set(0, 0.72, 0);
    torso.parent = pelvis;

    // Collar
    const collar = rg(MeshBuilder.CreateBox('collar', { width: 0.26, height: 0.05, depth: 0.13 }, scene));
    collar.material = shirtMat;
    collar.position.set(0, 0.89, 0);
    collar.parent = pelvis;

    // School badge on chest
    const badge = rg(MeshBuilder.CreateBox('badge', { width: 0.075, height: 0.055, depth: 0.025 }, scene));
    badge.material = badgeMat;
    badge.position.set(-0.09, 0.75, 0.085);
    badge.parent = pelvis;

    // Shirt buttons (small dots)
    for (let i = 0; i < 3; i++) {
        const btn = rg(MeshBuilder.CreateSphere(`btn_${i}`, { diameter: 0.018, segments: 4 }, scene));
        btn.material = mkMat(`btnm_${i}`, new Color3(0.78, 0.78, 0.75), scene);
        btn.position.set(0, 0.82 - i * 0.09, 0.082);
        btn.parent = pelvis;
    }

    // ── BACKPACK ──────────────────────────────────────────────────────────
    const backpack = rg(MeshBuilder.CreateBox('backpack', { width: 0.20, height: 0.28, depth: 0.11 }, scene));
    backpack.material = packMat;
    backpack.position.set(0, 0.73, -0.14);
    backpack.parent = pelvis;

    // Backpack top flap
    const flap = rg(MeshBuilder.CreateBox('flap', { width: 0.20, height: 0.08, depth: 0.12 }, scene));
    flap.material = mkMat('flapm', packCol.scale(0.85), scene);
    flap.position.set(0, 0.885, -0.135);
    flap.parent = pelvis;

    // Shoulder straps
    for (const sx of [-0.07, 0.07]) {
        const strap = rg(MeshBuilder.CreateBox(`strap${sx}`, { width: 0.035, height: 0.32, depth: 0.025 }, scene));
        strap.material = mkMat(`strapm${sx}`, packCol.scale(0.80), scene);
        strap.position.set(sx, 0.73, 0.005);
        strap.parent = pelvis;
    }

    // ── UPPER ARMS ────────────────────────────────────────────────────────
    const uArmLNode = new TransformNode('uArmLNode', scene);
    uArmLNode.parent   = pelvis;
    uArmLNode.position.set(-0.19, 0.87, 0);

    const uArmLMesh = rg(MeshBuilder.CreateCylinder('uArmLMesh', { height: 0.22, diameterTop: 0.072, diameterBottom: 0.082, tessellation: 7 }, scene));
    uArmLMesh.material = shirtMat;
    uArmLMesh.position.y = -0.11;
    uArmLMesh.parent = uArmLNode;

    const uArmRNode = new TransformNode('uArmRNode', scene);
    uArmRNode.parent   = pelvis;
    uArmRNode.position.set(0.19, 0.87, 0);

    const uArmRMesh = rg(uArmLMesh.clone('uArmRMesh'));
    uArmRMesh.parent = uArmRNode;

    // ── LOWER ARMS — parented to upper arm nodes so they follow swing ────
    const lArmL = rg(MeshBuilder.CreateCylinder('lArmL', { height: 0.20, diameterTop: 0.058, diameterBottom: 0.068, tessellation: 7 }, scene));
    lArmL.material = skinMat;
    lArmL.position.set(0, -0.32, 0);   // local offset below upper arm pivot
    lArmL.parent = uArmLNode;

    const lArmR = rg(lArmL.clone('lArmR'));
    lArmR.position.set(0, -0.32, 0);
    lArmR.parent = uArmRNode;

    // Hands — also parented to upper arm nodes
    const handL = rg(MeshBuilder.CreateSphere('handL', { diameter: 0.09, segments: 6 }, scene));
    handL.material = skinMat;
    handL.scaling.set(1, 0.9, 0.80);
    handL.position.set(0, -0.45, 0);
    handL.parent = uArmLNode;

    const handR = rg(handL.clone('handR'));
    handR.position.set(0, -0.45, 0);
    handR.parent = uArmRNode;

    // ── NECK ─────────────────────────────────────────────────────────────
    const neck = rg(MeshBuilder.CreateCylinder('neck', { height: 0.10, diameterTop: 0.095, diameterBottom: 0.10, tessellation: 8 }, scene));
    neck.material = skinMat;
    neck.position.set(0, 0.97, 0);
    neck.parent = pelvis;

    // ── HEAD — child proportions: rounder, bigger relative to body ────────
    const head = rg(MeshBuilder.CreateSphere('head', { diameter: 0.38, segments: 10 }, scene));
    head.material = skinMat;
    head.scaling.set(1.0, 1.05, 0.97);
    head.position.set(0, 1.08, 0);
    head.parent = pelvis;

    // ── HAIR ──────────────────────────────────────────────────────────────
    // Main hair cap
    const hairCap = rg(MeshBuilder.CreateSphere('hairCap', { diameter: 0.39, segments: 9 }, scene));
    hairCap.material = hairMat;
    hairCap.scaling.set(1.02, 0.62, 1.02);
    hairCap.position.set(0, 1.175, -0.015);
    hairCap.parent = pelvis;

    // Side hair puffs — typical Indian kid hair
    const hairSideL = rg(MeshBuilder.CreateSphere('hairSideL', { diameter: 0.22, segments: 7 }, scene));
    hairSideL.material = hairMat;
    hairSideL.scaling.set(0.70, 0.80, 0.95);
    hairSideL.position.set(-0.165, 1.14, 0);
    hairSideL.parent = pelvis;

    const hairSideR = rg(hairSideL.clone('hairSideR'));
    hairSideR.position.x = 0.165;
    hairSideR.parent = pelvis;

    // Hair back
    const hairBack = rg(MeshBuilder.CreateSphere('hairBack', { diameter: 0.28, segments: 7 }, scene));
    hairBack.material = hairMat;
    hairBack.scaling.set(1.0, 0.75, 0.80);
    hairBack.position.set(0, 1.11, -0.155);
    hairBack.parent = pelvis;

    // Hair fringe (forehead)
    const fringe = rg(MeshBuilder.CreateBox('fringe', { width: 0.30, height: 0.07, depth: 0.10 }, scene));
    fringe.material = hairMat;
    fringe.position.set(0, 1.22, 0.135);
    fringe.parent = pelvis;

    // ── EYES ──────────────────────────────────────────────────────────────
    // Sclera (white)
    const scleraL = rg(MeshBuilder.CreateSphere('scleraL', { diameter: 0.082, segments: 7 }, scene));
    scleraL.material = scleraMat;
    scleraL.scaling.set(1.0, 0.88, 0.7);
    scleraL.position.set(-0.095, 1.095, 0.162);
    scleraL.parent = pelvis;

    const scleraR = rg(scleraL.clone('scleraR'));
    scleraR.position.x = 0.095;
    scleraR.parent = pelvis;

    // Iris (dark brown)
    const irisL = rg(MeshBuilder.CreateSphere('irisL', { diameter: 0.058, segments: 6 }, scene));
    irisL.material = eyeMat;
    irisL.scaling.set(1.0, 0.88, 0.6);
    irisL.position.set(-0.095, 1.097, 0.182);
    irisL.parent = pelvis;

    const irisR = rg(irisL.clone('irisR'));
    irisR.position.x = 0.095;
    irisR.parent = pelvis;

    // Eye shine (tiny white spark for liveliness)
    const shineL = rg(MeshBuilder.CreateSphere('shineL', { diameter: 0.020, segments: 4 }, scene));
    shineL.material = mkMat('shinem', new Color3(1, 1, 1), scene, 0.0, 0.8);
    shineL.position.set(-0.085, 1.103, 0.192);
    shineL.parent = pelvis;

    const shineR = rg(shineL.clone('shineR'));
    shineR.position.x = 0.085;
    shineR.parent = pelvis;

    // Eyebrows
    const browL = rg(MeshBuilder.CreateBox('browL', { width: 0.065, height: 0.012, depth: 0.025 }, scene));
    browL.material = hairMat;
    browL.position.set(-0.095, 1.138, 0.170);
    browL.rotation.z = 0.15;
    browL.parent = pelvis;

    const browR = rg(browL.clone('browR'));
    browR.position.x = 0.095;
    browR.rotation.z = -0.15;
    browR.parent = pelvis;

    // ── NOSE ─────────────────────────────────────────────────────────────
    const nose = rg(MeshBuilder.CreateSphere('nose', { diameter: 0.042, segments: 5 }, scene));
    nose.material = noseMat;
    nose.scaling.set(1.0, 0.75, 0.85);
    nose.position.set(0, 1.065, 0.182);
    nose.parent = pelvis;

    // ── SMILE / MOUTH — small, correctly-sized lips ───────────────────────
    // Upper lip: thin box 0.06×0.012×0.005
    const upperLip = rg(MeshBuilder.CreateBox('uLip', { width: 0.075, height: 0.014, depth: 0.025 }, scene));
    upperLip.material = lipMat;
    upperLip.position.set(0, 1.030, 0.176);
    upperLip.parent = pelvis;

    // Lower lip: thin box 0.06×0.012×0.005, slightly lower
    const lowerLip = rg(MeshBuilder.CreateBox('lLip', { width: 0.080, height: 0.016, depth: 0.028 }, scene));
    lowerLip.material = lipMat;
    lowerLip.position.set(0, 1.013, 0.174);
    lowerLip.parent = pelvis;

    // Smile dimples
    for (const sx of [-0.042, 0.042]) {
        const dimple = rg(MeshBuilder.CreateSphere(`dimple${sx}`, { diameter: 0.018, segments: 4 }, scene));
        dimple.material = mkMat(`dimplem${sx}`, skinCol.scale(0.88), scene, 0.01, 0.03);
        dimple.position.set(sx, 1.022, 0.178);
        dimple.parent = pelvis;
    }

    // Ears
    for (const ex of [-0.195, 0.195]) {
        const ear = rg(MeshBuilder.CreateSphere(`ear${ex}`, { diameter: 0.065, segments: 5 }, scene));
        ear.material = skinMat;
        ear.scaling.set(0.50, 0.80, 0.60);
        ear.position.set(ex, 1.08, 0.010);
        ear.parent = pelvis;
    }

    return {
        root, pelvis, torso, head,
        uArmL: uArmLNode, lArmL,
        uArmR: uArmRNode, lArmR,
        uLegL: uLegLNode, lLegL,
        uLegR: uLegRNode, lLegR,
        allMeshes,
    };
}

// ─── SHADOW CASTING ───────────────────────────────────────────────────────────

export function enableCharacterShadows(ref: CharacterRef, generator: ShadowGenerator): void {
    for (const m of ref.allMeshes) {
        generator.addShadowCaster(m, false);
    }
}

// ─── ANIMATION ────────────────────────────────────────────────────────────────

export function animateCharacter(ref: CharacterRef, dt: number): void {
    const mag = joystickState.magnitude;
    _animTime += dt * 0.001 * (1.8 + _animBlend * 2.2);

    const targetBlend = mag < 0.12 ? 0 : mag < 0.55 ? 1 : 2;
    _animBlend = lerp(_animBlend, targetBlend, 0.09);

    const walkAmt = Math.min(_animBlend, 1.0);
    const runAmt  = Math.max(_animBlend - 1.0, 0.0);
    const s       = Math.sin(_animTime * Math.PI * 2);
    const swing   = s * (walkAmt * 0.38 + runAmt * 0.55);

    // Leg swing
    ref.uLegL.rotation.x =  swing;
    ref.uLegR.rotation.x = -swing;

    // Lower leg follow-through (knee bend)
    ref.lLegL.rotation.x = -Math.max(swing,  0) * 0.55;
    ref.lLegR.rotation.x = -Math.max(-swing, 0) * 0.55;

    // Arm swing (opposite to legs)
    ref.uArmL.rotation.x = -swing * 0.65;
    ref.uArmR.rotation.x =  swing * 0.65;

    // Slight arm angle out from body (natural carry position)
    ref.uArmL.rotation.z =  0.08;
    ref.uArmR.rotation.z = -0.08;

    // Hip bob
    ref.pelvis.position.y = Math.abs(s) * walkAmt * 0.016;

    // Torso lean forward when running
    ref.torso.rotation.x = runAmt * 0.10;

    // Idle breathing
    if (_animBlend < 0.08) {
        ref.torso.position.y = 0.72 + Math.sin(_animTime * 1.5) * 0.004;
    }
}

// ─── COLLISION REGISTRY ───────────────────────────────────────────────────────
// Simple AABB obstacle list: [centerX, centerZ, halfW, halfD]
const _obstacles: [number, number, number, number][] = [];

export function registerCollisionBox(cx: number, cz: number, hw: number, hd: number): void {
    _obstacles.push([cx, cz, hw, hd]);
}

function collidesWithObstacle(x: number, z: number): boolean {
    const PR = 0.28; // player radius
    for (const [cx, cz, hw, hd] of _obstacles) {
        if (
            x > cx - hw - PR && x < cx + hw + PR &&
            z > cz - hd - PR && z < cz + hd + PR
        ) return true;
    }
    return false;
}

// Trunks block the player like a real tree would — note this is intentionally
// a *small* trunk radius (not the full leafy canopy), so the character can
// still walk under low branches, just not through the wood itself. (Used to
// be 0.85, which — especially for closely-clustered trees like bamboo, and
// with trunks often hidden by tall grass — felt like invisible "ghost stump"
// walls. 0.5 still blocks a real trunk without that effect.)
const TREE_TRUNK_R = 0.5;

function collidesWithTree(x: number, z: number): boolean {
    const PR = 0.30;
    const r = TREE_TRUNK_R + PR;
    for (let i = 0; i < treePositions.length; i++) {
        if (treeAlive[i] === false) continue; // tree has died off — nothing here anymore
        const t = treePositions[i];
        const dx = x - t.x, dz = z - t.z;
        if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
}

// Live ground animals (deer / fox / peacock) also physically block the player —
// you can't walk into a deer any more than you could walk into a tree.
// Pond and river water is intentionally NOT checked anywhere here — the
// character is free to wade/walk straight through water.
function collidesWithAnimal(x: number, z: number): boolean {
    const PR = 0.30;
    for (const a of getGroundAnimalColliders()) {
        const r = a.r + PR;
        const dx = x - a.x, dz = z - a.z;
        if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
}

function isBlocked(x: number, z: number): boolean {
    return collidesWithObstacle(x, z) || collidesWithTree(x, z) || collidesWithAnimal(x, z);
}

// ─── MOVEMENT ─────────────────────────────────────────────────────────────────

export function moveCharacter(ref: CharacterRef, yaw: number, dt: number): void {
    const mag = joystickState.magnitude;
    const dtSec = dt * 0.001;

    // Always track terrain height each frame (even idle) — Bug 6
    const currentTY = getTerrainY(ref.root.position.x, ref.root.position.z);

    if (mag < 0.12) {   // Bug 5: dead zone raised from 0.05 → 0.12
        ref.root.position.y = lerp(ref.root.position.y, currentTY, 0.15);
        return;
    }

    // Bug 5: reduced speeds walk 1.4, run 3.2
    const speed = mag < 0.55 ? 1.4 : 3.2;

    const jx =  joystickState.x;
    const jz = -joystickState.z;

    // Compute world-space target direction from joystick + camera yaw
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const wx   =  jx * cosY + jz * sinY;
    const wz   = -jx * sinY + jz * cosY;

    // Bug 4: faster rotation chase (0.22 instead of 0.16)
    _targetRotY = Math.atan2(wx, wz);
    let dRot    = _targetRotY - ref.root.rotation.y;
    while (dRot >  Math.PI) dRot -= Math.PI * 2;
    while (dRot < -Math.PI) dRot += Math.PI * 2;
    ref.root.rotation.y += dRot * 0.22;

    // Bug 4: move along CURRENT facing direction (not target), so character
    // never appears to walk backwards during rotation catch-up
    const facingX = Math.sin(ref.root.rotation.y);
    const facingZ = Math.cos(ref.root.rotation.y);
    const nx = ref.root.position.x + facingX * speed * dtSec;
    const nz = ref.root.position.z + facingZ * speed * dtSec;

    // Bug 7: terrain-aware boundary — allow movement inside r<48, block cliffs
    const targetTY   = getTerrainY(nx, nz);
    const heightDiff  = targetTY - currentTY;
    const inBounds    = (nx * nx + nz * nz) < 46 * 46;
    const tooSteep    = heightDiff > 1.5;   // Bug 7: slope block

    if (inBounds && !tooSteep && !isBlocked(nx, nz)) {
        ref.root.position.x = nx;
        ref.root.position.z = nz;
    } else if (inBounds && !tooSteep && !isBlocked(nx, ref.root.position.z)) {
        ref.root.position.x = nx;
    } else if (inBounds && !tooSteep && !isBlocked(ref.root.position.x, nz)) {
        ref.root.position.z = nz;
    }

    // Bug 6: terrain height sampling + smooth lerp 0.25
    const ty = getTerrainY(ref.root.position.x, ref.root.position.z);
    ref.root.position.y = lerp(ref.root.position.y, ty, 0.25);
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────

export function updateCamera(ref: CharacterRef, camera: ArcRotateCamera): void {
    camera.target = Vector3.Lerp(
        camera.target,
        ref.root.position.add(new Vector3(0, 1.0, 0)),
        0.12,
    );

    const targetAlpha = -Math.PI / 2 - camYaw;
    camera.alpha  = lerp(camera.alpha,  targetAlpha, 0.09);
    camera.beta   = lerp(camera.beta,   camPitch,    0.07);
    // Lerp toward camRadius (set by wheel/pinch) — NOT a hardcoded constant.
    // Previously this was lerp(..., 8.0, 0.05) which fought against any zoom input.
    camera.radius = lerp(camera.radius, camRadius,   0.08);
}