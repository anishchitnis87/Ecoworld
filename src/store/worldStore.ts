import { create } from 'zustand'
import type { EcoScores, EcoTile, SeedStage, StudentContext } from '@/types'

// FIX: this used to be a 5-step staircase (0 / 0.25 / 0.50 / 0.75 / 1.0),
// which caused two visible problems: (1) abrupt jumps in tree/animal/grass
// density right at each score boundary instead of a smooth proportional
// change, and (2) every score from 10 down to 0 was stuck at the SAME
// healthT (0.75) — so dropping all the way to a near-worst score like 10
// barely looked any different from a middling one, because the entire
// final quarter of ecosystem collapse (0.75 → 1.0) was reserved for the
// single-digit range below 10 and never actually got exercised.
// A smooth linear curve fixes both: it keeps the same calibration at the
// two reference points (score 80 → fully healthy, score 60 → 0.25 decayed)
// but makes every point in between continuous, and makes low scores like
// 10 read as genuinely near-collapse (0.875) instead of a flat 0.75.
export function scoreToT(score: number): number {
    return Math.max(0, Math.min(1, (80 - score) / 80))
}

// ─── All 16 Eco Tiles ──────────────────────────────────────────────────────────
const ALL_TILES: EcoTile[] = [
    {
        id: 't1', icon: '🚌',
        label: 'Used public transport today',
        cat: 'TRANSPORT', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch1_climate', chapterName: 'Climate Change',
    },
    {
        id: 't2', icon: '🚴',
        label: 'Cycled or walked instead of car',
        cat: 'TRANSPORT', pts: 3, xp: 15, proofType: 'SELF',
        chapterId: 'ch1_climate', chapterName: 'Climate Change',
    },
    {
        id: 't3', icon: '⚡',
        label: 'Switched to LED lights at home',
        cat: 'ENERGY', pts: 2, xp: 10, proofType: 'PHOTO',
        chapterId: 'ch6_energy', chapterName: 'Renewable Energy',
    },
    {
        id: 't4', icon: '🔌',
        label: 'Unplugged devices on standby',
        cat: 'ENERGY', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch6_energy', chapterName: 'Renewable Energy',
    },
    {
        id: 't5', icon: '🌱',
        label: 'Planted or watered a sapling today',
        cat: 'NATURE', pts: 5, xp: 25, proofType: 'PHOTO',
        chapterId: 'ch5_forests', chapterName: 'Forest Conservation',
    },
    {
        id: 't6', icon: '🌳',
        label: 'Spent 15 mins in a park or garden',
        cat: 'NATURE', pts: 3, xp: 15, proofType: 'PHOTO',
        chapterId: 'ch2_bio', chapterName: 'Biodiversity',
    },
    {
        id: 't7', icon: '♻️',
        label: 'Segregated household waste today',
        cat: 'LIFESTYLE', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch7_waste', chapterName: 'Waste Management',
    },
    {
        id: 't8', icon: '🛍️',
        label: 'Refused single-use plastic today',
        cat: 'LIFESTYLE', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch3_pollution', chapterName: 'Pollution',
    },
    {
        id: 't9', icon: '💧',
        label: 'Turned off tap while brushing',
        cat: 'WATER', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch8_water', chapterName: 'Water Conservation',
    },
    {
        id: 't10', icon: '🌊',
        label: 'Saved water in another way today',
        cat: 'WATER', pts: 2, xp: 10, proofType: 'REFLECTION',
        chapterId: 'ch8_water', chapterName: 'Water Conservation',
    },
    {
        id: 't11', icon: '🥗',
        label: 'Chose plant-based meal today',
        cat: 'FOOD', pts: 3, xp: 15, proofType: 'PHOTO',
        chapterId: 'ch1_climate', chapterName: 'Climate Change',
    },
    {
        id: 't12', icon: '🍱',
        label: 'Brought home-cooked food',
        cat: 'FOOD', pts: 2, xp: 10, proofType: 'SELF',
        chapterId: 'ch7_waste', chapterName: 'Waste Management',
    },
    {
        id: 't13', icon: '🐦',
        label: 'Put water out for birds or animals',
        cat: 'NATURE', pts: 2, xp: 10, proofType: 'PHOTO',
        chapterId: 'ch2_bio', chapterName: 'Biodiversity',
    },
    {
        id: 't14', icon: '🗑️',
        label: 'Picked up litter in a public space',
        cat: 'NATURE', pts: 4, xp: 20, proofType: 'PHOTO',
        chapterId: 'ch3_pollution', chapterName: 'Pollution',
    },
    {
        id: 't15', icon: '🌍',
        label: 'Shared an eco fact with someone',
        cat: 'LIFESTYLE', pts: 1, xp: 5, proofType: 'SELF',
        chapterId: null, chapterName: null,
    },
    {
        id: 't16', icon: '🪣',
        label: 'Composted food waste today',
        cat: 'NATURE', pts: 3, xp: 15, proofType: 'PHOTO',
        chapterId: 'ch7_waste', chapterName: 'Waste Management',
    },
]

// ─── Store Interface ───────────────────────────────────────────────────────────
interface WorldState {
    // Scores & health
    scores: EcoScores
    healthT: number
    targetT: number

    // World meta
    seedStage: SeedStage
    zoneName: string
    isOffline: boolean
    worldReady: boolean

    // Tiles
    tiles: EcoTile[]
    doneTileIds: Set<string>
    pendingTileIds: Set<string>

    // Student
    studentCtx: StudentContext

    // UI
    activeCategory: string
    toastMsg: string
    toastVisible: boolean

    // ─── Actions ────────────────────────────────────────────────────────────────
    setTiles: (tiles: EcoTile[]) => void
    setScores: (s: EcoScores, zoneName?: string) => void
    setTargetT: (t: number) => void
    tickHealthT: () => void
    setSeedStage: (s: SeedStage) => void
    setOffline: (v: boolean) => void
    setWorldReady: (v: boolean) => void
    setStudentCtx: (ctx: StudentContext) => void
    markDone: (id: string) => void
    markPending: (id: string) => void
    removePending: (id: string) => void
    setActiveCategory: (cat: string) => void
    showToast: (msg: string, ms?: number) => void
}

// ─── Toast timer ref (module-level to survive re-renders) ─────────────────────
let _toastTimer: ReturnType<typeof setTimeout> | null = null

// ─── Store ────────────────────────────────────────────────────────────────────
export const useWorldStore = create<WorldState>((set, get) => ({
    // ─── Initial State ──────────────────────────────────────────────────────────
    scores: {
        overall: 80,
        bio: 80,
        air: 80,
        water: 80,
        carbon: 80,
    },
    healthT: 0.0,
    targetT: 0.0,

    seedStage: 'NONE',
    zoneName: 'ECOWORLD',
    isOffline: false,
    worldReady: false,

    tiles: ALL_TILES,
    doneTileIds: new Set<string>(),
    pendingTileIds: new Set<string>(),

    studentCtx: {
        recentChapterIds: [],
        todayCompletedTileIds: [],
        studentClass: '',
    },

    activeCategory: 'ALL',
    toastMsg: '',
    toastVisible: false,

    // ─── Actions ────────────────────────────────────────────────────────────────

    setTiles: (tiles) => set({ tiles }),

    setScores: (s, zoneName) => {
        const t = scoreToT(s.overall)
        set({
            scores: s,
            targetT: t,
            ...(zoneName ? { zoneName } : {}),
        })
    },

    setTargetT: (t) => set({ targetT: t }),

    tickHealthT: () => {
        const { healthT, targetT } = get()
        const delta = targetT - healthT
        if (Math.abs(delta) > 0.0001) {
            set({ healthT: healthT + delta * 0.004 })
        }
    },

    setSeedStage: (s) => set({ seedStage: s }),

    setOffline: (v) => set({ isOffline: v }),

    setWorldReady: (v) => set({ worldReady: v }),

    setStudentCtx: (ctx) => {
        const done = new Set<string>(ctx.todayCompletedTileIds)
        set({
            studentCtx: ctx,
            doneTileIds: done,
        })
    },

    markDone: (id) => {
        const done = new Set(get().doneTileIds)
        const pending = new Set(get().pendingTileIds)
        done.add(id)
        pending.delete(id)
        set({ doneTileIds: done, pendingTileIds: pending })
    },

    markPending: (id) => {
        const pending = new Set(get().pendingTileIds)
        pending.add(id)
        set({ pendingTileIds: pending })
    },

    removePending: (id) => {
        const pending = new Set(get().pendingTileIds)
        pending.delete(id)
        set({ pendingTileIds: pending })
    },

    setActiveCategory: (cat) => set({ activeCategory: cat }),

    showToast: (msg, ms = 2400) => {
        if (_toastTimer) clearTimeout(_toastTimer)
        set({ toastMsg: msg, toastVisible: true })
        _toastTimer = setTimeout(() => {
            set({ toastVisible: false })
            _toastTimer = null
        }, ms)
    },
}))