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

// Site Groups chat palettes (docs/site-groups-chat-design.md §3).
// WhatsApp's layout and proportions in OUR colours: warm grey-beige
// wallpaper, white incoming bubbles, a pale brand tint for outgoing, navy
// header and send button, amber accents (read ticks, badges, unread time).
// No WhatsApp greens. The app is locked to light mode, so `light` is the
// design users see; `lightBlue` is the alternative outgoing tint (shown
// side by side for the choice); `dark` is complete for later.
// Same keys in every palette — read them through useChatPalette()
// (lib/groupChats/chatTheme.ts), never directly by mode.
const chatLight = {
  bg: '#ECE6DD', // warm grey-beige (our own, not WhatsApp's exact value)
  incomingBg: '#FFFFFF',
  outgoingBg: '#FCEBCB', // pale amber-cream
  text: '#111B21',
  meta: '#667781',
  tickRead: '#E08A00', // our accent, a touch deeper so small ticks stay visible
  failed: '#D93025',
  link: '#1D63C9',
  bubbleShadow: '0px 1px 0.5px rgba(11, 20, 26, 0.13)',
  dateChipBg: '#FFFFFF',
  dateChipText: '#54656F',
  unreadBg: 'rgba(255, 255, 255, 0.72)',
  unreadText: '#54656F',
  inputBg: '#FFFFFF',
  inputText: '#111B21',
  placeholder: '#8696A0',
  sendBg: '#0F1F33', // our primary
  sendBgDisabled: '#B9C2CB',
  sendIcon: '#FFFFFF',
  badgeBg: '#F0A227',
  badgeText: '#0F1F33',
  fabBg: '#FFFFFF',
  fabIcon: '#54656F',
  readOnlyBg: 'rgba(255, 255, 255, 0.85)',
  readOnlyText: '#54656F',
  highlight: 'rgba(240, 162, 39, 0.16)',
  surface: '#FFFFFF',
  surfacePressed: '#F2F4F5',
  separator: '#E9EDEF',
  title: '#111B21',
  muted: '#667781',
  searchBg: '#F0F2F5',
  draft: '#C97A00',
  avatarAlpha: 0.16,
  senderPalette: ['#1D4ED8', '#B45309', '#7C3AED', '#0F766E', '#BE185D', '#4D7C0F', '#C2410C', '#1C3358'],
};

const chatLightBlue: typeof chatLight = {
  ...chatLight,
  outgoingBg: '#DDE8F6', // pale navy-blue tint
};

const chatDark: typeof chatLight = {
  bg: '#121619', // dark charcoal
  incomingBg: '#232A30', // dark grey
  outgoingBg: '#1D3557', // deep navy
  text: '#E9EDEF',
  meta: '#98A4AE',
  tickRead: '#F2B347',
  failed: '#F28B82',
  link: '#8AB4FF',
  bubbleShadow: '0px 1px 0.5px rgba(0, 0, 0, 0.3)',
  dateChipBg: '#1E252B',
  dateChipText: '#AEBAC1',
  unreadBg: 'rgba(255, 255, 255, 0.06)',
  unreadText: '#AEBAC1',
  inputBg: '#232A30',
  inputText: '#E9EDEF',
  placeholder: '#8696A0',
  sendBg: '#2C5288', // navy, lifted so it reads on charcoal
  sendBgDisabled: '#3A444C',
  sendIcon: '#FFFFFF',
  badgeBg: '#F0A227',
  badgeText: '#0F1F33',
  fabBg: '#232A30',
  fabIcon: '#AEBAC1',
  readOnlyBg: 'rgba(35, 42, 48, 0.9)',
  readOnlyText: '#AEBAC1',
  highlight: 'rgba(240, 162, 39, 0.14)',
  surface: '#111B21',
  surfacePressed: '#1E2A31',
  separator: '#222D34',
  title: '#E9EDEF',
  muted: '#8696A0',
  searchBg: '#1E252B',
  draft: '#F2B347',
  avatarAlpha: 0.24,
  senderPalette: ['#8AB4FF', '#F2B347', '#C4A5FF', '#5EEAD4', '#F9A8D4', '#A3E635', '#FDBA74', '#B4C3F5'],
};

export type ChatPalette = typeof chatLight;
export type ChatSchemeKey = 'light' | 'lightBlue' | 'dark';
export const chatPalettes: Record<ChatSchemeKey, ChatPalette> = { light: chatLight, lightBlue: chatLightBlue, dark: chatDark };

export const theme = { colors, type, space, radius, shadow, HIT, chat, chatPalettes };
export type Theme = typeof theme;
