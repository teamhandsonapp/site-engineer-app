// Diagnostic warnings across this app (auth/push-notification edge cases)
// are genuinely useful during development but shouldn't print in a
// production build — this is the one shared gate for that, rather than
// repeating `if (__DEV__)` at every call site.
export function devWarn(...args: unknown[]): void {
  if (__DEV__) {
    console.warn(...args);
  }
}
