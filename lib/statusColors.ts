// Mirrors admin-web's status color convention exactly (lib/utils/status-rules.ts
// — STATUS_COLOR_GROUP / STATUS_COLOR_PALETTE), so a task's color means the
// same thing here as it does on the desktop Gantt/flowchart. Kept as a
// separate hand-copied module (this app has no shared-package boundary with
// admin-web) rather than importing across repos.
export type TaskStatus = 'draft' | 'ready' | 'in_progress' | 'on_hold' | 'blocked' | 'completed';

export type StatusColorGroup = 'gray' | 'amber' | 'red' | 'green';

export const STATUS_COLOR_GROUP: Record<TaskStatus, StatusColorGroup> = {
  draft: 'gray',
  ready: 'amber',
  in_progress: 'amber',
  on_hold: 'amber',
  blocked: 'red',
  completed: 'green',
};

export const STATUS_COLOR_PALETTE: Record<StatusColorGroup, { bg: string; border: string; text: string; dot: string }> = {
  gray: { bg: '#F9FAFB', border: '#E5E7EB', text: '#6B7280', dot: '#9CA3AF' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', dot: '#F59E0B' },
  red: { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', dot: '#EF4444' },
  green: { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803D', dot: '#22C55E' },
};

export function getStatusColor(status: string) {
  const group = STATUS_COLOR_GROUP[status as TaskStatus] ?? 'gray';
  return STATUS_COLOR_PALETTE[group];
}
