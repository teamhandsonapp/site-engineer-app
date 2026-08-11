import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { ClientHome } from '../../components/home/ClientHome';

// A client already has exactly one project, permanently — ClientHome is
// effectively their project dashboard already (progress, timeline, their
// own pending-response feed), so there's no separate "pick a project" step
// for them to go through, and this screen stays drawer-wrapped exactly as
// before. Staff get App Home instead, but as of Part 6 that's a top-level,
// sidebar-less route (app/app-home.tsx) — this screen just relays them
// there rather than rendering it inline, so every existing '/home'
// navigation (login's own post-auth redirect aside, which routes each role
// directly — see login.tsx) still lands the right person in the right
// place: the drawer's own "Home" menu item, project-dashboard's back arrow,
// and gantt/flowchart's empty-state fallback all still just say '/home'.
export default function HomeScreen() {
  const { state } = useAuth();

  if (state.status !== 'signed-in') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  if (appRoleFor(state.profile.role) !== 'client') {
    return <Redirect href="/app-home" />;
  }

  return <ClientHome />;
}
