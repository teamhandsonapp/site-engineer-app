// Mirrors admin-web's checklist-health convention exactly (StatusDropdown.tsx's
// STATUS_CHIP colors, lib/utils/checklist-health.ts's severity order) — this
// app has no shared-package boundary with admin-web, so it's a hand-copied
// module, same convention as statusColors.ts/ganttLayout.ts in this repo.
export type CompletionStatus = 'YES' | 'NO' | 'ON_HOLD' | 'PENDING' | 'REVISIONS' | 'PROCEED';
export type DependencyCategory = 'architect' | 'client' | 'consultant' | 'contractor' | 'inspector' | 'procurement';

export const STATUS_CHIP: Record<CompletionStatus, { label: string; bg: string; text: string; dot: string }> = {
  YES:       { label: 'Yes',       bg: '#DCFCE7', text: '#15803D', dot: '#22C55E' },
  PROCEED:   { label: 'Proceed',   bg: '#CCFBF1', text: '#0F766E', dot: '#14B8A6' },
  PENDING:   { label: 'Pending',   bg: '#F3F4F6', text: '#4B5563', dot: '#9CA3AF' },
  ON_HOLD:   { label: 'On Hold',   bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  REVISIONS: { label: 'Revisions', bg: '#FFEDD5', text: '#C2410C', dot: '#FB923C' },
  NO:        { label: 'No',        bg: '#FEE2E2', text: '#B91C1C', dot: '#EF4444' },
};

export const CATEGORY_LABELS: Record<DependencyCategory, string> = {
  architect: 'Architect',
  client: 'Client',
  consultant: 'Consultant',
  contractor: 'Contractor',
  inspector: 'Inspector',
  procurement: 'Procurement',
};

// Worst-to-best — an active problem (No, On Hold) always outranks a merely
// unresolved one (Pending), which in turn outranks anything already
// clearing the item (Proceed, Yes).
const SEVERITY_ORDER: CompletionStatus[] = ['NO', 'ON_HOLD', 'REVISIONS', 'PENDING', 'PROCEED', 'YES'];
const SEVERITY_RANK: Record<CompletionStatus, number> = Object.fromEntries(
  SEVERITY_ORDER.map((status, i) => [status, i])
) as Record<CompletionStatus, number>;

export function worstChecklistStatus(statuses: CompletionStatus[]): CompletionStatus | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, s) => (SEVERITY_RANK[s] < SEVERITY_RANK[worst] ? s : worst), statuses[0]);
}

export interface ChecklistItem {
  category: DependencyCategory;
  itemLabel: string;
  status: CompletionStatus;
}

// Fixed display order — NOT insertion order from whatever order items
// happen to arrive in (which would vary task to task and reorder the boxes
// unpredictably as the user scans down the Gantt).
export const CATEGORY_ORDER: DependencyCategory[] = [
  'architect', 'client', 'consultant', 'contractor', 'inspector', 'procurement',
];

export interface CategoryHealth {
  category: DependencyCategory;
  status: CompletionStatus; // worst status among this category's own items
  items: ChecklistItem[];
}

// One entry per category that actually HAS items on this task (max 6, per
// CATEGORY_ORDER) — a category with zero items is simply absent from the
// result, not rendered as an empty/placeholder box. Each entry carries its
// own item list so a tap can show just that category's breakdown without a
// second fetch or re-filtering the full list again.
export function checklistHealthByCategory(items: ChecklistItem[]): CategoryHealth[] {
  const byCategory = new Map<DependencyCategory, ChecklistItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }
  return CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((category) => {
    const categoryItems = byCategory.get(category)!;
    return { category, status: worstChecklistStatus(categoryItems.map((i) => i.status))!, items: categoryItems };
  });
}
