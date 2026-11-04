import { useEffect, useRef } from 'react';
import { devWarn } from '../devLog';
import {
  findOpenLocationDisabledAlertId,
  insertLocationDisabledAlert,
  markLocationDisabledAlertEnabled,
} from './locationDisabledAlerts';

// Tracks one continuous "the location gate is blocking this user" episode
// at a time — creates a location_disabled_alerts row the instant `blocked`
// becomes true, and fills in enabled_at the instant it becomes false again.
// No confirmation delay (unlike Part 4's geofence exit): a permission/
// services toggle is a deliberate state change, not a noisy GPS reading,
// so there's nothing to debounce here.
export function useLocationDisabledAlertTracking(
  isField: boolean,
  blocked: boolean,
  reason: 'permission' | 'services' | null,
  userId: string | null,
  projectId: string | null
): void {
  const openAlertIdRef = useRef<string | null>(null);
  const wasBlockedRef = useRef(false);
  const reconciledUserIdRef = useRef<string | null>(null);

  // Reconciles against a still-open alert from BEFORE this mount (e.g. the
  // app was killed/restarted while already blocked) so a restart mid-block
  // doesn't create a second, redundant alert row for the same episode.
  useEffect(() => {
    if (!isField || !userId || reconciledUserIdRef.current === userId) return;
    reconciledUserIdRef.current = userId;
    findOpenLocationDisabledAlertId(userId).then((id) => {
      if (id) {
        openAlertIdRef.current = id;
        wasBlockedRef.current = true;
      }
    });
  }, [isField, userId]);

  useEffect(() => {
    if (!isField || !userId) return;

    if (blocked && !wasBlockedRef.current) {
      wasBlockedRef.current = true;
      insertLocationDisabledAlert({ userId, projectId, reason: reason ?? 'permission' })
        .then((id) => {
          openAlertIdRef.current = id;
        })
        .catch((err) => devWarn('[locationTracking] failed to record location-disabled alert:', err));
    } else if (!blocked && wasBlockedRef.current) {
      wasBlockedRef.current = false;
      const alertId = openAlertIdRef.current;
      openAlertIdRef.current = null;
      if (alertId) {
        markLocationDisabledAlertEnabled(alertId).catch((err) =>
          devWarn('[locationTracking] failed to clear location-disabled alert:', err)
        );
      }
    }
  }, [isField, blocked, reason, userId, projectId]);
}
