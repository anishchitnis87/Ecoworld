/**
 * src/components/TopBar.tsx — EcoWorld v4 FINAL
 */

import { useWorldStore } from '@/store/worldStore';

interface Props {
    postToRN: (obj: Record<string, unknown>) => void;
}

const SEED_EMOJI: Record<string, string> = {
    NONE:             '🌰',
    ORB:              '✨',
    SAPLING:          '🌱',
    YOUNG_TREE:       '🌿',
    GUARDIAN_TREE:    '🌳',
    ANCIENT_GUARDIAN: '🌲',
};

export function TopBar({ postToRN }: Props) {
    const { scores, zoneName, seedStage } = useWorldStore();

    function onSeedTap() {
        postToRN({ type: 'SEED_TAPPED', payload: { seedStage } });
    }

    return (
        <div className="fixed top-0 left-0 right-0 h-11 z-30 flex items-center px-4 gap-3"
            style={{ background: 'rgba(5,14,5,0.80)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
            {/* Zone name */}
            <span className="font-syne font-bold text-eco-green text-[11px] tracking-[0.2em] uppercase shrink-0">
                {zoneName}
            </span>

            {/* Score pills */}
            <div className="flex gap-1.5 flex-1 justify-center">
                {[
                    { label: 'BIO',  val: scores.bio,    dot: 'bg-eco-green' },
                    { label: 'AIR',  val: scores.air,    dot: 'bg-eco-teal' },
                    { label: 'H₂O',  val: scores.water,  dot: 'bg-blue-400' },
                    { label: 'CO₂',  val: scores.carbon, dot: 'bg-eco-amber' },
                ].map(({ label, val, dot }) => (
                    <div key={label} className="flex items-center gap-1 bg-white/[0.08] rounded-full px-2 py-1">
                        <span className={`w-[5px] h-[5px] rounded-full ${dot}`} />
                        <span className="text-[11px] font-syne font-bold text-white">{val}</span>
                    </div>
                ))}
            </div>

            {/* Seed stage */}
            <button
                onClick={onSeedTap}
                className="flex items-center gap-1 shrink-0 active:scale-90 transition-transform"
            >
                <span className="text-base">{SEED_EMOJI[seedStage] ?? '🌰'}</span>
                <span className="text-[9px] font-syne font-bold text-eco-purple leading-none">
                    {seedStage.replace('_', ' ')}
                </span>
            </button>
        </div>
    );
}