import { ScrollView } from 'react-native';
import { DevicesPanel } from '../../components/DevicesPanel';

// Devices & Logins — the same content as Settings → "Login & Devices"
// (components/DevicesPanel.tsx), kept as its own route for old links.
export default function DevicesScreen() {
  return (
    <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-4 pb-10" keyboardShouldPersistTaps="handled">
      <DevicesPanel />
    </ScrollView>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
