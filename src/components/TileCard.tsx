/**
 * src/components/TileCard.tsx — EcoWorld v4
 */

import type { EcoTile } from '@/types';

interface Props {
    tile:      EcoTile;
    isPending: boolean;
    isDone:    boolean;
    onTap:     () => void;
}

const CAT_DOT: Record<string, string> = {
    TRANSPORT: 'bg-cyan-400',
    NATURE:    'bg-eco-green',
    FOOD:      'bg-eco-amber',
    LIFESTYLE: 'bg-purple-400',
    WATER:     'bg-blue-400',
    ENERGY:    'bg-eco-orange',
};

export function TileCard({ tile, isPending, isDone, onTap }: Props) {
    const base    = 'bg-white/[0.07] border border-white/[0.08]';
    const doneCls = isDone    ? 'bg-eco-green/[0.06] border-eco-green/30 opacity-60' : '';
    const pendCls = isPending ? 'border-amber-400/50' : '';

    return (
        <div className={`${base} ${doneCls} ${pendCls} rounded-2xl p-3 flex flex-col gap-1.5`}>
            {/* Row 1: icon + cat dot */}
            <div className="flex items-center gap-1.5">
                <span className="text-2xl leading-none">{tile.icon}</span>
                <span className={`w-[7px] h-[7px] rounded-full ${CAT_DOT[tile.cat] ?? 'bg-white/40'} ml-auto`} />
            </div>

            {/* Row 2: label */}
            <p className="text-[11px] font-bold text-neutral-100 leading-snug font-dm">{tile.label}</p>

            {/* Row 3: pts */}
            <p className="text-eco-green text-[9px] font-bold font-syne">+{tile.pts}pts · +{tile.xp}XP</p>

            {/* Row 4: chapter */}
            {tile.chapterId && (
                <span className="text-[8px] text-green-400/80 bg-eco-green/10 rounded-md px-1.5 py-0.5 w-fit font-dm">
                    📗 {tile.chapterName}
                </span>
            )}

            {/* Row 5: proof badge */}
            {tile.proofType !== 'SELF' && (
                <span className="text-[8px] text-amber-400 bg-amber-400/[0.12] rounded-md px-1.5 py-0.5 w-fit font-dm">
                    {tile.proofType === 'PHOTO' ? '📸 Photo proof' : '✍️ Reflection'}
                </span>
            )}

            {/* Button */}
            {isDone ? (
                <button disabled className="mt-auto w-full rounded-xl py-1.5 text-[10px] font-syne font-bold bg-white/[0.08] text-eco-green cursor-default">
                    ✓ Done
                </button>
            ) : isPending ? (
                <button disabled className="mt-auto w-full rounded-xl py-1.5 text-[10px] font-syne font-bold bg-white/[0.08] text-amber-400 cursor-default">
                    ⏳ Saving…
                </button>
            ) : tile.proofType === 'SELF' ? (
                <button onClick={onTap} className="mt-auto w-full rounded-xl py-1.5 text-[10px] font-syne font-bold bg-eco-green text-white active:scale-95 transition-transform">
                    ✓ Log It
                </button>
            ) : (
                <button onClick={onTap} className="mt-auto w-full rounded-xl py-1.5 text-[10px] font-syne font-bold bg-amber-500 text-white active:scale-95 transition-transform">
                    Submit Proof →
                </button>
            )}
        </div>
    );
}