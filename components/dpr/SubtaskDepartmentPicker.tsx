import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { WorkOption } from '../../lib/flowchart/data';

// A single day's Subtask can be tagged with its own Department, by explicit
// request — independent of the parent task's own single Department (a
// task's checklist/report Department stays whatever it always was; this is
// only which Work a specific day's Subtask note gets filed under). A
// collapsed dropdown, not a flat chip wall — by explicit correction, a
// real project's department list (15+ trades) read as a wall of chips;
// same collapsed-header-expands-a-bordered-list pattern as
// TaskDetailSheet.tsx's own DropdownPicker. Shared since this control now
// shows up in 4 places (the DPR form, DPR History, the flowchart's own
// Subtasks tab, and task creation).
export function SubtaskDepartmentPicker({
  works,
  value,
  onChange,
  editable,
  compact,
}: {
  works: WorkOption[];
  value: string | null;
  onChange: (workId: string | null) => void;
  editable: boolean;
  // Tighter padding/type + no top margin, and the expanded list floats
  // over the layout instead of pushing it — for the two-column subtask row
  // (SubtaskListEditor), which sits the picker beside its text field rather
  // than stacked below it. CreateTaskSheet's own standalone usage (stacked
  // under a full-width TextInput, plenty of room) stays at the default.
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (works.length === 0) return null;
  const selected = works.find((w) => w.id === value);

  return (
    <View
      className={compact ? undefined : 'mt-1.5'}
      style={compact ? { position: 'relative', zIndex: open ? 10 : undefined, elevation: open ? 10 : undefined } : undefined}
    >
      <Pressable
        onPress={() => editable && setOpen((v) => !v)}
        className={`flex-row items-center justify-between border border-neutral-200 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}
      >
        <Text className={compact ? 'text-2xs text-neutral-900 flex-1' : 'text-xs text-neutral-900'} numberOfLines={1}>
          {selected ? selected.name : 'No department'}
        </Text>
        {editable && <Text className="text-2xs text-neutral-400">{open ? '▲' : '▼'}</Text>}
      </Pressable>
      {editable && open && (
        <View
          className="mt-1 border border-neutral-100 rounded-lg overflow-hidden bg-white"
          style={compact ? { position: 'absolute', top: '100%', left: 0, right: 0 } : undefined}
        >
          <Pressable
            onPress={() => { onChange(null); setOpen(false); }}
            className="px-2.5 py-2 border-b border-neutral-50"
            style={{ backgroundColor: value == null ? '#0F1F33' : undefined }}
          >
            <Text className={`text-xs font-medium ${value == null ? 'text-white' : 'text-neutral-600'}`}>No department</Text>
          </Pressable>
          {works.map((w, index) => {
            const active = value === w.id;
            return (
              <Pressable
                key={w.id}
                onPress={() => { onChange(w.id); setOpen(false); }}
                className={`px-2.5 py-2 ${active ? 'bg-brand-navy' : ''} ${index < works.length - 1 ? 'border-b border-neutral-50' : ''}`}
              >
                <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{w.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
