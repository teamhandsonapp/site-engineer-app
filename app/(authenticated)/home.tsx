import { ActivityIndicator, View } from 'react-native';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { ClientHome } from '../../components/home/ClientHome';
import { AppHome } from '../../components/home/AppHome';

// A client already has exactly one project, permanently — ClientHome is
// effectively their project dashboard already (progress, timeline, their
// own pending-response feed), so there's no separate "pick a project" step
// for them to go through.
//
// Staff used to get relayed out to a top-level, sidebar-less /app-home
// (Part 6) — the sidebar is now visible from the moment the home screen
// loads, so AppHome (the cross-project overview: global stats + a
// project-cards list) renders directly here instead, inside the drawer.
// Every existing '/home' navigation (the drawer's own "Home" row,
// gantt/flowchart's empty-state fallback, etc.) still just says '/home'
// and now correctly stays inside the drawer for staff too.
export default function HomeScreen() {
  const { state } = useAuth();

  if (state.status !== 'signed-in') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  return appRoleFor(state.profile.role) === 'client' ? <ClientHome /> : <AppHome />;
}
