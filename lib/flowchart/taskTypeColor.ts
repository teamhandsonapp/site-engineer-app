// Ported verbatim from admin-web's lib/utils/task-type-color.ts — same
// green -> red duration scale and same AC/AV box-background mix, so a task
// box looks identical on both platforms. Keep these two files in sync if
// either changes.

// A 7-step green -> red gradient, ranked by defaultDurationDays ascending —
// a shorter lead-time type reads as calm/green, a longer one as more of a
// warning/red, regardless of how many types actually exist (colors are
// spread evenly across whatever the real count is, not hardcoded to 7).
const TASK_TYPE_COLOR_SCALE = ['#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316', '#EF4444', '#B91C1C'];

export function getTaskTypeColors<T extends { id: string; defaultDurationDays: number }>(
  taskTypes: T[]
): Record<string, string> {
  const sorted = [...taskTypes].sort((a, b) => a.defaultDurationDays - b.defaultDurationDays);
  const n = sorted.length;
  const map: Record<string, string> = {};
  sorted.forEach((t, i) => {
    const scaleIdx = n <= 1 ? 0 : Math.round((i / (n - 1)) * (TASK_TYPE_COLOR_SCALE.length - 1));
    map[t.id] = TASK_TYPE_COLOR_SCALE[scaleIdx];
  });
  return map;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// AC's identity is black, AV's is white — but the box background should
// read as a light, subtle tint either way, not the type color at full
// saturation. So the type color is pre-lightened into a pale tone FIRST,
// then only a small touch of black (AC) or extra white (AV) is mixed in —
// enough to tell the two apart, not enough to turn the box bold/dark.
export function getTaskBoxBackground(
  typeColor: string | null,
  accountabilityType: 'ACC' | 'ACV' | null
): { background: string; textColor: string } | null {
  if (!typeColor || !accountabilityType) return null;
  const [r, g, b] = hexToRgb(typeColor);

  const paleRatio = 0.75;
  const pr = r + (255 - r) * paleRatio;
  const pg = g + (255 - g) * paleRatio;
  const pb = b + (255 - b) * paleRatio;

  if (accountabilityType === 'ACC') {
    // A light touch of black — just enough to read as "AC," still a light shade overall.
    const ratio = 0.14;
    return { background: rgbToHex(pr * (1 - ratio), pg * (1 - ratio), pb * (1 - ratio)), textColor: '#111111' };
  }
  // ACV — a further touch of white on top of the same pale base, airier than AC.
  const ratio = 0.35;
  return {
    background: rgbToHex(pr + (255 - pr) * ratio, pg + (255 - pg) * ratio, pb + (255 - pb) * ratio),
    textColor: '#111111',
  };
}
