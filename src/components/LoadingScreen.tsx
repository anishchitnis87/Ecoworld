import { motion, AnimatePresence } from 'framer-motion'

interface LoadingScreenProps {
    visible: boolean
    progress: number  // 0-100
    message: string
}

export function LoadingScreen({ visible, progress, message }: LoadingScreenProps) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    key="loading"
                    initial={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.04 }}
                    transition={{ duration: 0.7, ease: 'easeInOut' }}
                    className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#050e05]"
                >
                    {/* ── Outer glow ring ── */}
                    <div className="relative flex items-center justify-center mb-8">
                        <motion.div
                            animate={{
                                boxShadow: [
                                    '0 0 20px rgba(34,197,94,0.3)',
                                    '0 0 60px rgba(34,197,94,0.7)',
                                    '0 0 20px rgba(34,197,94,0.3)',
                                ],
                            }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                            className="w-24 h-24 rounded-full border border-eco-green/20 flex items-center justify-center"
                        >
                            {/* ── Pulsing orb ── */}
                            <motion.div
                                animate={{ scale: [1, 1.12, 1] }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                className="w-16 h-16 rounded-full bg-eco-green/20 flex items-center justify-center"
                            >
                                <motion.div
                                    animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                    className="w-10 h-10 rounded-full bg-eco-green"
                                    style={{
                                        boxShadow: '0 0 24px rgba(34,197,94,0.8)',
                                    }}
                                />
                            </motion.div>
                        </motion.div>

                        {/* ── Rotating ring ── */}
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                            className="absolute w-28 h-28 rounded-full border-t-2 border-r-2 border-eco-green/40 border-b-transparent border-l-transparent"
                        />
                    </div>

                    {/* ── Title ── */}
                    <h1 className="font-syne font-extrabold text-eco-green text-2xl tracking-[0.3em] uppercase mb-1">
                        EcoWorld
                    </h1>

                    {/* ── Subtitle ── */}
                    <p className="font-dm text-white/40 text-xs tracking-widest mb-8">
                        Your actions shape this world
                    </p>

                    {/* ── Progress bar ── */}
                    <div className="w-48 h-[2px] bg-eco-green/20 rounded-full overflow-hidden mb-3">
                        <motion.div
                            className="h-full bg-eco-green rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                            style={{ boxShadow: '0 0 8px rgba(34,197,94,0.6)' }}
                        />
                    </div>

                    {/* ── Progress percent ── */}
                    <p className="font-dm text-eco-green/60 text-[10px] font-bold mb-2">
                        {Math.round(progress)}%
                    </p>

                    {/* ── Rotating message ── */}
                    <AnimatePresence mode="wait">
                        <motion.p
                            key={message}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.3 }}
                            className="font-dm text-white/35 text-[10px] tracking-wider"
                        >
                            {message}
                        </motion.p>
                    </AnimatePresence>

                    {/* ── Bottom eco tagline ── */}
                    <div className="absolute bottom-8 flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-eco-green/40" />
                        <p className="font-dm text-white/20 text-[9px] tracking-[0.2em] uppercase">
                            EcoQuest — Act. Heal. Thrive.
                        </p>
                        <div className="w-1 h-1 rounded-full bg-eco-green/40" />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}