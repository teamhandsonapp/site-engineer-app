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

// Site Groups chat palettes (docs/site-groups-chat-design.md §3). Light is
// what the app shows today (it is locked to light mode); dark is complete
// and used wherever the platform reports a dark colour scheme. Every text
// pair is >= 4.5:1, icons >= 3:1. Same keys in both — read them through
// useChatPalette() (lib/groupChats/chatTheme.ts), never directly by mode.
const chatLight = {
  bg: '#EDF0F4',
  incomingBg: '#FFFFFF',
  incomingBorder: '#E1E5EB',
  outgoingBg: '#E3EBF5',
  outgoingBorder: '#D3DEEC',
  textIn: '#111827',
  textOut: '#0F1F33',
  metaIn: '#5B6472',
  metaOut: '#4B5768',
  tickRead: '#B45309',
  failed: '#B91C1C',
  linkIn: '#1D4ED8',
  linkOut: '#1D4ED8',
  dateChipBg: '#FFFFFF',
  dateChipText: '#374151',
  unreadBg: '#FEF5E4',
  unreadText: '#B45309',
  composerBar: '#FFFFFF',
  composerBorder: '#E3E6EB',
  inputBg: '#F1F3F6',
  inputText: '#111827',
  placeholder: '#6B7280',
  sendBg: '#F0A227',
  sendIcon: '#0F1F33',
  badgeBg: '#F0A227',
  badgeText: '#0F1F33',
  fabBg: '#FFFFFF',
  fabIcon: '#0F1F33',
  surface: '#FFFFFF',
  surfacePressed: '#F1F3F6',
  separator: '#EDEFF2',
  title: '#111827',
  muted: '#5B6472',
  highlight: '#FDE7B8',
  avatarAlpha: 0.14,
  senderPalette: ['#1D4ED8', '#B45309', '#7C3AED', '#0F766E', '#BE185D', '#4D7C0F', '#C2410C', '#1C3358'],
};

const chatDark: typeof chatLight = {
  bg: '#0B111B',
  incomingBg: '#172131',
  incomingBorder: '#202C3F',
  outgoingBg: '#1F3A63',
  outgoingBorder: '#284673',
  textIn: '#E7ECF3',
  textOut: '#F3F6FA',
  metaIn: '#9AA6B8',
  metaOut: '#B4C0D3',
  tickRead: '#F2B347',
  failed: '#FCA5A5',
  linkIn: '#8AB4FF',
  linkOut: '#A9C7FF',
  dateChipBg: '#1A2433',
  dateChipText: '#C9D2DE',
  unreadBg: '#2B2213',
  unreadText: '#F2B347',
  composerBar: '#111A27',
  composerBorder: '#1E2A3B',
  inputBg: '#1A2433',
  inputText: '#E7ECF3',
  placeholder: '#8592A6',
  sendBg: '#F0A227',
  sendIcon: '#0F1F33',
  badgeBg: '#F0A227',
  badgeText: '#0F1F33',
  fabBg: '#1A2433',
  fabIcon: '#E7ECF3',
  surface: '#111A27',
  surfacePressed: '#1A2433',
  separator: '#1E2A3B',
  title: '#E7ECF3',
  muted: '#9AA6B8',
  highlight: '#5A4317',
  avatarAlpha: 0.22,
  senderPalette: ['#8AB4FF', '#F2B347', '#C4A5FF', '#5EEAD4', '#F9A8D4', '#A3E635', '#FDBA74', '#B4C3F5'],
};

export type ChatPalette = typeof chatLight;
export const chatPalettes: Record<'light' | 'dark', ChatPalette> = { light: chatLight, dark: chatDark };

export const theme = { colors, type, space, radius, shadow, HIT, chat, chatPalettes };
export type Theme = typeof theme;
