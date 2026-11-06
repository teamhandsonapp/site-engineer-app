import type { ColorValue } from 'react-native';
import { router, useNavigation, usePathname, type Href } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';

// Header back arrow for every screen of the root stack (set once in
// app/_layout.tsx). Same look as the default arrow; only the tap is safer:
//
// 1. Two taps landing in the same frame (easy on a busy screen such as the
//    flowchart canvas right after linking tasks) each ran goBack(); the
//    second came from a screen that was already gone, so nothing handled
//    it and the dev build showed "The action 'GO_BACK' was not handled by
//    any navigator". Taps on a screen that is no longer focused, and taps
//    within 500 ms of the last one, are now ignored.
// 2. With nothing behind the screen (web page reloaded, or opened from a
//    link) the default arrow was hidden and you were stuck. The arrow now
//    always shows and falls back to the list the screen belongs to, or Home.

let lastBackAt = 0;

// Detail screens that sit under a list screen of their own.
const LIST_PARENTS = new Set(['flowchart-templates', 'checklist-templates', 'reports', 'drawings', 'site-groups']);

function fallbackFor(pathname: string): Href {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 1 && LIST_PARENTS.has(parts[0])) return `/${parts[0]}` as Href;
  return '/home';
}

export function SafeHeaderBack({ tintColor }: { tintColor?: ColorValue }) {
  const navigation = useNavigation();
  const pathname = usePathname();
  return (
    <HeaderBackButton
      tintColor={tintColor}
      onPress={() => {
        const now = Date.now();
        if (now - lastBackAt < 500 || !navigation.isFocused()) return;
        lastBackAt = now;
        if (navigation.canGoBack()) navigation.goBack();
        else router.replace(fallbackFor(pathname));
      }}
    />
  );
}
