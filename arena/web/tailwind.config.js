/** Baccarat Gladiator social layer — "juicy UI" design tokens.
 *  Dark abyss base + neon accents; chunky shadows; glow utilities. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss:   { 900: '#0a0618', 800: '#120b2e', 700: '#1a1145', 600: '#241857' },
        neon:    { pink: '#ff2e88', blue: '#2ee6ff', gold: '#ffd24a', green: '#3dff8f', violet: '#a855f7' },
        // Semantic outcome tokens — CSS-var backed so zh locales can flip
        // red↔green (palettes in social.css, stamped by i18n/LocaleContext).
        win:     'rgb(var(--c-win) / <alpha-value>)',
        loss:    'rgb(var(--c-loss) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'], // matches the game's table typography
      },
      boxShadow: {
        // chunky/tactile: hard drop + soft ambient + inset top-light
        chunky:      '0 4px 0 rgba(0,0,0,0.55), 0 10px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
        'chunky-sm': '0 3px 0 rgba(0,0,0,0.5), 0 6px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
        'glow-gold': '0 0 18px rgba(255,210,74,0.55), 0 0 42px rgba(255,210,74,0.22)',
        'glow-pink': '0 0 18px rgba(255,46,136,0.55), 0 0 42px rgba(255,46,136,0.22)',
        'glow-blue': '0 0 18px rgba(46,230,255,0.5), 0 0 42px rgba(46,230,255,0.2)',
        'glow-win':  '0 0 18px rgb(var(--c-win) / 0.55), 0 0 42px rgb(var(--c-win) / 0.22)',
        'glow-loss': '0 0 18px rgb(var(--c-loss) / 0.5), 0 0 42px rgb(var(--c-loss) / 0.2)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(255,210,74,0.35)' },
          '50%':      { boxShadow: '0 0 26px rgba(255,210,74,0.75)' },
        },
        'live-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.4', transform: 'scale(0.8)' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.8s ease-in-out infinite',
        'live-dot':   'live-dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
