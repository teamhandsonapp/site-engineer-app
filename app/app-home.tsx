import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { AppHome } from '../components/home/AppHome';
import { NotificationBell } from '../components/NotificationBell';

// Staff's landing / project-selection screen (Part 6) — deliberately a
// top-level Stack route, NOT one more (authenticated) Drawer.Screen, the
// same reasoning project-dashboard.tsx already established: no sidebar
// should be available until someone has actually selected a project. A
// sibling top-level file is also the only way to get that (Expo Router
// treats every file inside app/(authenticated)/ as belonging to that
// Drawer regardless of whether it's explicitly listed via <Drawer.Screen>,
// so this couldn't be achieved by just deleting that registration line —
// the file itself has to live outside the group).
//
// (authenticated)/home.tsx stays the canonical "/home" route: it still
// renders ClientHome directly (unchanged — a client has no project-picker
// step to skip past) and now redirects a staff user straight here instead
// of rendering AppHome inline. That keeps every existing `router.push/
// replace('/home')` call site (project-dashboard's back arrow, gantt/
// flowchart's empty-state fallback, the drawer's own "Home" menu item)
// correct for both roles with no further changes.
export default function AppHomeScreen() {
  const { state } = useAuth();

  if (state.status !== 'signed-in') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  // Defense in depth, matching project-dashboard.tsx's own
  // no-project-selected guard — a client shouldn't normally reach this
  // route at all (nothing links here for them), but a stale deep link
  // should land them on their real home, not an empty/wrong screen.
  if (appRoleFor(state.profile.role) === 'client') {
    return <Redirect href="/home" />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Home',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          headerRight: () => <NotificationBell />,
        }}
      />
      <AppHome />
    </>
  );
}
