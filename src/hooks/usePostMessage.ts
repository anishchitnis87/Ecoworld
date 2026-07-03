import { useEffect, useCallback } from 'react'
import { useWorldStore } from '@/store/worldStore'
import type { RNMessage } from '@/types'

// ─── Post to React Native ─────────────────────────────────────────────────────
type PostToRN = (obj: Record<string, unknown>) => void

export function usePostMessage(): PostToRN {
    const {
        setScores,
        setSeedStage,
        markDone,
        removePending,
        setStudentCtx,
        setOffline,
        showToast,
        setTiles,
    } = useWorldStore()

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            let parsed: RNMessage

            try {
                parsed = JSON.parse(
                    typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
                ) as RNMessage
            } catch {
                return
            }

            const { type, payload } = parsed

            switch (type) {

                // ─── Zone scores update from RN ───────────────────────────────────────
                case 'ZONE_UPDATE': {
                    const bio =
                        typeof payload.biodiversity === 'number' ? payload.biodiversity :
                            typeof payload.bio === 'number' ? payload.bio : 80

                    const air =
                        typeof payload.airQuality === 'number' ? payload.airQuality :
                            typeof payload.air === 'number' ? payload.air : 80

                    const water =
                        typeof payload.waterPurity === 'number' ? payload.waterPurity :
                            typeof payload.water === 'number' ? payload.water : 80

                    const carbon =
                        typeof payload.carbon === 'number' ? payload.carbon : 80

                    const overall =
                        typeof payload.overall === 'number' ? payload.overall : 80

                    const zoneName =
                        typeof payload.zoneName === 'string' ? payload.zoneName : undefined

                    setScores({ overall, bio, air, water, carbon }, zoneName)

                    if (typeof payload.seedStage === 'string') {
                        setSeedStage(payload.seedStage as ReturnType<typeof useWorldStore.getState>['seedStage'])
                    }
                    break
                }

                // ─── Tile confirmed by RN backend ─────────────────────────────────────
                case 'TASK_CONFIRMED': {
                    if (typeof payload.tileId === 'string') {
                        markDone(payload.tileId)
                        showToast('✅ Action logged!')
                    }
                    break
                }

                // ─── Tile failed on RN backend ────────────────────────────────────────
                case 'TASK_FAILED': {
                    if (typeof payload.tileId === 'string') {
                        removePending(payload.tileId)
                        showToast('❌ Could not save — try again')
                    }
                    break
                }

                // ─── Student context (chapters, completed tiles, class) ───────────────
                case 'SET_CONTEXT': {
                    const recentChapterIds =
                        Array.isArray(payload.recentChapterIds)
                            ? (payload.recentChapterIds as string[])
                            : []

                    const todayCompletedTileIds =
                        Array.isArray(payload.todayCompletedTileIds)
                            ? (payload.todayCompletedTileIds as string[])
                            : []

                    const studentClass =
                        typeof payload.studentClass === 'string'
                            ? payload.studentClass
                            : ''

                    setStudentCtx({ recentChapterIds, todayCompletedTileIds, studentClass })
                    break
                }

                // ─── Active backend tasks loader ──────────────────────────────────────
                case 'SET_TASKS': {
                    if (Array.isArray(payload.tasks)) {
                        const mappedTiles = payload.tasks.map((task: any) => ({
                            id: task.taskId,
                            icon: task.emoji || '🌱',
                            label: task.title,
                            cat: (task.category || 'LIFESTYLE').toUpperCase(),
                            pts: Math.round((task.xpReward || 10) / 5),
                            xp: task.xpReward || 10,
                            proofType: (task.proofRequired ? 'PHOTO' : 'SELF') as 'PHOTO' | 'SELF',
                            chapterId: null,
                            chapterName: null,
                        }))
                        setTiles(mappedTiles)
                    }
                    break
                }

                // ─── Offline status ───────────────────────────────────────────────────
                case 'SET_OFFLINE': {
                    if (typeof payload.offline === 'boolean') {
                        setOffline(payload.offline)
                        if (payload.offline) {
                            showToast('📶 You are offline')
                        }
                    }
                    break
                }

                default:
                    break
            }
        }

        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [setScores, setSeedStage, markDone, removePending, setStudentCtx, setOffline, showToast, setTiles])

    // ─── postToRN helper ──────────────────────────────────────────────────────
    const postToRN = useCallback<PostToRN>((obj) => {
        try {
            const msg = JSON.stringify(obj)
            // @ts-expect-error — ReactNativeWebView injected by RN
            window.ReactNativeWebView?.postMessage(msg)
        } catch {
            console.warn('[EcoWorld] postToRN failed', obj)
        }
    }, [])

    return postToRN
}