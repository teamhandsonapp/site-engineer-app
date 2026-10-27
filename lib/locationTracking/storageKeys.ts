// AsyncStorage keys shared between the foreground app and the headless
// background task context (backgroundSnapshotTask.ts, geofence.ts's event
// task) — a background task has no React context to read from, so anything
// it needs (which project was selected, which checkpoints already fired
// today, whether a geofence exit is currently pending confirmation) has to
// be persisted here by the foreground side instead.
export const SELECTED_PROJECT_KEY = 'field-location:selected-project-id';
export const CHECKPOINT_STATE_KEY = 'field-location:checkpoint-state';
export const PENDING_EXIT_KEY = 'field-location:pending-exit';
export const PENDING_ZONE_ENTRIES_KEY = 'field-location:pending-zone-entries';
export const ZONE_EVENT_QUEUE_KEY = 'field-location:zone-event-queue';
export const SHIFT_STATE_KEY = 'field-location:shift-state';
export const BATTERY_OPT_PROMPTED_KEY = 'field-location:battery-opt-prompted';
export const TRACKING_STATUS_STATE_KEY = 'field-location:tracking-status-state';
export const TRACKING_STATUS_QUEUE_KEY = 'field-location:tracking-status-queue';
export const LOCATION_PING_QUEUE_KEY = 'field-location:location-ping-queue';
export const LAST_FIX_AT_KEY = 'field-location:last-fix-at';
export const MANUFACTURER_CHECKLIST_DONE_KEY = 'field-location:manufacturer-checklist-done';

// TEMPORARY — testTrackingTask.ts's own device_label/session_id, read back
// by the headless task handler (no React context there, same reasoning as
// every other key in this file). Remove alongside that file once the
// Oppo/Redmi/CMF 2-hour comparison is done.
export const TEST_TRACKING_SESSION_KEY = 'field-location:test-tracking-session';
