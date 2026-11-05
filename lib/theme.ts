// Design system — the ONE place colours, type, spacing, radius and shadows
// are defined. tailwind.config.js imports the same values, so `className`
// (NativeWind) and `style={{}}` always agree. New/updated screens should use
// these tokens (or the matching Tailwind classes) instead of raw hex values.
//
// Brand: navy #0F1F33 + amber #F0A227, IBM Plex Sans / Mono.

export const colors = {
  // Brand
  navy: '#0F1F33',
  navyLight: '#1C3358',
  navySoft: '#EEF2F7',
  amber: '#F0A227',
  amberLight: '#FBC26B',
  amberSoft: '#FEF5E4',
  amberDeep: '#412402',

  // Surfaces
  bg: '#F6F7F9', // screen background
  surface: '#FFFFFF', // cards, sheets
  surfaceMuted: '#F1F3F6', // inputs, segmented controls, chips

  // Text — every pair here is >= 4.5:1 on `surface` and `bg` (WCAG AA)
  text: '#111827', // titles, primary text (17:1)
  textSecondary: '#374151', // body copy, field labels (10:1)
  textMuted: '#5B6472', // captions, metadata (6:1) — replaces the old #9CA3AF (2.5:1)
  textInverse: '#FFFFFF',
  placeholder: '#6B7280', // input placeholders (4.8:1)

  // Lines
  border: '#E3E6EB',
  borderStrong: '#CDD2D9',
  divider: '#EDEFF2',

  // Status
  success: '#15803D',
  successSoft: '#E8F5EC',
  warning: '#B45309',
  warningSoft: '#FEF3E2',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  info: '#1D4ED8',
  infoSoft: '#EAF0FD',
} as const;

// Type scale — nothing user-facing below 12px.
export const type = {
  title: { fontSize: 20, lineHeight: 26, fontFamily: 'IBMPlexSans_700Bold' },
  section: { fontSize: 16, lineHeight: 22, fontFamily: 'IBMPlexSans_600SemiBold' },
  body: { fontSize: 14, lineHeight: 20, fontFamily: 'IBMPlexSans_400Regular' },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontFamily: 'IBMPlexSans_600SemiBold' },
  label: { fontSize: 13, lineHeight: 18, fontFamily: 'IBMPlexSans_500Medium' },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: 'IBMPlexSans_400Regular' },
  overline: { fontSize: 12, lineHeight: 16, fontFamily: 'IBMPlexSans_600SemiBold', letterSpacing: 0.6, textTransform: 'uppercase' as const },
  stat: { fontSize: 24, lineHeight: 30, fontFamily: 'IBMPlexSans_700Bold' },
  mono: { fontSize: 13, lineHeight: 18, fontFamily: 'IBMPlexMono_400Regular' },
} as const;

// 4-pt spacing scale.
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

// Minimum touch target (WCAG / platform guidelines).
export const HIT = 44;

export const shadow = {
  card: {
    shadowColor: '#0F1F33',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  raised: {
    shadowColor: '#0F1F33',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// Site Groups: sender-name colours (picked by a stable hash of the sender's
// WhatsApp id) and bubble tints. Brand navy/amber family — deliberately no
// WhatsApp green. All sender colours are >= 4.5:1 on white.
export const chat = {
  senderPalette: ['#1D4ED8', '#B45309', '#7C3AED', '#0F766E', '#BE185D', '#4D7C0F', '#C2410C', '#1C3358'],
  incomingBg: '#FFFFFF',
  outgoingBg: '#FEF5E4', // amberSoft
  outgoingBorder: '#F6D9A6',
  readTick: '#B45309',
} as const;

export const theme = { colors, type, space, radius, shadow, HIT, chat };
export type Theme = typeof theme;
