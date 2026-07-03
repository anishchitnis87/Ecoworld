import { useEffect } from 'react'
import { useWorldStore } from '@/store/worldStore'

export function useHealthState(): void {
    useEffect(() => {
        let rafId: number

        const tick = () => {
            useWorldStore.getState().tickHealthT()
            rafId = requestAnimationFrame(tick)
        }

        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [])
}