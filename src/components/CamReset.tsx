/**
 * src/components/CamReset.tsx — EcoWorld v4
 * Camera reset button — fixed bottom-right, above joystick.
 */
import { resetCamera } from '@/babylon/character';

export function CamReset() {
    return (
        <button
            className="fixed bottom-[72px] right-[18px] z-[38] w-[44px] h-[44px] rounded-full
                       bg-white/12 backdrop-blur-sm border border-white/15
                       flex items-center justify-center text-white text-lg
                       active:scale-95 transition-transform touch-none"
            onPointerDown={(e) => { e.stopPropagation(); resetCamera(); }}
        >
            ↩
        </button>
    );
}