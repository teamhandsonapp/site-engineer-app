import '../global.css';

import { useEffect, type ReactNode } from 'react';
import { enableFreeze } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// Each weight imported from its own path: importing the package index
// bundled all 28 IBM Plex files (~5 MB) even though only these 5 are used.
import { useFonts } from 'expo-font';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import { ProjectProvider } from '../lib/ProjectContext';
import { useNavigationLogging } from '../lib/navigationLogging';
import { useNotificationTapRouting } from '../lib/notificationRouting';
import { initSentry } from '../lib/sentryInit';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { RestoreErrorScreen } from '../components/RestoreErrorScreen';
import { BrandSplash } from '../components/BrandSplash';
import { SafeHeaderBack } from '../components/SafeHeaderBack';
import { colors } from '../lib/theme';
import { ToastProvider } from '../components/ui/Toast';

// Runs once at module load — this file is the app's true entry point, so
// there's no earlier point to call this from. See sentryInit.ts's own
// header for why Session Replay is deliberately never enabled here.
initSentry();

// Held until IBM Plex is ready (see RootLayout's useFonts call below) —
// without this, the native splash hides itself automatically as soon as
// the JS bundle evaluates, which is BEFORE the async font load resolves,
// so the opening/login screens would render one frame in the OS default
// font and visibly swap to IBM Plex a moment later.
SplashScreen.preventAutoHideAsync();

// The drawer keeps every visited screen mounted (expo-router/React
// Navigation's own default), and until now nothing ever called this, so
// "inactive" never actually meant "paused" — every effect, timer, poll,
// and subscription on an off-screen drawer screen kept running at full
// speed in the background for the rest of the session. This is the
// documented, official fix (react-native-screens' own freeze-on-blur
// support): an inactive screen's React tree is suspended via Activity/
// Offscreen once its exit transition finishes, and resumes exactly where
// it left off the moment it's focused again. Must be called once at true
// app startup, before any navigator mounts — this file is that point.
enableFreeze(true);

// Isolated from RootLayout specifically so its usePathname() subscription
// doesn't force the WHOLE app tree to re-render on every navigation —
// confirmed live: with this hook called directly inside RootLayout, every
// drawer switch re-rendered AuthProvider/ProjectProvider (both rebuild
// their context value object fresh on every render, with no memoization)
// and every still-mounted-but-inactive drawer screen underneath them (the
// drawer keeps every visited screen mounted) — real, repeated JS work on
// every single tab switch, not just the destination screen. A sibling that
// renders null re-renders on its own on every pathname change, but has no
// children to cascade into. enableFreeze() above should make this specific
// cascade far cheaper even if it still fires, since a frozen screen's own
// subtree won't actually re-render while suspended — but this isolation
// stays regardless, since NavigationLogger's own re-render is unrelated to
// freeze state.
// Notification taps — inside AuthProvider so it knows when the user is signed
// in, and waits for the root navigator to be ready before navigating.
function NotificationTapRouter() {
  const { state } = useAuth();
  const navReady = !!useRootNavigationState()?.key;
  useNotificationTapRouting(navReady && state.status === 'signed-in');
  return null;
}

function NavigationLogger() {
  useNavigationLogging();
  return null;
}

function RootLayout() {

  // Called unconditionally (Rules of Hooks) — the early `return null` below
  // happens AFTER every hook in this component has run, not before.
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_400Regular,
  });

  // A real font-load error still hides the splash and falls through to the
  // OS default font rather than leaving the app stuck on the splash screen
  // forever.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Providers (and so session restore in AuthProvider) start right away, in
  // parallel with font loading — only the visible UI waits for the fonts
  // (the native splash stays up until then), so cold start is no longer
  // fonts-then-session one after the other.
  const fontsReady = fontsLoaded || !!fontError;

  return (
    <ErrorBoundary>
      {/* overflow: 'hidden' alongside flex: 1 — web-only fix. A flex item's
          automatic minimum size defaults to its CONTENT size, not its
          flex-computed size, so on a tall screen (e.g. the drawer menu after
          Projects/Reports were added) this root container was growing past
          the 100vh the html/body/#root chain actually has instead of
          clipping to it — which is what let DrawerContent's "Log Out"
          footer, pinned to the bottom of ITS OWN flex-1 box, end up pinned
          to the bottom of an oversized box far below the visible viewport.
          overflow: hidden resets the automatic minimum to 0 (CSS Flexbox/
          Sizing spec), so this finally clips to 100vh like every screen
          below it assumes. No effect on native — RN's own layout engine
          doesn't have this content-based min-size quirk. */}
      <GestureHandlerRootView style={{ flex: 1, overflow: 'hidden' }}>
        <SafeAreaProvider>
          <ToastProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <NavigationLogger />
            <NotificationTapRouter />
            <AuthGate fontsReady={fontsReady}>
              <ProjectProvider>
                  <AppStack />
              </ProjectProvider>
            </AuthGate>
          </AuthProvider>
          </ToastProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// Pages pushed on top of the menu (task, DPR checklist, reports, templates,
// drawings, team…) have no bottom tab bar under them, and Android draws the
// system navigation bar (3-button or gesture) OVER the app (edge-to-edge is
// always on). This one wrapper keeps every such page's content above that
// bar instead of fixing each page. Left out: the two sign-in screens (they
// pad themselves), the menu screens (the tab bar pads), and pages that pin
// their own inset-aware bottom bar (DPR entry's Save/Submit footer, the
// template canvas zoom controls).
const OWN_BOTTOM_INSET = new Set([
  'index',
  'login',
  '(authenticated)',
  'dpr-edit/[taskId]',
  'pr-edit/[taskId]',
  'flowchart-templates/canvas/[templateId]',
]);

function AppStack() {
  const insets = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0F1F33' }, headerLeft: ({ tintColor }) => <SafeHeaderBack tintColor={tintColor} /> }}
      screenLayout={({ children, route }) =>
        OWN_BOTTOM_INSET.has(route.name) ? (
          children
        ) : (
          <View style={{ flex: 1, paddingBottom: insets.bottom, backgroundColor: colors.bg }}>{children}</View>
        )
      }
    >
      {/* Pure black, not the shared navy default above — both
          screens before authentication are a deliberately
          strict black/white/grey design, so a transition
          should never show a navy frame behind them. */}
      <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#000000' } }} />
      <Stack.Screen name="login" options={{ contentStyle: { backgroundColor: '#0F1F33' } }} />
    </Stack>
  );
}

// Gates the ENTIRE app on session-restore state, not just the
// (authenticated) route group — restore() runs at the true root, before
// the user has necessarily navigated anywhere (a cold start always lands
// on /login first regardless of whether a session already exists), so a
// restore failure needs to be visible here to ever be seen at all.
function AuthGate({ children, fontsReady }: { children: ReactNode; fontsReady: boolean }) {
  const { state, retryRestore } = useAuth();

  // Native splash is still showing until the fonts are in.
  if (!fontsReady) return null;

  if (state.status === 'loading') {
    return <BrandSplash />;
  }

  if (state.status === 'error') {
    return <RestoreErrorScreen message={state.message} onRetry={retryRestore} />;
  }

  return <>{children}</>;
}

// Sentry.wrap (not a plain default export) — this is what enables native
// crash capture and automatic touch-event breadcrumbs on top of the
// explicit logAction() calls elsewhere in the app; it has nothing to do
// with Session Replay (a separate, never-added integration — see
// sentryInit.ts).
export default Sentry.wrap(RootLayout);
