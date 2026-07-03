// ─── Seed Stages ───────────────────────────────────────────────────────────────
export type SeedStage =
    | 'NONE'
    | 'ORB'
    | 'SAPLING'
    | 'YOUNG_TREE'
    | 'GUARDIAN_TREE'
    | 'ANCIENT_GUARDIAN'

// ─── Proof & Category Types ────────────────────────────────────────────────────
export type ProofType = 'SELF' | 'PHOTO' | 'REFLECTION'

export type TileCategory =
    | 'TRANSPORT'
    | 'NATURE'
    | 'FOOD'
    | 'LIFESTYLE'
    | 'WATER'
    | 'ENERGY'

// ─── Eco Scores ────────────────────────────────────────────────────────────────
export interface EcoScores {
    overall: number
    bio: number
    air: number
    water: number
    carbon: number
}

// ─── Eco Tile ──────────────────────────────────────────────────────────────────
export interface EcoTile {
    id: string
    icon: string
    label: string
    cat: TileCategory
    pts: number
    xp: number
    proofType: ProofType
    chapterId: string | null
    chapterName: string | null
}

// ─── Student Context ───────────────────────────────────────────────────────────
export interface StudentContext {
    recentChapterIds: string[]
    todayCompletedTileIds: string[]
    studentClass: string
}

// ─── React Native Message Bridge ───────────────────────────────────────────────
export type RNMessageType =
    | 'ZONE_UPDATE'
    | 'TASK_CONFIRMED'
    | 'TASK_FAILED'
    | 'SET_CONTEXT'
    | 'SET_OFFLINE'
    | 'SET_TASKS'

export interface RNMessage {
    type: RNMessageType
    payload: Record<string, unknown>
}

// ─── URL Params ────────────────────────────────────────────────────────────────
export interface URLParams {
    overall: number
    bio: number
    air: number
    water: number
    carbon: number
    demo: boolean
    quality: 'low' | 'medium' | 'high'
    zoneName: string
}

// ─── Health State ──────────────────────────────────────────────────────────────
export type HealthState =
    | 'THRIVING'
    | 'HEALTHY'
    | 'STRUGGLING'
    | 'CRITICAL'
    | 'COLLAPSED'

// FIX: see the matching comment in store/worldStore.ts — this used to be a
// 5-step staircase that left every score 0-10 stuck at the same 0.75
// healthT. Now a smooth continuous curve, same calibration at the two
// reference points (score 80 → 0, score 60 → 0.25).
export function scoreToT(score: number): number {
    return Math.max(0, Math.min(1, (80 - score) / 80))
}

export function tToHealthState(t: number): HealthState {
    if (t <= 0.125) return 'THRIVING'
    if (t <= 0.375) return 'HEALTHY'
    if (t <= 0.625) return 'STRUGGLING'
    if (t <= 0.875) return 'CRITICAL'
    return 'COLLAPSED'
}

// ─── Seed Stage Emoji Map ──────────────────────────────────────────────────────
export const SEED_STAGE_EMOJI: Record<SeedStage, string> = {
    NONE: '🌰',
    ORB: '✨',
    SAPLING: '🌱',
    YOUNG_TREE: '🌿',
    GUARDIAN_TREE: '🌳',
    ANCIENT_GUARDIAN: '🌲',
}

export const SEED_STAGE_LABEL: Record<SeedStage, string> = {
    NONE: 'Seed',
    ORB: 'Orb',
    SAPLING: 'Sapling',
    YOUNG_TREE: 'Young Tree',
    GUARDIAN_TREE: 'Guardian',
    ANCIENT_GUARDIAN: 'Ancient',
}