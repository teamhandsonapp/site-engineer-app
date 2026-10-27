import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { devWarn } from '../devLog';
import { runCheckpointCatchUp } from './checkpoints';
import { BACKGROUND_SNAPSHOT_TASK, BACKGROUND_TASK_MIN_INTERVAL_MINUTES } from './constants';
import { getCurrentFieldSession } from './currentFieldSession';
import { runDebugWatchdog } from './debugWatchdog';
import { confirmPendingExitIfDue, confirmPendingZoneEntriesIfDue } from './geofence';
import { evaluateGeofence, evaluateLocationPingTask } from './evaluateTracking';
import { syncPendingPings } from './locationPings';
import { logShiftWindowTransition } from './shiftWindow';
import { syncPendingTrackingStatusEvents } from './trackingStatusQueue';
import { syncPendingZoneEvents } from './zoneEventQueue';
import { logError } from '../sentryLog';

// This module-level ref is fine to be fresh on every task invocation
// (unlike useFieldLocationTracking.ts's own lastRegionsKeyRef, which
// persists across many rapid foreground ticks within one mounted session) —
// a background wake has no equivalent long-lived session to remember
// across, and re-registering an unchanged geofence set is a cheap, local,
// idempotent call (no network, no fresh GPS fix — see evaluateTracking.ts's
// own comment).
const backgroundLastRegionsKeyRef = { current: 'none' };

// Defined at module scope — required by TaskManager (this file is imported
// once from the root layout, which runs this unconditionally at both a
// normal app launch AND the separate headless launch iOS/Android use to
// invoke a background task, regardless of whether the task is currently
// registered).
//
// iOS's BGTaskScheduler only ever grants ONE permitted background-task
// identifier via the expo-background-task config plugin (hardcoded to
// com.expo.modules.backgroundtask.processing regardless of the JS task
// name given to registerTaskAsync — see constants.ts's own comment), so
// this single wake does six jobs at once: the checkpoint snapshot, the
// pending-geofence-exit confirmation, the restricted-zone pending-entry
// confirmation, and syncing the offline zone-event, location-ping, and
// tracking-status queues, rather than each registering its own background
// task. (Addition B's own location-ping foreground-service task, part 3,
// is the one exception — it wakes independently, on its own interval, and
// isn't limited to this single iOS background-task slot at all.)
//
// Real-world reliability (see the plan this was built against): Android's
// WorkManager backing genuinely respects something close to the requested
// interval, battery-manager throttling aside. iOS's BGTaskScheduler is a
// REQUEST, not a schedule — the OS decides if/when this actually runs, and
// frequently prefers overnight/idle windows over the daytime work-hours
// window this feature actually cares about. That's exactly why
// runCheckpointCatchUp() and confirmPendingExitIfDue() are also invoked
// from the foreground app-open/resume path (see
// useFieldLocationTracking.ts) — that path is the real primary mechanism
// on iOS in practice, not just a backstop.
//
// evaluateGeofence/evaluateLocationPingTask below are the self-heal: the
// foreground tick is the only other place that ever calls these, so an
// engineer who never reopens the app after the tracking window closes had
// nothing left to notice the NEXT day's window opening and re-register —
// confirmed live (site-engineer whose phone went quiet at the same time
// every night, tracking never resuming on its own the next morning without
// a manual reopen). WorkManager's own periodic wake (Android; iOS is
// best-effort per the comment above) reaches this task roughly every
// BACKGROUND_TASK_MIN_INTERVAL_MINUTES regardless of whether the app has
// been opened that day at all — as long as the OS hasn't fully force-
// stopped the app (a real, un-overridable ceiling: Android revokes ALL of
// an app's background-wake ability on a force-stop, and nothing software-
// side can undo that except the user reopening the app once), this is what
// lets tracking actually resume within about that same margin of the
// window opening, with zero user action.
TaskManager.defineTask(BACKGROUND_SNAPSHOT_TASK, async () => {
  try {
    await runCheckpointCatchUp();
    await confirmPendingExitIfDue();
    await confirmPendingZoneEntriesIfDue();
    await syncPendingZoneEvents();
    await syncPendingPings();
    await syncPendingTrackingStatusEvents();

    const session = await getCurrentFieldSession();
    if (session) {
      const withinWindow = await logShiftWindowTransition(session.projectId, session.userId);
      await evaluateGeofence(withinWindow, session.projectId, backgroundLastRegionsKeyRef);
      await evaluateLocationPingTask(withinWindow);
      // TEMPORARY — see debugWatchdog.ts's own header for scope/removal.
      // The background-wake counterpart to useFieldLocationTracking's
      // foreground tick — this is the path that actually catches a kill
      // that happened while the app wasn't in the foreground at all.
      await runDebugWatchdog(session.userId, withinWindow).catch(() => {});
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    devWarn('[locationTracking] background task run failed:', err);
    logError(err, 'background_snapshot_task');
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSnapshotTask(): Promise<void> {
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SNAPSHOT_TASK);
  if (alreadyRegistered) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_SNAPSHOT_TASK, {
    minimumInterval: BACKGROUND_TASK_MIN_INTERVAL_MINUTES,
  });
}

export async function unregisterBackgroundSnapshotTask(): Promise<void> {
  const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SNAPSHOT_TASK);
  if (!alreadyRegistered) return;
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SNAPSHOT_TASK);
}
