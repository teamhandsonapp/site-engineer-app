// One shared "how long has this been pending" vocabulary for both home
// screens' alert cards — previously each screen defined its own inline
// color logic (StaffHome had one ternary, ClientHome had none at all,
// always rendering red regardless of age). Same 7/14-day boundary
// UpcomingTasksBell already uses for its own (unrelated — "days until
// start," not "days since pending") urgency buckets, kept for one
// consistent "a week / two weeks" mental model across the app rather than
// introducing a fourth set of thresholds.
export type UrgencyTier = 'calm' | 'warn' | 'urgent';

export function urgencyTier(daysPending: number): UrgencyTier {
  if (daysPending >= 14) return 'urgent';
  if (daysPending >= 7) return 'warn';
  return 'calm';
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

export function pendingLabel(daysPending: number): string {
  if (daysPending === 0) return 'Pending today';
  if (daysPending === 1) return 'Pending 1 day';
  return `Pending ${daysPending} days`;
}

// Tailwind/nativewind class names, since the two consuming screens style
// with className rather than inline color values — mapped 1:1 to the
// status.* tokens in tailwind.config.js.
export const URGENCY_CLASSES: Record<UrgencyTier, { text: string; bg: string; border: string }> = {
  calm: { text: 'text-status-calm', bg: 'bg-status-calmBg', border: 'border-status-calm' },
  warn: { text: 'text-status-warn', bg: 'bg-status-warnBg', border: 'border-status-warn' },
  urgent: { text: 'text-status-urgent', bg: 'bg-status-urgentBg', border: 'border-status-urgent' },
};
