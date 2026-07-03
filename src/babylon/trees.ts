/**
 * src/babylon/trees.ts — EcoWorld v4 REDESIGNED
 *
 * CHANGES:
 * 1. All trees grounded with getTerrainHeightAt() — NO floating
 * 2. Trees spread across ALL quadrants naturally
 * 3. Flat plateau zone respected — trees on flat ground look grounded properly
 * 4. Shadow casting enabled on all tree meshes
 * 5. School redesigned: proper Indian school architecture, U-shaped, arched windows,
 * colourful painted facade, courtyard, flag — looks REAL not like floating blocks
 * 6. All 5 species fully detailed: Neem, Mango, Banyan, Bamboo, Teak, Palm
 * 7. Sizes realistic and proportional
 */

import {
    Scene,
    MeshBuilder,
    StandardMaterial,
    Color3,
    TransformNode,
    Mesh,
    ShadowGenerator,
    Vector3,
    VertexData,
} from '@babylonjs/core';
import { seededRandom, lerpColor, lerp, smoothstep } from './engine';
import { getTerrainHeightAt, isInRiver } from './terrain';

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

export interface ForestRef {
    nodes:      TransformNode[];
    canopyMats: StandardMaterial[];
    banyanNode: TransformNode;
    allMeshes:  Mesh[];
    dieRand:    number[];   // per-tree random extinction threshold (0..1, Infinity = never dies)
    baseScale:  Vector3[];  // per-tree original scale, so shrink/regrow is relative
}

// BUG 22: Export tree positions so animals can collide with them
export const treePositions: {x: number, z: number}[] = [];
// Per-tree extinction threshold (same value used to shrink/hide the actual
// mesh in updateTreeHealth) and live alive-state, kept in lockstep with
// treePositions by index so collision (animals.ts / character.ts) always
// matches what's actually rendered — no more "ghost stump" colliders where
// a tree visually died but its hitbox lingered.
export const treeDieRand: number[] = [];
export const treeAlive: boolean[] = [];

// ─── HEALTH COLOUR RAMP ───────────────────────────────────────────────────────

const CANOPY_RAMP = [
    { t: 0.00, c: new Color3(0.09, 0.38, 0.10) },
    { t: 0.25, c: new Color3(0.10, 0.34, 0.09) },
    { t: 0.50, c: new Color3(0.28, 0.30, 0.07) },
    { t: 0.75, c: new Color3(0.34, 0.20, 0.04) },
    { t: 1.00, c: new Color3(0.18, 0.11, 0.03) },
];

function canopyColorAt(healthT: number): Color3 {
    const h = Math.max(0, Math.min(1, healthT));
    for (let i = 0; i < CANOPY_RAMP.length - 1; i++) {
        const a = CANOPY_RAMP[i], b = CANOPY_RAMP[i + 1];
        if (h <= b.t) return lerpColor(a.c, b.c, (h - a.t) / (b.t - a.t));
    }
    return CANOPY_RAMP[CANOPY_RAMP.length - 1].c;
}

// ─── MATERIAL FACTORY ─────────────────────────────────────────────────────────

function mat(name: string, col: Color3, scene: Scene, emissive = 0): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor  = col.clone();
    m.specularColor = new Color3(0.018, 0.022, 0.012);
    m.ambientColor  = col.scale(0.22);
    if (emissive > 0) m.emissiveColor = col.scale(emissive);
    return m;
}

const TRUNK_DARK = new Color3(0.22, 0.13, 0.07);
const TRUNK_MED  = new Color3(0.30, 0.18, 0.09);
const TRUNK_PALE = new Color3(0.48, 0.34, 0.20);

// ─── RENDERING GROUP + SHADOW HELPER ─────────────────────────────────────────

const _allTreeMeshes: Mesh[] = [];

function rg(m: Mesh): Mesh {
    m.renderingGroupId = 2;
    m.receiveShadows   = true;
    m.isPickable       = false;
    _allTreeMeshes.push(m);
    return m;
}

// ─── CANOPY BUILDER ───────────────────────────────────────────────────────────

function addCanopy(
    root: TransformNode,
    cMat: StandardMaterial,
    darkMat: StandardMaterial,
    trunkH: number,
    mainR: number,
    sc: number,
    rand: () => number,
    scene: Scene,
    tag: string,
    subCount = 5,
): void {
    const mainY = trunkH + mainR * 0.42;

    const main = rg(MeshBuilder.CreateSphere(`${tag}_c`, { diameter: mainR * 2, segments: 10 }, scene));
    main.material = cMat;
    main.scaling.set(1.0 + rand() * 0.15, 0.76 + rand() * 0.14, 1.0 + rand() * 0.15);
    main.position.set(0, mainY, 0);
    main.parent = root;

    // Dark AO underside
    const shadow = rg(MeshBuilder.CreateSphere(`${tag}_cs`, { diameter: mainR * 1.80, segments: 8 }, scene));
    shadow.material = darkMat;
    shadow.scaling.copyFrom(main.scaling);
    shadow.position.set(0, mainY - mainR * 0.30, 0);
    shadow.parent = root;

    // Sub-spheres for organic silhouette
    for (let i = 0; i < subCount; i++) {
        const ang    = (i / subCount) * Math.PI * 2 + rand() * 0.9;
        const subR   = (0.44 + rand() * 0.30) * mainR * sc;
        const radOff = mainR * (0.52 + rand() * 0.32);
        const hOff   = (rand() - 0.38) * mainR * 0.60;
        const sub    = rg(MeshBuilder.CreateSphere(`${tag}_sub${i}`, { diameter: subR * 2, segments: 8 }, scene));
        sub.material = cMat;
        sub.scaling.set(1.0, 0.80 + rand() * 0.14, 1.0);
        sub.position.set(Math.cos(ang) * radOff, mainY + hOff, Math.sin(ang) * radOff);
        sub.parent = root;
    }
}

// ─── SPECIES: NEEM ────────────────────────────────────────────────────────────

function buildNeem(scene: Scene, rand: () => number, canopyMats: StandardMaterial[], idx: number): TransformNode {
    const root   = new TransformNode(`neem_${idx}`, scene);
    const sc     = 0.80 + rand() * 0.55;
    const trunkH = (2.8 + rand() * 1.2) * sc;
    const mainR  = (1.0 + rand() * 0.35) * sc;

    // Trunk with slight taper
    const trunk = rg(MeshBuilder.CreateCylinder(`neem_tk_${idx}`, {
        height: trunkH, diameterTop: 0.14 * sc, diameterBottom: 0.22 * sc, tessellation: 10,
    }, scene));
    trunk.material = mat(`neem_m_${idx}`, TRUNK_DARK, scene);
    trunk.position.y = trunkH * 0.5;
    trunk.parent = root;

    // Bark texture via subtle sphere overlay at base
    const barkBase = rg(MeshBuilder.CreateCylinder(`neem_bk_${idx}`, {
        height: trunkH * 0.3, diameterTop: 0.22 * sc, diameterBottom: 0.26 * sc, tessellation: 10,
    }, scene));
    barkBase.material = mat(`neem_bkm_${idx}`, TRUNK_DARK.scale(0.80), scene);
    barkBase.position.y = trunkH * 0.15;
    barkBase.parent = root;

    // Spreading branches (2-3 visible forks)
    const branchCount = 2 + Math.floor(rand() * 2);
    for (let b = 0; b < branchCount; b++) {
        const bAng = (b / branchCount) * Math.PI * 2 + rand() * 0.8;
        const bLen = (0.5 + rand() * 0.4) * sc;
        const branchH = trunkH * (0.65 + rand() * 0.25);
        const branch = rg(MeshBuilder.CreateCylinder(`neem_br_${idx}_${b}`, {
            height: bLen, diameterTop: 0.04 * sc, diameterBottom: 0.09 * sc, tessellation: 7,
        }, scene));
        branch.material = mat(`neem_brm_${idx}_${b}`, TRUNK_DARK, scene);
        branch.rotation.z = (0.5 + rand() * 0.4) * (rand() < 0.5 ? 1 : -1);
        branch.position.set(Math.cos(bAng) * 0.12 * sc, branchH, Math.sin(bAng) * 0.12 * sc);
        branch.parent = root;
    }

    const cCol = new Color3(0.08 + rand() * 0.06, 0.36 + rand() * 0.10, 0.09 + rand() * 0.06);
    const cMat = mat(`neem_c_${idx}`, cCol, scene);
    const dMat = mat(`neem_cd_${idx}`, cCol.scale(0.50), scene);
    canopyMats.push(cMat);
    addCanopy(root, cMat, dMat, trunkH, mainR, sc, rand, scene, `neem_${idx}`, 5);
    return root;
}

// ─── SPECIES: MANGO ───────────────────────────────────────────────────────────

function buildMango(scene: Scene, rand: () => number, canopyMats: StandardMaterial[], idx: number): TransformNode {
    const root   = new TransformNode(`mango_${idx}`, scene);
    const sc     = 0.85 + rand() * 0.65;
    const trunkH = (3.5 + rand() * 1.8) * sc;
    const mainR  = (1.2 + rand() * 0.45) * sc;

    const trunk = rg(MeshBuilder.CreateCylinder(`mango_tk_${idx}`, {
        height: trunkH, diameterTop: 0.17 * sc, diameterBottom: 0.27 * sc, tessellation: 10,
    }, scene));
    trunk.material = mat(`mango_m_${idx}`, TRUNK_MED, scene);
    trunk.position.y = trunkH * 0.5;
    trunk.parent = root;

    // Buttress roots (mango characteristic)
    for (let r = 0; r < 4; r++) {
        const ang   = (r / 4) * Math.PI * 2 + rand() * 0.5;
        const butt  = rg(MeshBuilder.CreateBox(`mango_bt_${idx}_${r}`, { width: 0.06 * sc, height: trunkH * 0.18, depth: 0.18 * sc }, scene));
        butt.material = mat(`mango_btm_${idx}_${r}`, TRUNK_MED.scale(0.90), scene);
        butt.rotation.y = ang;
        butt.position.set(Math.cos(ang) * 0.16 * sc, trunkH * 0.09, Math.sin(ang) * 0.16 * sc);
        butt.parent = root;
    }

    // Dense spreading canopy (mango is very full)
    const cCol = new Color3(0.06 + rand() * 0.04, 0.28 + rand() * 0.14, 0.07 + rand() * 0.06);
    const cMat = mat(`mango_c_${idx}`, cCol, scene);
    const dMat = mat(`mango_cd_${idx}`, cCol.scale(0.48), scene);
    canopyMats.push(cMat);
    addCanopy(root, cMat, dMat, trunkH, mainR, sc, rand, scene, `mango_${idx}`, 6);

    // Extra drooping outer canopy puffs
    for (let i = 0; i < 4; i++) {
        const ang  = (i / 4) * Math.PI * 2 + rand() * 0.6;
        const drR  = (0.55 + rand() * 0.20) * mainR;
        const drop = rg(MeshBuilder.CreateSphere(`mango_dp_${idx}_${i}`, { diameter: drR * 2, segments: 7 }, scene));
        drop.material = mat(`mango_dpm_${idx}_${i}`, cCol.scale(0.88), scene);
        drop.scaling.set(1, 0.65, 1);
        drop.position.set(Math.cos(ang) * mainR * 0.9, trunkH + mainR * 0.15, Math.sin(ang) * mainR * 0.9);
        drop.parent = root;
    }

    return root;
}

// ─── SPECIES: BANYAN (hero tree) ──────────────────────────────────────────────

function buildBanyan(scene: Scene, canopyMats: StandardMaterial[]): TransformNode {
    const root = new TransformNode('banyan', scene);
    const rand = seededRandom(999);
    const sc   = 1.0;
    const trunkH = 4.0;
    const mainR  = 2.8;

    // Massive main trunk with bark ridges
    const trunk = rg(MeshBuilder.CreateCylinder('banyan_trunk', {
        height: trunkH, diameterTop: 0.55, diameterBottom: 0.72, tessellation: 14,
    }, scene));
    trunk.material = mat('banyan_tk', new Color3(0.30, 0.20, 0.11), scene);
    trunk.position.y = trunkH * 0.5;
    trunk.parent = root;

    // Bark ridge lines (vertical fins)
    for (let r = 0; r < 6; r++) {
        const ang  = (r / 6) * Math.PI * 2;
        const ridge = rg(MeshBuilder.CreateBox(`banyan_ridge_${r}`, { width: 0.05, height: trunkH * 0.85, depth: 0.12 }, scene));
        ridge.material = mat(`banyan_ridgem_${r}`, new Color3(0.22, 0.14, 0.07), scene);
        ridge.rotation.y = ang;
        ridge.position.set(Math.cos(ang) * 0.34, trunkH * 0.42, Math.sin(ang) * 0.34);
        ridge.parent = root;
    }

    // Wide sweeping canopy
    const cCol = new Color3(0.08, 0.36, 0.10);
    const cMat = mat('banyan_c', cCol, scene);
    const dMat = mat('banyan_cd', cCol.scale(0.42), scene);
    canopyMats.push(cMat);
    addCanopy(root, cMat, dMat, trunkH, mainR, sc, rand, scene, 'banyan', 8);

    // Extended spreading satellite lobes (banyan grows outward)
    for (let i = 0; i < 6; i++) {
        const ang  = (i / 6) * Math.PI * 2 + 0.25;
        const dist = mainR * 0.85;
        const lobeR = (0.85 + rand() * 0.40) * mainR;
        const lobe = rg(MeshBuilder.CreateSphere(`banyan_lobe_${i}`, { diameter: lobeR, segments: 8 }, scene));
        lobe.material = mat(`banyan_lobe_m_${i}`, cCol.scale(0.88 + rand() * 0.15), scene);
        lobe.scaling.set(1, 0.70, 1);
        lobe.position.set(Math.cos(ang) * dist, trunkH + mainR * 0.25, Math.sin(ang) * dist);
        lobe.parent = root;
    }

    // Aerial roots — the banyan's signature feature
    const rootPositions = [
        [-0.9, 0.7], [0.8, 0.5], [-1.4, -0.6], [1.2, -0.8],
        [0.0, 1.2], [-0.6, -1.3], [1.5, 0.1],
    ];
    for (let i = 0; i < rootPositions.length; i++) {
        const [rx, rz] = rootPositions[i];
        const aH  = trunkH * (0.45 + rand() * 0.35);
        const aer = rg(MeshBuilder.CreateCylinder(`banyan_aer_${i}`, {
            height: aH, diameterTop: 0.038, diameterBottom: 0.072, tessellation: 6,
        }, scene));
        aer.material = mat(`banyan_aerm_${i}`, new Color3(0.26, 0.17, 0.09), scene);
        aer.position.set(rx, aH * 0.5, rz);
        aer.parent = root;

        // Small root splash at base
        const splash = rg(MeshBuilder.CreateCylinder(`banyan_splash_${i}`, {
            height: 0.06, diameterTop: 0.14, diameterBottom: 0.20, tessellation: 6,
        }, scene));
        splash.material = mat(`banyan_spm_${i}`, new Color3(0.20, 0.13, 0.07), scene);
        splash.position.set(rx, 0.03, rz);
        splash.parent = root;
    }

    return root;
}

// ─── SPECIES: BAMBOO ──────────────────────────────────────────────────────────

function buildBamboo(scene: Scene, rand: () => number, canopyMats: StandardMaterial[], idx: number): TransformNode {
    const root    = new TransformNode(`bamboo_${idx}`, scene);
    const sc      = 0.75 + rand() * 0.55;
    const stalks  = 5 + Math.floor(rand() * 5);

    const bamMat  = mat(`bamboo_m_${idx}`,  new Color3(0.38, 0.58, 0.18), scene);
    const nodeMat = mat(`bamboo_nm_${idx}`, new Color3(0.28, 0.44, 0.10), scene);
    const leafMat = mat(`bamboo_l_${idx}`,  new Color3(0.18, 0.46, 0.10), scene);
    canopyMats.push(leafMat);

    for (let s = 0; s < stalks; s++) {
        const sH   = (3.5 + rand() * 3.2) * sc;
        const offX = (rand() - 0.5) * 1.2 * sc;
        const offZ = (rand() - 0.5) * 1.2 * sc;
        const lean = (rand() - 0.5) * 0.10;

        // Main stalk — bright green, smooth
        const stalk = rg(MeshBuilder.CreateCylinder(`bamboo_stalk_${idx}_${s}`, {
            height: sH, diameterTop: 0.030 * sc, diameterBottom: 0.052 * sc, tessellation: 8,
        }, scene));
        stalk.material = bamMat;
        stalk.rotation.z = lean;
        stalk.position.set(offX, sH * 0.5, offZ);
        stalk.parent = root;

        // Internodal rings
        const nodeCount = Math.floor(sH / 0.55);
        for (let n = 0; n < nodeCount; n++) {
            const nodeH = (n + 0.5) * (sH / nodeCount);
            const node = rg(MeshBuilder.CreateTorus(`bamboo_node_${idx}_${s}_${n}`, {
                diameter: 0.060 * sc, thickness: 0.016 * sc, tessellation: 8,
            }, scene));
            node.material = nodeMat;
            node.rotation.z = lean;
            node.position.set(offX, nodeH, offZ);
            node.parent = root;
        }

        // Leaf CLUSTERS at top — overlapping spheroids, NO flat boxes
        // This gives a full, natural bamboo tuft look with zero gaps
        const clusterCount = 3 + Math.floor(rand() * 2);
        for (let l = 0; l < clusterCount; l++) {
            const cAng = rand() * Math.PI * 2;
            const cR   = 0.18 * sc;
            const leafCluster = rg(MeshBuilder.CreateSphere(`bamboo_lc_${idx}_${s}_${l}`, {
                diameter: (0.55 + rand() * 0.25) * sc, segments: 6,
            }, scene));
            leafCluster.material = leafMat;
            leafCluster.scaling.set(1.6 + rand() * 0.5, 0.38 + rand() * 0.12, 1.6 + rand() * 0.5);
            leafCluster.position.set(
                offX + lean * sH * 0.3 + Math.cos(cAng) * cR,
                sH - l * 0.22 * sc,
                offZ + Math.sin(cAng) * cR,
            );
            leafCluster.parent = root;
        }

        // Extra thin arching leaf blades (long, very flat spheroids) for character
        for (let b = 0; b < 4; b++) {
            const bAng = (b / 4) * Math.PI * 2 + rand() * 0.6;
            const blade = rg(MeshBuilder.CreateSphere(`bamboo_blade_${idx}_${s}_${b}`, {
                diameter: (0.80 + rand() * 0.30) * sc, segments: 5,
            }, scene));
            blade.material = leafMat;
            blade.scaling.set(0.18, 0.06, 1.0);
            blade.rotation.y = bAng;
            blade.rotation.x = 0.35 + rand() * 0.25;
            blade.position.set(
                offX + lean * sH * 0.28 + Math.cos(bAng) * 0.25 * sc,
                sH - 0.15 * sc,
                offZ + Math.sin(bAng) * 0.25 * sc,
            );
            blade.parent = root;
        }
    }

    return root;
}

// ─── SPECIES: TEAK ────────────────────────────────────────────────────────────

function buildTeak(scene: Scene, rand: () => number, canopyMats: StandardMaterial[], idx: number): TransformNode {
    const root   = new TransformNode(`teak_${idx}`, scene);
    const sc     = 0.90 + rand() * 0.70;
    const trunkH = (4.0 + rand() * 2.5) * sc;
    const mainR  = (1.15 + rand() * 0.50) * sc;

    // Tall straight trunk (teak grows very straight)
    const trunk = rg(MeshBuilder.CreateCylinder(`teak_tk_${idx}`, {
        height: trunkH, diameterTop: 0.15 * sc, diameterBottom: 0.24 * sc, tessellation: 10,
    }, scene));
    trunk.material = mat(`teak_m_${idx}`, new Color3(0.26, 0.16, 0.08), scene);
    trunk.position.y = trunkH * 0.5;
    trunk.parent = root;

    // Flat mushroom-shaped canopy (teak's distinctive flat top)
    const cCol = new Color3(0.10 + rand() * 0.05, 0.32 + rand() * 0.12, 0.08 + rand() * 0.06);
    const cMat = mat(`teak_c_${idx}`, cCol, scene);
    const dMat = mat(`teak_cd_${idx}`, cCol.scale(0.48), scene);
    canopyMats.push(cMat);

    // Central canopy (very flat scaleY)
    const mainY = trunkH + mainR * 0.25;
    const main = rg(MeshBuilder.CreateSphere(`teak_cmain_${idx}`, { diameter: mainR * 2.2, segments: 10 }, scene));
    main.material = cMat;
    main.scaling.set(1.0, 0.48 + rand() * 0.12, 1.0);
    main.position.set(0, mainY, 0);
    main.parent = root;

    // Wide umbrella lobes
    for (let i = 0; i < 5; i++) {
        const ang  = (i / 5) * Math.PI * 2 + rand() * 0.5;
        const lobeR = (0.60 + rand() * 0.25) * mainR;
        const lobe = rg(MeshBuilder.CreateSphere(`teak_lobe_${idx}_${i}`, { diameter: lobeR * 2, segments: 8 }, scene));
        lobe.material = cMat;
        lobe.scaling.set(1.0, 0.44 + rand() * 0.10, 1.0);
        lobe.position.set(Math.cos(ang) * mainR * 0.88, mainY - mainR * 0.08, Math.sin(ang) * mainR * 0.88);
        lobe.parent = root;
    }

    // Dark underside
    const under = rg(MeshBuilder.CreateSphere(`teak_under_${idx}`, { diameter: mainR * 1.80, segments: 8 }, scene));
    under.material = dMat;
    under.scaling.set(1.0, 0.38, 1.0);
    under.position.set(0, mainY - mainR * 0.22, 0);
    under.parent = root;

    return root;
}

// ─── SPECIES: PALM ────────────────────────────────────────────────────────────

function buildPalm(scene: Scene, rand: () => number, canopyMats: StandardMaterial[], idx: number): TransformNode {
    const root   = new TransformNode(`palm_${idx}`, scene);
    const sc     = 0.85 + rand() * 0.75;
    const totalH = (6.0 + rand() * 4.0) * sc;
    const lean   = (rand() - 0.5) * 0.18;

    // Segmented trunk (palm segments are shorter with ring scars)
    const SEGS = 6;
    const segH = totalH / SEGS;
    for (let i = 0; i < SEGS; i++) {
        const t   = i / SEGS;
        const dia = lerp(0.22, 0.14, t) * sc;
        const seg = rg(MeshBuilder.CreateCylinder(`palm_seg_${idx}_${i}`, {
            height: segH, diameterTop: dia * 0.92, diameterBottom: dia, tessellation: 9,
        }, scene));
        seg.material = mat(`palm_tk_${idx}_${i}`, new Color3(
            0.44 + rand() * 0.10,
            0.30 + rand() * 0.08,
            0.18 + rand() * 0.06,
        ), scene);
        seg.position.set(lean * i * segH * 0.8, segH * 0.5 + i * segH, lean * i * segH * 0.4);
        seg.parent = root;

        // Ring scar at each segment junction
        if (i < SEGS - 1) {
            const ring = rg(MeshBuilder.CreateTorus(`palm_ring_${idx}_${i}`, {
                diameter: dia * 1.8, thickness: 0.025 * sc, tessellation: 9,
            }, scene));
            ring.material = mat(`palm_rm_${idx}_${i}`, new Color3(0.35, 0.24, 0.14), scene);
            ring.position.set(lean * i * segH * 0.8, (i + 1) * segH, lean * i * segH * 0.4);
            ring.parent = root;
        }
    }

    // Fronds — large and graceful, gap-free
    const frondMat = mat(`palm_frond_${idx}`, new Color3(0.20, 0.48, 0.12), scene);
    const frondDark = mat(`palm_frondD_${idx}`, new Color3(0.12, 0.32, 0.08), scene);
    canopyMats.push(frondMat);
    const FRONDS   = 9 + Math.floor(rand() * 5);
    const topX     = lean * (SEGS - 1) * segH * 0.8;
    const topZ     = lean * (SEGS - 1) * segH * 0.4;

    for (let i = 0; i < FRONDS; i++) {
        const ang    = (i / FRONDS) * Math.PI * 2 + rand() * 0.3;
        const frondL = (2.5 + rand() * 1.8) * sc;
        const droop  = 0.40 + rand() * 0.28;

        // Midrib (main stalk of frond)
        const midrib = rg(MeshBuilder.CreateCylinder(`palm_mid_${idx}_${i}`, {
            height: frondL, diameterTop: 0.008 * sc, diameterBottom: 0.040 * sc, tessellation: 6,
        }, scene));
        midrib.material = frondMat;
        midrib.rotation.x = -(Math.PI * 0.5 - droop);
        midrib.rotation.y = ang;
        midrib.position.set(
            topX + Math.cos(ang) * frondL * 0.35,
            totalH + 0.08 * sc,
            topZ + Math.sin(ang) * frondL * 0.35,
        );
        midrib.parent = root;

        // Leaflet pairs — overlapping spheroid blades, no gaps
        // Each leaflet pair is a flat-scaled sphere straddling the midrib
        const leaflets = 8 + Math.floor(rand() * 4);
        for (let j = 0; j < leaflets; j++) {
            const t  = (j + 0.5) / leaflets;
            const lw = (0.28 + rand() * 0.10) * sc * (1.0 - t * 0.35); // taper toward tip
            const lh = 0.025 * sc;
            const ld = (0.08 + rand() * 0.03) * sc;

            // Position along the midrib arc
            const px = topX + Math.cos(ang) * frondL * (0.12 + t * 0.78);
            const pz = topZ + Math.sin(ang) * frondL * (0.12 + t * 0.78);
            const py = totalH - t * frondL * droop * 0.52;

            // Use a very flat sphere (scaleY tiny, scaleX wide) for each leaflet pair
            const lf = rg(MeshBuilder.CreateSphere(`palm_lf_${idx}_${i}_${j}`, {
                diameter: 1.0, segments: 5,
            }, scene));
            lf.material = (j % 3 === 0) ? frondDark : frondMat;
            lf.scaling.set(lw, lh, ld * 2.5);
            lf.rotation.y = ang + (rand() - 0.5) * 0.15;
            lf.rotation.x = -(Math.PI * 0.5 - droop) - t * 0.28;
            lf.position.set(px, py, pz);
            lf.parent = root;
        }
    }

    return root;
}

// ─── PLACEMENT HELPERS ────────────────────────────────────────────────────────

const inPond    = (x: number, z: number) => Math.hypot(x + 20, z + 10) < 11.0;
const inCenter  = (x: number, z: number) => Math.hypot(x, z) < 8.0;
const outBound  = (x: number, z: number) => Math.abs(x) > 54 || Math.abs(z) > 54;
// School zone clear — wider margin to prevent trees merging into compound walls
const inSchool  = (x: number, z: number) => Math.abs(x) < 26 && z > -68 && z < -30;

function placeNode(node: TransformNode, x: number, z: number, rand: () => number, scaleVar = 0, dieRngFn?: () => number): number {
    // Sample terrain at 4 points around tree base radius — use the MINIMUM
    // so trunk always rises FROM the ground, never floats on a slope
    const probeR = 0.4;
    const probes = [
        getTerrainHeightAt(x, z),
        getTerrainHeightAt(x + probeR, z),
        getTerrainHeightAt(x - probeR, z),
        getTerrainHeightAt(x, z + probeR),
        getTerrainHeightAt(x, z - probeR),
    ];
    const gy = Math.min(...probes) - 0.05; // sink 5cm into ground — hides any gap on slopes
    node.position.set(x, gy, z);
    node.rotation.y = rand() * Math.PI * 2;
    if (scaleVar > 0) {
        const sc = 1.0 + (rand() - 0.5) * scaleVar;
        node.scaling.setAll(sc);
    }
    
    // BUG 22: Save position for animal collisions
    treePositions.push({ x, z });
    const dieR = dieRngFn ? dieRngFn() : Infinity;
    treeDieRand.push(dieR);
    treeAlive.push(true);
    return dieR;
}

// River centre (inline to avoid circular import)
function riverCentreZ(x: number): number {
    return 20 + 4.5 * Math.sin(x * 0.04) + 2.0 * Math.sin(x * 0.10 + 1.1);
}

// ─── BUILD FOREST ─────────────────────────────────────────────────────────────

export function buildForest(scene: Scene): ForestRef {
    _allTreeMeshes.length = 0;  // reset
    treePositions.length = 0;   // reset
    treeDieRand.length = 0;
    treeAlive.length = 0;

    const rand       = seededRandom(7);
    const nodes:      TransformNode[]    = [];
    const canopyMats: StandardMaterial[] = [];
    const nodeDieRand: number[] = [];
    const nodeBaseScale: Vector3[] = [];

    // Single shared, skewed die-off RNG — skewed toward lower thresholds so a
    // good chunk of the forest is already visibly gone by moderately-bad
    // health, not just near total collapse. Used for BOTH the rendered tree
    // (nodeDieRand, below) and its collision footprint (treeDieRand, inside
    // placeNode) — same call, same value, so a tree's hitbox always vanishes
    // exactly when the tree itself does.
    const dieRng     = seededRandom(999);
    const skewedDie  = () => Math.pow(dieRng(), 1.7);

    const spread = (extent: number) => (rand() - 0.5) * 2 * extent;

    const isBlocked = (x: number, z: number) =>
        isInRiver(x, z) || inPond(x, z) || inCenter(x, z) || outBound(x, z) || inSchool(x, z);

    function tryPlace(build: () => TransformNode, count: number, extentX: number, extentZ: number): void {
        for (let i = 0; i < count; i++) {
            let x = 0, z = 0, tries = 0;
            do {
                x = spread(extentX);
                z = spread(extentZ);
                tries++;
            } while (isBlocked(x, z) && tries < 100);
            if (tries >= 100) continue;
            const node = build();
            placeNode(node, x, z, rand, 0.15);
            nodes.push(node);
        }
    }

    // ── NEEM — 24 instances, all quadrants ───────────────────────────────
    for (let i = 0; i < 24; i++) {
        let x = 0, z = 0, tries = 0;
        do { x = spread(52); z = spread(52); tries++; } while (isBlocked(x, z) && tries < 100);
        if (tries >= 100) continue;
        const node = buildNeem(scene, seededRandom(i * 37 + 5), canopyMats, i);
        const dieR = placeNode(node, x, z, rand, 0.15, skewedDie);
        nodes.push(node);
        nodeDieRand.push(dieR);
        nodeBaseScale.push(node.scaling.clone());
    }

    // ── MANGO — 18 instances ─────────────────────────────────────────────
    for (let i = 0; i < 18; i++) {
        let x = 0, z = 0, tries = 0;
        do { x = spread(50); z = spread(50); tries++; } while (isBlocked(x, z) && tries < 100);
        if (tries >= 100) continue;
        const node = buildMango(scene, seededRandom(i * 53 + 11), canopyMats, i);
        const dieR = placeNode(node, x, z, rand, 0.12, skewedDie);
        nodes.push(node);
        nodeDieRand.push(dieR);
        nodeBaseScale.push(node.scaling.clone());
    }

    // ── BANYAN — hero tree, slightly off-centre ────────────────────────
    const banyanNode = buildBanyan(scene, canopyMats);
    const banY = getTerrainHeightAt(8, 6);
    banyanNode.position.set(8, banY, 6);
    banyanNode.scaling.setAll(0.08);  // grows via atmosphere
    nodes.push(banyanNode);
    nodeDieRand.push(Infinity);
    nodeBaseScale.push(banyanNode.scaling.clone());

    // ── BAMBOO — 14 clusters, river bank + scattered ──────────────────
    for (let i = 0; i < 14; i++) {
        let x = 0, z = 0, tries = 0;
        do {
            if (i < 6) {
                // Near river bank
                const rx = spread(55);
                x = rx;
                z = riverCentreZ(rx) + (rand() * 2 - 1) * 9 + (rand() < 0.5 ? -7 : 7);
            } else {
                x = spread(50); z = spread(50);
            }
            tries++;
        } while ((isInRiver(x, z) || inPond(x, z) || outBound(x, z) || inCenter(x, z) || inSchool(x, z)) && tries < 100);
        if (tries >= 100) continue;
        const node = buildBamboo(scene, seededRandom(i * 59 + 17), canopyMats, i);
        const dieR = placeNode(node, x, z, rand, 0.10, skewedDie);
        nodes.push(node);
        nodeDieRand.push(dieR);
        nodeBaseScale.push(node.scaling.clone());
    }

    // ── TEAK — 16 instances ───────────────────────────────────────────────
    for (let i = 0; i < 16; i++) {
        let x = 0, z = 0, tries = 0;
        do { x = spread(52); z = spread(52); tries++; } while (isBlocked(x, z) && tries < 100);
        if (tries >= 100) continue;
        const node = buildTeak(scene, seededRandom(i * 67 + 23), canopyMats, i);
        const dieR = placeNode(node, x, z, rand, 0.14, skewedDie);
        nodes.push(node);
        nodeDieRand.push(dieR);
        nodeBaseScale.push(node.scaling.clone());
    }

    // ── PALM — 16 instances, pond rim + scattered ────────────────────────
    for (let i = 0; i < 16; i++) {
        let x = 0, z = 0, tries = 0;
        do {
            if (i < 7) {
                // Ring around pond
                const ang = rand() * Math.PI * 2;
                const r   = 11 + rand() * 9;
                x = -20 + Math.cos(ang) * r;
                z = -10 + Math.sin(ang) * r;
            } else {
                x = spread(50); z = spread(50);
            }
            tries++;
        } while ((inPond(x, z) || isInRiver(x, z) || outBound(x, z) || inSchool(x, z)) && tries < 100);
        if (tries >= 100) continue;
        const node = buildPalm(scene, seededRandom(i * 79 + 29), canopyMats, i);
        const dieR = placeNode(node, x, z, rand, 0.12, skewedDie);
        nodes.push(node);
        nodeDieRand.push(dieR);
        nodeBaseScale.push(node.scaling.clone());
    }

    return { nodes, canopyMats, banyanNode, allMeshes: [..._allTreeMeshes], dieRand: nodeDieRand, baseScale: nodeBaseScale };
}

// ─── SCHOOL SILHOUETTE ────────────────────────────────────────────────────────

export function buildSchoolSilhouette(scene: Scene, forest: ForestRef): Mesh[] {
    const schoolMeshes: Mesh[] = [];
    // FIX: school trees used to use their own local nodes/canopyMats arrays
    // that this function discarded on return — so they never received a
    // die-off threshold (always Infinity = immortal) and never had their
    // canopy colour updated with the rest of the forest. They now push
    // directly into the shared ForestRef so updateTreeHealth() treats them
    // exactly like every other tree on the map.
    const canopyMats: StandardMaterial[] = forest.canopyMats;
    const nodes:      TransformNode[]    = forest.nodes;

    // School center — positioned on flat terrain zone
    const baseX =  0;
    const baseZ = -48;
    const groundY = getTerrainHeightAt(baseX, baseZ);

    // ── MATERIALS ─────────────────────────────────────────────────────────
    // Indian school building colours: cream/pale yellow walls, terracotta/brick red roof
    const wallMat   = mat('sch_wall',   new Color3(0.88, 0.84, 0.72), scene, 0.08);   // cream plaster
    const wall2Mat  = mat('sch_wall2',  new Color3(0.82, 0.78, 0.65), scene, 0.06);   // shade variant
    const roofMat   = mat('sch_roof',   new Color3(0.72, 0.28, 0.16), scene, 0.06);   // terracotta red
    const accentMat = mat('sch_accent', new Color3(0.22, 0.48, 0.28), scene, 0.08);   // green trim
    const winMat    = mat('sch_win',    new Color3(0.42, 0.65, 0.88), scene, 0.28);   // blue glass
    const doorMat   = mat('sch_door',   new Color3(0.28, 0.16, 0.08), scene, 0.05);   // brown wood
    const pillarMat = mat('sch_pillar', new Color3(0.92, 0.88, 0.78), scene, 0.10);   // white pillar
    const floorMat  = mat('sch_floor',  new Color3(0.62, 0.58, 0.50), scene, 0.04);   // stone floor
    const poleMat   = mat('sch_pole',   new Color3(0.80, 0.80, 0.78), scene, 0.08);   // silver pole
    const flagSafMat= mat('sch_fsaf',   new Color3(1.00, 0.55, 0.10), scene, 0.20);   // saffron
    const flagWhMat = mat('sch_fwhi',   new Color3(0.92, 0.92, 0.92), scene, 0.15);   // white
    const flagGrMat = mat('sch_fgrn',   new Color3(0.08, 0.52, 0.22), scene, 0.20);   // green
    const boardMat  = mat('sch_board',  new Color3(0.16, 0.40, 0.22), scene, 0.12);   // green chalkboard
    const borderMat = mat('sch_border', new Color3(0.55, 0.42, 0.25), scene, 0.06);   // ochre border

    const mk = (name: string, w: number, h: number, d: number,
                 x: number, y: number, z: number, m: StandardMaterial): Mesh => {
        const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
        b.material = m;
        b.position.set(baseX + x, groundY + y, baseZ + z);
        b.isPickable = false;
        b.renderingGroupId = 2;
        b.receiveShadows = true;
        schoolMeshes.push(b);
        _allTreeMeshes.push(b);
        return b;
    };

    const cyl = (name: string, dia: number, h: number,
                  x: number, y: number, z: number, m: StandardMaterial): Mesh => {
        const c = MeshBuilder.CreateCylinder(name, { diameter: dia, height: h, tessellation: 10 }, scene);
        c.material = m;
        c.position.set(baseX + x, groundY + y, baseZ + z);
        c.isPickable = false;
        c.renderingGroupId = 2;
        c.receiveShadows = true;
        schoolMeshes.push(c);
        _allTreeMeshes.push(c);
        return c;
    };

    // ── GROUND PLATFORM (stone courtyard) ─────────────────────────────────
    mk('sch_platform', 28, 0.18, 22,  0, 0.09, 0, floorMat);

    // Courtyard border strips
    mk('sch_border_front', 28, 0.22, 0.25,  0, 0.20,  10.5, borderMat);
    mk('sch_border_back',  28, 0.22, 0.25,  0, 0.20, -10.5, borderMat);
    mk('sch_border_left',  0.25, 0.22, 22, -13.5, 0.20, 0, borderMat);
    mk('sch_border_right', 0.25, 0.22, 22,  13.5, 0.20, 0, borderMat);

    // ── MAIN BUILDING BODY ────────────────────────────────────────────────
    // Main block
    mk('sch_main',      16, 6.0, 2.8,  0, 3.18, -3.0, wallMat);
    // Side shade (slightly different colour)
    mk('sch_main_side', 16, 5.6, 0.60, 0, 2.98, -4.20, wall2Mat);

    // Horizontal band/string course
    mk('sch_course',    16.4, 0.28, 2.88, 0, 1.24, -3.0, accentMat);

    // ── MAIN ROOF ──────────────────────────────────────────────────────────
    // Flat parapet top
    mk('sch_roof_top',     16.8, 0.40, 3.0,  0, 6.38, -3.0, roofMat);
    // Parapet wall above roof
    mk('sch_parapet_front', 16.8, 0.80, 0.22, 0, 6.98, -1.70, wallMat);
    mk('sch_parapet_back',  16.8, 0.80, 0.22, 0, 6.98, -4.28, wallMat);

    // ── LEFT WING ────────────────────────────────────────────────────────
    mk('sch_wL',       6.0, 5.0, 2.8, -11, 2.68, -3.0, wallMat);
    mk('sch_wL_roof',  6.5, 0.35, 3.0, -11, 5.35, -3.0, roofMat);
    mk('sch_wL_par',   6.5, 0.65, 0.22, -11, 5.82, -1.70, wallMat);
    mk('sch_wL_course', 6.5, 0.24, 2.88, -11, 0.94, -3.0, accentMat);

    // ── RIGHT WING ───────────────────────────────────────────────────────
    mk('sch_wR',       6.0, 5.0, 2.8,  11, 2.68, -3.0, wallMat);
    mk('sch_wR_roof',  6.5, 0.35, 3.0,  11, 5.35, -3.0, roofMat);
    mk('sch_wR_par',   6.5, 0.65, 0.22,  11, 5.82, -1.70, wallMat);
    mk('sch_wR_course', 6.5, 0.24, 2.88, 11, 0.94, -3.0, accentMat);

    // ── PILLARED VERANDA (front facade) ──────────────────────────────────
    mk('sch_veranda_floor', 16, 0.14, 1.8, 0, 0.25, -1.5, floorMat);
    // Pillars
    for (let i = -3; i <= 3; i++) {
        cyl(`sch_pil_${i}`, 0.22, 5.5, i * 2.3, 2.93, -1.4, pillarMat);
    }
    // Veranda ceiling beam
    mk('sch_vbeam', 16.2, 0.22, 0.20, 0, 5.62, -1.40, wallMat);

    // ── WINDOWS — arched tops ─────────────────────────────────────────────
    // Main building — 5 windows
    for (let i = -2; i <= 2; i++) {
        mk(`sch_win_${i}`,    1.10, 1.60, 0.12, i * 2.6, 3.90, -1.62, winMat);
        mk(`sch_warch_${i}`,  1.10, 0.28, 0.12, i * 2.6, 4.80, -1.62, winMat);   // arch top
        mk(`sch_wframe_${i}`, 1.20, 1.98, 0.09, i * 2.6, 3.90, -1.58, accentMat);// green frame
    }

    // Lower windows in wings
    for (let i = -1; i <= 1; i += 2) {
        const wx = i * 10.5;
        mk(`sch_wwin_${i}`,   1.0, 1.40, 0.12, wx, 3.60, -1.62, winMat);
        mk(`sch_warch2_${i}`, 1.0, 0.24, 0.12, wx, 4.40, -1.62, winMat);
        mk(`sch_wframe2_${i}`,1.10, 1.74, 0.09, wx, 3.60, -1.58, accentMat);
    }

    // ── MAIN DOOR ────────────────────────────────────────────────────────
    mk('sch_door',       1.60, 2.40, 0.12,  0, 1.38, -1.62, doorMat);
    mk('sch_door_arch',  1.60, 0.35, 0.12,  0, 2.77, -1.62, roofMat);
    // Door frame
    mk('sch_door_frameL', 0.12, 2.80, 0.10, -0.86, 1.58, -1.60, accentMat);
    mk('sch_door_frameR', 0.12, 2.80, 0.10,  0.86, 1.58, -1.60, accentMat);
    mk('sch_door_frameT', 1.84, 0.12, 0.10,  0,    2.96, -1.60, accentMat);

    // Steps
    mk('sch_step1', 2.5, 0.16, 0.50,  0, 0.16, -1.1, floorMat);
    mk('sch_step2', 3.0, 0.12, 0.50,  0, 0.06, -0.7, floorMat);

    // ── SCHOOL NAME BOARD ─────────────────────────────────────────────────
    mk('sch_nameboard',   7.5, 0.80, 0.10, 0, 5.90, -1.63, boardMat);
    mk('sch_nameboard_fr', 7.7, 0.96, 0.08, 0, 5.90, -1.60, accentMat);

    // ── FLAGPOLE ─────────────────────────────────────────────────────────
    cyl('sch_pole', 0.060, 7.5, -12, 3.75, 5, poleMat);

    // Indian tricolour flag (3 horizontal stripes)
    mk('sch_flag_saf', 1.10, 0.38, 0.04, -11.48, 7.85, 5, flagSafMat);  // saffron top
    mk('sch_flag_whi', 1.10, 0.35, 0.04, -11.48, 7.48, 5, flagWhMat);  // white middle
    mk('sch_flag_grn', 1.10, 0.38, 0.04, -11.48, 7.12, 5, flagGrMat);  // green bottom
    // Ashoka Chakra (tiny sphere on white stripe)
    const chakra = MeshBuilder.CreateTorus('sch_chakra', { diameter: 0.14, thickness: 0.022, tessellation: 12 }, scene);
    chakra.material = mat('chakram', new Color3(0.12, 0.22, 0.72), scene, 0.15);
    chakra.position.set(baseX - 11.48, groundY + 7.48, baseZ + 5);
    chakra.rotation.y = Math.PI / 2;
    chakra.renderingGroupId = 2;
    chakra.isPickable = false;
    schoolMeshes.push(chakra);
    _allTreeMeshes.push(chakra);

    // ── COMPOUND WALL ─────────────────────────────────────────────────────
    // Front wall — split into two segments with 4-unit gate opening at x=0
    mk('sch_cwall_fL', 13, 0.90, 0.28, -8.5, 0.45, 12.5, wallMat);   // left segment x: -15 to -2 (meets side wall + gate post)
    mk('sch_cwall_fR', 13, 0.90, 0.28,  8.5, 0.45, 12.5, wallMat);   // right segment x: 2 to 15 (meets gate post + side wall)
    mk('sch_cwall_l', 0.28, 0.90, 26, -15, 0.45, 0,    wallMat);   // left wall
    mk('sch_cwall_r', 0.28, 0.90, 26,  15, 0.45, 0,    wallMat);   // right wall
    // FIX: back wall was missing entirely — compound was open at the rear.
    // Slightly over-wide (30.5 vs 30) so it overlaps the side walls at both
    // corners instead of just touching them.
    mk('sch_cwall_back', 30.5, 0.90, 0.28, 0, 0.45, -13, wallMat);   // back wall, closes the compound

    // Corner pillar caps — finishes all 4 compound corners cleanly instead of
    // leaving raw butted wall edges
    const cwallCornerY = 0.95;
    for (const [cx, cz] of [[-15, 12.5], [15, 12.5], [-15, -13], [15, -13]] as const) {
        cyl(`sch_wall_corner_${cx}_${cz}`, 0.42, 1.20, cx, cwallCornerY, cz, pillarMat);
    }

    // Gate pillars
    cyl('sch_gate_l', 0.35, 1.40, -2.2, 0.70, 12.5, pillarMat);
    cyl('sch_gate_r', 0.35, 1.40,  2.2, 0.70, 12.5, pillarMat);
    mk('sch_gate_arch', 5.0, 0.35, 0.30, 0, 1.55, 12.5, accentMat);

    // Courtyard border end-caps — small corner blocks so the border strips
    // meet with a finished joint instead of an exposed cut end
    for (const [bx, bz] of [[-13.5, 10.5], [13.5, 10.5], [-13.5, -10.5], [13.5, -10.5]] as const) {
        mk(`sch_border_corner_${bx}_${bz}`, 0.42, 0.24, 0.42, bx, 0.21, bz, borderMat);
    }

    // ── SMALL TREES AROUND SCHOOL ─────────────────────────────────────────
    // Planted neem trees inside compound
    const schoolRand = seededRandom(42);
    // FIX: school trees now die off on the same realistic curve as the rest
    // of the forest (skewed toward lower thresholds), instead of being
    // permanently immortal. Independent seeded RNG so it's deterministic
    // run-to-run but not identical to the main forest's die sequence.
    const schoolDieRng = seededRandom(4242);
    const schoolSkewedDie = () => Math.pow(schoolDieRng(), 1.7);
    const schoolTreePos = [
        [-11, 8], [11, 8], [-5, 9], [5, 9],
    ];
    for (const [tx, tz] of schoolTreePos) {
        const tnode = buildNeem(scene, seededRandom(schoolRand() * 1000 | 0), canopyMats, 200 + schoolTreePos.indexOf([tx, tz]));
        const ty = getTerrainHeightAt(baseX + tx, baseZ + tz);
        tnode.position.set(baseX + tx, ty, baseZ + tz);
        tnode.scaling.setAll(0.55);  // smaller planted trees
        nodes.push(tnode);
        forest.dieRand.push(schoolSkewedDie());
        forest.baseScale.push(tnode.scaling.clone());

        // BUG 22: Save school trees as well
        const dieR = forest.dieRand[forest.dieRand.length - 1];
        treePositions.push({ x: baseX + tx, z: baseZ + tz });
        treeDieRand.push(dieR);
        treeAlive.push(true);
    }

    return schoolMeshes;
}

// ─── SHADOW SETUP ─────────────────────────────────────────────────────────────

export function enableForestShadows(ref: ForestRef, generator: ShadowGenerator): void {
    for (const m of ref.allMeshes) {
        generator.addShadowCaster(m, false);
    }
}

// ─── UPDATE TREE HEALTH ───────────────────────────────────────────────────────

let _lastHealthT = -1;

export function updateTreeHealth(ref: ForestRef, healthT: number): void {
    if (Math.abs(healthT - _lastHealthT) < 0.002) return;
    _lastHealthT = healthT;
    const color = canopyColorAt(healthT);
    const dark  = color.scale(0.46);
    for (const m of ref.canopyMats) {
        m.diffuseColor.r = color.r;
        m.diffuseColor.g = color.g;
        m.diffuseColor.b = color.b;
        m.ambientColor.r = dark.r;
        m.ambientColor.g = dark.g;
        m.ambientColor.b = dark.b;
    }

    // ── DEFORESTATION ──────────────────────────────────────────────────────
    // As the world's score drops (healthT rises), trees shrink and disappear
    // one by one — the forest visibly thins out, just like real deforestation
    // tracking ecosystem collapse. Each tree has its own random threshold
    // (set in buildForest) so the die-off feels organic, not synchronized.
    const FADE_BAND = 0.12; // width of the shrink-then-vanish transition
    for (let i = 0; i < ref.nodes.length; i++) {
        const threshold = ref.dieRand[i];
        if (!isFinite(threshold)) continue; // banyan — never dies
        const deathAmount = smoothstep(threshold - FADE_BAND, threshold, healthT);
        const survival = 1.0 - deathAmount;
        const node = ref.nodes[i];
        const base = ref.baseScale[i];
        node.scaling.set(base.x * survival, base.y * survival, base.z * survival);
        node.setEnabled(survival > 0.02);
    }

    // Mirror the exact same threshold math onto the collision-only arrays
    // (treeDieRand/treeAlive), so a tree's hitbox disappears in lockstep with
    // its mesh — no more "ghost stump" you can't walk through after the
    // tree itself is long gone.
    for (let k = 0; k < treeDieRand.length; k++) {
        const threshold = treeDieRand[k];
        if (!isFinite(threshold)) { treeAlive[k] = true; continue; }
        const deathAmount = smoothstep(threshold - FADE_BAND, threshold, healthT);
        treeAlive[k] = deathAmount < 0.5;
    }
}