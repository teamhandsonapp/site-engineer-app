import * as Sentry from '@sentry/react-native';

// The one shared entry point for every breadcrumb in this app — every call
// site gets the same shape (category/message/level/data) for free, and
// adding something to every breadcrumb at once (e.g. a shared field) later
// only ever means editing this one function, not every call site. Sentry
// already timestamps each breadcrumb itself, so this doesn't add one.
//
// `category` should be one of a small, fixed set used consistently across
// the app (see AGENTS/PR notes: "auth", "navigation", "shift", "geofence",
// "sync", "location_ping", "permission", "alert") — that's what makes the
// breadcrumb trail filterable by area later, not just a wall of text.
export function logAction(category: string, message: string, data?: Record<string, unknown>): void {
  Sentry.addBreadcrumb({
    category,
    message,
    level: 'info',
    data,
  });
}

// For a caught error that must show up in the Issues list, not just as a
// line in some other issue's breadcrumb trail — every catch block in
// tracking-related code should call this, not console.error/devWarn alone
// (a caught-and-only-logged-locally error never reaches Sentry at all).
// `area` becomes a searchable tag (`area:sync`, `area:geofence`, ...) so
// the Issues list itself can be filtered by pipeline stage, not just each
// issue's own trail inspected one at a time.
export function logError(error: unknown, area: string, extra?: Record<string, unknown>): void {
  Sentry.captureException(error, {
    tags: { area },
    extra,
  });
}
