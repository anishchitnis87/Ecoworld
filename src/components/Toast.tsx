import { motion, AnimatePresence } from 'framer-motion'
import { useWorldStore } from '@/store/worldStore'

export function Toast() {
    const toastMsg = useWorldStore((s) => s.toastMsg)
    const toastVisible = useWorldStore((s) => s.toastVisible)

    return (
        <AnimatePresence>
            {toastVisible && (
                <motion.div
                    key="toast"
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
                >
                    <div
                        className="bg-eco-green/90 backdrop-blur-sm text-white rounded-full px-5 py-2 font-syne text-xs font-bold whitespace-nowrap"
                        style={{ boxShadow: '0 0 20px rgba(34,197,94,0.4)' }}
                    >
                        {toastMsg}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}