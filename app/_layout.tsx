import '../global.css';

import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { enableFreeze } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import { ProjectProvider } from '../lib/ProjectContext';
import { useNavigationLogging } from '../lib/navigationLogging';
import { useNotificationTapRouting } from '../lib/notificationRouting';
import { initSentry } from '../lib/sentryInit';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { RestoreErrorScreen } from '../components/RestoreErrorScreen';
import { FieldLocationGuard } from '../components/FieldLocationGuard';

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
function NavigationLogger() {
  useNavigationLogging();
  return null;
}

function RootLayout() {
  useNotificationTapRouting();

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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <NavigationLogger />
            <AuthGate>
              <ProjectProvider>
                <FieldLocationGuard>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0F1F33' } }}>
                    {/* Pure black, not the shared navy default above — both
                        screens before authentication are a deliberately
                        strict black/white/grey design, so a transition
                        should never show a navy frame behind them. */}
                    <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#000000' } }} />
                    <Stack.Screen name="login" options={{ contentStyle: { backgroundColor: '#000000' } }} />
                  </Stack>
                </FieldLocationGuard>
              </ProjectProvider>
            </AuthGate>
          </AuthProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

// Gates the ENTIRE app on session-restore state, not just the
// (authenticated) route group — restore() runs at the true root, before
// the user has necessarily navigated anywhere (a cold start always lands
// on /login first regardless of whether a session already exists), so a
// restore failure needs to be visible here to ever be seen at all.
function AuthGate({ children }: { children: ReactNode }) {
  const { state, retryRestore } = useAuth();

  if (state.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-brand-navy">
        <ActivityIndicator color="#F0A227" />
      </View>
    );
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
