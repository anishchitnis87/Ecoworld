import { useMemo } from 'react'
import type { URLParams } from '@/types'

export function useURLParams(): URLParams {
    return useMemo(() => {
        const p = new URLSearchParams(location.search)

        const overall = Math.min(100, Math.max(0, parseInt(p.get('overall') ?? '80')))

        const bio = Math.min(100, Math.max(0,
            parseInt(p.get('biodiversity') ?? p.get('bio') ?? String(overall))
        ))
        const air = Math.min(100, Math.max(0,
            parseInt(p.get('airQuality') ?? p.get('air') ?? String(overall))
        ))
        const water = Math.min(100, Math.max(0,
            parseInt(p.get('waterPurity') ?? p.get('water') ?? String(overall))
        ))
        const carbon = Math.min(100, Math.max(0,
            parseInt(p.get('carbon') ?? String(overall))
        ))

        const rawQuality = p.get('quality')
        const quality: URLParams['quality'] =
            rawQuality === 'low' || rawQuality === 'high'
                ? rawQuality
                : 'medium'

        return {
            overall,
            bio,
            air,
            water,
            carbon,
            demo: p.get('demo') === 'true',
            quality,
            zoneName: decodeURIComponent(p.get('zoneName') ?? 'ECOWORLD'),
        }
    }, [])
}