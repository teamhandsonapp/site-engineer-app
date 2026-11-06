// Site Groups chat theming. The app is locked to light mode today
// (app.json userInterfaceStyle), so on phones this always resolves to
// 'light'; the dark palette is complete and shows wherever the platform
// reports dark (e.g. the web dev build with a dark browser), ready for when
// the app follows the phone theme.
//
// Styles are built ONCE per scheme at module load (themedStyles), so
// components pick a prebuilt sheet instead of creating style objects on
// every render.

import { StyleSheet, useColorScheme } from 'react-native';
import { chatPalettes, type ChatPalette } from '../theme';

export type ChatScheme = 'light' | 'dark';

export function useChatScheme(): ChatScheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useChatPalette(): ChatPalette {
  return chatPalettes[useChatScheme()];
}

export function themedStyles<T extends StyleSheet.NamedStyles<T>>(make: (p: ChatPalette, scheme: ChatScheme) => T): (scheme: ChatScheme) => T {
  const sheets = {
    light: StyleSheet.create(make(chatPalettes.light, 'light')),
    dark: StyleSheet.create(make(chatPalettes.dark, 'dark')),
  };
  return (scheme) => sheets[scheme];
}

// Same sender → same palette slot in both modes.
export function senderSlot(key: string | null): number {
  const s = key ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % chatPalettes.light.senderPalette.length;
}
