import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack } from 'expo-router';
import { roleLabel, useAuth, type UserRole } from '../../lib/AuthContext';
import { useProject } from '../../lib/ProjectContext';
import {
  fetchProjectSiteEngineers,
  fetchSiteEngineerReport,
  type SiteEngineerAttendanceSummary,
  type SiteEngineerDelayRow,
  type SiteEngineerDelaySummary,
  type SiteEngineerDprRow,
  type SiteEngineerDprSummary,
  type SiteEngineerLeaveSummary,
  type SiteEngineerOption,
  type SiteEngineerQualityChecklistRow,
  type SiteEngineerQualityChecklistSummary,
  type SiteEngineerReport,
} from '../../lib/reports/siteEngineerReport';
import { DPR_COMMENT_LABEL, DPR_DEPENDENCY_LABEL } from '../../lib/dprEntries';
import { leaveReasonLabelFor, type LeaveLogEntry } from '../../lib/leaveEvents';
import { type DateRange, defaultLast7Days, formatDateLabel } from '../../lib/reports/dateRange';
import { formatDateLabel as formatIstDayLabel, formatTime12h } from '../../lib/formatTime';
import type { DailyAttendanceRecord } from '../../lib/attendanceReview';
import { DateRangeBar } from '../../components/reports/DateRangeBar';
import { ReportProjectPicker } from '../../components/reports/ReportProjectPicker';
import { ReportSection } from '../../components/reports/ReportSection';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

// One site engineer's Delay Tracking + Attendance (working hours, check-in/
// check-out times) + Leave + DPR submission history for a project — by
// explicit request, in that order. Combines FOUR data sources that already
// existed separately (see lib/reports/siteEngineerReport.ts's own header
// comment for exactly which). Staff-only (redirect below + REPORT_SUBMENU's
// own filter in DrawerContent.tsx) — same "don't offer a client a menu item
// that just dead-ends" reasoning as Team Attendance/Leave Log elsewhere in
// the app; this surfaces individual engineers' check-in times, scores,
// delay-by-person, and DPR submission history, which is internal
// staff-performance data, not a client-facing progress view like the other
// Report-by-X screens.
//
// Every picker/field here (engineer, date range) applies IMMEDIATELY on
// selection — no separate "Generate Report" step — by explicit feedback
// that a select-then-generate flow was unwanted friction; see
// DateRangeBar.tsx's own header comment for the shared fix.

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View className="flex-1 rounded-xl bg-white border border-neutral-100 px-3 py-2.5">
      <Text className="text-2xs font-bold uppercase tracking-wide text-neutral-400">{label}</Text>
      <Text className="text-lg font-extrabold mt-0.5" style={{ color }}>
        {value}
      </Text>
    </View>
  );
}

function DelayTaskRowCard({ row }: { row: SiteEngineerDelayRow }) {
  const statusLabel = !row.isComplete && row.isOverdue
    ? `Overdue ${row.delayDays}d`
    : row.isComplete && row.delayDays > 0
      ? `Completed ${row.delayDays}d late`
      : row.isComplete
        ? 'Completed on time'
        : 'On track';
  const statusColor = row.delayDays > 0 ? '#DC2626' : row.isComplete ? '#16A34A' : '#0F1F33';
  const statusBg = row.delayDays > 0 ? '#FDECEC' : row.isComplete ? '#EAF7EE' : '#EEF2F6';
  return (
    <Card className="mb-2.5">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
            {row.taskName}
          </Text>
          <Text className="text-2xs text-neutral-400 mt-0.5">
            {row.taskCode} · {row.workName}
          </Text>
        </View>
        <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: statusBg }}>
          <Text className="text-2xs font-bold" style={{ color: statusColor }}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text className="text-xs text-neutral-500 mt-1">
        Due {formatDateLabel(row.dueDate)}
        {row.actualEndDate ? ` · Completed ${formatDateLabel(row.actualEndDate)}` : ''}
      </Text>
    </Card>
  );
}

function LeaveEventRow({ entry }: { entry: LeaveLogEntry }) {
  const d = new Date(entry.leftAtISO);
  return (
    <Card className="mb-2.5">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900">{leaveReasonLabelFor(entry.reasonPreset, null)}</Text>
        <Text className="text-2xs text-neutral-400">{formatIstDayLabel(d)} · {formatTime12h(d)}</Text>
      </View>
      {entry.reasonNote && <Text className="text-xs text-neutral-500 italic">&quot;{entry.reasonNote}&quot;</Text>}
    </Card>
  );
}

function AttendanceDayRow({ day }: { day: DailyAttendanceRecord }) {
  const statusLabel = day.isAbsent ? 'Absent' : day.wasLate ? 'Late' : 'On time';
  const statusColor = day.isAbsent ? '#DC2626' : day.wasLate ? '#B45309' : '#16A34A';
  const statusBg = day.isAbsent ? '#FDECEC' : day.wasLate ? '#FEF3E2' : '#EAF7EE';
  return (
    <Card className="mb-2.5">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-sm font-bold text-neutral-900">{formatDateLabel(day.date)}</Text>
        <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: statusBg }}>
          <Text className="text-2xs font-bold" style={{ color: statusColor }}>
            {statusLabel}
          </Text>
        </View>
      </View>
      {!day.isAbsent && (
        <Text className="text-xs text-neutral-500">
          {formatTime12h(day.checkInTime)} – {day.checkOutTime ? formatTime12h(day.checkOutTime) : 'still on site'}
          {day.totalHoursOnSite != null ? ` · ${day.totalHoursOnSite}h on site` : ''}
        </Text>
      )}
    </Card>
  );
}

// A day's worth of THIS engineer's DPR entries as one grouped card, not one
// elevated Card per entry — by explicit feedback, this section used to
// reuse the exact same per-task card the generic Weekly/Daily Report shows
// (app/reports/activity-report.tsx's own ActivityRowCard), which read as
// indistinguishable from that generic report. Grouping by day (with a
// violet accent tying it to this screen's own icon color in app/reports.tsx)
// reframes it as "this person's daily submission log" instead of a flat
// task list, and surfaces the entry's own submittedAtISO (when they
// actually logged it, not just which day it's for) — a detail the generic
// report has no reason to show but this one does.
const DPR_ACCENT = '#7C3AED';

function groupDprRowsByDay(rows: SiteEngineerDprRow[]): { date: string; rows: SiteEngineerDprRow[] }[] {
  const byDate = new Map<string, SiteEngineerDprRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.reportDate) ?? [];
    bucket.push(row);
    byDate.set(row.reportDate, bucket);
  }
  return [...byDate.entries()].map(([date, rows]) => ({ date, rows })).sort((a, b) => b.date.localeCompare(a.date));
}

function DprDayGroup({ date, rows }: { date: string; rows: SiteEngineerDprRow[] }) {
  return (
    <Card accentColor={DPR_ACCENT} className="mb-2.5">
      <View className="flex-row items-center justify-between pb-2.5 mb-1 border-b border-neutral-100">
        <Text className="text-sm font-extrabold text-neutral-900">{formatDateLabel(date)}</Text>
        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: `${DPR_ACCENT}1F` }}>
          <Text className="text-2xs font-bold" style={{ color: DPR_ACCENT }}>
            {rows.length} DPR{rows.length === 1 ? '' : 's'}
          </Text>
        </View>
      </View>
      {rows.map((row, i) => (
        <View key={`${row.taskId}-${row.submittedAtISO}`} className={`py-2.5 ${i < rows.length - 1 ? 'border-b border-neutral-100' : ''}`}>
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-2">
              <Text className="text-sm font-semibold text-neutral-800" numberOfLines={1}>
                {row.taskName}
              </Text>
              <Text className="text-2xs text-neutral-400 mt-0.5">
                {row.taskCode} · {row.workName}
              </Text>
            </View>
            <View className="items-end">
              {row.percentComplete != null && (
                <View className="px-2 py-0.5 rounded-full bg-emerald-50">
                  <Text className="text-2xs font-bold text-emerald-700">{row.percentComplete}%</Text>
                </View>
              )}
              <Text className="text-2xs text-neutral-400 mt-1">{formatTime12h(new Date(row.submittedAtISO))}</Text>
            </View>
          </View>
          {row.dependencyCategories.length > 0 && (
            <View className="flex-row flex-wrap gap-1 mt-1.5">
              {row.dependencyCategories.map((c) => (
                <View key={c} className="px-2 py-0.5 rounded-full bg-neutral-100">
                  <Text className="text-2xs font-semibold text-neutral-600">{DPR_DEPENDENCY_LABEL[c]}</Text>
                </View>
              ))}
            </View>
          )}
          {row.commentPreset && (
            <Text className="text-2xs text-neutral-500 mt-1.5">
              {row.commentPreset === 'other' ? row.commentText : DPR_COMMENT_LABEL[row.commentPreset]}
            </Text>
          )}
        </View>
      ))}
    </Card>
  );
}

function QualityChecklistRowCard({ row }: { row: SiteEngineerQualityChecklistRow }) {
  return (
    <Card accentColor="#16A34A" className="mb-2.5 flex-row items-center justify-between">
      <View className="flex-1 pr-2">
        <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
          {row.taskName}
        </Text>
        <Text className="text-2xs text-neutral-400 mt-0.5">
          {row.taskCode} · {row.workName}
        </Text>
      </View>
      <View className="items-end">
        <View className="px-2 py-0.5 rounded-full bg-emerald-50">
          <Text className="text-2xs font-bold text-emerald-700">Signed</Text>
        </View>
        <Text className="text-2xs text-neutral-400 mt-1">
          {formatIstDayLabel(new Date(row.uploadedAtISO))} · {formatTime12h(new Date(row.uploadedAtISO))}
        </Text>
      </View>
    </Card>
  );
}

// Consistency % color bands — 80+ green (regularly filing DPRs on days
// they're on site), 50-79 amber (patchy), below that red — same 3-tier
// severity language as every other status chip in this report, not a new
// convention.
function consistencyColor(pct: number | null): string {
  if (pct == null) return '#0F1F33';
  if (pct >= 80) return '#16A34A';
  if (pct >= 50) return '#B45309';
  return '#DC2626';
}

// --- Sample preview (temporary, by explicit request) ---------------------
// A picked engineer/project/date-range combo can genuinely have zero real
// rows in any given section (a brand-new assignment, or just a quiet week)
// — that's correct empty-state behavior, not a bug. But while reviewing the
// redesigned layout there was nothing real to look at yet, so each section
// falls back to this clearly-labeled illustrative content (never written to
// Supabase, never mixed silently with real rows — SamplePreviewBanner marks
// it every time it's shown). Remove this whole block once every section has
// been checked against real data.
const SAMPLE_DELAY_ROWS: SiteEngineerDelayRow[] = [
  {
    taskId: 'sample-1',
    taskCode: 'ELEC-SAMPLE-01',
    taskName: 'First fix wiring — Ground floor kitchen',
    workName: 'Electrical',
    dueDate: '2026-09-12',
    actualEndDate: '2026-09-14',
    isComplete: true,
    isOverdue: false,
    delayDays: 2,
  },
  {
    taskId: 'sample-2',
    taskCode: 'MILE-SAMPLE-02',
    taskName: '+3\'-6" level Slab casting',
    workName: 'Civil Works',
    dueDate: '2026-09-15',
    actualEndDate: null,
    isComplete: false,
    isOverdue: true,
    delayDays: 1,
  },
  {
    taskId: 'sample-3',
    taskCode: 'HVAC-SAMPLE-01',
    taskName: 'Ducting layout — Mezzanine floor',
    workName: 'HVAC',
    dueDate: '2026-09-16',
    actualEndDate: null,
    isComplete: false,
    isOverdue: false,
    delayDays: 0,
  },
];
const SAMPLE_DELAY_SUMMARY: SiteEngineerDelaySummary = { tasksDueCount: 3, delayedTaskCount: 2, overdueOpenCount: 1, avgDelayDays: 1 };

function sampleAttendanceDay(
  date: string,
  opts: { isAbsent?: boolean; wasLate?: boolean; hours?: number | null; checkIn?: string; checkOut?: string | null }
): DailyAttendanceRecord {
  const checkInTime = opts.isAbsent ? null : new Date(`${date}T${opts.checkIn ?? '09:05:00'}+05:30`);
  const checkOutTime = opts.isAbsent || !opts.checkOut ? null : new Date(`${date}T${opts.checkOut}+05:30`);
  return {
    date,
    sessions: [],
    isCurrentlyClockedIn: false,
    checkInTime,
    checkOutTime,
    checkInLocation: null,
    checkOutLocation: null,
    deviceManufacturer: null,
    deviceModel: null,
    scheduledStart: null,
    scheduledEnd: null,
    totalHoursOnSite: opts.hours ?? null,
    wasLate: opts.wasLate ?? false,
    leftEarly: false,
    zoneExitCount: 0,
    redZoneEntryCount: 0,
    unresolvedRedZoneEntryCount: 0,
    trackingDegradedMinutes: 0,
    locationDisabledEpisodes: [],
    redZoneEntries: [],
    isAbsent: opts.isAbsent ?? false,
    score: opts.isAbsent ? 0 : opts.wasLate ? 90 : 100,
  };
}
const SAMPLE_ATTENDANCE: DailyAttendanceRecord[] = [
  sampleAttendanceDay('2026-09-16', { checkIn: '09:02:00', checkOut: '18:10:00', hours: 9.1 }),
  sampleAttendanceDay('2026-09-15', { checkIn: '09:40:00', checkOut: '18:05:00', hours: 8.4, wasLate: true }),
  sampleAttendanceDay('2026-09-14', { checkIn: '08:58:00', checkOut: '17:55:00', hours: 8.9 }),
  sampleAttendanceDay('2026-09-13', { isAbsent: true }),
  sampleAttendanceDay('2026-09-12', { checkIn: '09:05:00', checkOut: '18:00:00', hours: 8.9 }),
];
const SAMPLE_ATTENDANCE_SUMMARY: SiteEngineerAttendanceSummary = {
  presentDays: 4,
  absentDays: 1,
  lateDays: 1,
  earlyDepartureDays: 0,
  totalHoursOnSite: 35.3,
  averageScore: 92,
};

const SAMPLE_LEAVE_ENTRIES: LeaveLogEntry[] = [
  {
    id: 'sample-leave-1',
    userId: 'sample',
    userName: null,
    projectId: null,
    projectName: null,
    leftAtISO: '2026-09-14T10:30:00.000Z',
    reasonPreset: 'material_pickup',
    reasonNote: null,
  },
  {
    id: 'sample-leave-2',
    userId: 'sample',
    userName: null,
    projectId: null,
    projectName: null,
    leftAtISO: '2026-09-12T13:15:00.000Z',
    reasonPreset: 'client_visit',
    reasonNote: 'Walkthrough with client rep',
  },
];
const SAMPLE_LEAVE_SUMMARY: SiteEngineerLeaveSummary = {
  totalCount: 2,
  byReason: [
    { reasonPreset: 'material_pickup', label: leaveReasonLabelFor('material_pickup', null), count: 1 },
    { reasonPreset: 'client_visit', label: leaveReasonLabelFor('client_visit', null), count: 1 },
  ],
};

const SAMPLE_DPR_ROWS: SiteEngineerDprRow[] = [
  {
    taskId: 'sample-1',
    taskCode: 'ELEC-SAMPLE-01',
    taskName: 'First fix wiring — Ground floor kitchen',
    workName: 'Electrical',
    reportDate: '2026-09-14',
    submittedAtISO: '2026-09-14T11:05:00.000Z',
    percentComplete: 35,
    dependencyCategories: ['contractor'],
    commentPreset: 'labour_shortage',
    commentText: null,
  },
  {
    taskId: 'sample-2',
    taskCode: 'MILE-SAMPLE-02',
    taskName: '+3\'-6" level Slab casting',
    workName: 'Civil Works',
    reportDate: '2026-09-14',
    submittedAtISO: '2026-09-14T16:40:00.000Z',
    percentComplete: 45,
    dependencyCategories: ['contractor', 'vendor'],
    commentPreset: 'coordination_pending',
    commentText: null,
  },
  {
    taskId: 'sample-3',
    taskCode: 'HVAC-SAMPLE-01',
    taskName: 'Ducting layout — Mezzanine floor',
    workName: 'HVAC',
    reportDate: '2026-09-12',
    submittedAtISO: '2026-09-12T15:20:00.000Z',
    percentComplete: 20,
    dependencyCategories: ['architect'],
    commentPreset: 'awaiting_drawing_clarification',
    commentText: null,
  },
];
const SAMPLE_DPR_SUMMARY: SiteEngineerDprSummary = {
  entryCount: 3,
  taskCount: 3,
  cumulativePercent: 33.3,
  submissionDays: 2,
  consistencyPercent: 50,
};

const SAMPLE_QUALITY_ROWS: SiteEngineerQualityChecklistRow[] = [
  {
    id: 'sample-quality-1',
    taskId: 'sample-1',
    taskCode: 'ELEC-SAMPLE-01',
    taskName: 'First fix wiring — Ground floor kitchen',
    workName: 'Electrical',
    uploadedAtISO: '2026-09-14T17:20:00.000Z',
  },
  {
    id: 'sample-quality-2',
    taskId: 'sample-2',
    taskCode: 'MILE-SAMPLE-02',
    taskName: '+3\'-6" level Slab casting',
    workName: 'Civil Works',
    uploadedAtISO: '2026-09-12T12:05:00.000Z',
  },
];
const SAMPLE_QUALITY_SUMMARY: SiteEngineerQualityChecklistSummary = { uploadCount: 2, taskCount: 2 };

function SamplePreviewBanner() {
  return (
    <View className="flex-row items-center gap-1.5 mb-2.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 self-start">
      <Ionicons name="flask-outline" size={12} color="#B45309" />
      <Text className="text-2xs font-semibold text-amber-700">Sample preview — no real activity in this window yet</Text>
    </View>
  );
}

// The 4 sections below, split out once `report` has actually loaded — keeps
// the real-vs-sample fallback for each section (delayRows/attendance/
// leaveEntries/dprRows independently, since one section being empty doesn't
// imply the others are) as a plain const per section instead of repeating
// an inline ternary block 4 times in the screen's own JSX.
function SiteEngineerReportBody({ report }: { report: SiteEngineerReport }) {
  const usingSampleDelay = report.delayRows.length === 0;
  const delayRows = usingSampleDelay ? SAMPLE_DELAY_ROWS : report.delayRows;
  const delaySummary = usingSampleDelay ? SAMPLE_DELAY_SUMMARY : report.delaySummary;

  const usingSampleAttendance = report.attendance.length === 0;
  const attendance = usingSampleAttendance ? SAMPLE_ATTENDANCE : report.attendance;
  const attendanceSummary = usingSampleAttendance ? SAMPLE_ATTENDANCE_SUMMARY : report.attendanceSummary;

  const usingSampleLeave = report.leaveEntries.length === 0;
  const leaveEntries = usingSampleLeave ? SAMPLE_LEAVE_ENTRIES : report.leaveEntries;
  const leaveSummary = usingSampleLeave ? SAMPLE_LEAVE_SUMMARY : report.leaveSummary;

  const usingSampleDpr = report.dprRows.length === 0;
  const dprRows = usingSampleDpr ? SAMPLE_DPR_ROWS : report.dprRows;
  const dprSummary = usingSampleDpr ? SAMPLE_DPR_SUMMARY : report.dprSummary;

  const usingSampleQuality = report.qualityRows.length === 0;
  const qualityRows = usingSampleQuality ? SAMPLE_QUALITY_ROWS : report.qualityRows;
  const qualitySummary = usingSampleQuality ? SAMPLE_QUALITY_SUMMARY : report.qualitySummary;

  return (
    <>
      <ReportSection title="Delay Tracking">
        {usingSampleDelay && <SamplePreviewBanner />}
        <View className="flex-row gap-2.5 mb-2.5">
          <StatTile label="Tasks Due" value={delaySummary.tasksDueCount} color="#0F1F33" />
          <StatTile label="Delayed" value={delaySummary.delayedTaskCount} color="#DC2626" />
          <StatTile label="Avg Delay (d)" value={delaySummary.avgDelayDays} color="#B45309" />
        </View>
        {delayRows.map((row) => (
          <DelayTaskRowCard key={row.taskId} row={row} />
        ))}
      </ReportSection>

      <ReportSection title="Attendance (Working Hours)">
        {usingSampleAttendance && <SamplePreviewBanner />}
        <View className="flex-row gap-2.5 mb-2.5">
          <StatTile label="Present" value={attendanceSummary.presentDays} color="#16A34A" />
          <StatTile label="Absent" value={attendanceSummary.absentDays} color="#DC2626" />
          <StatTile label="Late" value={attendanceSummary.lateDays} color="#B45309" />
        </View>
        <View className="flex-row gap-2.5">
          <StatTile label="Left Early" value={attendanceSummary.earlyDepartureDays} color="#B45309" />
          <StatTile label="Hours on Site" value={attendanceSummary.totalHoursOnSite} color="#0F1F33" />
          <StatTile label="Avg Score" value={attendanceSummary.averageScore} color="#0F1F33" />
        </View>
      </ReportSection>

      <ReportSection title="Daily Attendance · Check-in / Check-out">
        {usingSampleAttendance && <SamplePreviewBanner />}
        {attendance.map((day) => (
          <AttendanceDayRow key={day.date} day={day} />
        ))}
      </ReportSection>

      <ReportSection title={`Leave (${leaveSummary.totalCount})`} subtitle="How often this engineer has stepped off site, and why">
        {usingSampleLeave && <SamplePreviewBanner />}
        {leaveSummary.byReason.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5 mb-2.5">
            {leaveSummary.byReason.map((r) => (
              <View key={r.reasonPreset} className="px-2.5 py-1 rounded-full bg-neutral-100">
                <Text className="text-2xs font-semibold text-neutral-600">
                  {r.label} · {r.count}
                </Text>
              </View>
            ))}
          </View>
        )}
        {leaveEntries.map((entry) => (
          <LeaveEventRow key={entry.id} entry={entry} />
        ))}
      </ReportSection>

      <ReportSection
        title={`DPR Submission (${dprSummary.entryCount} entr${dprSummary.entryCount === 1 ? 'y' : 'ies'} · ${dprSummary.taskCount} task${dprSummary.taskCount === 1 ? '' : 's'})`}
      >
        {usingSampleDpr && <SamplePreviewBanner />}
        {/* Regularity, not just the raw entry/task counts already in the
            title above — of the days this engineer was actually present
            (Attendance section), what share got a DPR filed. */}
        <View className="flex-row gap-2.5 mb-2.5">
          <StatTile label="Submission Days" value={dprSummary.submissionDays} color="#0F1F33" />
          <StatTile
            label="Consistency"
            value={dprSummary.consistencyPercent != null ? `${dprSummary.consistencyPercent}%` : '—'}
            color={consistencyColor(dprSummary.consistencyPercent)}
          />
        </View>
        {groupDprRowsByDay(dprRows).map((group) => (
          <DprDayGroup key={group.date} date={group.date} rows={group.rows} />
        ))}
        <View className="rounded-xl px-4 py-3 mt-1" style={{ backgroundColor: '#2E1065' }}>
          <Text className="text-2xs font-bold uppercase tracking-wide text-white/50 mb-0.5">Cumulative Progress</Text>
          <Text className="text-lg font-extrabold text-white">{dprSummary.cumulativePercent != null ? `${dprSummary.cumulativePercent}%` : '—'}</Text>
        </View>
      </ReportSection>

      <ReportSection
        title={`Quality Checklist (${qualitySummary.uploadCount} signed · ${qualitySummary.taskCount} task${qualitySummary.taskCount === 1 ? '' : 's'})`}
        subtitle="Signed checklists this engineer photographed and uploaded"
      >
        {usingSampleQuality && <SamplePreviewBanner />}
        {qualityRows.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            iconColor="#9CA3AF"
            title="No signed checklists uploaded"
            subtitle="This engineer uploaded no signed quality checklists in this window."
          />
        ) : (
          qualityRows.map((row) => <QualityChecklistRowCard key={row.id} row={row} />)
        )}
      </ReportSection>
    </>
  );
}

export default function SiteEngineerReportScreen() {
  const { state } = useAuth();
  const { selectedProjectId, isClient } = useProject();

  const [engineers, setEngineers] = useState<SiteEngineerOption[] | null>(null);
  const [engineersError, setEngineersError] = useState<string | null>(null);
  const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [range, setRange] = useState<DateRange>(defaultLast7Days());
  const [report, setReport] = useState<SiteEngineerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the engineer list whenever the project changes, and default the
  // selection to the first engineer (or clear it if the previous pick isn't
  // on this project) — same "pick a project, then act on it" flow as
  // team/[category].tsx's own AttendanceContent.
  useEffect(() => {
    if (!selectedProjectId) {
      setEngineers(null);
      setSelectedEngineerId(null);
      return;
    }
    let cancelled = false;
    setEngineers(null);
    setEngineersError(null);
    fetchProjectSiteEngineers(selectedProjectId)
      .then((list) => {
        if (cancelled) return;
        setEngineers(list);
        setSelectedEngineerId((prev) => (prev && list.some((e) => e.userId === prev) ? prev : (list[0]?.userId ?? null)));
      })
      .catch((err) => {
        if (!cancelled) setEngineersError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const selectedEngineer = engineers?.find((e) => e.userId === selectedEngineerId) ?? null;

  const load = useCallback(async () => {
    // range.from > range.to is a transient state while DateRangeBar's two
    // fields are being edited independently (each commits immediately, no
    // "Generate" button to wait for) — skip the fetch and leave whatever
    // report is already on screen until the range is valid again.
    if (!selectedProjectId || !selectedEngineer || range.from > range.to) return;
    try {
      setError(null);
      setLoading(true);
      setReport(await fetchSiteEngineerReport(selectedProjectId, selectedEngineer, range));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, selectedEngineer, range]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status !== 'signed-in') {
    return <Redirect href="/login" />;
  }
  if (isClient) {
    return <Redirect href="/reports" />;
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Site Engineer Status',
          headerStyle: { backgroundColor: '#0F1F33' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
        }}
      />

      <ScrollView contentContainerClassName="px-4 pt-4 pb-10">
        <ReportProjectPicker />

        {!selectedProjectId ? (
          <EmptyState icon="bar-chart-outline" iconColor="#9CA3AF" title="Select a project" subtitle="Pick a project above to generate its report." />
        ) : engineersError ? (
          <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
            <Text className="text-sm text-red-600">{engineersError}</Text>
          </View>
        ) : !engineers ? (
          <View className="items-center py-10">
            <ActivityIndicator color="#0F1F33" />
          </View>
        ) : engineers.length === 0 ? (
          <EmptyState
            icon="construct-outline"
            iconColor="#9CA3AF"
            title="No site engineers on this project"
            subtitle="Assign a site engineer to this project to generate their report."
          />
        ) : (
          <>
            <Card className="mb-3">
              <Text className="text-2xs text-neutral-400 mb-1">Site Engineer</Text>
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 bg-white"
              >
                <Text className={`text-sm ${selectedEngineer ? 'text-neutral-900 font-medium' : 'text-neutral-400'}`}>
                  {selectedEngineer ? `${selectedEngineer.fullName} · ${roleLabel(selectedEngineer.role as UserRole)}` : 'Select a site engineer'}
                </Text>
                <Text className="text-neutral-400">{pickerOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {pickerOpen && (
                <View className="mt-2">
                  {engineers.map((e) => {
                    const active = e.userId === selectedEngineerId;
                    return (
                      <Pressable
                        key={e.userId}
                        onPress={() => {
                          setSelectedEngineerId(e.userId);
                          setPickerOpen(false);
                        }}
                        className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                      >
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{e.fullName}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </Card>

            <DateRangeBar range={range} onChange={setRange} />
            <Text className="text-xs text-neutral-400 mb-3">
              Showing {formatDateLabel(range.from)} – {formatDateLabel(range.to)}
            </Text>

            {loading ? (
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
            ) : report ? (
              <SiteEngineerReportBody report={report} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
