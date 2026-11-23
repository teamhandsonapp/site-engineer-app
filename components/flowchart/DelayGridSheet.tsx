import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Platform, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, TextInput } from '../ui/AppText';
import { FormModal, useBackdropGuard } from '../ui/FormModal';
import { EMPTY_CHECKLIST_NOTES, fieldDays, parseDays, splitPoints, type ChecklistNotes } from '../../lib/flowchart/checklistNotes';
import { enteredDays, stageMatchText, type ExpectedDelay } from '../../lib/flowchart/delayMatch';
import {
  CARRIED_CELL_ID,
  cellDays,
  cleanGrid,
  cleanGridNotes,
  DELAY_GRID_TABLES,
  gridCellId,
  gridTotal,
  MAX_GRID_ROWS,
  rowCellId,
  tableRows,
  type DelayGrid,
  type DelayGridNotes,
  type DelayGridTable,
} from '../../lib/flowchart/delayGrid';

type Stage = 'pre' | 'con';
type Cells = Record<string, string>;
const STAGE_LABEL: Record<Stage, string> = { pre: 'Pre-construction', con: 'Construction' };

const toCells = (grid: DelayGrid | undefined): Cells => Object.fromEntries(Object.entries(grid ?? {}).map(([k, v]) => [k, String(v)]));
const toGrid = (cells: Cells): DelayGrid =>
  cleanGrid(Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, parseDays(v) ?? 0]))) ?? {};
const sameGrid = (a: DelayGrid | DelayGridNotes, b: DelayGrid | DelayGridNotes) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// Reasons for delay as small tables (2026-11-23, client): opened from the
// card's checklist icon, straight in edit mode — no Edit → Checklist tab.
// One table per party (Contractor, Drawings), one column per cause, days in
// the cells; the same tables for Pre-construction and Construction.
// Only the Past Tasks Copy L (−4'6") cards for now (lib/flowchart/delayGrid.ts).
export function DelayGridSheet({
  visible,
  taskCode,
  taskName,
  notes,
  constructionNotes,
  editable,
  expected = null,
  onSave,
  onClose,
}: {
  /** The task's delay per stage from its dates (null = not finished yet): the days entered should add up to it. */
  expected?: ExpectedDelay | null;
  visible: boolean;
  taskCode: string;
  taskName: string;
  notes: ChecklistNotes | null;
  constructionNotes: ChecklistNotes | null;
  editable: boolean;
  /** Days and the reason written per cell (2026-11-23), per stage. */
  onSave: (pre: DelayGrid, con: DelayGrid, preNotes: DelayGridNotes, conNotes: DelayGridNotes) => Promise<void>;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('pre');
  const [cells, setCells] = useState<Record<Stage, Cells>>({ pre: {}, con: {} });
  // The reason written under each cell's days (2026-11-23, client).
  const [why, setWhy] = useState<Record<Stage, Cells>>({ pre: {}, con: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Save with days that don't add up to the delay: the first tap warns, the second saves.
  const [warned, setWarned] = useState(false);
  // Rows per table, per stage — more than one delay per cause (2026-11-23, client).
  const [rows, setRows] = useState<Record<Stage, Record<string, number>>>({ pre: {}, con: {} });

  // Movable pop-up (2026-11-23, client): drag it by the title row so the card
  // behind it can be seen. Starts centred again each time it opens.
  const drag = useRef(new Animated.ValueXY()).current;
  // Web: plain pointer events (PanResponder never got the mouse here — the
  // card's outer Pressable took the press first). Mouse, pen and touch.
  const dragAt = useRef({ x: 0, y: 0 });
  const startWebDrag = (e: { clientX: number; clientY: number; button?: number; target: unknown; preventDefault: () => void }) => {
    if (e.button) return; // left button / touch only
    if ((e.target as HTMLElement | null)?.closest?.('[aria-label="Close"]')) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = { ...dragAt.current };
    const move = (ev: PointerEvent) => {
      dragAt.current = { x: base.x + ev.clientX - sx, y: base.y + ev.clientY - sy };
      drag.setValue(dragAt.current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // Phone / tablet app.
  const dragPan = useRef(
    PanResponder.create({
      // The close button sits inside the title row and takes its own taps first.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 3,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 3,
      onPanResponderGrant: () => drag.extractOffset(),
      onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => drag.flattenOffset(),
      onPanResponderTerminate: () => drag.flattenOffset(),
      // Keep the drag even if the pop-up's scroll view wants the move.
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const initial = useMemo(
    () => ({
      pre: notes?.delayGrid ?? {},
      con: constructionNotes?.delayGrid ?? {},
      preNotes: notes?.delayGridNotes ?? {},
      conNotes: constructionNotes?.delayGridNotes ?? {},
    }),
    [notes, constructionNotes]
  );
  useEffect(() => {
    if (!visible) return;
    // "Delay from task above" filled in for you when the task above made this one start late.
    const pre = toCells(initial.pre);
    if (!pre[CARRIED_CELL_ID] && expected?.fromAbove) pre[CARRIED_CELL_ID] = String(expected.fromAbove);
    setCells({ pre, con: toCells(initial.con) });
    setWhy({ pre: { ...initial.preNotes }, con: { ...initial.conNotes } });
    setRows({
      pre: Object.fromEntries(DELAY_GRID_TABLES.map((t) => [t.key, tableRows(t, initial.pre, initial.preNotes)])),
      con: Object.fromEntries(DELAY_GRID_TABLES.map((t) => [t.key, tableRows(t, initial.con, initial.conNotes)])),
    });
    setStage(!gridTotal(initial.pre) && gridTotal(initial.con) ? 'con' : 'pre');
    setError(null);
    setWarned(false);
    drag.setOffset({ x: 0, y: 0 });
    drag.setValue({ x: 0, y: 0 });
    dragAt.current = { x: 0, y: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, taskCode]);

  const grids = { pre: toGrid(cells.pre), con: toGrid(cells.con) };
  const whyNotes = { pre: cleanGridNotes(why.pre) ?? {}, con: cleanGridNotes(why.con) ?? {} };
  const dirty =
    !sameGrid(grids.pre, initial.pre) ||
    !sameGrid(grids.con, initial.con) ||
    !sameGrid(whyNotes.pre, initial.preNotes) ||
    !sameGrid(whyNotes.con, initial.conNotes);
  const guardedClose = useBackdropGuard(visible, onClose);
  const stageNotes = stage === 'pre' ? notes : constructionNotes;
  // Days given per stage as the reports count them (table + checklist), live while typing.
  const entered = {
    pre: enteredDays({ ...(notes ?? EMPTY_CHECKLIST_NOTES), delayGrid: grids.pre }),
    con: enteredDays({ ...(constructionNotes ?? EMPTY_CHECKLIST_NOTES), delayGrid: grids.con }),
  };
  const stageMatch = (s: Stage) => !expected || entered[s] === expected[s];
  const allMatch = stageMatch('pre') && stageMatch('con');

  async function save() {
    if (!allMatch && !warned) {
      setWarned(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(grids.pre, grids.con, whyNotes.pre, whyNotes.con);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  const setCell = (id: string, text: string) => {
    setWarned(false);
    setCells((prev) => ({ ...prev, [stage]: { ...prev[stage], [id]: text.replace(/[^0-9]/g, '').slice(0, 4) } }));
  };
  const rowCount = (table: DelayGridTable) => rows[stage][table.key] ?? 1;
  const addRow = (table: DelayGridTable) =>
    setRows((prev) => ({ ...prev, [stage]: { ...prev[stage], [table.key]: Math.min(rowCount(table) + 1, MAX_GRID_ROWS) } }));
  // Remove row r: the rows under it move up one, like deleting a row in Excel.
  const removeRow = (table: DelayGridTable, r: number) => {
    const n = rowCount(table);
    const shift = (m: Cells): Cells => {
      const out = { ...m };
      for (const c of table.columns) {
        const id = gridCellId(table, c);
        for (let i = r; i < n; i++) {
          const below = out[rowCellId(id, i + 1)];
          if (below === undefined) delete out[rowCellId(id, i)];
          else out[rowCellId(id, i)] = below;
        }
        delete out[rowCellId(id, n)];
      }
      return out;
    };
    setWarned(false);
    setCells((prev) => ({ ...prev, [stage]: shift(prev[stage]) }));
    setWhy((prev) => ({ ...prev, [stage]: shift(prev[stage]) }));
    setRows((prev) => ({ ...prev, [stage]: { ...prev[stage], [table.key]: Math.max(1, n - 1) } }));
  };
  // Days already written in the checklist text for the same cause, shown grey.
  let hasHint = false;

  return (
    // While something is typed, a tap outside doesn't throw it away.
    <FormModal visible={visible} onRequestClose={onClose} onBackdropPress={dirty ? () => {} : guardedClose}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 520 }}>
        <Animated.View style={{ transform: drag.getTranslateTransform() }}>
          <View testID="delay-grid-sheet" className="bg-white rounded-2xl p-4">
            <View
              {...(Platform.OS === 'web' ? ({ onPointerDown: startWebDrag } as object) : dragPan.panHandlers)}
              testID="delay-grid-drag"
              className="flex-row items-start gap-2 mb-3"
              // Web: show the move cursor, don't select the title text, and don't let touch scroll the page while dragging.
              style={Platform.OS === 'web' ? ({ cursor: 'move', userSelect: 'none', touchAction: 'none' } as object) : undefined}
            >
              <Ionicons name="move" size={16} color="#9CA3AF" style={{ marginTop: 2 }} />
              <View className="flex-1">
                <Text className="text-md font-bold text-neutral-900">Reasons for delay</Text>
                <Text className="text-xs text-neutral-500 mt-0.5" numberOfLines={2}>
                  {taskCode} · {taskName}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#9CA3AF" />
              </Pressable>
            </View>

            <View className="flex-row rounded-xl p-1 mb-3" style={{ backgroundColor: '#F1F3F6' }}>
              {(['pre', 'con'] as Stage[]).map((s) => {
                const on = stage === s;
                const total = gridTotal(grids[s]);
                return (
                  <Pressable
                    key={s}
                    testID={`delay-grid-stage-${s}`}
                    onPress={() => setStage(s)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    className="flex-1 items-center justify-center rounded-lg"
                    style={{ minHeight: 34, backgroundColor: on ? '#fff' : 'transparent' }}
                  >
                    <Text className="text-2xs font-bold" style={{ color: on ? '#0F1F33' : '#9CA3AF' }}>
                      {STAGE_LABEL[s]}
                      {total ? ` · ${total}d` : ''}
                      {expected ? (stageMatch(s) ? ' ✓' : ' ⚠') : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {expected ? (
              <View
                testID="delay-grid-match"
                className="flex-row items-center gap-2 rounded-xl px-3 py-2 mb-3"
                style={{ backgroundColor: stageMatch(stage) ? '#DCFCE7' : '#FEE2E2' }}
              >
                <Ionicons name={stageMatch(stage) ? 'checkmark-circle' : 'alert-circle'} size={18} color={stageMatch(stage) ? '#15803D' : '#B91C1C'} />
                <View className="flex-1">
                  <Text className="text-xs font-bold" style={{ color: stageMatch(stage) ? '#15803D' : '#B91C1C' }}>
                    Card shows {expected[stage]}d · entered {entered[stage]}d{stageMatch(stage) ? ' ✓' : ` (${stageMatchText(entered[stage], expected[stage])})`}
                  </Text>
                  {stage === 'pre' && expected.fromAbove ? (
                    <Text className="text-2xs text-neutral-500">{expected.fromAbove}d came from {expected.aboveCode} above</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {DELAY_GRID_TABLES.filter((t) => stage === 'pre' || !t.preOnly).map((table) => {
              const tableTotal = table.columns.reduce((a, c) => a + cellDays(grids[stage], gridCellId(table, c)), 0);
              // Excel-style rows (2026-11-23, client): more than one delay per cause.
              // Not for "Delay from task above" — that is one number from the dates.
              const multi = !table.columns.some((c) => c.carried);
              const n = multi ? rowCount(table) : 1;
              const GUTTER = 28;
              return (
                <View key={table.key} className="mb-3" style={{ borderWidth: 1, borderColor: '#D4D8DE', borderRadius: 10, overflow: 'hidden' }}>
                  <View className="flex-row items-center justify-between px-3 py-1.5" style={{ backgroundColor: '#0F1F33' }}>
                    <Text className="text-xs font-bold text-white">{table.title}</Text>
                    {tableTotal ? <Text className="text-2xs font-bold" style={{ color: '#FCD34D' }}>{tableTotal} days</Text> : null}
                  </View>
                  {/* Header row: one column per cause. */}
                  <View className="flex-row">
                    {multi ? <View style={{ width: GUTTER, backgroundColor: '#F3F4F6', borderBottomWidth: 1, borderColor: '#E5E7EB' }} /> : null}
                    {table.columns.map((c, i) => (
                      <View key={c.key} style={{ flex: 1, minWidth: 0, borderLeftWidth: i || multi ? 1 : 0, borderColor: '#E5E7EB' }}>
                        <View style={{ height: 3, backgroundColor: c.color }} />
                        <View className="items-center justify-center px-1 py-1.5" style={{ minHeight: 42, backgroundColor: '#F3F4F6', borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#374151', textAlign: 'center' }} numberOfLines={2}>
                            {c.label}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  {/* One row per delay: days, and the reason under it. */}
                  {Array.from({ length: n }, (_, k) => k + 1).map((r) => (
                    <View key={r} className="flex-row" style={{ borderTopWidth: r > 1 ? 1 : 0, borderColor: '#D4D8DE' }}>
                      {multi ? (
                        <View className="items-center justify-center gap-1" style={{ width: GUTTER, backgroundColor: '#F9FAFB' }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#9CA3AF' }}>{r}</Text>
                          {editable && n > 1 ? (
                            <Pressable
                              testID={`delay-grid-remove-${table.key}-${r}`}
                              onPress={() => removeRow(table, r)}
                              hitSlop={6}
                              accessibilityLabel={`Remove row ${r} of ${table.title}`}
                            >
                              <Ionicons name="close-circle" size={16} color="#D1D5DB" />
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                      {table.columns.map((c, i) => {
                        const id = rowCellId(gridCellId(table, c), r);
                        // Grey hints from the checklist only on the first row.
                        const hint = r === 1 && c.field ? fieldDays(stageNotes ?? undefined, c.field) : null;
                        if (hint && !cells[stage][id]) hasHint = true;
                        return (
                          <View key={id} style={{ flex: 1, minWidth: 0, borderLeftWidth: i || multi ? 1 : 0, borderColor: '#E5E7EB' }}>
                            <TextInput
                              testID={`delay-grid-cell-${id}`}
                              value={cells[stage][id] ?? ''}
                              onChangeText={(t) => setCell(id, t)}
                              editable={editable && !saving}
                              keyboardType="number-pad"
                              maxLength={4}
                              placeholder={hint ? String(hint) : '–'}
                              placeholderTextColor="#B6BCC6"
                              accessibilityLabel={`${table.title} — ${c.label}, row ${r}, days`}
                              style={{ height: 46, textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#B91C1C' }}
                            />
                            {c.carried ? null : (
                              <TextInput
                                testID={`delay-grid-reason-${id}`}
                                value={why[stage][id] ?? ''}
                                onChangeText={(t) => setWhy((prev) => ({ ...prev, [stage]: { ...prev[stage], [id]: t.slice(0, 300) } }))}
                                editable={editable && !saving}
                                multiline
                                // Grey: what is already written in the checklist for the same point.
                                placeholder={(r === 1 && c.field ? splitPoints(stageNotes?.[c.field])[0] : null) ?? 'Reason'}
                                placeholderTextColor="#B6BCC6"
                                accessibilityLabel={`${table.title} — ${c.label}, row ${r}, reason`}
                                style={{ minHeight: 40, paddingHorizontal: 6, paddingVertical: 6, fontSize: 12, color: '#0F1F33', textAlign: 'center', borderTopWidth: 1, borderColor: '#EEF0F3' }}
                              />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                  {multi && editable && n < MAX_GRID_ROWS ? (
                    <Pressable
                      testID={`delay-grid-add-${table.key}`}
                      onPress={() => addRow(table)}
                      disabled={saving}
                      className="flex-row items-center justify-center gap-1 py-2"
                      style={{ borderTopWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' }}
                      accessibilityLabel={`Add a row to ${table.title}`}
                    >
                      <Ionicons name="add" size={16} color="#0F1F33" />
                      <Text className="text-xs font-semibold" style={{ color: '#0F1F33' }}>
                        Add row
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            <Text className="text-2xs text-neutral-500 mb-3">
              Days of delay in each cell, and the reason under it. More than one delay for the same cause? Tap Add row{hasHint ? '. Grey numbers are days already written in the checklist — type a number to replace them.' : '.'}
            </Text>

            {warned && !allMatch ? (
              <Text className="text-xs font-semibold mb-2" style={{ color: '#B91C1C' }}>
                The days given don&apos;t add up to the delay
                {expected ? ` on the card (Pre-construction ${expected.pre}d, Construction ${expected.con}d)` : ''}. Tap Save anyway to keep them.
              </Text>
            ) : null}
            {error && <Text className="text-xs text-red-600 mb-2">{error}</Text>}

            {editable ? (
              <View className="flex-row gap-2">
                <Pressable onPress={onClose} className="flex-1 items-center justify-center rounded-xl bg-neutral-100" style={{ minHeight: 44 }}>
                  <Text className="text-sm font-semibold text-neutral-600">Cancel</Text>
                </Pressable>
                <Pressable
                  testID="delay-grid-save"
                  onPress={save}
                  disabled={!dirty || saving}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand-navy"
                  style={{ minHeight: 44, opacity: !dirty || saving ? 0.4 : 1 }}
                >
                  {saving && <ActivityIndicator color="#fff" size="small" />}
                  <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : warned && !allMatch ? 'Save anyway' : 'Save'}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={onClose} className="items-center justify-center rounded-xl bg-neutral-100" style={{ minHeight: 44 }}>
                <Text className="text-sm font-semibold text-neutral-600">Close</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </Pressable>
    </FormModal>
  );
}
