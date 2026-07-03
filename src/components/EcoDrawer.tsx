/**
 * src/components/EcoDrawer.tsx — EcoWorld v4
 */

import { useState } from 'react';
import { useWorldStore } from '@/store/worldStore';
import { TileCard } from './TileCard';

interface Props {
    postToRN: (obj: Record<string, unknown>) => void;
}

const CATEGORIES = ['ALL', 'TRANSPORT', 'NATURE', 'FOOD', 'LIFESTYLE', 'WATER', 'ENERGY'] as const;

export function EcoDrawer({ postToRN }: Props) {
    const [open, setOpen] = useState(false);
    const [activeCat, setActiveCat] = useState<string>('ALL');

    const {
        tiles, doneTileIds, pendingTileIds, studentCtx,
        isOffline, markPending, showToast,
    } = useWorldStore();

    const doneCount = doneTileIds.size;
    const totalCount = tiles.length || 16;

    function onTileTap(tile: typeof tiles[0]) {
        if (isOffline)                   { showToast('📶 Connect to log actions'); return; }
        if (doneTileIds.has(tile.id))    return;
        if (pendingTileIds.has(tile.id)) return;
        markPending(tile.id);
        showToast(`${tile.icon} Logging…`);
        postToRN({
            type: 'ECO_ACTION_TAPPED',
            payload: {
                actionLabel:  tile.label,
                category:     tile.cat,
                tileId:       tile.id,
                pts:          tile.pts,
                xp:           tile.xp,
                proofType:    tile.proofType,
                chapterId:    tile.chapterId,
                chapterName:  tile.chapterName,
            },
        });
    }

    const suggested  = tiles.filter(t =>
        t.chapterId && studentCtx.recentChapterIds.includes(t.chapterId) && !doneTileIds.has(t.id)
    );
    const remaining  = tiles.filter(t =>
        !doneTileIds.has(t.id) &&
        !suggested.includes(t) &&
        (activeCat === 'ALL' || t.cat === activeCat)
    );
    const completed  = tiles.filter(t => doneTileIds.has(t.id));

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-[39] flex flex-col"
            style={{
                background:     'rgba(5,14,5,0.92)',
                backdropFilter: 'blur(18px)',
                borderTop:      '1px solid rgba(255,255,255,0.06)',
                maxHeight:      '72vh',
                transform:      open ? 'translateY(0%)' : 'translateY(calc(100% - 56px))',
                transition:     'transform 0.44s cubic-bezier(0.34,1.38,0.64,1)',
            }}
        >
            {/* Handle zone */}
            <div
                className="flex flex-col items-center pt-2 pb-1 cursor-pointer select-none"
                onClick={() => setOpen(o => !o)}
            >
                <div className="h-1 w-10 bg-white/30 rounded-full mb-2" />
                <div className="flex items-center gap-2 px-4 w-full">
                    <span className="text-sm font-syne font-extrabold text-eco-green">🌿 Today's Actions</span>
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden mx-2">
                        <div
                            className="h-full bg-eco-green rounded-full transition-all"
                            style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
                        />
                    </div>
                    <span className="text-[10px] font-syne font-bold text-white/60">{doneCount}/{totalCount}</span>
                </div>
            </div>

            {/* Category tabs */}
            <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-none shrink-0">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setActiveCat(cat)}
                        className={`shrink-0 text-[10px] font-syne font-bold rounded-full px-3 py-1 transition-colors ${
                            activeCat === cat ? 'bg-eco-green text-white' : 'bg-white/[0.08] text-white/60'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Scrollable tile body */}
            <div className="overflow-y-auto flex-1 px-3 pb-4">
                {suggested.length > 0 && (
                    <>
                        <p className="text-white/40 text-[9px] font-syne font-bold tracking-widest uppercase mb-2 mt-1">
                            ⭐ Suggested for You
                        </p>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {suggested.map(t => (
                                <TileCard
                                    key={t.id} tile={t}
                                    isPending={pendingTileIds.has(t.id)}
                                    isDone={doneTileIds.has(t.id)}
                                    onTap={() => onTileTap(t)}
                                />
                            ))}
                        </div>
                    </>
                )}

                {remaining.length > 0 && (
                    <>
                        <p className="text-white/40 text-[9px] font-syne font-bold tracking-widest uppercase mb-2">
                            All Actions
                        </p>
                        <div className="grid grid-cols-2 gap-2 mb-3">
                            {remaining.map(t => (
                                <TileCard
                                    key={t.id} tile={t}
                                    isPending={pendingTileIds.has(t.id)}
                                    isDone={false}
                                    onTap={() => onTileTap(t)}
                                />
                            ))}
                        </div>
                    </>
                )}

                {completed.length > 0 && (
                    <>
                        <p className="text-white/40 text-[9px] font-syne font-bold tracking-widest uppercase mb-2">
                            ✓ Completed Today
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {completed.map(t => (
                                <TileCard
                                    key={t.id} tile={t}
                                    isPending={false}
                                    isDone={true}
                                    onTap={() => {}}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}