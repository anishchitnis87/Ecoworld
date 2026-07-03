/**
 * src/components/Joystick.tsx — EcoWorld v4 FIXED
 *
 * FIX: The outer container was `fixed inset-0` (full screen), which meant
 * the joystick pointer handler consumed ALL touch events — including taps
 * on the EcoDrawer handle strip at the bottom. The drawer's onClick never
 * fired because the joystick layer swallowed the pointer first.
 *
 * Fix: Container now covers only `top:0 → bottom:DRAWER_H`, leaving the
 * bottom 56px (the closed drawer handle) completely free to receive its
 * own pointer events.
 *
 * Everything else is identical — joystick, camera drag, pointer capture,
 * safety reset, visual design — all unchanged.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import {
    joystickState,
    setCamYaw, getCamYaw,
    setCamPitch, getCamPitch,
} from '@/babylon/character';

const MAX_DIST     = 52;    // px — max thumb travel
const MOVE_ZONE_PX = 150;   // px — fixed boundary between MOVE and LOOK zones.
                             // Must stay just past the joystick's right edge
                             // (base sits at left:28, width:116 → ends at 144px)
                             // so the "LOOK" hint (left:156px) actually falls
                             // inside the LOOK zone instead of the MOVE zone.
                             // NOTE: previously this was `window.innerWidth * 0.45`,
                             // which on real phone widths put the boundary around
                             // 350-400px — well past the LOOK hint, so dragging
                             // on/near it was silently captured as MOVE input.
const DRAWER_H     = 56;    // px — height of the closed drawer handle strip

export function Joystick() {
    const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 });
    const [active,   setActive]   = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const leftPtrId    = useRef<number | null>(null);
    const rightPtrId   = useRef<number | null>(null);
    const leftOrigin   = useRef({ x: 0, y: 0 });
    const rightLast    = useRef({ x: 0, y: 0 });

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        containerRef.current?.setPointerCapture(e.pointerId);
        const isLeft = e.clientX < MOVE_ZONE_PX;

        if (isLeft && leftPtrId.current === null) {
            leftPtrId.current         = e.pointerId;
            leftOrigin.current        = { x: e.clientX, y: e.clientY };
            joystickState.x           = 0;
            joystickState.z           = 0;
            joystickState.magnitude   = 0;
            joystickState.touchActive = true;
            setThumbPos({ x: 0, y: 0 });
            setActive(true);
        } else if (!isLeft && rightPtrId.current === null) {
            rightPtrId.current = e.pointerId;
            rightLast.current  = { x: e.clientX, y: e.clientY };
        }
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerId === leftPtrId.current) {
            const rawDx = e.clientX - leftOrigin.current.x;
            const rawDy = e.clientY - leftOrigin.current.y;
            const dist  = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

            const clampedDist = Math.min(dist, MAX_DIST);
            const nx = dist > 0.001 ? (rawDx / dist) * clampedDist : 0;
            const ny = dist > 0.001 ? (rawDy / dist) * clampedDist : 0;

            joystickState.x         = nx / MAX_DIST;
            joystickState.z         = ny / MAX_DIST;
            joystickState.magnitude = Math.min(dist / MAX_DIST, 1.0);

            setThumbPos({ x: nx, y: ny });

        } else if (e.pointerId === rightPtrId.current) {
            const dX = e.clientX - rightLast.current.x;
            const dY = e.clientY - rightLast.current.y;
            rightLast.current = { x: e.clientX, y: e.clientY };

            setCamYaw(getCamYaw()     + dX * 0.006);
            setCamPitch(getCamPitch() + dY * 0.004);
        }
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerId === leftPtrId.current) {
            leftPtrId.current         = null;
            joystickState.x           = 0;
            joystickState.z           = 0;
            joystickState.magnitude   = 0;
            joystickState.touchActive = false;
            setThumbPos({ x: 0, y: 0 });
            setActive(false);
        } else if (e.pointerId === rightPtrId.current) {
            rightPtrId.current = null;
        }
    }, []);

    useEffect(() => {
        const resetAll = () => {
            if (leftPtrId.current !== null) {
                leftPtrId.current         = null;
                joystickState.x           = 0;
                joystickState.z           = 0;
                joystickState.magnitude   = 0;
                joystickState.touchActive = false;
                setThumbPos({ x: 0, y: 0 });
                setActive(false);
            }
            if (rightPtrId.current !== null) {
                rightPtrId.current = null;
            }
        };

        const onVisChange = () => { if (document.hidden) resetAll(); };
        const onWinPtrUp  = (e: PointerEvent) => {
            if (e.pointerId === leftPtrId.current) {
                leftPtrId.current         = null;
                joystickState.x           = 0;
                joystickState.z           = 0;
                joystickState.magnitude   = 0;
                joystickState.touchActive = false;
                setThumbPos({ x: 0, y: 0 });
                setActive(false);
            }
            if (e.pointerId === rightPtrId.current) {
                rightPtrId.current = null;
            }
        };

        document.addEventListener('visibilitychange', onVisChange);
        window.addEventListener('pointerup',     onWinPtrUp);
        window.addEventListener('pointercancel', onWinPtrUp);

        return () => {
            document.removeEventListener('visibilitychange', onVisChange);
            window.removeEventListener('pointerup',     onWinPtrUp);
            window.removeEventListener('pointercancel', onWinPtrUp);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="fixed left-0 right-0 z-[38] touch-none select-none"
            style={{ top: 44, bottom: DRAWER_H }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            {/* ── JOYSTICK BASE ─────────────────────────────────────────── */}
            <div
                className="absolute pointer-events-none"
                style={{
                    bottom: 32,
                    left: 28,
                    width: 116,
                    height: 116,
                    borderRadius: '50%',
                    background: active
                        ? 'radial-gradient(circle, rgba(34,197,94,0.14) 0%, rgba(6,182,212,0.08) 100%)'
                        : 'radial-gradient(circle, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.04) 100%)',
                    border: active
                        ? '2px solid rgba(34,197,94,0.45)'
                        : '2px solid rgba(255,255,255,0.22)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    boxShadow: active
                        ? '0 0 24px rgba(34,197,94,0.20), inset 0 0 16px rgba(34,197,94,0.06)'
                        : '0 0 16px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.08)',
                    transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
                }}
            >
                <div
                    className="absolute"
                    style={{
                        top: '50%', left: '50%',
                        width: 64, height: 64,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.10)',
                        transform: 'translate(-50%,-50%)',
                    }}
                />
                {[0, 90, 180, 270].map((deg, i) => (
                    <div
                        key={i}
                        className="absolute"
                        style={{
                            top: '50%', left: '50%',
                            width: 5, height: 5,
                            borderRadius: '50%',
                            background: 'rgba(255,255,255,0.18)',
                            transform: `translate(-50%,-50%) translate(${Math.cos((deg - 90) * Math.PI / 180) * 44}px, ${Math.sin((deg - 90) * Math.PI / 180) * 44}px)`,
                        }}
                    />
                ))}
                <div
                    className="absolute"
                    style={{
                        top: '50%',
                        left: '50%',
                        width: 46,
                        height: 46,
                        borderRadius: '50%',
                        background: active
                            ? 'radial-gradient(circle at 32% 32%, rgba(52,211,153,0.95), rgba(6,182,212,0.75))'
                            : 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.65), rgba(200,210,220,0.40))',
                        boxShadow: active
                            ? '0 0 20px rgba(52,211,153,0.60), 0 3px 10px rgba(0,0,0,0.35)'
                            : '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.40)',
                        transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))`,
                        transition: joystickState.magnitude < 0.05 ? 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
                        border: '1.5px solid rgba(255,255,255,0.30)',
                    }}
                />
            </div>
        </div>
    );
}
