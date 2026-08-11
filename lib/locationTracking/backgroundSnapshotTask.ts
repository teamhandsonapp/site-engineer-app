import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { devWarn } from '../devLog';
import { runCheckpointCatchUp } from './checkpoints';
import { BACKGROUND_SNAPSHOT_TASK, BACKGROUND_TASK_MIN_INTERVAL_MINUTES } from './constants';
import { confirmPendingExitIfDue, confirmPendingZoneEntriesIfDue } from './geofence';
import { syncPendingPings } from './locationPings';
import { syncPendingTrackingStatusEvents } from './trackingStatusQueue';
import { syncPendingZoneEvents } from './zoneEventQueue';
import { logError } from '../sentryLog';

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
TaskManager.defineTask(BACKGROUND_SNAPSHOT_TASK, async () => {
  try {
    await runCheckpointCatchUp();
    await confirmPendingExitIfDue();
    await confirmPendingZoneEntriesIfDue();
    await syncPendingZoneEvents();
    await syncPendingPings();
    await syncPendingTrackingStatusEvents();
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
