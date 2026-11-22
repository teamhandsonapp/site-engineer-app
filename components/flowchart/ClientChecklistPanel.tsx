import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from '../ui/AppText';
import {
  CHECKLIST_NOTE_FIELDS,
  CHECKLIST_STAGE_LABEL,
  EMPTY_CHECKLIST_NOTES,
  fetchChecklistNotes,
  isMissingTableError,
  joinPoints,
  parseDays,
  saveChecklistNotes,
  splitPoints,
  STAGED_NOTE_FIELDS,
  type ChecklistNoteKey,
  type ChecklistNotes,
  type ChecklistStage,
  type DelayDays,
} from '../../lib/flowchart/checklistNotes';

// Days box next to a delay (2026-11-22, client): whole days, saved with the delay.
function DaysInput({ value, onChange, testID, label }: { value: number | null | undefined; onChange: (d: number | null) => void; testID: string; label: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if (parseDays(text) !== (value ?? null)) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <View className="flex-row items-center rounded-md" style={{ backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA', paddingHorizontal: 6, height: 32 }}>
      <TextInput
        testID={testID}
        value={text}
        onChangeText={(t) => {
          const clean = t.replace(/[^0-9]/g, '').slice(0, 4);
          setText(clean);
          onChange(parseDays(clean));
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        placeholder="0"
        placeholderTextColor="#D6A77A"
        accessibilityLabel={label}
        className="text-sm text-neutral-900"
        style={{ width: 40, textAlign: 'center', paddingVertical: 0 }}
      />
      <Text className="text-2xs font-semibold ml-1" style={{ color: '#C2410C' }}>days</Text>
    </View>
  );
}
const daysLabel = (d: number | null | undefined) => (d ? `${d} day${d === 1 ? '' : 's'}` : '');


// Task sheet "Checklist" tab (Flowchart 2): the client's checklist points
// for this task — what they wrote on the checklist sheet ("On hold",
// "Shop dwgs", "Roof erection", ...). Staff can edit and save; others read.
// `stages` (Past Tasks, 2026-11-21): two tabs, Pre-construction and
// Construction, each with its own delays, saved and reported separately.
export function ClientChecklistPanel({
  taskId,
  editable,
  userId,
  stages = false,
  preStage = 'preConstruction',
}: {
  taskId: string;
  editable: boolean;
  userId: string | null;
  stages?: boolean;
  // Past Works copy of a Current Status task: 'copyPreConstruction' (its own Pre-construction).
  preStage?: ChecklistStage;
}) {
  const STAGES: ChecklistStage[] = [preStage, 'construction'];
  const [stage, setStage] = useState<ChecklistStage>(preStage);
  if (!stages) return <ChecklistStagePanel taskId={taskId} editable={editable} userId={userId} stage="preConstruction" />;
  return (
    <View>
      <View className="flex-row rounded-xl p-1 mb-3" style={{ backgroundColor: '#F1F3F6' }}>
        {STAGES.map((s) => {
          const on = stage === s;
          return (
            <Pressable
              key={s}
              testID={`client-checklist-stage-${s}`}
              onPress={() => setStage(s)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              className="flex-1 items-center justify-center rounded-lg"
              style={{ minHeight: 34, backgroundColor: on ? '#fff' : 'transparent' }}
            >
              <Text className="text-xs font-bold" style={{ color: on ? '#0F1F33' : '#9CA3AF' }}>
                {CHECKLIST_STAGE_LABEL[s]} delays
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Both stay mounted, so typing in one tab isn't lost when switching to the other. */}
      {STAGES.map((s) => (
        <View key={s} style={{ display: stage === s ? 'flex' : 'none' }}>
          <ChecklistPointsPanel taskId={taskId} editable={editable} userId={userId} stage={s} />
        </View>
      ))}
    </View>
  );
}

function ChecklistStagePanel({
  taskId,
  editable,
  userId,
  stage,
  fields = CHECKLIST_NOTE_FIELDS,
}: {
  taskId: string;
  editable: boolean;
  userId: string | null;
  stage: ChecklistStage;
  // Past Tasks tabs add Equipment delays (STAGED_NOTE_FIELDS).
  fields?: typeof CHECKLIST_NOTE_FIELDS;
}) {
  const [notes, setNotes] = useState<ChecklistNotes>(EMPTY_CHECKLIST_NOTES);
  const [saved, setSaved] = useState<ChecklistNotes>(EMPTY_CHECKLIST_NOTES);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  // The Construction table's migration hasn't been run on this database yet.
  const [notSetUp, setNotSetUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setNotSetUp(false);
    fetchChecklistNotes(taskId, stage)
      .then((n) => {
        if (cancelled) return;
        const value = n ? { ...EMPTY_CHECKLIST_NOTES, ...n } : EMPTY_CHECKLIST_NOTES;
        setNotes(value);
        setSaved(value);
        setUpdatedAt(n?.updatedAt ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (stage !== 'preConstruction' && isMissingTableError(err)) setNotSetUp(true);
        else setMessage({ text: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err), isError: true });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId, stage]);

  const dayOf = (n: ChecklistNotes, key: ChecklistNoteKey) => n.delayDays?.[key]?.[0] ?? null;
  const dirty = fields.some((f) => notes[f.key].trim() !== saved[f.key].trim() || dayOf(notes, f.key) !== dayOf(saved, f.key));
  const setDays = (key: ChecklistNoteKey, d: number | null) => setNotes((n) => ({ ...n, delayDays: { ...n.delayDays, [key]: [d] } }));

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await saveChecklistNotes(taskId, notes, userId, stage);
      setSaved(notes);
      setUpdatedAt(new Date().toISOString());
      setMessage({ text: stage === 'construction' ? 'Construction delays saved' : 'Checklist saved', isError: false });
    } catch (err) {
      setMessage({ text: `Could not save: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`, isError: true });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  if (notSetUp) {
    return (
      <View className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
        <Text className="text-xs font-semibold text-amber-900">{CHECKLIST_STAGE_LABEL[stage]} delays aren&apos;t set up in the database yet.</Text>
        <Text className="text-2xs text-amber-800 mt-1">The database update for this tab hasn&apos;t been run yet.</Text>
      </View>
    );
  }

  return (
    <View testID={`client-checklist-panel${stage === 'construction' ? '-construction' : ''}`}>
      {fields.map((f) => {
        const value = notes[f.key];
        return (
          <View key={f.key} className="mb-2.5">
            <Text className="text-xs text-neutral-400 mb-1">{f.label}</Text>
            {editable ? (
              <View className="flex-row items-start gap-1.5">
                <TextInput
                  testID={`client-checklist-${stage === 'construction' ? 'construction-' : ''}${f.key}`}
                  value={value}
                  onChangeText={(t) => setNotes((n) => ({ ...n, [f.key]: t }))}
                  placeholder="Not given"
                  placeholderTextColor="#A3A3A3"
                  multiline
                  className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900"
                  style={{ minHeight: 40, textAlignVertical: 'top' }}
                />
                <View style={{ marginTop: 4 }}>
                  <DaysInput
                    testID={`client-checklist-${stage === 'construction' ? 'construction-' : ''}${f.key}-days`}
                    value={dayOf(notes, f.key)}
                    onChange={(d) => setDays(f.key, d)}
                    label={`Days of delay for ${f.label}`}
                  />
                </View>
              </View>
            ) : (
              <View className="flex-row items-start border border-neutral-100 bg-neutral-50 rounded-lg px-3 py-2">
                <Text className="flex-1 text-sm" style={{ color: value ? '#171717' : '#A3A3A3' }}>{value || 'Not given'}</Text>
                {dayOf(notes, f.key) ? <Text className="text-xs font-bold ml-2" style={{ color: '#C2410C' }}>{daysLabel(dayOf(notes, f.key))}</Text> : null}
              </View>
            )}
          </View>
        );
      })}

      {updatedAt ? (
        <Text className="text-2xs text-neutral-400 mb-2">
          Last updated {new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      ) : null}
      {message ? (
        <Text className="text-xs mb-2" style={{ color: message.isError ? '#DC2626' : '#15803D' }}>{message.text}</Text>
      ) : null}
      {editable ? (
        <Pressable
          testID={`client-checklist-save${stage === 'construction' ? '-construction' : ''}`}
          onPress={handleSave}
          disabled={saving || !dirty}
          className="self-end px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5"
          style={{ opacity: saving || !dirty ? 0.5 : 1 }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text className="text-xs font-semibold text-white">{stage === 'construction' ? 'Save Construction Delays' : 'Save Checklist'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type Points = Record<ChecklistNoteKey, string[]>;
const toPoints = (n: ChecklistNotes): Points =>
  Object.fromEntries(STAGED_NOTE_FIELDS.map((f) => [f.key, splitPoints(n[f.key])])) as Points;
// Points and their days are kept side by side; blank points (and their days) drop out on save.
const toNotes = (p: Points, days: DelayDays = {}): ChecklistNotes => {
  const out = { ...EMPTY_CHECKLIST_NOTES } as ChecklistNotes;
  const delayDays: DelayDays = {};
  for (const f of STAGED_NOTE_FIELDS) {
    const kept = (p[f.key] ?? []).map((text, i) => ({ text, d: days[f.key]?.[i] ?? null })).filter((x) => x.text.trim());
    out[f.key] = joinPoints(kept.map((x) => x.text));
    if (kept.some((x) => x.d)) delayDays[f.key] = kept.map((x) => x.d);
  }
  if (Object.keys(delayDays).length) out.delayDays = delayDays;
  return out;
};
const daysKey = (n: ChecklistNotes) => JSON.stringify(STAGED_NOTE_FIELDS.map((f) => n.delayDays?.[f.key] ?? []));
const sameNotes = (a: ChecklistNotes, b: ChecklistNotes) => STAGED_NOTE_FIELDS.every((f) => (a[f.key] ?? '') === (b[f.key] ?? '')) && daysKey(a) === daysKey(b);
const AUTOSAVE_MS = 900;

// Past Works stage tab (2026-11-21, client): each delay field is a list of
// points — "+ Add point", type, and it auto-saves a moment after typing
// stops; "Save Checklist" at the end saves (and confirms) everything.
// Points are stored one per line in the same column (see splitPoints).
function ChecklistPointsPanel({ taskId, editable, userId, stage }: { taskId: string; editable: boolean; userId: string | null; stage: ChecklistStage }) {
  const [points, setPoints] = useState<Points>(() => toPoints(EMPTY_CHECKLIST_NOTES));
  // Days per point, same index as `points` (2026-11-22).
  const [days, setDays] = useState<DelayDays>({});
  const [saved, setSaved] = useState<ChecklistNotes>(EMPTY_CHECKLIST_NOTES);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  // The point just added (or split off with Enter) gets the cursor.
  const [focus, setFocus] = useState<string | null>(null);

  const notes = toNotes(points, days);
  const dirty = !sameNotes(notes, saved);
  // Saves run one after another, so a slow save never lands after a newer one.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ notes, dirty, loaded: false });
  latest.current = { notes, dirty, loaded: !loading && !notSetUp };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setNotSetUp(false);
    fetchChecklistNotes(taskId, stage)
      .then((n) => {
        if (cancelled) return;
        const value = n ? { ...EMPTY_CHECKLIST_NOTES, ...n } : EMPTY_CHECKLIST_NOTES;
        setPoints(toPoints(value));
        setDays(value.delayDays ?? {});
        setSaved(toNotes(toPoints(value), value.delayDays ?? {}));
        setUpdatedAt(n?.updatedAt ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (stage !== 'preConstruction' && isMissingTableError(err)) setNotSetUp(true);
        else setMessage({ text: errText(err), isError: true });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId, stage]);

  function save(snapshot: ChecklistNotes, confirm: boolean): Promise<void> {
    chain.current = chain.current.then(async () => {
      setSaving(true);
      try {
        await saveChecklistNotes(taskId, snapshot, userId, stage);
        setSaved(snapshot);
        setUpdatedAt(new Date().toISOString());
        setMessage(confirm ? { text: stage === 'construction' ? 'Construction delays saved' : 'Checklist saved', isError: false } : null);
      } catch (err) {
        setMessage({ text: `Could not save: ${errText(err)}`, isError: true });
      } finally {
        setSaving(false);
      }
    });
    return chain.current;
  }

  // Auto-save a moment after typing stops.
  const notesKey = STAGED_NOTE_FIELDS.map((f) => notes[f.key]).join('\u0001') + daysKey(notes);
  useEffect(() => {
    if (!editable || loading || notSetUp || !dirty) return;
    const t = setTimeout(() => void save(notes, false), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, editable, loading, notSetUp]);

  // Closing the sheet right after typing: still save what was written.
  useEffect(
    () => () => {
      const l = latest.current;
      if (editable && l.loaded && l.dirty) void saveChecklistNotes(taskId, l.notes, userId, stage).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId, stage]
  );

  const setField = (key: ChecklistNoteKey, next: string[]) => setPoints((p) => ({ ...p, [key]: next }));
  const setDay = (key: ChecklistNoteKey, i: number, d: number | null) =>
    setDays((prev) => {
      const list = [...(prev[key] ?? [])];
      while (list.length <= i) list.push(null);
      list[i] = d;
      return { ...prev, [key]: list };
    });
  function changePoint(key: ChecklistNoteKey, i: number, text: string) {
    const list = [...(points[key] ?? [])];
    if (text.includes('\n')) {
      // Enter (or pasting several lines) starts the next point.
      const parts = text.split('\n');
      list.splice(i, 1, ...parts.map((p, j) => (j === 0 ? p : p.trimStart())));
      // New points start without days; later points keep theirs.
      setDays((prev) => {
        const dl = [...(prev[key] ?? [])];
        dl.splice(i + 1, 0, ...parts.slice(1).map(() => null));
        return { ...prev, [key]: dl };
      });
      setFocus(`${key}:${i + parts.length - 1}`);
    } else list[i] = text;
    setField(key, list);
  }
  function addPoint(key: ChecklistNoteKey) {
    const list = points[key] ?? [];
    setField(key, [...list, '']);
    setFocus(`${key}:${list.length}`);
  }
  function removePoint(key: ChecklistNoteKey, i: number) {
    setField(key, (points[key] ?? []).filter((_, j) => j !== i));
    setDays((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((_, j) => j !== i) }));
    setFocus(null);
  }

  if (loading) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }
  if (notSetUp) {
    return (
      <View className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
        <Text className="text-xs font-semibold text-amber-900">{CHECKLIST_STAGE_LABEL[stage]} delays aren&apos;t set up in the database yet.</Text>
        <Text className="text-2xs text-amber-800 mt-1">The database update for this tab hasn&apos;t been run yet.</Text>
      </View>
    );
  }

  const tid = stage === 'construction' ? 'construction-' : '';
  return (
    <View testID={`client-checklist-panel${stage === 'construction' ? '-construction' : ''}`}>
      {/* One compact list (2026-11-21): a row per field with "+ Add" on the right;
          points only appear under a field once there are some. */}
      <View className="rounded-xl border border-neutral-200 overflow-hidden mb-3">
        {STAGED_NOTE_FIELDS.map((f, fi) => {
          const list = points[f.key] ?? [];
          const count = list.filter((p) => p.trim()).length;
          return (
            <View key={f.key} className="px-3 py-2" style={{ borderTopWidth: fi ? 1 : 0, borderTopColor: '#F1F1F1', backgroundColor: count ? '#fff' : '#FCFCFC' }}>
              <View className="flex-row items-center gap-2" style={{ minHeight: 28 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: count ? f.color : '#D4D4D4' }} />
                <Text className="flex-1 text-xs" style={{ color: count ? '#171717' : '#737373', fontWeight: count ? '600' : '400' }} numberOfLines={1}>
                  {f.label}
                </Text>
                {count ? (
                  <View className="rounded-full px-1.5" style={{ backgroundColor: `${f.color}1A` }}>
                    <Text className="text-2xs font-bold" style={{ color: f.color }}>{count}</Text>
                  </View>
                ) : !editable ? (
                  <Text className="text-2xs" style={{ color: '#A3A3A3' }}>—</Text>
                ) : null}
                {editable ? (
                  <Pressable
                    testID={`client-checklist-${tid}${f.key}-add`}
                    onPress={() => addPoint(f.key)}
                    accessibilityLabel={`Add point to ${f.label}`}
                    hitSlop={6}
                    className="rounded-md px-2 py-1"
                    style={{ backgroundColor: '#EFF6FF' }}
                  >
                    <Text className="text-2xs font-semibold" style={{ color: '#2563EB' }}>+ Add</Text>
                  </Pressable>
                ) : null}
              </View>
              {list.map((p, i) =>
                editable ? (
                  <View key={i} className="flex-row items-center gap-1.5 mt-1.5" style={{ paddingLeft: 16 }}>
                    <Text className="text-2xs font-bold" style={{ color: f.color, width: 14 }}>{i + 1}.</Text>
                    <TextInput
                      testID={`client-checklist-${tid}${f.key}-${i}`}
                      value={p}
                      onChangeText={(t) => changePoint(f.key, i, t)}
                      autoFocus={focus === `${f.key}:${i}`}
                      placeholder="Type the delay…"
                      placeholderTextColor="#A3A3A3"
                      multiline
                      className="flex-1 rounded-md px-2.5 py-1.5 text-sm text-neutral-900"
                      style={{ minHeight: 32, textAlignVertical: 'top', backgroundColor: '#F5F5F5' }}
                    />
                    <DaysInput
                      testID={`client-checklist-${tid}${f.key}-${i}-days`}
                      value={days[f.key]?.[i] ?? null}
                      onChange={(d) => setDay(f.key, i, d)}
                      label={`Days of delay for point ${i + 1} of ${f.label}`}
                    />
                    <Pressable
                      testID={`client-checklist-${tid}${f.key}-${i}-remove`}
                      onPress={() => removePoint(f.key, i)}
                      accessibilityLabel={`Remove point ${i + 1}`}
                      hitSlop={8}
                      className="items-center justify-center"
                      style={{ width: 22, height: 28 }}
                    >
                      <Text className="text-sm" style={{ color: '#A3A3A3' }}>✕</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View key={i} className="flex-row items-start gap-1.5 mt-1" style={{ paddingLeft: 16 }}>
                    <Text className="text-2xs font-bold" style={{ color: f.color, width: 14, marginTop: 2 }}>{i + 1}.</Text>
                    <Text className="text-sm flex-1" style={{ color: '#171717' }}>{p}</Text>
                    {days[f.key]?.[i] ? <Text className="text-xs font-bold" style={{ color: '#C2410C', marginTop: 2 }}>{daysLabel(days[f.key]?.[i])}</Text> : null}
                  </View>
                )
              )}
            </View>
          );
        })}
      </View>

      {message ? (
        <Text className="text-xs mb-2" style={{ color: message.isError ? '#DC2626' : '#15803D' }}>{message.text}</Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-2xs" style={{ color: saving ? '#B45309' : editable && !dirty && updatedAt ? '#15803D' : '#A3A3A3' }}>
          {saving
            ? 'Saving…'
            : editable && dirty
              ? 'Auto-saves when you stop typing'
              : updatedAt
                ? `${editable ? 'Auto-saved · ' : ''}Last updated ${new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : ''}
        </Text>
        {editable ? (
          <Pressable
            testID={`client-checklist-save${stage === 'construction' ? '-construction' : ''}`}
            onPress={() => void save(notes, true)}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5"
            style={{ opacity: saving ? 0.5 : 1 }}
          >
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text className="text-xs font-semibold text-white">{stage === 'construction' ? 'Save Construction Delays' : 'Save Checklist'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
}
