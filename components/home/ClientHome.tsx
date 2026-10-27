import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { fetchProjectProgress, type ProjectProgress } from '../../lib/projectProgress';
import { fetchProjectTimeline, type TimelineWork } from '../../lib/projectTimeline';
import {
  fetchClientCriticalAlerts,
  respondToClientAlert,
  type CriticalAlert,
} from '../../lib/dependencyAlerts';
import { daysSince, pendingLabel, urgencyTier, URGENCY_CLASSES } from '../../lib/urgency';
import { useDependencyCompletionsRealtime } from '../../lib/dependencyCompletionsRealtime';
import { consumeLastViewedAlerts, isAfterViewedThreshold } from '../../lib/lastViewedAlerts';
import { timeOfDayGreeting, firstName } from '../../lib/greeting';
import { useSafeBottomOffset } from '../../lib/useSafeBottomOffset';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { AlertCardSkeleton, ProgressCardSkeleton } from '../ui/Skeleton';

function formatDateKey(value: string | null): string {
  if (!value) return 'No date set';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function AlertCard({
  alert,
  onRespond,
  highlighted,
  isNew,
}: {
  alert: CriticalAlert;
  onRespond: (status: 'YES' | 'NO' | 'PROCEED') => Promise<void>;
  highlighted?: boolean;
  isNew?: boolean;
}) {
  const [busy, setBusy] = useState<'YES' | 'NO' | 'PROCEED' | null>(null);
  const days = daysSince(alert.pendingSinceISO);
  const tier = urgencyTier(days);
  const tone = URGENCY_CLASSES[tier];

  async function press(status: 'YES' | 'NO' | 'PROCEED') {
    setBusy(status);
    try {
      await onRespond(status);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      accentColor={tier === 'urgent' ? '#DC2626' : tier === 'warn' ? '#B45309' : '#1C3358'}
      className="mb-3"
      style={highlighted ? { borderWidth: 2, borderColor: '#F0A227' } : undefined}
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          {isNew && <View className="w-2 h-2 rounded-full bg-brand-amber" />}
          <Text className="text-md font-semibold text-neutral-900 flex-1" numberOfLines={2}>{alert.taskName}</Text>
        </View>
        {(alert.status === 'REVISIONS' || alert.isFlagged) && (
          <View className="px-2 py-1 rounded-full bg-status-urgentBg flex-shrink-0">
            <Text className="text-2xs font-bold text-status-urgent uppercase tracking-wide">
              {alert.status === 'REVISIONS' ? 'Revisions' : alert.status === 'ON_HOLD' ? 'On Hold' : 'No'}
            </Text>
          </View>
        )}
      </View>
      <Text className="text-sm text-neutral-500 mt-1">{alert.itemLabel}</Text>

      <View className={`self-start mt-3 px-2.5 py-1 rounded-full ${tone.bg}`}>
        <Text className={`text-xs font-semibold ${tone.text}`}>{pendingLabel(days)}</Text>
      </View>

      <View className="flex-row gap-2 mt-4">
        {(['YES', 'PROCEED', 'NO'] as const).map((status) => {
          const isPrimary = status !== 'NO';
          return (
            <Pressable
              key={status}
              disabled={busy !== null}
              onPress={() => press(status)}
              className={`flex-1 items-center justify-center rounded-xl disabled:opacity-50 ${isPrimary ? 'bg-brand-navy' : 'bg-white border border-neutral-200'}`}
              style={{ minHeight: 44 }}
            >
              {busy === status ? (
                <ActivityIndicator size="small" color={isPrimary ? '#fff' : '#111'} />
              ) : (
                <Text className={`text-sm font-semibold ${isPrimary ? 'text-white' : 'text-neutral-700'}`}>
                  {status}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function ProgressCard({ progress }: { progress: ProjectProgress | null }) {
  if (!progress) return null;
  const pct = progress.percentage;
  return (
    <Card className="mb-6">
      <Text className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Project Progress</Text>
      <View className="flex-row items-end gap-2 mt-1.5 mb-3">
        <Text className="text-2xl font-bold text-neutral-900">{pct != null ? `${pct}%` : '—'}</Text>
        {progress.target != null && (
          <Text className="text-sm text-neutral-400 mb-1">
            {Math.round(progress.completed)} / {Math.round(progress.target)} SFT
          </Text>
        )}
      </View>
      <View className="h-2 rounded-full bg-neutral-100 overflow-hidden">
        <View className="h-2 rounded-full bg-brand-amber" style={{ width: `${pct ?? 0}%` }} />
      </View>
      {progress.target == null && (
        <Text className="text-xs text-neutral-400 mt-2.5">No SFT target has been set for this project yet.</Text>
      )}
    </Card>
  );
}

function TimelineSection({ works }: { works: TimelineWork[] }) {
  if (works.length === 0) {
    return (
      <Card>
        <Text className="text-sm text-neutral-400 text-center py-2">No tasks scheduled yet.</Text>
      </Card>
    );
  }
  return (
    <View className="gap-4">
      {works.map((w) => (
        <View key={w.workId}>
          <View className="flex-row items-center gap-2 mb-2">
            <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: w.workColor }} />
            <Text className="text-sm font-semibold text-neutral-700">{w.workName}</Text>
          </View>
          <View className="gap-1.5">
            {w.tasks.map((t) => (
              <View key={t.id} className="flex-row items-center justify-between rounded-xl bg-neutral-50 px-3 py-2.5">
                <Text className="text-sm text-neutral-700 flex-1 pr-2" numberOfLines={1}>{t.taskName}</Text>
                <Text className="text-xs text-neutral-400">
                  {formatDateKey(t.plannedStartDate)}{t.dueDate && t.dueDate !== t.plannedStartDate ? ` – ${formatDateKey(t.dueDate)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Toast({ toast }: { toast: { type: 'success' | 'error'; message: string } | null }) {
  const bottom = useSafeBottomOffset(12);
  if (!toast) return null;
  const isSuccess = toast.type === 'success';
  return (
    <View
      className="absolute left-4 right-4 rounded-xl px-4 py-3 flex-row items-center gap-2"
      style={{ bottom, backgroundColor: isSuccess ? '#0F1F33' : '#DC2626', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
    >
      <Ionicons name={isSuccess ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
      <Text className="text-sm font-semibold text-white flex-1">{toast.message}</Text>
    </View>
  );
}

export function ClientHome() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const projectId = profile?.clientProjectId ?? null;
  const profileId = profile?.id ?? null;

  // Set when this screen was opened by tapping a push notification (see
  // lib/notificationRouting.ts) — used to scroll to and highlight the
  // specific alert the notification was about, rather than just landing on
  // the generic top-of-list view.
  const { highlightItemId } = useLocalSearchParams<{ highlightItemId?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [timeline, setTimeline] = useState<TimelineWork[]>([]);
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [viewedThreshold, setViewedThreshold] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(type: 'success' | 'error', message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      const [p, t, a] = await Promise.all([
        fetchProjectProgress(projectId),
        fetchProjectTimeline(projectId),
        fetchClientCriticalAlerts(),
      ]);
      setProgress(p);
      setTimeline(t.works);
      setAlerts(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Live updates while this screen is open — a staff member resolving
  // something on their end, or a revisions-request reopening an item,
  // shows up here without any manual action. Replaces pull-to-refresh for
  // this list (see the hook's comment for why a plain refresh alone
  // wouldn't be "instant").
  useDependencyCompletionsRealtime(load);

  // Snapshot once per mount — stays fixed for the lifetime of this screen
  // being open, so an alert that arrives live via the subscription above
  // still shows as "new" until the NEXT time this screen is opened.
  useEffect(() => {
    if (!profileId) return;
    consumeLastViewedAlerts(profileId).then(setViewedThreshold);
  }, [profileId]);

  const greeting = useMemo(() => `${timeOfDayGreeting()}, ${profile ? firstName(profile.fullName) : ''}`, [profile]);

  useEffect(() => {
    if (!highlightItemId || loading) return;
    // onLayout runs asynchronously after render — a short delay is more
    // reliable than scrolling in the same tick the list first appears.
    const timer = setTimeout(() => {
      const y = cardOffsets.current[highlightItemId];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightItemId, loading, alerts]);

  // Not optimistic on purpose: wait for the write to actually succeed
  // before the card disappears, and show an explicit confirmation either
  // way — a silent vanish (or a vanish-then-quietly-revert on failure)
  // risks someone believing they responded when the write never landed.
  async function handleRespond(alert: CriticalAlert, status: 'YES' | 'NO' | 'PROCEED') {
    if (!profile) return;
    try {
      await respondToClientAlert(alert.itemId, status, profile.id);
      setAlerts((prev) => prev.filter((a) => a.itemId !== alert.itemId));
      showToast('success', 'Response submitted');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to submit response — try again');
    }
  }

  if (!projectId) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Ionicons name="alert-circle-outline" size={36} color="#9CA3AF" />
        <Text className="text-md font-semibold text-neutral-800 text-center mt-3">No project assigned</Text>
        <Text className="text-sm text-neutral-400 text-center mt-1.5">
          Your account isn&apos;t linked to a project yet. Contact your PMC office to get this set up.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <ScrollView className="flex-1 bg-neutral-50" contentContainerClassName="px-4 pt-5 pb-8">
        <View className="mb-3">
          <AlertCardSkeleton />
        </View>
        <ProgressCardSkeleton />
      </ScrollView>
    );
  }

  return (
    <View className="flex-1">
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-neutral-50"
        contentContainerClassName="px-4 pt-5 pb-10"
      >
        {/* Subtle and secondary — the alerts section below is still the
            loudest thing on the screen, matching the design pass's
            hierarchy: this is a nice touch, not the headline. */}
        <Text className="text-sm text-neutral-400 mb-3">{greeting}</Text>

        {error && (
          <Card className="mb-4 border-red-200 bg-red-50">
            <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
            <Pressable
              onPress={load}
              className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200"
            >
              <Text className="text-xs font-semibold text-red-600">Retry</Text>
            </Pressable>
          </Card>
        )}

        {/* Critical alerts — the actual reason someone opens this app, so this
            is the loudest thing on the screen: a bigger header than any other
            section, and it always renders something here (either the cards or
            an explicit "all caught up" card), never silently disappearing. */}
        <View className="mb-6">
          <Text className="text-lg font-bold text-neutral-900 mb-3">
            {alerts.length > 0 ? `Needs your response (${alerts.length})` : 'Needs your response'}
          </Text>
          {alerts.length > 0 ? (
            alerts.map((a) => (
              <View key={a.itemId} onLayout={(e) => { cardOffsets.current[a.itemId] = e.nativeEvent.layout.y; }}>
                <AlertCard
                  alert={a}
                  onRespond={(status) => handleRespond(a, status)}
                  highlighted={a.itemId === highlightItemId}
                  isNew={isAfterViewedThreshold(a.pendingSinceISO, viewedThreshold)}
                />
              </View>
            ))
          ) : (
            <Card className="bg-status-calmBg border-transparent">
              <EmptyState
                title="You're all caught up"
                subtitle="No pending items — nothing needs your attention right now."
              />
            </Card>
          )}
        </View>

        <ProgressCard progress={progress} />

        <Text className="text-lg font-bold text-neutral-900 mb-3">Schedule</Text>
        <TimelineSection works={timeline} />
      </ScrollView>
      <Toast toast={toast} />
    </View>
  );
}
