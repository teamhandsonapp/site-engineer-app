/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#0F1F33',
          'navy-light': '#1C3358',
          amber: '#F0A227',
          'amber-light': '#FBC26B',
          'amber-deep': '#412402',
        },
        // One shared status vocabulary for "how long has this been pending"
        // — used identically on both home screens' alert cards so urgency
        // reads the same regardless of which persona is looking at it.
        // Distinct from brand.amber (that's the identity/primary-action
        // color; this is a separate semantic channel per the design brief).
        status: {
          calm: '#1C3358', // just became pending — same navy-light as everywhere else, not alarming
          calmBg: '#EEF2F7',
          warn: '#B45309', // getting stale — amber family, but a distinct shade from the brand accent
          warnBg: '#FEF3E2',
          urgent: '#DC2626', // overdue — the one true "needs attention now" red in this app
          urgentBg: '#FDECEC',
        },
      },
      // This app had no formal type scale before this pass — every screen
      // used its own arbitrary text-[13.5px]-style bracket values. This
      // replaces Tailwind's default sizes (tuned for web) with a scale
      // built for this app's actual density, keeping the familiar
      // text-xs/sm/base/... names so it reads as "the standard scale," not
      // a one-off. Every screen in this pass uses only these tokens.
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }], // timestamps, tertiary metadata
        xs: ['11px', { lineHeight: '15px' }], // captions, field labels, badges
        sm: ['12px', { lineHeight: '17px' }], // secondary body text
        base: ['14px', { lineHeight: '20px' }], // primary body text
        md: ['16px', { lineHeight: '22px' }], // card titles, emphasized body
        lg: ['18px', { lineHeight: '24px' }], // section headers
        xl: ['20px', { lineHeight: '27px' }], // screen titles
        '2xl': ['26px', { lineHeight: '32px' }], // hero stat (e.g. progress %)
      },
    },
  },
  plugins: [],
};
