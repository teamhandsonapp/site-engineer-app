// Site Groups chat theming.
//
// The app is locked to LIGHT mode (app.json userInterfaceStyle), so the
// chat is always light by default. It used to follow useColorScheme(),
// which on the web dev build reports the computer's dark mode — that is why
// a screenshot from the browser showed the dark palette (every bubble dark
// navy). The dark and the alternative blue-outgoing palettes are only used
// when a screen asks for them explicitly through <ChatSchemeProvider>
// (today: the dev preview route, for side-by-side screenshots).
//
// Styles are built ONCE per scheme at module load (themedStyles), so
// components pick a prebuilt sheet instead of creating style objects on
// every render.

import { createContext, createElement, useContext, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { chatPalettes, type ChatPalette, type ChatSchemeKey } from '../theme';

export type ChatScheme = ChatSchemeKey;
export const CHAT_SCHEMES: ChatScheme[] = ['light', 'lightBlue', 'dark'];

const SchemeContext = createContext<ChatScheme>('light');

export function ChatSchemeProvider({ scheme, children }: { scheme: ChatScheme; children: ReactNode }) {
  return createElement(SchemeContext.Provider, { value: scheme }, children);
}

export function useChatScheme(): ChatScheme {
  return useContext(SchemeContext);
}

export function useChatPalette(): ChatPalette {
  return chatPalettes[useChatScheme()];
}

export function isDarkScheme(scheme: ChatScheme): boolean {
  return scheme === 'dark';
}

export function themedStyles<T extends StyleSheet.NamedStyles<T>>(make: (p: ChatPalette, scheme: ChatScheme) => T): (scheme: ChatScheme) => T {
  const sheets = Object.fromEntries(CHAT_SCHEMES.map((k) => [k, StyleSheet.create(make(chatPalettes[k], k))])) as Record<ChatScheme, T>;
  return (scheme) => sheets[scheme];
}

// Same sender → same palette slot in every scheme.
export function senderSlot(key: string | null): number {
  const s = key ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % chatPalettes.light.senderPalette.length;
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
