import type { AccountabilityType } from './types';

// Ported verbatim from admin-web's lib/utils/accountability.ts
// (classifyAccountabilityType) — same two reference lists + matching rule
// as the one-time batch pass that originally classified every existing
// task (admin-web/scripts/apply-task-accountability-classification.mjs).
// Substring `.includes()` on the lowercased `taskName + ' ' + description`,
// not a word-boundary regex. Returns null (no override) both when NEITHER
// list matches (pure structural work) and when BOTH match (a genuine
// conflict) — never guesses either way. Called automatically at task-
// creation time (createTask); a person can still set it manually
// afterward via Edit Task regardless of what (if anything) this returns.
const AC_KEYWORDS = [
  'civil execution', 'structural consultant', 'hvac', 'electrical', 'plumbing', 'lighting',
  'automation', 'av consultant', 'audio', 'video', 'landscape', 'waterbody', 'kitchen consultant', 'kitchen hvac',
];
const AV_KEYWORDS = [
  'flooring', 'dado', 'cladding', 'paint', 'furniture', 'soft furnishing', 'false ceiling', 'sanitary',
];

export function classifyAccountabilityType(taskName: string, description: string | null): AccountabilityType | null {
  const hay = `${taskName} ${description ?? ''}`.toLowerCase();
  const acHit = AC_KEYWORDS.some((k) => hay.includes(k));
  const avHit = AV_KEYWORDS.some((k) => hay.includes(k));
  if (acHit && avHit) return null;
  if (acHit) return 'ACC';
  if (avHit) return 'ACV';
  return null;
}
