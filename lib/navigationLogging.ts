import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { logAction } from './sentryLog';

// One integration point covers every screen, per the Sentry instrumentation
// brief — expo-router has no exposed `navigationRef.addListener('state', ...)`
// the way a bare React Navigation setup would, but usePathname() changing is
// the same underlying signal (expo-router is built on React Navigation
// internally; the pathname only changes when the active route does), so this
// achieves the identical result without reaching past expo-router's own
// abstraction. Mounted once at the root layout, not per-screen.
export function useNavigationLogging(): void {
  const pathname = usePathname();

  useEffect(() => {
    logAction('navigation', 'Screen focused', { pathname });
  }, [pathname]);
}
