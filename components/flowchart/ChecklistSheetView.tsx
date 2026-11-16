import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { Text } from '../ui/AppText';
import {
  CHECKLIST_NOTE_FIELDS,
  CONTRACTOR_KEYS,
  contractorFor,
  SHEET_FIELD_ORDER,
  EMPTY_CHECKLIST_NOTES,
  fetchChecklistNotesForTasks,
  saveChecklistNoteField,
  type ChecklistNoteKey,
  type ChecklistNotes,
} from '../../lib/flowchart/checklistNotes';
import { sheetStatus, type SheetStatusTask } from '../../lib/flowchart/sheetStatus';
import { formatCardDateRange } from '../../lib/flowchart/delay';

// Flowchart 2 "Sheet View" (2026-11-15): a Google-Sheets-style table —
// Task name, Department, then the 7 client checklist points. Each cell is
// typed straight in and autosaved (0.8s after typing stops, or when the
// cell is left). Rows follow the flowchart's filter.

const ROW_NO_W = 40;
const ID_W = 80;
const NAME_W = 240;
const DEPT_W = 130;
const DONE_PLAN_W = 150;
const DONE_W = 230;
const OPEN_W = 170;
const FIELD_W = 180;
const BORDER = '#E2E8F0';
const SAVE_DELAY_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type SheetGroup = 'Delayed' | 'Upcoming' | 'Completed';
const SHEET_GROUPS: SheetGroup[] = ['Delayed', 'Upcoming', 'Completed'];
const GROUP_COLORS: Record<SheetGroup, string> = { Delayed: '#DC2626', Upcoming: '#94A3B8', Completed: '#0F1F33' };

// Red when the delay line has real late days.
const isLate = (delay: string) => /\d+d (late|delay|past)|Total: [1-9]/.test(delay);

// Sheet column order (2026-11-15): Contractor delay before Other dependencies,
// which is the last column. The card checklist keeps its own order.
const SHEET_FIELDS = SHEET_FIELD_ORDER.map((k) => CHECKLIST_NOTE_FIELDS.find((f) => f.key === k)!);

export function ChecklistSheetView({
  tasks,
  editable,
  userId,
}: {
  tasks: ({ id: string; taskId: string; taskName: string; workName: string } & SheetStatusTask)[];
  editable: boolean;
  userId: string | null;
}) {
  const [notes, setNotes] = useState<Map<string, ChecklistNotes>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => Promise<void>>());
  const idsKey = tasks.map((t) => t.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChecklistNotesForTasks(idsKey ? idsKey.split(',') : [])
      .then((m) => {
        if (cancelled) return;
        setNotes(m);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  // Save anything still waiting when the sheet closes.
  useEffect(() => {
    const t = timers.current;
    const p = pending.current;
    return () => {
      t.forEach(clearTimeout);
      p.forEach((run) => void run().catch(() => {}));
    };
  }, []);

  function runSave(cell: string) {
    const run = pending.current.get(cell);
    timers.current.delete(cell);
    pending.current.delete(cell);
    if (!run) return;
    setSaveState('saving');
    run()
      .then(() => setSaveState(pending.current.size === 0 ? 'saved' : 'saving'))
      .catch(() => setSaveState('error'));
  }

  function onCellChange(taskId: string, key: ChecklistNoteKey, value: string) {
    setNotes((m) => {
      const next = new Map(m);
      next.set(taskId, { ...(m.get(taskId) ?? EMPTY_CHECKLIST_NOTES), [key]: value });
      return next;
    });
    const cell = `${taskId}:${key}`;
    pending.current.set(cell, () => saveChecklistNoteField(taskId, key, value, userId));
    const old = timers.current.get(cell);
    if (old) clearTimeout(old);
    timers.current.set(cell, setTimeout(() => runSave(cell), SAVE_DELAY_MS));
    setSaveState('saving');
  }

  function onCellBlur(taskId: string, key: ChecklistNoteKey) {
    const cell = `${taskId}:${key}`;
    const t = timers.current.get(cell);
    if (t) clearTimeout(t);
    runSave(cell);
  }

  const headerCell = (label: string, width: number, color?: string) => (
    <View key={label} style={{ width, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center' }}>
      <Text numberOfLines={2} style={{ fontSize: 12, fontWeight: '700', color: color ?? '#334155' }}>
        {label}
      </Text>
    </View>
  );
  // One department in view (e.g. filtered to Electrical) → "ELECTRICAL CONTRACTOR";
  // a mix → each row's contractor follows its Department column.
  const depts = [...new Set(tasks.map((t) => t.workName))];
  const contractorHeading = depts.length === 1 ? contractorFor(depts[0]).toUpperCase() : 'CONTRACTOR (BY DEPARTMENT)';
  const totalWidth = ROW_NO_W + ID_W + NAME_W + DEPT_W + DONE_PLAN_W + DONE_W + OPEN_W + FIELD_W * CHECKLIST_NOTE_FIELDS.length;
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  // Rows grouped Delayed → Upcoming → Completed, each group under its own heading.
  const groupOf = (t: (typeof tasks)[number]): SheetGroup => (t.actualEndDate ? 'Completed' : sheetStatus(t, today).open?.delay ? 'Delayed' : 'Upcoming');
  let rowNo = 0;
  const orderedRows: ({ group: SheetGroup; count: number } | { t: (typeof tasks)[number]; i: number })[] = SHEET_GROUPS.flatMap((g) => {
    const list = tasks.filter((t) => groupOf(t) === g);
    return list.length ? [{ group: g, count: list.length }, ...list.map((t) => ({ t, i: rowNo++ }))] : [];
  });

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  const saveText =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved, check connection' : '';

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center px-3 py-1.5 border-b" style={{ borderColor: BORDER }}>
        <Text className="flex-1 text-xs text-neutral-500">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {editable ? ' · type in any cell, it saves by itself' : ' · view only'}
        </Text>
        <Text
          testID="sheet-save-state"
          className="text-xs font-semibold"
          style={{ color: saveState === 'error' ? '#B91C1C' : saveState === 'saving' ? '#B45309' : '#15803D' }}
        >
          {saveText}
        </Text>
      </View>
      {loadError ? <Text className="text-xs text-red-600 px-3 py-2">{loadError}</Text> : null}
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: totalWidth }}>
        <View style={{ width: totalWidth, flex: 1 }}>
          {/* Group heading row: "Contractor" over Procurement delay + Workers delay */}
          <View className="flex-row" style={{ backgroundColor: '#F1F5F9', borderTopWidth: 1, borderColor: BORDER }}>
            <View style={{ width: ROW_NO_W + ID_W + NAME_W + DEPT_W + DONE_PLAN_W + DONE_W + OPEN_W, borderRightWidth: 1, borderColor: BORDER }} />
            {SHEET_FIELDS.map((f, i) => {
              if (!CONTRACTOR_KEYS.includes(f.key)) {
                return <View key={f.key} style={{ width: FIELD_W, borderRightWidth: 1, borderColor: BORDER }} />;
              }
              if (i > 0 && CONTRACTOR_KEYS.includes(SHEET_FIELDS[i - 1].key)) return null;
              return (
                <View key="contractor" style={{ width: FIELD_W * CONTRACTOR_KEYS.length, borderRightWidth: 1, borderBottomWidth: 1, borderColor: BORDER, backgroundColor: '#FEF5E4', paddingVertical: 5, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#412402', letterSpacing: 0.5 }}>{contractorHeading}</Text>
                </View>
              );
            })}
          </View>
          <View className="flex-row" style={{ backgroundColor: '#F1F5F9', borderBottomWidth: 1, borderColor: BORDER }}>
            {headerCell('#', ROW_NO_W)}
            {headerCell('Task ID', ID_W)}
            {headerCell('Task name', NAME_W)}
            {headerCell('Department', DEPT_W)}
            {headerCell('Completed — planned dates', DONE_PLAN_W)}
            {headerCell('Completed — actual dates & delay', DONE_W)}
            {headerCell('Not completed — status & delay', OPEN_W)}
            {SHEET_FIELDS.map((f) => headerCell(f.label, FIELD_W, f.color))}
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {orderedRows.map((item) => {
              if ('group' in item) {
                // Group heading: Delayed → Upcoming → Completed (same three groups as Reports).
                return (
                  <View key={`group-${item.group}`} className="flex-row items-center" style={{ gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderColor: BORDER }}>
                    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: GROUP_COLORS[item.group] }} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }}>{item.group}</Text>
                    <Text style={{ fontSize: 12, color: '#64748B' }}>{item.count} task{item.count === 1 ? '' : 's'}</Text>
                  </View>
                );
              }
              const { t, i } = item;
              const n = notes.get(t.id) ?? EMPTY_CHECKLIST_NOTES;
              const st = sheetStatus(t, today);
              return (
                <View key={t.id} testID={`sheet-row-${i + 1}`} className="flex-row" style={{ borderBottomWidth: 1, borderColor: BORDER, minHeight: 40 }}>
                  <View style={{ width: ROW_NO_W, borderRightWidth: 1, borderColor: BORDER, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, color: '#64748B' }}>{i + 1}</Text>
                  </View>
                  <View style={{ width: ID_W, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F172A' }}>{t.taskId}</Text>
                  </View>
                  {/* No reason written in any of the 7 columns → task name lightly highlighted (2026-11-16). */}
                  <View style={{ width: NAME_W, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center', backgroundColor: CHECKLIST_NOTE_FIELDS.some((f) => n[f.key]?.trim()) ? undefined : '#FEF3C7' }}>
                    <Text style={{ fontSize: 12, color: '#0F172A' }}>{t.taskName}</Text>
                  </View>
                  <View style={{ width: DEPT_W, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, color: '#475569' }}>{t.workName}</Text>
                  </View>
                  {[
                    { cell: st.completed ? { dates: formatCardDateRange(t.plannedStartDate, t.dueDate), delay: null } : null, width: DONE_PLAN_W },
                    { cell: st.completed, width: DONE_W },
                    { cell: st.open, width: OPEN_W },
                  ].map(({ cell, width }, k) => (
                    <View key={k} style={{ width, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' }}>
                      {cell ? (
                        <>
                          {'status' in cell && cell.status ? (
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F1F33' }}>{cell.status}</Text>
                          ) : null}
                          <Text style={{ fontSize: 12, color: '#0F172A' }}>{cell.dates}</Text>
                          {cell.delay ? (
                            <Text style={{ fontSize: 11, fontWeight: '600', color: isLate(cell.delay) ? '#B91C1C' : '#64748B' }}>{cell.delay}</Text>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                  ))}
                  {SHEET_FIELDS.map((f) => (
                    <View key={f.key} style={{ width: FIELD_W, borderRightWidth: 1, borderColor: BORDER }}>
                      <TextInput
                        testID={`sheet-cell-${i + 1}-${f.key}`}
                        value={n[f.key]}
                        editable={editable}
                        multiline
                        // Contractor cells show whose they are, e.g. "Civil contractor".
                        placeholder={CONTRACTOR_KEYS.includes(f.key) ? contractorFor(t.workName) : undefined}
                        placeholderTextColor="#CBD5E1"
                        onChangeText={(v) => onCellChange(t.id, f.key, v)}
                        onBlur={() => onCellBlur(t.id, f.key)}
                        style={{ flex: 1, minHeight: 40, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, color: '#0F172A' }}
                      />
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}
