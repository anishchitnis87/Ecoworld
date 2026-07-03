/**
 * src/App.tsx — EcoWorld v4
 *
 * FIX (loading screen flash):
 *  Previously setWorldReady(true) was called synchronously at setProgress(100),
 *  BEFORE engine.runRenderLoop() started. This meant the loading screen exited
 *  while the canvas was still black — causing the flash of sky/grass you saw.
 *  Fix: setWorldReady(true) is now called 800ms AFTER runRenderLoop() starts,
 *  giving Babylon time to render several frames before the loading screen fades.
 *
 * Also adds:
 *  - WASD keyboard movement (desktop exploration)
 *  - Mouse wheel zoom
 *  - Proper keyboard/wheel cleanup on unmount
 */

import { useEffect, useRef, useState } from 'react';
import { Vector3, Color3 } from '@babylonjs/core';
import { AnimatePresence } from 'framer-motion';

import { useURLParams }   from '@/hooks/useURLParams';
import { usePostMessage } from '@/hooks/usePostMessage';
import { useHealthState } from '@/hooks/useHealthState';
import { useWorldStore, scoreToT } from '@/store/worldStore';

import { initEngine, updateLighting, getSunDirection } from '@/babylon/engine';
import { buildTerrain,    updateTerrainColor }  from '@/babylon/terrain';
import { buildSky,        updateSky }           from '@/babylon/sky';
import { buildWater,      updateWater }         from '@/babylon/water';
import { buildGrassField, updateGrass }         from '@/babylon/grass';
import { buildAtmosphere, updateAtmosphere, setTargetSeedStage } from '@/babylon/atmosphere';
import {
    buildForest, buildSchoolSilhouette, updateTreeHealth, enableForestShadows,
} from '@/babylon/trees';
import {
    buildCharacter, animateCharacter, moveCharacter, updateCamera,
    getCamYaw, enableCharacterShadows, registerCollisionBox, joystickState,
    setCamRadius, getCamRadius,
} from '@/babylon/character';
import { buildAnimals,    updateAnimals }        from '@/babylon/animals';
import { buildPostProcessing, updatePostProcessing } from '@/babylon/postprocess';

import { LoadingScreen } from '@/components/LoadingScreen';
import { Toast }         from '@/components/Toast';
import { TopBar }        from '@/components/TopBar';
import { Joystick }      from '@/components/Joystick';
import { CamReset }      from '@/components/CamReset';
import { EcoDrawer }     from '@/components/EcoDrawer';

import type { EngineRef }     from '@/babylon/engine';
import type { TerrainRef }    from '@/babylon/terrain';
import type { SkyRef }        from '@/babylon/sky';
import type { WaterRef }      from '@/babylon/water';
import type { GrassRef }      from '@/babylon/grass';
import type { AtmosphereRef } from '@/babylon/atmosphere';
import type { ForestRef }     from '@/babylon/trees';
import type { CharacterRef }  from '@/babylon/character';
import type { PPRef }         from '@/babylon/postprocess';
import type { ArcRotateCamera } from '@babylonjs/core';

export default function App() {
    const params   = useURLParams();
    const postToRN = usePostMessage();
    useHealthState();

    const canvasRef     = useRef<HTMLCanvasElement>(null);
    const engineRef     = useRef<EngineRef | null>(null);
    const terrainRef    = useRef<TerrainRef | null>(null);
    const skyRef        = useRef<SkyRef | null>(null);
    const waterRef      = useRef<WaterRef | null>(null);
    const grassRef      = useRef<GrassRef | null>(null);
    const atmosphereRef = useRef<AtmosphereRef | null>(null);
    const forestRef     = useRef<ForestRef | null>(null);
    const charRef       = useRef<CharacterRef | null>(null);
    const ppRef         = useRef<PPRef | null>(null);
    const worldTimeRef  = useRef<number>(0);

    const [loadProgress, setProgress] = useState(0);
    const [loadMsg, setLoadMsg]       = useState('Preparing world…');
    const { setWorldReady, worldReady } = useWorldStore();

    // Sync initial scores from URL params
    useEffect(() => {
        const store = useWorldStore.getState();
        store.setScores({
            overall: params.overall,
            bio:     params.bio,
            air:     params.air,
            water:   params.water,
            carbon:  params.carbon,
        }, params.zoneName);
        const snapT = scoreToT(params.overall);
        useWorldStore.setState({ healthT: snapT, targetT: snapT });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Online/offline tracking
    useEffect(() => {
        const goOnline  = () => useWorldStore.getState().setOffline(false);
        const goOffline = () => useWorldStore.getState().setOffline(true);
        window.addEventListener('online',  goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online',  goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    // Seed stage sync
    useEffect(() => {
        const unsub = useWorldStore.subscribe((state) => {
            setTargetSeedStage(state.seedStage);
        });
        return unsub;
    }, []);

    // ── MAIN BABYLON INIT ────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ref = initEngine(canvas);
        engineRef.current = ref;
        const { engine, scene } = ref;

        // Listener cleanup refs (populated inside executeWhenReady)
        let _cleanupKeys:  (() => void) | null = null;
        let _cleanupWheel: (() => void) | null = null;
        let _fakeProgressTimer: ReturnType<typeof setInterval> | null = null;

        scene.executeWhenReady(async () => {

            // ── BUILD WORLD (sequential, with progress) ───────────────────

            setProgress(8);  setLoadMsg('Growing terrain…');
            terrainRef.current = buildTerrain(scene);

            setProgress(18); setLoadMsg('Painting sky…');
            skyRef.current = buildSky(scene);

            setProgress(28); setLoadMsg('Filling river…');
            waterRef.current = buildWater(scene);

            setProgress(40); setLoadMsg('Planting grass…');
            grassRef.current = buildGrassField(scene, params.quality);

            setProgress(54); setLoadMsg('Growing forest…');
            forestRef.current = buildForest(scene);
            buildSchoolSilhouette(scene, forestRef.current);

            // Collision boxes — school + major tree clusters
            registerCollisionBox(0,    -48,  15, 5);
            registerCollisionBox(-11,  -48,   4, 5);
            registerCollisionBox( 11,  -48,   4, 5);
            registerCollisionBox(-15,  -48, 0.5, 14);
            registerCollisionBox( 15,  -48, 0.5, 14);
            registerCollisionBox(-8.5, -36,  5.5, 0.5);
            registerCollisionBox( 8.5, -36,  5.5, 0.5);
            registerCollisionBox(-30,  -10,   6, 6);
            registerCollisionBox( 25,  -15,   5, 5);
            registerCollisionBox(-20,   10,   4, 4);
            registerCollisionBox( 18,   10,   4, 4);
            registerCollisionBox(  5,  -25,   3, 3);

            if (forestRef.current) enableForestShadows(forestRef.current, ref.shadows);

            setProgress(66); setLoadMsg('Adding wildlife…');
            buildAnimals(scene);

            setProgress(76); setLoadMsg('Setting atmosphere…');
            atmosphereRef.current = buildAtmosphere(scene, forestRef.current!.banyanNode);

            setProgress(86); setLoadMsg('Summoning student…');
            charRef.current = buildCharacter(scene);
            if (charRef.current) enableCharacterShadows(charRef.current, ref.shadows);

            setProgress(96); setLoadMsg('Almost ready…');

            // ── KEYBOARD WASD ─────────────────────────────────────────────
            const _keys = new Set<string>();
            const _onKD = (e: KeyboardEvent) => {
                const k = e.key.toLowerCase();
                _keys.add(k);
                if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) {
                    e.preventDefault();
                }
            };
            const _onKU = (e: KeyboardEvent) => _keys.delete(e.key.toLowerCase());
            window.addEventListener('keydown', _onKD);
            window.addEventListener('keyup',   _onKU);
            _cleanupKeys = () => {
                window.removeEventListener('keydown', _onKD);
                window.removeEventListener('keyup',   _onKU);
                window.removeEventListener('blur',    _onBlur);
            };
            const _onBlur = () => {
                _keys.clear();
                joystickState.x         = 0;
                joystickState.z         = 0;
                joystickState.magnitude = 0;
            };
            window.addEventListener('blur', _onBlur);

            // ── MOUSE WHEEL ZOOM ──────────────────────────────────────────
            const _onWheel = (e: WheelEvent) => {
                setCamRadius(getCamRadius() + e.deltaY * 0.025);
            };
            canvas.addEventListener('wheel', _onWheel, { passive: true });
            _cleanupWheel = () => canvas.removeEventListener('wheel', _onWheel);

            // ── PER-FRAME UPDATE ──────────────────────────────────────────
            scene.registerBeforeRender(() => {
                const s  = useWorldStore.getState();
                const dt = engine.getDeltaTime();
                worldTimeRef.current += dt * 0.001;
                const t = worldTimeRef.current;

                if (!joystickState.touchActive) {
                    const kx = (_keys.has('a') || _keys.has('arrowleft')  ? -0.8 : 0)
                             + (_keys.has('d') || _keys.has('arrowright') ?  0.8 : 0);
                    const kz = (_keys.has('w') || _keys.has('arrowup')    ? -0.8 : 0)
                             + (_keys.has('s') || _keys.has('arrowdown')  ?  0.8 : 0);
                    joystickState.x         = kx;
                    joystickState.z         = kz;
                    joystickState.magnitude = Math.min(1, Math.sqrt(kx * kx + kz * kz));
                }

                if (engineRef.current) updateLighting(engineRef.current, s.healthT, t);

                const sunDir = engineRef.current
                    ? getSunDirection(engineRef.current)
                    : new Vector3(0.6, 0.8, 0.3).normalize();
                const sunColor     = engineRef.current?.sun.diffuse   ?? new Color3(1, 0.85, 0.52);
                const sunIntensity = engineRef.current?.sun.intensity ?? 1.4;
                const charPos      = charRef.current?.root.position   ?? Vector3.Zero();

                if (skyRef.current)        updateSky(skyRef.current, s.healthT, scene, sunDir);
                if (terrainRef.current)    updateTerrainColor(terrainRef.current, s.healthT);
                if (waterRef.current)      updateWater(waterRef.current, s.healthT, t);
                if (grassRef.current)      updateGrass(grassRef.current, s.healthT, t, charPos, s.scores.air, sunDir, sunColor, sunIntensity, scene);
                if (forestRef.current)     updateTreeHealth(forestRef.current, s.healthT);
                if (atmosphereRef.current) updateAtmosphere(atmosphereRef.current, s.healthT, t);
                if (ppRef.current)         updatePostProcessing(ppRef.current, s.healthT);

                updateAnimals(s.healthT, t, s.scores);

                if (charRef.current) {
                    moveCharacter(charRef.current, getCamYaw(), dt);
                    animateCharacter(charRef.current, dt);
                    const cam = scene.activeCamera as ArcRotateCamera;
                    if (cam) updateCamera(charRef.current, cam);
                }
            });

            // ── START RENDER LOOP ─────────────────────────────────────────
            // Called AFTER registerBeforeRender so the first rendered frame
            // already has all update logic attached.
            engine.runRenderLoop(() => scene.render());

            // ── DEFERRED WORLD READY ──────────────────────────────────────
            // Wait 800ms after the render loop starts before hiding the loading
            // screen. This gives Babylon time to render several complete frames
            // (terrain, sky, grass all visible) so there is no flash of a
            // partially-built scene when the loading overlay fades out.
            //
            // FIX: progress used to sit frozen at 96% for this entire 800ms
            // (everything before this point runs near-instantly, then nothing
            // ticks until the timeout fires) — it looked stuck/hung. Now we
            // nudge it up a notch every 150ms so it keeps visibly moving
            // right up until the world is actually ready.
            let fakeProgress = 96;
            _fakeProgressTimer = setInterval(() => {
                fakeProgress = Math.min(99, fakeProgress + 1);
                setProgress(fakeProgress);
            }, 150);

            setTimeout(() => {
                if (_fakeProgressTimer) clearInterval(_fakeProgressTimer);
                setProgress(100);
                setWorldReady(true);
                // Tell React Native the world is ready. Extra 200ms so the
                // WebView JS bridge is fully settled before RN injects ZONE_UPDATE.
                setTimeout(() => {
                    postToRN({ type: 'WORLD_LOADED', payload: { success: true } });
                }, 200);
            }, 800);

            // ── DEFERRED POST-PROCESSING ──────────────────────────────────
            // Must happen AFTER runRenderLoop. 500ms lets the GPU stabilise
            // framebuffers before the pipeline adds its own passes.
            const ppCamera = scene.activeCamera as ArcRotateCamera;
            if (ppCamera) {
                setTimeout(() => {
                    try {
                        ppRef.current = buildPostProcessing(scene, ppCamera);
                    } catch (err) {
                        console.warn('[EcoWorld] Post-process init failed, continuing without it:', err);
                    }
                }, 500);
            }
        });

        // ── CLEANUP ON UNMOUNT ────────────────────────────────────────────
        return () => {
            _cleanupKeys?.();
            _cleanupWheel?.();
            if (_fakeProgressTimer) clearInterval(_fakeProgressTimer);
            const eng = ref.engine as typeof engine & { _resizeHandler?: () => void };
            if (eng._resizeHandler) window.removeEventListener('resize', eng._resizeHandler);
            engine.dispose();
            engineRef.current     = null;
            terrainRef.current    = null;
            skyRef.current        = null;
            waterRef.current      = null;
            grassRef.current      = null;
            forestRef.current     = null;
            atmosphereRef.current = null;
            charRef.current       = null;
            ppRef.current         = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="fixed inset-0 bg-eco-dark overflow-hidden">
            <canvas
                id="renderCanvas"
                ref={canvasRef}
                className="fixed inset-0 w-full h-full z-0 touch-none"
            />
            <TopBar postToRN={postToRN} />
            <Joystick />
            <CamReset />
            <EcoDrawer postToRN={postToRN} />
            <Toast />
            <AnimatePresence>
                {!worldReady && (
                    <LoadingScreen
                        visible={!worldReady}
                        progress={loadProgress}
                        message={loadMsg}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}