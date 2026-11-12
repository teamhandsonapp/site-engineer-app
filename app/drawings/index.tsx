import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../components/ui/AppText';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { ConsultantStatusBadge, formatDate } from '../../components/drawings/ui';
import { NewDrawingSheet } from '../../components/drawings/PanelSheets';
import { fetchProjectDrawings, type DrawingListItem } from '../../lib/drawings/data';
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, revLabel } from '../../lib/drawings/types';
import { canEditDrawings, canViewDrawings } from '../../lib/drawings/roles';
import { useLatestRequest } from '../../lib/useLatestRequest';

const HEADER = {
  headerShown: true,
  title: 'Drawings',
  headerStyle: { backgroundColor: '#0F1F33' },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '600' as const },
};

type Floor = { base: DrawingListItem | null; departments: DrawingListItem[] };

// admin-web /projects/[id]/drawings (DrawingsList): floor plan tabs, one
// card per department sheet, consultant status badges, New floor plan /
// Add department drawing.
export default function DrawingsScreen() {
  const params = useLocalSearchParams<{ projectId?: string; floor?: string; newFor?: string }>();
  const { state } = useAuth();
  const { selectedProjectId, projects } = useProject();
  const projectId = params.projectId || selectedProjectId;
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';
  const profile = state.status === 'signed-in' ? state.profile : null;
  const canView = profile ? canViewDrawings(profile.role) : false;
  const canEdit = profile ? canEditDrawings(profile.role) : false;
  const toast = useToast();

  const [items, setItems] = useState<DrawingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [floorId, setFloorId] = useState<string | null>(params.floor ?? params.newFor ?? null);
  const [formFor, setFormFor] = useState<string | null>(null);

  const latest = useLatestRequest();
  const load = useCallback(async () => {
    if (!projectId || !canView) return;
    const isCurrent = latest.begin();
    try {
      setError(null);
      const res = await fetchProjectDrawings(projectId);
      if (!isCurrent()) return;
      setItems(res);
      if (res.length === 0) setFormFor((f) => f ?? '');
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, canView, latest]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (params.newFor && canEdit) setFormFor(params.newFor);
  }, [params.newFor, canEdit]);

  const floors: Floor[] = useMemo(() => {
    const list = items ?? [];
    const ids = new Set(list.map((i) => i.id));
    const result: Floor[] = list
      .filter((i) => !i.baseDrawingId)
      .sort((a, b) => a.sheetNumber.localeCompare(b.sheetNumber, undefined, { numeric: true }))
      .map((base) => ({ base, departments: [base, ...list.filter((i) => i.baseDrawingId === base.id)] }));
    const loose = list.filter((i) => i.baseDrawingId && !ids.has(i.baseDrawingId));
    if (loose.length) result.push({ base: null, departments: loose });
    return result;
  }, [items]);
  const floorKey = (f: Floor) => f.base?.id ?? 'other';
  const current = floors.find((f) => floorKey(f) === floorId) ?? floors[0] ?? null;
  const baseOptions = (items ?? []).filter((i) => !i.baseDrawingId).map((i) => ({ id: i.id, sheetNumber: i.sheetNumber, title: i.title }));
  const overdue = (items ?? []).filter((i) => i.status && i.status.overdueDays > 0).length;
  const floorCount = floors.filter((f) => f.base).length;

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const open = (id: string) => router.push({ pathname: '/drawings/[drawingId]', params: { drawingId: id, projectId: projectId! } } as never);

  if (!profile || !canView) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Stack.Screen options={HEADER} />
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }
  if (!projectId) {
    return (
      <View className="flex-1 bg-neutral-50">
        <Stack.Screen options={HEADER} />
        <EmptyState icon="folder-open-outline" iconColor="#9CA3AF" title="No project selected" subtitle="Choose a project first." />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ ...HEADER, title: projectName ? `Drawings · ${projectName}` : 'Drawings' }} />
      <ScrollView contentContainerClassName="pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}>
        <View className="px-4 pt-4 pb-2 flex-row items-end justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-xs text-neutral-500">File Management › Drawings</Text>
            {items ? (
              <Text className="text-xs text-neutral-600 mt-0.5">
                {floorCount} floor plan{floorCount === 1 ? '' : 's'} · {items.length} drawing{items.length === 1 ? '' : 's'}
                {overdue > 0 ? <Text className="text-red-600 font-semibold"> · {overdue} overdue</Text> : null}
              </Text>
            ) : null}
          </View>
          {canEdit ? <Button label="New floor plan" icon="add" size="sm" variant="secondary" onPress={() => setFormFor('')} /> : null}
        </View>

        {error ? (
          <View className="mx-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-3">
            <Text className="text-sm text-red-600">{error}</Text>
          </View>
        ) : null}

        {!items ? (
          <View className="px-4 gap-3">
            {[0, 1, 2].map((i) => (
              <View key={i} className="h-24 rounded-xl bg-neutral-200/60" />
            ))}
          </View>
        ) : items.length === 0 ? (
          <EmptyState icon="map-outline" iconColor="#9CA3AF" title="No drawings yet" subtitle={canEdit ? 'Add the first floor plan.' : 'Drawings appear here once the office adds them.'} />
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 gap-1 border-b border-neutral-200">
              {floors.map((f) => {
                const active = current && floorKey(f) === floorKey(current);
                return (
                  <Pressable key={floorKey(f)} onPress={() => setFloorId(floorKey(f))} className={`px-3 py-2.5 border-b-2 ${active ? 'border-brand-navy' : 'border-transparent'}`} style={{ minHeight: 44 }}>
                    <Text className={`text-sm font-semibold ${active ? 'text-brand-navy' : 'text-neutral-500'}`}>{f.base ? f.base.title : 'Other drawings'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {current ? (
              <View className="px-4 pt-3">
                {current.base ? (
                  <View className="flex-row gap-2 mb-3">
                    <Button label="Open floor plan" icon="map-outline" size="sm" onPress={() => open(current.base!.id)} />
                    {canEdit ? <Button label="Add department drawing" icon="add" size="sm" variant="secondary" onPress={() => setFormFor(current.base!.id)} /> : null}
                  </View>
                ) : null}
                {current.departments.map((item) => {
                  const isBase = current.base?.id === item.id;
                  return (
                    <Pressable key={item.id} onPress={() => open(item.id)} className="mb-3">
                      <Card accentColor={DISCIPLINE_COLOR[item.discipline]}>
                        <View className="flex-row items-start justify-between">
                          <View className="flex-1 pr-2">
                            <View className="flex-row items-center">
                              <View className="w-2.5 h-2.5 rounded-sm mr-1.5" style={{ backgroundColor: DISCIPLINE_COLOR[item.discipline] }} />
                              <Text className="text-xs font-semibold text-neutral-600">{DISCIPLINE_LABEL[item.discipline]}</Text>
                              <Text className="text-xs text-neutral-400 ml-1.5">{item.sheetNumber}</Text>
                            </View>
                            <Text className="text-sm font-bold text-neutral-900 mt-1">{item.title}</Text>
                          </View>
                          {isBase ? <Text className="text-2xs font-semibold uppercase tracking-wide text-neutral-400 pt-1">Base plan</Text> : null}
                        </View>
                        <View className="flex-row items-center justify-between mt-2">
                          <Text className="text-xs text-neutral-500">
                            {item.latestRevision === null ? <Text className="text-neutral-400">No PDF yet</Text> : `${revLabel(item.latestRevision)} · ${formatDate(item.latestUploadedAt!)}`}
                            {item.tagCount ? ` · ${item.tagCount} tag${item.tagCount === 1 ? '' : 's'}` : ''}
                          </Text>
                          {item.status ? <ConsultantStatusBadge status={item.status} /> : null}
                        </View>
                        <View className="flex-row items-center mt-2.5 pt-2 border-t border-neutral-100">
                          <Text className="text-xs font-semibold text-neutral-600">Open drawing</Text>
                          <Ionicons name="arrow-forward" size={12} color="#4B5563" style={{ marginLeft: 4 }} />
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {formFor !== null && canEdit ? (
        <NewDrawingSheet
          projectId={projectId}
          userId={profile.id}
          defaultBaseId={formFor}
          baseOptions={baseOptions}
          onClose={() => setFormFor(null)}
          onCreated={(id) => {
            setFormFor(null);
            toast.success('Sheet created');
            load();
            open(id);
          }}
        />
      ) : null}
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';
