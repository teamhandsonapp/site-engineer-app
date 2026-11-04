import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../../lib/AuthContext';
import { ComposeCriticalAlertModal } from '../../components/ComposeCriticalAlertModal';
import {
  fetchTaskDependencies,
  fetchTaskDetail,
  verifyTaskChecklist,
  type ChecklistItem,
  type ChecklistVerificationStatus,
  type TaskDependencies,
  type TaskDependencyRef,
  type TaskDetailInfo,
} from '../../lib/taskDetail/data';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABEL,
  CATEGORY_LETTER,
  computeProcurementLeadTime,
  isCategoryNotRequired,
  isItemDone,
  PROCUREMENT_INPUT_PRESET_DAYS,
  type DependencyCategory,
} from '../../lib/taskDetail/constants';
import { ChecklistItemRow } from '../../components/taskDetail/ChecklistItemRow';
import { DelayPanel } from '../../components/taskDetail/DelayPanel';
import { formatCardDateRange } from '../../lib/flowchart/delay';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateLabel, formatTime12h } from '../../lib/formatTime';
import { fetchGeneralParameterReport, type GeneralParameterReportData } from '../../lib/reports/generalParameterReport';

type VerifyAction = Exclude<ChecklistVerificationStatus, 'pending'>;

// Checklist completion -> admin notification -> on-site verification (see
// prisma/add-checklist-verification.sql for the server side). Shown to
// EVERY role once task.verificationStatus is non-null (an engineer needs
// to know whether their completed work was actually confirmed, not just
// that they submitted it) — only the Mark Verified/Needs Rework actions
// themselves are admin/manager-gated.
function VerificationBanner({
  task,
  isAdminOrManager,
  onOpenAction,
}: {
  task: TaskDetailInfo;
  isAdminOrManager: boolean;
  onOpenAction: (action: VerifyAction) => void;
}) {
  if (!task.verificationStatus) return null;

  if (task.verificationStatus === 'verified') {
    return (
      <View className="rounded-xl bg-green-50 border border-green-200 px-3.5 py-3 mt-3.5">
        <Text className="text-xs font-bold text-green-800">
          ✅ Verified{task.verifiedByName ? ` by ${task.verifiedByName}` : ''}
          {task.verifiedAtISO ? ` at ${formatTime12h(new Date(task.verifiedAtISO))}` : ''}
        </Text>
        {task.verificationNote && <Text className="text-xs text-green-700 mt-1">{task.verificationNote}</Text>}
      </View>
    );
  }

  if (task.verificationStatus === 'needs_rework') {
    return (
      <View className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 mt-3.5">
        <Text className="text-xs font-bold text-amber-800">
          ⚠️ Needs rework{task.verifiedByName ? ` — flagged by ${task.verifiedByName}` : ''}
        </Text>
        {task.verificationNote && <Text className="text-xs text-amber-700 mt-1">{task.verificationNote}</Text>}
      </View>
    );
  }

  return (
    <View className="rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-3 mt-3.5">
      <Text className="text-xs font-bold text-blue-800">
        Checklist complete{task.checklistCompletedByName ? ` — ${task.checklistCompletedByName}` : ''}
        {task.checklistCompletedAtISO ? `, ${formatTime12h(new Date(task.checklistCompletedAtISO))}` : ''}
      </Text>
      <Text className="text-xs text-blue-700 mt-0.5">Pending review</Text>
      {isAdminOrManager && (
        <View className="flex-row gap-2 mt-2.5">
          <Pressable onPress={() => onOpenAction('verified')} className="px-3.5 py-2 rounded-lg bg-green-600">
            <Text className="text-xs font-bold text-white">Mark Verified</Text>
          </Pressable>
          <Pressable onPress={() => onOpenAction('needs_rework')} className="px-3.5 py-2 rounded-lg bg-amber-600">
            <Text className="text-xs font-bold text-white">Needs Rework</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Procurement Duration Type (task_types.default_duration_days) + Client/
// Architect/Consultant input (PROCUREMENT_INPUT_PRESET_DAYS, always all 3)
// = the real total lead time before this task's live planned start date.
// Same numbers admin's push-notification cron uses server-side (see
// admin-web/prisma/add-procurement-lead-time-alerts.sql) — this is just
// the on-screen equivalent so it's not ONLY visible via a notification.
// Renders nothing when the task has no Procurement Duration Type or no
// planned start date set yet — there's nothing to count back from.
// Redesigned 2026-08-17 from a plain two-sentence paragraph into a
// scannable stat card — the total, its two components, and a clear
// urgency-colored "start by" action were all buried in one dense sentence
// before, which is exactly what made it hard to act on at a glance.
function ProcurementLeadTimeCard({ task }: { task: TaskDetailInfo }) {
  if (task.procurementTypeDurationDays == null || !task.referenceStartDateISO) return null;

  const { totalLeadTimeDays, startByISODate } = computeProcurementLeadTime(
    task.procurementTypeDurationDays,
    task.referenceStartDateISO
  );

  const startBy = new Date(startByISODate + 'T00:00:00Z');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysUntilStart = Math.round((startBy.getTime() - today.getTime()) / 86_400_000);

  // Same 3-tier red/amber/green convention as VerificationBanner above and
  // the error banner further down this screen — not a new palette.
  const urgency: 'overdue' | 'imminent' | 'normal' =
    daysUntilStart < 0 ? 'overdue' : daysUntilStart <= 7 ? 'imminent' : 'normal';
  const urgencyStyles: Record<typeof urgency, { wrap: string; text: string; sub: string }> = {
    overdue: { wrap: 'bg-red-50 border-red-200', text: 'text-red-800', sub: 'text-red-700' },
    imminent: { wrap: 'bg-amber-50 border-amber-200', text: 'text-amber-800', sub: 'text-amber-700' },
    normal: { wrap: 'bg-green-50 border-green-200', text: 'text-green-800', sub: 'text-green-700' },
  };
  const style = urgencyStyles[urgency];
  const actionLabel =
    urgency === 'overdue'
      ? `${Math.abs(daysUntilStart)} day${Math.abs(daysUntilStart) === 1 ? '' : 's'} overdue to start`
      : urgency === 'imminent'
        ? `Start in ${daysUntilStart} day${daysUntilStart === 1 ? '' : 's'}`
        : `${daysUntilStart} days until you need to start`;

  return (
    <View className="rounded-xl bg-neutral-50 border border-neutral-200 px-3.5 py-3.5 mt-3.5">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2.5">
        Procurement Lead Time
      </Text>

      <View className="flex-row items-stretch gap-2.5 mb-3">
        <View className="rounded-lg bg-white border border-neutral-200 px-3 py-2 items-center justify-center">
          <Text className="text-2xl font-extrabold text-neutral-900 leading-none">{totalLeadTimeDays}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">total days</Text>
        </View>
        <View className="flex-1 rounded-lg bg-white border border-neutral-200 px-2.5 py-2 justify-center">
          <Text className="text-sm font-bold text-neutral-800">{task.procurementTypeDurationDays}d</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">Procurement</Text>
        </View>
        <View className="flex-1 rounded-lg bg-white border border-neutral-200 px-2.5 py-2 justify-center">
          <Text className="text-sm font-bold text-neutral-800">+{PROCUREMENT_INPUT_PRESET_DAYS}d</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">Client + Arch + Consult (7 each)</Text>
        </View>
      </View>

      <View className={`rounded-lg border px-3 py-2.5 ${style.wrap}`}>
        <Text className={`text-xs font-bold ${style.text}`}>
          Start procurement by {formatDateLabel(startBy)} — {actionLabel}
        </Text>
        <Text className={`text-2xs mt-0.5 ${style.sub}`}>
          To hit the {formatDateLabel(new Date(task.referenceStartDateISO + 'T00:00:00Z'))} planned start.
        </Text>
      </View>
    </View>
  );
}

// Same FS/SS/FF/SF badge convention as the flowchart canvas's own edge
// badges (components/flowchart/EdgeLayer.tsx) — shown as-is, not spelled
// out, since that's already the app's one existing precedent for
// surfacing this value to a user.
function DependencyGroup({ label, refs }: { label: string; refs: TaskDependencyRef[] }) {
  if (refs.length === 0) return null;
  return (
    <View className="mb-2.5">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">{label}</Text>
      <View className="gap-1.5">
        {refs.map((ref) => (
          <Pressable
            key={ref.id}
            onPress={() => router.push(`/task/${ref.id}`)}
            className="flex-row items-center justify-between rounded-lg bg-neutral-50 border border-neutral-100 px-2.5 py-2"
          >
            <View className="flex-1 pr-2">
              <Text className="text-xs font-semibold text-neutral-800" numberOfLines={1}>{ref.taskCode} · {ref.taskName}</Text>
            </View>
            {ref.type && (
              <View className="px-1.5 py-0.5 rounded bg-neutral-200">
                <Text className="text-2xs font-mono font-bold text-neutral-600">{ref.type}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Mirrors admin-web's TrelloTaskDetail — the full checklist-by-department
// view reached via the flowchart's task action menu "Open" (Part 6),
// distinct from TaskDetailSheet (which is the quick Edit-fields form).
export default function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const canEdit = profile ? appRoleFor(profile.role) === 'staff' : false;
  // Same inline check every other admin/manager-gated screen in this app
  // uses (no shared helper exists — DrawerContent.tsx, team-attendance.tsx,
  // leave-log.tsx all repeat this exact expression).
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');

  const [task, setTask] = useState<TaskDetailInfo | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependencies | null>(null);
  const [delay, setDelay] = useState<GeneralParameterReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyAction, setVerifyAction] = useState<VerifyAction | null>(null);
  const [verifyNote, setVerifyNote] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [alertComposeOpen, setAlertComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      setError(null);
      // Independent of each other (dependencies has nothing to do with the
      // checklist) — fetched together rather than one blocking the other.
      const [detail, deps] = await Promise.all([fetchTaskDetail(taskId), fetchTaskDependencies(taskId)]);
      setTask(detail.task);
      setItems(detail.items);
      setDependencies(deps);
      // Cumulative Pre + Construction delay — admin/manager oversight only
      // (see the Post Construction category's own card below), reusing the
      // existing General Parameter Report calculation for this one task.
      setDelay(isAdminOrManager && detail.task.projectId ? await fetchGeneralParameterReport(taskId, detail.task.projectId) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId, isAdminOrManager]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // This route has no drawer entry and is only ever reached via router.push
  // from an already-authenticated flowchart screen — but it's still a real,
  // independently-navigable URL (e.g. a cold app relaunch with router state
  // restored), so it needs its own guard rather than assuming the caller
  // always got here through an authenticated screen.
  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  function handleItemChanged(itemId: string, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  }

  // A full reload (not local state patching) after either action — Needs
  // Rework resets every item's status server-side (verify_task_checklist),
  // so the checklist section below needs the real, freshly-reset data, not
  // a guess at what changed.
  async function handleVerifyAction(action: VerifyAction) {
    if (!task) return;
    setVerifying(true);
    try {
      await verifyTaskChecklist(task.id, action, verifyNote.trim() || null);
      setVerifyAction(null);
      setVerifyNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  function handleItemDeleted(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  const itemsByCategory = new Map<DependencyCategory, ChecklistItem[]>();
  for (const cat of CATEGORIES) itemsByCategory.set(cat, []);
  for (const item of items) {
    if (itemsByCategory.has(item.category)) itemsByCategory.get(item.category)!.push(item);
  }

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen
        options={{
          headerShown: true,
          title: task?.taskCode ?? 'Task',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          // On every task's checklist page, not gated behind canEdit — a
          // field engineer reading a locked/read-only checklist still needs
          // a way to flag a real on-site problem immediately, same reach as
          // the standalone Critical Alerts screen, just one tap closer from
          // wherever they already are.
          headerRight: () =>
            task?.projectId ? (
              <Pressable onPress={() => setAlertComposeOpen(true)} hitSlop={10} style={{ marginRight: 12 }}>
                <Ionicons name="warning" size={22} color="#F87171" />
              </Pressable>
            ) : null,
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
          <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : !task ? (
        <EmptyState icon="document-text-outline" iconColor="#9CA3AF" title="Task not found" subtitle="It may have been deleted." />
      ) : (
        <ScrollView className="bg-neutral-50" contentContainerClassName="px-4 py-4 pb-10">
          <Text className="text-lg font-extrabold text-neutral-900">{task.taskName}</Text>
          <Text className="text-xs text-neutral-400 mt-1 mb-1">{task.workName} · {task.workCode}</Text>
          {/* Planned Start/End — by explicit request, this screen previously
              showed no dates at all. Same formatCardDateRange the flowchart
              canvas's own yellow chip already uses, for one consistent
              "planned span" wording across both screens. */}
          <View className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 self-start mt-1 mb-1">
            <Text className="text-2xs font-bold text-amber-900">{formatCardDateRange(task.plannedStartDate, task.dueDate)}</Text>
          </View>
          {task.description && <Text className="text-xs text-neutral-500 mt-2 mb-1">{task.description}</Text>}

          <VerificationBanner task={task} isAdminOrManager={isAdminOrManager} onOpenAction={setVerifyAction} />
          <ProcurementLeadTimeCard task={task} />

          {dependencies &&
            (dependencies.predecessors.length > 0 || dependencies.successors.length > 0 || dependencies.parallel.length > 0) && (
              <Card className="mt-3.5 p-3.5">
                <Text className="text-sm font-bold text-neutral-900 mb-2.5">Dependencies</Text>
                <DependencyGroup label="Predecessors" refs={dependencies.predecessors} />
                <DependencyGroup label="Successors" refs={dependencies.successors} />
                <DependencyGroup label="Parallel" refs={dependencies.parallel} />
              </Card>
            )}

          {CATEGORIES.map((cat) => {
            const catItems = itemsByCategory.get(cat) ?? [];
            const notRequired = isCategoryNotRequired(task.accountabilityType, cat);

            // A "Not Required" category still renders its struck-through
            // header even with 0 items loaded — a genuinely-empty, still-
            // required category (shouldn't happen in practice; every task
            // is auto-seeded) is the only case that skips rendering.
            if (catItems.length === 0 && !notRequired) return null;

            if (notRequired) {
              return (
                <View key={cat} className="rounded-xl bg-neutral-100 mt-3 px-3.5 py-2.5 flex-row items-center gap-2.5">
                  <View className="w-5 h-5 rounded-full items-center justify-center bg-neutral-300">
                    <Text className="text-2xs font-bold text-neutral-500">{CATEGORY_LETTER[cat]}</Text>
                  </View>
                  <Text className="text-2xs font-semibold text-neutral-400" style={{ textDecorationLine: 'line-through' }}>
                    {CATEGORY_LABEL[cat]} — Not Required
                  </Text>
                </View>
              );
            }

            const colors = CATEGORY_COLORS[cat];
            const done = catItems.filter((i) => isItemDone(i.status)).length;
            const total = catItems.length;
            const complete = done === total;

            return (
              <Card key={cat} accentColor={colors.dot} className="mt-3.5 p-0 overflow-hidden">
                <View className="flex-row items-center justify-between px-3.5 py-3">
                  <View className="flex-row items-center gap-2">
                    <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: colors.dot }}>
                      <Text className="text-2xs font-bold text-white">{CATEGORY_LETTER[cat]}</Text>
                    </View>
                    <Text className="text-sm font-bold text-neutral-900">{CATEGORY_LABEL[cat]}</Text>
                  </View>
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: complete ? '#DCFCE7' : colors.badge }}>
                    <Text className="text-2xs font-mono font-bold" style={{ color: complete ? '#15803D' : colors.text }}>
                      {done}/{total}
                    </Text>
                  </View>
                </View>
                {cat === 'quality_post_construction' && isAdminOrManager && delay && (
                  <DelayPanel delay={delay} />
                )}
                <View className="px-3.5">
                  {catItems.map((item, idx) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      taskId={taskId}
                      editable={canEdit}
                      userId={profile?.id ?? null}
                      onChanged={handleItemChanged}
                      onDeleted={handleItemDeleted}
                      isLast={idx === catItems.length - 1}
                    />
                  ))}
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}

      {verifyAction && (
        <ConfirmDialog
          title={verifyAction === 'verified' ? 'Mark checklist verified?' : 'Send back for rework?'}
          description={
            verifyAction === 'verified'
              ? 'Confirms this checklist was reviewed on site and everything checks out.'
              : 'Every checklist item will be reset to unchecked so the engineer can redo it. Add a note explaining what needs fixing.'
          }
          confirmLabel={verifyAction === 'verified' ? 'Mark Verified' : 'Needs Rework'}
          variant={verifyAction === 'verified' ? 'warning' : 'danger'}
          busy={verifying}
          onConfirm={() => handleVerifyAction(verifyAction)}
          onCancel={() => {
            setVerifyAction(null);
            setVerifyNote('');
          }}
        >
          <TextInput
            value={verifyNote}
            onChangeText={setVerifyNote}
            placeholder="Note (optional)"
            placeholderTextColor="#a3a3a3"
            multiline
            className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
            style={{ minHeight: 60, textAlignVertical: 'top' }}
          />
        </ConfirmDialog>
      )}

      {task?.projectId && profile && (
        <ComposeCriticalAlertModal
          visible={alertComposeOpen}
          mode={isAdminOrManager ? 'admin' : 'engineer'}
          projectId={task.projectId}
          projectName={task.projectName}
          senderId={profile.id}
          onClose={() => setAlertComposeOpen(false)}
          onSent={() => setAlertComposeOpen(false)}
        />
      )}
    </View>
  );
}
