import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  fetchProjectDepartmentNames,
  fetchStakeholderReport,
  type StakeholderFilter,
  type StakeholderReport,
  type StakeholderTaskRow,
} from '../../lib/reports/stakeholderReport';
import { formatContactCard, whatsappShareUrl, type Contact } from '../../lib/contacts';
import { CATEGORY_LABEL, STATUS_CHIP, type CompletionStatus, type DependencyCategory } from '../../lib/taskDetail/constants';
import { formatDateLabel } from '../../lib/reports/dateRange';
import { ReportProjectPicker } from '../../components/reports/ReportProjectPicker';
import { ReportSection } from '../../components/reports/ReportSection';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

// Report by Architect/Client/Vendor/Dept/Contractor — a live snapshot, not
// a date-range list (that's activity-report.tsx's job): what input is this
// party still holding up right now, and what real downstream delay does
// that cause. See lib/reports/stakeholderReport.ts's own header comment.

function ContactCard({ contact }: { contact: Contact }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(formatContactCard(contact));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleWhatsApp() {
    try {
      await Linking.openURL(whatsappShareUrl(contact));
    } catch {
      Alert.alert('WhatsApp not available', 'WhatsApp doesn’t appear to be installed on this device.');
    }
  }

  return (
    <Card className="mb-3">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Follow up with</Text>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900">{contact.name}</Text>
          <Text className="text-xs text-neutral-500 mt-0.5">
            {contact.phoneNumber}
            {contact.companyName ? ` · ${contact.companyName}` : ''}
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable onPress={handleWhatsApp} className="w-9 h-9 rounded-full bg-green-50 items-center justify-center">
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
          </Pressable>
          <Pressable onPress={handleCopy} className="w-9 h-9 rounded-full bg-neutral-100 items-center justify-center">
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#0F1F33" />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View className="flex-1 rounded-xl bg-white border border-neutral-100 px-3 py-2.5">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">{label}</Text>
      <Text className="text-lg font-extrabold mt-0.5" style={{ color }}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: CompletionStatus }) {
  const chip = STATUS_CHIP[status];
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: chip.bg }}>
      <Text className="text-2xs font-semibold" style={{ color: chip.text }}>{chip.label}</Text>
    </View>
  );
}

function TaskRowCard({ row }: { row: StakeholderTaskRow }) {
  return (
    <Card className="mb-2.5">
      <View className="flex-row items-start justify-between mb-1.5">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>{row.taskName}</Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            {row.taskCode} · {row.workName}
          </Text>
        </View>
        {row.isOverdue ? (
          <View className="px-2 py-0.5 rounded-full bg-red-100">
            <Text className="text-2xs font-bold text-red-700">Delayed</Text>
          </View>
        ) : row.dueDate ? (
          <Text className="text-2xs font-semibold text-neutral-400">Due {formatDateLabel(row.dueDate)}</Text>
        ) : null}
      </View>

      <View className="gap-1.5">
        {row.pendingItems.map((item, i) => (
          <View key={i} className="flex-row items-center justify-between rounded-lg bg-neutral-50 px-2.5 py-1.5">
            <Text className="text-xs text-neutral-700 flex-1 pr-2" numberOfLines={2}>
              {item.label}
              {item.isMandatory && <Text style={{ color: '#DC2626' }}> *</Text>}
            </Text>
            <StatusBadge status={item.status} />
          </View>
        ))}
      </View>

      {row.blocking.length > 0 && (
        <View className="mt-2 pt-2 border-t border-neutral-100">
          <Text className="text-2xs font-semibold text-amber-700">
            Holding up {row.blocking.length} task{row.blocking.length === 1 ? '' : 's'}:{' '}
            <Text className="text-neutral-500 font-normal">{row.blocking.map((b) => b.taskName).join(', ')}</Text>
          </Text>
        </View>
      )}
    </Card>
  );
}

export default function StakeholderReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId } = useProject();
  const params = useLocalSearchParams<{ category?: string; title?: string }>();
  const category = params.category as DependencyCategory | undefined;
  const isDepartmentMode = !category;
  const title = params.title ?? (category ? `${CATEGORY_LABEL[category]} Status` : 'Department Status');

  const [departments, setDepartments] = useState<string[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [report, setReport] = useState<StakeholderReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDepartmentMode || !selectedProjectId) return;
    fetchProjectDepartmentNames(selectedProjectId).then(setDepartments).catch(() => {});
  }, [isDepartmentMode, selectedProjectId]);

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    if (isDepartmentMode && !selectedDept) {
      setReport(null);
      setLoading(false);
      return;
    }
    const filter: StakeholderFilter = category ? { kind: 'category', category } : { kind: 'department', workName: selectedDept! };
    try {
      setError(null);
      setLoading(true);
      setReport(await fetchStakeholderReport(selectedProjectId, filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, category, isDepartmentMode, selectedDept]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        <ReportProjectPicker />

        {!selectedProjectId ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="Select a project" subtitle="Pick a project above to generate its report." />
        ) : (
          <>
            {isDepartmentMode && (
              <View className="flex-row flex-wrap gap-1.5 mb-3">
                {departments.map((name) => {
                  const active = name === selectedDept;
                  return (
                    <Pressable
                      key={name}
                      onPress={() => setSelectedDept(name)}
                      className="px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
                    >
                      <Text className="text-2xs font-bold" style={{ color: active ? '#fff' : '#525252' }}>{name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {isDepartmentMode && !selectedDept ? (
              <EmptyState icon="business-outline" iconColor="#9CA3AF" title="Pick a department" subtitle="Choose a department above to generate its report." />
            ) : loading ? (
              <View className="items-center py-10">
                <ActivityIndicator color="#0F1F33" />
              </View>
            ) : error ? (
              <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
                <Text className="text-sm text-red-600 mb-2.5">{error}</Text>
                <Pressable onPress={load} className="self-start px-3.5 py-1.5 rounded-lg bg-white border border-red-200">
                  <Text className="text-xs font-semibold text-red-600">Retry</Text>
                </Pressable>
              </View>
            ) : !report ? null : (
              <>
                {report.contacts.map((c) => (
                  <ContactCard key={c.id} contact={c} />
                ))}

                <View className="flex-row gap-2 mb-3">
                  <StatTile label="Affected Tasks" value={report.affectedTaskCount} color="#0F1F33" />
                  <StatTile label="Delayed" value={report.delayedTaskCount} color="#DC2626" />
                  <StatTile label="Pending Inputs" value={report.totalPendingItems} color="#B45309" />
                </View>

                {report.rows.length === 0 ? (
                  <EmptyState
                    icon="checkmark-circle-outline"
                    iconColor="#16A34A"
                    title="Nothing pending"
                    subtitle="No open tasks are currently waiting on this party."
                  />
                ) : (
                  <ReportSection title={`Pending Inputs (${report.rows.length} task${report.rows.length === 1 ? '' : 's'})`}>
                    {report.rows.map((row) => (
                      <TaskRowCard key={row.taskId} row={row} />
                    ))}
                  </ReportSection>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
