import { Platform } from 'react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { isFieldRole, useAuth } from '../lib/AuthContext';
import { useProject } from '../lib/ProjectContext';
import { hasPromptedBatteryOptimization, requestIgnoreBatteryOptimizations } from '../lib/locationTracking/batteryOptimization';
import { getDeviceManufacturer } from '../lib/locationTracking/deviceInfo';
import { isTestModeActive } from '../lib/locationTracking/testModeConfig';
import { useLocationGateStatus } from '../lib/locationTracking/locationGate';
import { useBackgroundPermissionState } from '../lib/locationTracking/backgroundPermissionFlow';
import {
  getMandatoryChecklist,
  hasCompletedManufacturerChecklist,
} from '../lib/locationTracking/manufacturerChecklist';
import { useShiftState } from '../lib/locationTracking/shiftState';
import { useTrackingStatus } from '../lib/locationTracking/trackingStatus';
import { useFieldLocationTracking } from '../lib/locationTracking/useFieldLocationTracking';
import { useLocationDisabledAlertTracking } from '../lib/locationTracking/useLocationDisabledAlertTracking';
import { LocationBlockScreen } from './LocationBlockScreen';
import { BackgroundLocationExplainer } from './BackgroundLocationExplainer';
import { BackgroundLocationBanner } from './BackgroundLocationBanner';
import { BatteryOptimizationPrompt } from './BatteryOptimizationPrompt';
import { ManufacturerChecklistGate } from './ManufacturerChecklistGate';
import { TrackingDegradedBanner } from './TrackingDegradedBanner';

// The one mounting point for every part of the site-engineer location
// feature (Parts 2-4, plus the location-disabled admin alert) — wraps the
// authenticated area in app/_layout.tsx. admin/manager/client never see the
// block screen and never have any tracking registered, because `isField`
// is false for them and every hook below takes that as its
// `enabled`/`active` input.
export function FieldLocationGuard({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isField = profile != null && isFieldRole(profile.role);

  const { selectedProjectId } = useProject();
  const gate = useLocationGateStatus(isField);
  const blocked = isField && gate.checked && (!gate.permissionGranted || !gate.servicesEnabled);
  const blockedReason: 'permission' | 'services' | null = blocked
    ? !gate.permissionGranted
      ? 'permission'
      : 'services'
    : null;

  const backgroundState = useBackgroundPermissionState(isField && !blocked);
  const [explainerDone, setExplainerDone] = useState(false);
  // Bumped whenever the background-permission explainer resolves, so
  // useFieldLocationTracking re-checks and registers immediately instead of
  // waiting up to 60s for its next scheduled tick — see that hook's own
  // comment on permissionRecheckSignal for why granting background
  // permission alone doesn't otherwise change any of its other inputs.
  const [permissionRecheckSignal, setPermissionRecheckSignal] = useState(0);

  // Point 6 — asked once, right after the background-permission step
  // resolves (either outcome — granted or while-using-only both count as
  // "resolved," this isn't gated on getting "Allow all the time"
  // specifically). `batteryPromptChecked` distinguishes "haven't read the
  // persisted flag yet" from "read it, and it was false" so this doesn't
  // flash the prompt for a split second on every app open.
  const [batteryPromptChecked, setBatteryPromptChecked] = useState(false);
  const [batteryPromptDone, setBatteryPromptDone] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !isField) return;
    hasPromptedBatteryOptimization().then((already) => {
      setBatteryPromptDone(already);
      setBatteryPromptChecked(true);
    });
  }, [isField]);

  // TEMPORARY (pre-launch 3-day test mode, see testModeConfig.ts's own
  // TEST_MODE_ALWAYS_TRACK comment) — fires the real system exemption
  // dialog on EVERY login while test mode is active, regardless of
  // whether the one-time prompt above was already answered before.
  // Testers shouldn't be relying only on having manually done this once —
  // the OS (or the tester) can silently re-enable optimization later, and
  // this re-asks every time rather than waiting for someone to notice
  // tracking degraded first. No-ops entirely (never fires) once
  // TEST_MODE_ALWAYS_TRACK is false — delete this effect at that point,
  // the permanent one-time prompt above already covers normal, non-test
  // behavior on its own.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isField || !isTestModeActive()) return;
    requestIgnoreBatteryOptimizations().catch(() => {});
  }, [isField]);

  // Chained right after the generic Android battery-optimization step —
  // mandatory (no "not now") specifically for the worst-offender
  // manufacturers (see manufacturerChecklist.ts), since those are known to
  // silently break tracking entirely rather than just degrade it. null
  // checklist (a non-problem manufacturer, or web/iOS) means this step is
  // skipped outright, same "ask once" persisted-flag pattern as the battery
  // prompt above.
  const manufacturerChecklist = Platform.OS === 'android' ? getMandatoryChecklist(getDeviceManufacturer()) : null;
  const [checklistChecked, setChecklistChecked] = useState(false);
  const [checklistDone, setChecklistDone] = useState(false);
  useEffect(() => {
    if (!manufacturerChecklist || !isField) return;
    hasCompletedManufacturerChecklist().then((already) => {
      setChecklistDone(already);
      setChecklistChecked(true);
    });
  }, [isField, manufacturerChecklist]);

  // Return value intentionally unused here — background tracking no longer
  // depends on manual clock-in/out at all, so nothing in this component
  // reads shiftState.isOn anymore. The call itself still matters for its
  // own side effect (Sentry's `shiftActive` tag) and for keeping the
  // locally-persisted attendance mirror reconciled with the backend.
  useShiftState(isField && !blocked, profile?.id ?? null);
  // Gated on the same `active` input as tracking itself (logged in, gate
  // passed), not on manual clock-in/out — degraded-tracking monitoring now
  // covers the whole scheduled window regardless of check-in state,
  // matching useFieldLocationTracking's own independent decoupling.
  const trackingStatus = useTrackingStatus(isField && !blocked, profile?.id ?? null, selectedProjectId);

  useFieldLocationTracking(isField && !blocked, profile?.id ?? null, selectedProjectId, permissionRecheckSignal);
  useLocationDisabledAlertTracking(isField, blocked, blockedReason, profile?.id ?? null, selectedProjectId);

  if (blocked && blockedReason) {
    return <LocationBlockScreen reason={blockedReason} />;
  }

  // Shown once per state — not a hard block. If the OS dialog comes back
  // "while using only," backgroundState moves to that value (never stays
  // 'not-yet-asked'), so this naturally doesn't reappear; explainerDone is
  // just a defensive latch for the brief window before that re-check lands.
  if (isField && backgroundState === 'not-yet-asked' && !explainerDone) {
    return (
      <BackgroundLocationExplainer
        onDone={() => {
          setExplainerDone(true);
          setPermissionRecheckSignal((n) => n + 1);
        }}
      />
    );
  }

  // Chained right after the background-permission step, same "ask once,
  // right after" ordering the spec itself calls for. Android-only — iOS
  // has no battery-optimization concept at all, so `batteryPromptChecked`
  // is never set to true there and this step is always skipped.
  if (
    Platform.OS === 'android' &&
    isField &&
    backgroundState !== 'not-yet-asked' &&
    backgroundState !== 'unknown' &&
    batteryPromptChecked &&
    !batteryPromptDone
  ) {
    return <BatteryOptimizationPrompt onDone={() => setBatteryPromptDone(true)} />;
  }

  // Chained right after the generic battery-optimization step — mandatory
  // (no skip) specifically for known worst-offender manufacturers. Waits
  // for both the battery prompt AND its own persisted-flag check to
  // resolve first, same "don't flash while still reading AsyncStorage"
  // reasoning as batteryPromptChecked above.
  if (
    Platform.OS === 'android' &&
    isField &&
    profile &&
    manufacturerChecklist &&
    batteryPromptChecked &&
    batteryPromptDone &&
    checklistChecked &&
    !checklistDone
  ) {
    return (
      <ManufacturerChecklistGate
        checklist={manufacturerChecklist}
        userId={profile.id}
        onDone={() => setChecklistDone(true)}
      />
    );
  }

  // At most one banner at a time: the urgent, window-scoped one (Point 9)
  // takes precedence over the ambient pre-shift nudge (Part 1) whenever
  // both conditions happen to be true, rather than stacking two banners
  // making largely the same point. trackingStatus already reports OFF
  // outside the scheduled window (see useTrackingStatus), so no extra
  // shiftState.isOn check is needed here.
  const degradedReason = trackingStatus.status === 'degraded' ? trackingStatus.reason : null;
  const showAmbientBanner = !degradedReason && isField && backgroundState === 'while-using-only';

  return (
    <>
      {degradedReason && <TrackingDegradedBanner reason={degradedReason} />}
      {showAmbientBanner && <BackgroundLocationBanner />}
      {children}
    </>
  );
}
