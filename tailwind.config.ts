import type { Config } from 'tailwindcss'

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                syne: ['Syne', 'sans-serif'],
                dm: ['DM Sans', 'sans-serif'],
            },
            colors: {
                eco: {
                    green: '#22c55e',
                    teal: '#06b6d4',
                    lime: '#84cc16',
                    amber: '#f59e0b',
                    red: '#ef4444',
                    purple: '#a78bfa',
                    orange: '#f97316',
                    dark: '#050e05',
                }
            },
            boxShadow: {
                'eco-glow': '0 0 24px rgba(34,197,94,0.35)',
                'teal-glow': '0 0 24px rgba(6,182,212,0.35)',
                'amber-glow': '0 0 24px rgba(245,158,11,0.35)',
            },
            backdropBlur: {
                xs: '2px',
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
                'float': 'float 6s ease-in-out infinite',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
            },
            keyframes: {
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-8px)' },
                },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 20px rgba(34,197,94,0.4)' },
                    '50%': { boxShadow: '0 0 40px rgba(34,197,94,0.8)' },
                }
            }
        }
    },
    plugins: []
} satisfies Config