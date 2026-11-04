import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import { FLOOR_LEVEL_PRESETS, ROOM_TYPE_PRESETS } from '../../lib/flowchart/types';
import type { Milestone } from '../../lib/flowchart/milestones';
import { PLANNED_DATE_MODE_LABEL, type PlannedDateMode } from '../../lib/flowchart/plannedDateFilter';

// Three independent, combinable filters — Floor Level, Department (the
// project's own real work/trade names), and Room Type — by explicit
// request ("FILTER BY FLOOR... FILTER BY DEPARTMENT... FILTER... RELATED
// TO ROOM"). null in any of the three means "All" for that dimension.
function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        <Pressable
          onPress={() => onChange(null)}
          className="px-2.5 py-1.5 rounded-full"
          style={{ backgroundColor: value === null ? '#0F1F33' : '#F5F5F5' }}
        >
          <Text className="text-2xs font-semibold" style={{ color: value === null ? '#fff' : '#525252' }}>All</Text>
        </Pressable>
        {options.map((option) => {
          const active = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(active ? null : option)}
              className="px-2.5 py-1.5 rounded-full"
              style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
            >
              <Text className="text-2xs font-semibold" style={{ color: active ? '#fff' : '#525252' }}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Milestone chips use each milestone's OWN color when active (matching the
// canvas legend's color-coding) rather than the generic navy every other
// ChipRow uses — a milestone's color is its identity everywhere else in the
// flowchart, so the filter chip should read the same way.
function MilestoneChipRow({
  milestones,
  value,
  onChange,
}: {
  milestones: Milestone[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (milestones.length === 0) return null;
  return (
    <View className="mb-4">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Milestone</Text>
      <View className="flex-row flex-wrap gap-1.5">
        <Pressable
          onPress={() => onChange(null)}
          className="px-2.5 py-1.5 rounded-full"
          style={{ backgroundColor: value === null ? '#0F1F33' : '#F5F5F5' }}
        >
          <Text className="text-2xs font-semibold" style={{ color: value === null ? '#fff' : '#525252' }}>All</Text>
        </Pressable>
        {milestones.map((m) => {
          const active = m.id === value;
          return (
            <Pressable
              key={m.id}
              onPress={() => onChange(active ? null : m.id)}
              className="px-2.5 py-1.5 rounded-full flex-row items-center gap-1.5"
              style={{ backgroundColor: active ? m.color : '#F5F5F5' }}
            >
              {!active && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />}
              <Text className="text-2xs font-semibold" style={{ color: active ? '#fff' : '#525252' }}>{m.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const PLANNED_DATE_MODES: PlannedDateMode[] = ['start', 'complete', 'happening'];

// Custom date-range filter with a calendar (DateField already opens the
// platform calendar/date picker) — by explicit request. One shared range
// checked against whichever "supposed to..." meaning is picked below,
// rather than 3 separate date filters; see lib/flowchart/plannedDateFilter.ts.
function PlannedDateSection({
  mode,
  from,
  to,
  onChangeMode,
  onChangeFrom,
  onChangeTo,
}: {
  mode: PlannedDateMode | null;
  from: string | null;
  to: string | null;
  onChangeMode: (v: PlannedDateMode | null) => void;
  onChangeFrom: (v: string) => void;
  onChangeTo: (v: string) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400 mb-1.5">Planned Date</Text>
      <View className="flex-row flex-wrap gap-1.5 mb-3">
        <Pressable
          onPress={() => onChangeMode(null)}
          className="px-2.5 py-1.5 rounded-full"
          style={{ backgroundColor: mode === null ? '#0F1F33' : '#F5F5F5' }}
        >
          <Text className="text-2xs font-semibold" style={{ color: mode === null ? '#fff' : '#525252' }}>Off</Text>
        </Pressable>
        {PLANNED_DATE_MODES.map((m) => {
          const active = m === mode;
          return (
            <Pressable
              key={m}
              onPress={() => onChangeMode(active ? null : m)}
              className="px-2.5 py-1.5 rounded-full"
              style={{ backgroundColor: active ? '#0F1F33' : '#F5F5F5' }}
            >
              <Text className="text-2xs font-semibold" style={{ color: active ? '#fff' : '#525252' }}>{PLANNED_DATE_MODE_LABEL[m]}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode !== null && (
        <View className="flex-row gap-3">
          <View className="flex-1">
            {/* maxDate/minDate below constrain the calendar itself so an
                inverted range can't be picked at all — this modal has no
                DateRangeBar-style inline "From must be before To" warning,
                so an invalid pick would otherwise just silently fail to
                activate the filter with no explanation. */}
            <DateField label="From" value={from} maxDate={to} onChange={onChangeFrom} />
          </View>
          <View className="flex-1">
            <DateField label="To" value={to} minDate={from} onChange={onChangeTo} />
          </View>
        </View>
      )}
    </View>
  );
}

export function FlowchartFilterModal({
  visible,
  departments,
  floor,
  department,
  room,
  milestones,
  milestoneId,
  dateMode,
  dateFrom,
  dateTo,
  onChangeFloor,
  onChangeDepartment,
  onChangeRoom,
  onChangeMilestone,
  onChangeDateMode,
  onChangeDateFrom,
  onChangeDateTo,
  onClear,
  onClose,
}: {
  visible: boolean;
  departments: string[];
  floor: string | null;
  department: string | null;
  room: string | null;
  milestones: Milestone[];
  milestoneId: string | null;
  dateMode: PlannedDateMode | null;
  dateFrom: string | null;
  dateTo: string | null;
  onChangeFloor: (v: string | null) => void;
  onChangeDepartment: (v: string | null) => void;
  onChangeRoom: (v: string | null) => void;
  onChangeMilestone: (v: string | null) => void;
  onChangeDateMode: (v: PlannedDateMode | null) => void;
  onChangeDateFrom: (v: string) => void;
  onChangeDateTo: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 400, maxHeight: '80%' }}>
          <Card>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-md font-bold text-neutral-900">Filter Flowchart</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <ChipRow label="Floor" options={FLOOR_LEVEL_PRESETS} value={floor} onChange={onChangeFloor} />
              <ChipRow label="Department" options={departments} value={department} onChange={onChangeDepartment} />
              <ChipRow label="Room" options={ROOM_TYPE_PRESETS} value={room} onChange={onChangeRoom} />
              <MilestoneChipRow milestones={milestones} value={milestoneId} onChange={onChangeMilestone} />
              <PlannedDateSection
                mode={dateMode}
                from={dateFrom}
                to={dateTo}
                onChangeMode={onChangeDateMode}
                onChangeFrom={onChangeDateFrom}
                onChangeTo={onChangeDateTo}
              />
            </ScrollView>

            <View className="flex-row justify-between items-center pt-2 border-t border-neutral-100">
              <Pressable onPress={onClear} className="px-3 py-2">
                <Text className="text-xs font-semibold text-neutral-500">Clear all</Text>
              </Pressable>
              <Pressable onPress={onClose} className="px-4 py-2 rounded-lg bg-brand-navy">
                <Text className="text-xs font-bold text-white">Done</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
