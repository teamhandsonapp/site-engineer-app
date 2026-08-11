import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { devWarn } from '../devLog';
import { logAction, logError } from '../sentryLog';
import { SESSION_STARTED_KEY } from '../forceLogoutWatch';
import { getDeviceManufacturer, getDeviceModel } from './deviceInfo';
import {
  findOpenTrackingDegradedAlertIdForReason,
  insertLocationDisabledAlert,
  markLocationDisabledAlertEnabled,
} from './locationDisabledAlerts';
import type { TrackingStatusResult } from './trackingStatus';
import { DEAD_ZONE_TIMEOUT_MINUTES, STARTUP_GRACE_PERIOD_MINUTES } from './constants';
import { LAST_FIX_AT_KEY } from './storageKeys';

// Section 5 — the two-case GPS lockout logic. Case A (this file's
// checkDeadZoneAndReport) never locks anything, it only logs, exactly like
// the existing tracking-degraded episodes it reuses the table/dedup pattern
// from. Case B (maybeLockForServicesDisabled) is the only path that ever
// calls the lock_own_account_for_gps Postgres function. Both respect the
// same startup grace period — see isWithinStartupGrace below.

async function isWithinStartupGrace(): Promise<boolean> {
  const sessionStartedAt = await AsyncStorage.getItem(SESSION_STARTED_KEY);
  // No stored session start (shouldn't happen for a real signed-in session —
  // AuthContext's signIn() always stamps one — but a missing value should
  // never be treated as "grace has definitely elapsed," since that would be
  // the more dangerous direction to guess wrong in) — treat as still within
  // grace rather than risk a spurious lock/log on an edge case this can't
  // actually distinguish.
  if (!sessionStartedAt) return true;
  const elapsedMinutes = (Date.now() - new Date(sessionStartedAt).getTime()) / 60_000;
  return elapsedMinutes < STARTUP_GRACE_PERIOD_MINUTES;
}

// Called from locationPingTask.ts whenever a real fix arrives (even one
// later discarded elsewhere for poor accuracy — signal was still present,
// which is the only thing this cares about). Closes any open dead-zone
// episode this same fix just resolved.
export async function recordSuccessfulFix(userId: string): Promise<void> {
  await AsyncStorage.setItem(LAST_FIX_AT_KEY, new Date().toISOString());
  try {
    const openId = await findOpenTrackingDegradedAlertIdForReason(userId, 'no_fix_timeout');
    if (openId) await markLocationDisabledAlertEnabled(openId);
  } catch (err) {
    devWarn('[locationTracking] failed to close dead-zone episode on fix recovery:', err);
    logError(err, 'gps_lockout_dead_zone_recovery');
  }
}

// Case A — permission+services both fine (status === 'active'), but no fix
// has landed in DEAD_ZONE_TIMEOUT_MINUTES. Only ever logs (existing-style
// tracking-degraded episode, same table/dedup as Part 3's own
// background_permission/gps_disabled reasons) — NEVER locks. Takes the
// already-computed TrackingStatusResult from the caller (locationPingTask.ts
// already has one) rather than re-deriving it, so a status that's degraded
// for a DIFFERENT reason (permission/services actually off) is correctly
// left alone here — that's Case B's or the existing gate's job, not this
// one's.
export async function checkDeadZoneAndReport(
  userId: string,
  projectId: string | null,
  status: TrackingStatusResult
): Promise<void> {
  if (status.status !== 'active') return;
  if (await isWithinStartupGrace()) return;

  const lastFixAtISO = await AsyncStorage.getItem(LAST_FIX_AT_KEY);
  if (!lastFixAtISO) {
    // First-ever check this session with no fix yet — seed the clock from
    // now rather than reporting a dead zone before tracking has had any
    // real chance to produce a fix at all.
    await AsyncStorage.setItem(LAST_FIX_AT_KEY, new Date().toISOString());
    return;
  }

  const minutesSinceLastFix = (Date.now() - new Date(lastFixAtISO).getTime()) / 60_000;
  if (minutesSinceLastFix <= DEAD_ZONE_TIMEOUT_MINUTES) return;

  try {
    await insertLocationDisabledAlert({ userId, projectId, reason: 'no_fix_timeout' });
    logAction('permission', 'Dead zone detected — no GPS fix for a while', { minutesSinceLastFix: Math.round(minutesSinceLastFix) });
  } catch (err) {
    devWarn('[locationTracking] failed to report dead-zone episode:', err);
    logError(err, 'gps_lockout_dead_zone_report');
  }
}

// Case B — the OS-level location toggle was explicitly turned off. Called
// from both locationGate.ts's foreground poll and trackingStatus.ts's
// reportTrackingStatusIfChanged (which also runs from the headless
// background task via locationPingTask.ts) — safe to call repeatedly from
// either or both, since the underlying RPC is idempotent (guarded by
// gps_locked_at IS NULL server-side).
export async function maybeLockForServicesDisabled(): Promise<void> {
  if (await isWithinStartupGrace()) return;

  try {
    const { error } = await supabase.rpc('lock_own_account_for_gps', {
      p_reason: 'location_services_disabled',
      p_device_manufacturer: getDeviceManufacturer(),
      p_device_model: getDeviceModel(),
    });
    if (error) throw new Error(error.message);
    logAction('permission', 'GPS lockout triggered — location services turned off', {});
  } catch (err) {
    // Best-effort — this must never throw back into the gate/tracking-status
    // poll it's hooked into. A failed lock attempt here isn't the end of the
    // story either: the poll that called this will call it again on its
    // next tick as long as services are still off, and useForceLogoutWatch's
    // own 60s poll/AppState-resume check are independent backstops for any
    // lock that DID land despite this call itself erroring on the response.
    devWarn('[locationTracking] gps lockout RPC failed:', err);
    logError(err, 'gps_lockout_rpc');
  }
}
