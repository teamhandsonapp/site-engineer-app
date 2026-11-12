// Meeting page › Agenda tab, top card: the agenda typed while creating the
// meeting and "What will be discussed" (tasks + topics). Each task shows its
// planned start → end and, when known, actual start / end — small. Tapping a
// task opens Task Detail. Each item has a "discussed" tick and a note for the
// minutes (saved on the meeting).

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/AppText';
import { Card } from '../ui/Card';
import { fetchTaskDates, shortDay, type TaskDates } from '../../lib/mom/taskDates';
import type { DiscussionItem, Meeting } from '../../lib/mom/types';
import { Field, NAVY, SectionTitle } from './ui';

const STATUS_COLOR: Record<string, string> = {
  completed: '#15803D',
  in_progress: '#1D4ED8',
  blocked: '#DC2626',
  not_started: '#6B7280',
};

export function AgendaOverview({
  meeting: m,
  onSaveItems,
}: {
  meeting: Meeting;
  onSaveItems: (next: DiscussionItem[]) => Promise<boolean>;
}) {
  const items = m.discussionItems ?? [];
  const [dates, setDates] = useState<Map<string, TaskDates>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.note ?? ''])));
  const taskKey = items.map((i) => i.taskId ?? '').join(',');

  useEffect(() => {
    let alive = true;
    fetchTaskDates(items.filter((i) => i.type === 'task').map((i) => i.taskId as string))
      .then((d) => alive && setDates(d))
      .catch(() => {}); // dates are extra info; the list still shows without them
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey]);

  const save = (id: string, patch: Partial<DiscussionItem>) => onSaveItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const done = items.filter((i) => i.discussed).length;

  return (
    <Card className="mb-3">
      <SectionTitle>Agenda</SectionTitle>
      <Text testID="meeting-detail-agenda" className={`text-sm ${m.agenda ? 'text-neutral-800' : 'text-neutral-400 italic'}`}>
        {m.agenda || 'No agenda added'}
      </Text>

      <View className="mt-4">
        <SectionTitle>{items.length ? `What will be discussed · ${done}/${items.length} discussed` : 'What will be discussed'}</SectionTitle>
        {items.length === 0 ? <Text className="text-sm text-neutral-400 italic">No discussion items added</Text> : null}
        {items.map((i, idx) => {
          const d = i.taskId ? dates.get(i.taskId) : undefined;
          return (
            <View key={i.id} className={`py-2.5 ${idx > 0 ? 'border-t border-neutral-100' : ''}`}>
              <View className="flex-row items-start gap-2">
                <Pressable
                  testID="minutes-item-toggle"
                  onPress={() => void save(i.id, { discussed: !i.discussed })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!i.discussed }}
                  accessibilityLabel={`Discussed: ${i.title}`}
                  hitSlop={8}
                  style={{ paddingTop: 1 }}
                >
                  <Ionicons name={i.discussed ? 'checkbox' : 'square-outline'} size={20} color={i.discussed ? '#16A34A' : '#D1D5DB'} />
                </Pressable>
                <Pressable
                  className="flex-1"
                  disabled={i.type !== 'task' || !i.taskId}
                  onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: i.taskId as string } } as never)}
                  testID={i.type === 'task' ? 'meeting-detail-task' : undefined}
                  accessibilityRole={i.type === 'task' ? 'link' : undefined}
                >
                  <View className="flex-row items-center gap-1.5 flex-wrap">
                    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: i.type === 'task' ? '#EEF2F7' : '#F3E8FF', maxWidth: 140 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: i.type === 'task' ? NAVY : '#7C3AED' }} numberOfLines={1}>
                        {i.type === 'task' ? (i.departmentName ?? 'Task') : 'Topic'}
                      </Text>
                    </View>
                    {d ? (
                      <Text style={{ fontSize: 11, fontWeight: '700', color: STATUS_COLOR[d.status] ?? '#6B7280' }}>{d.status.replace(/_/g, ' ')}</Text>
                    ) : null}
                  </View>
                  <Text className={`text-sm mt-0.5 ${i.type === 'task' ? 'font-semibold text-brand-navy' : 'text-neutral-900'}`} numberOfLines={2}>
                    {i.title}
                  </Text>
                  {i.type === 'task' ? (
                    <Text testID="meeting-detail-task-dates" className="text-2xs text-neutral-500 mt-0.5">
                      {i.taskCode ? `${i.taskCode} · ` : ''}
                      {d
                        ? `Planned ${shortDay(d.plannedStart)} → ${shortDay(d.plannedEnd)}${d.actualStart ? ` · Started ${shortDay(d.actualStart)}` : ''}${d.actualEnd ? ` · Ended ${shortDay(d.actualEnd)}` : ''}${d.deleted ? ' · task deleted' : ''}`
                        : ''}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
              <View style={{ marginLeft: 28, marginTop: 4 }}>
                <Field
                  testID="minutes-item-note"
                  value={drafts[i.id] ?? ''}
                  onChangeText={(v) => setDrafts((x) => ({ ...x, [i.id]: v }))}
                  onBlur={() => {
                    if ((drafts[i.id] ?? '') !== (i.note ?? '')) void save(i.id, { note: drafts[i.id] ?? '' });
                  }}
                  placeholder="Notes / decision (optional)"
                  multiline
                  style={{ minHeight: 40, textAlignVertical: 'top', paddingVertical: 8 }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
