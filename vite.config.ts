import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
        // FIX: this project has stale compiled .js files sitting next to almost
        // every .tsx source (App.js/App.tsx, Joystick.js/Joystick.tsx, etc).
        // Every import omits the extension (e.g. `from '@/components/Joystick'`),
        // and Vite's DEFAULT resolution order is
        //   ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
        // — .js comes before .tsx, so Vite was silently bundling the stale .js
        // twins instead of the .tsx files actually being edited. This explicit
        // order puts .tsx/.ts/.jsx first so the real source always wins.
        extensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.mts', '.json'],
    },
    optimizeDeps: {
        exclude: ['@babylonjs/core', '@babylonjs/loaders', '@babylonjs/materials']
    },
    build: {
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('@babylonjs')) {
                        return 'babylon'
                    }
                }
            }
        }
    }
})