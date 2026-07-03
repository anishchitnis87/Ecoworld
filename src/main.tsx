import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// React StrictMode is intentionally NOT used here.
// In development it double-invokes useEffect: mount → cleanup (dispose engine)
// → mount again. The engine.dispose() between the two mounts blacks out the
// canvas for one or more frames, adding to the black-box problem.
// StrictMode's benefits (detecting side-effects) don't apply to a WebGL canvas
// app where the entire point is controlled side effects in the render loop.
const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(<App />)

// ── Service Worker ──────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then((reg) => console.log('[EcoWorld] SW registered:', reg.scope))
            .catch((err) => console.warn('[EcoWorld] SW registration failed:', err))
    })
}
