import { supabase } from './supabase';

export type WeatherCondition = 'SUNNY' | 'CLOUDY' | 'RAINY' | 'WINDY' | 'OTHER';
export const WEATHER_OPTIONS: WeatherCondition[] = ['SUNNY', 'CLOUDY', 'RAINY', 'WINDY', 'OTHER'];

// Three required Daily Updates per day (~12:00 PM, ~3:00 PM, ~5:30 PM —
// the last being the latest acceptable time, not an exact-minute
// deadline). targetMinutes is minutes-since-midnight IST wall-clock time,
// mirrored server-side in supabase/daily-update-reminders.sql's own VALUES
// list — keep the two in sync if these ever change. Reports submitted
// before this feature existed have slot = null ("legacy/unslotted"), which
// is why every slot lookup below treats a null match as simply "no slot
// info," not an error.
export type DailyUpdateSlot = 'slot_12pm' | 'slot_3pm' | 'slot_530pm';

export interface SlotInfo {
  id: DailyUpdateSlot;
  label: string;
  targetMinutes: number;
}

export const DAILY_UPDATE_SLOTS: SlotInfo[] = [
  { id: 'slot_12pm', label: '12:00 PM', targetMinutes: 12 * 60 },
  { id: 'slot_3pm', label: '3:00 PM', targetMinutes: 15 * 60 },
  { id: 'slot_530pm', label: '5:30 PM', targetMinutes: 17 * 60 + 30 },
];

export const SLOT_LABELS: Record<DailyUpdateSlot, string> = {
  slot_12pm: '12:00 PM',
  slot_3pm: '3:00 PM',
  slot_530pm: '5:30 PM',
};

// Same +5:30 IST-arithmetic pattern as formatTime.ts/critical-alerts.tsx's
// own reportedAtLabel — never Intl/toLocaleString with a timeZone option,
// which silently falls back to UTC on Hermes builds without full ICU data
// (confirmed live earlier this session). A slot only ever gates its EARLY
// side (current time must be at or after targetMinutes) — there is
// deliberately no upper bound, so a slot stays fillable for the rest of
// the day once its time arrives, including late.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function currentISTMinutesSinceMidnight(): number {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function isSlotAvailable(slot: SlotInfo): boolean {
  return currentISTMinutesSinceMidnight() >= slot.targetMinutes;
}

// report_date is a DATE column (no time-of-day, no timezone attached), so
// this is a plain calendar-date string comparison — none of the
// naive-timestamp/.getTime() pitfalls documented elsewhere in this file
// apply here, since there's no time component to misinterpret.
export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DailyUpdateInput {
  workType: string;
  workDescription: string;
  sftCompleted: number | null;
  workforceCount: number | null;
  weatherCondition: WeatherCondition | null;
  materialsUsed: string | null;
  equipmentUsed: string | null;
  siteIssues: string | null;
  safetyObservations: string | null;
  visitorsOnSite: string | null;
  remarks: string | null;
}

export interface DailyUpdate extends DailyUpdateInput {
  id: string;
  reportDate: string;
  createdAtISO: string;
  photoCount: number;
  // Only populated by fetchProjectDailyUpdates below — the self-view
  // (fetchMyDailyUpdates) never needs it, since every row is already known
  // to belong to the caller.
  submittedByName: string | null;
  // Null for reports submitted before this feature existed.
  slot: DailyUpdateSlot | null;
}

interface RawRow {
  id: string;
  work_type: string;
  work_description: string;
  report_date: string;
  sft_completed: number | string | null;
  workforce_count: number | null;
  weather_condition: WeatherCondition | null;
  materials_used: string | null;
  equipment_used: string | null;
  site_issues: string | null;
  safety_observations: string | null;
  visitors_on_site: string | null;
  remarks: string | null;
  server_received_at: string;
  photos: { count: number }[];
  user_profiles?: { full_name: string } | null;
  slot: DailyUpdateSlot | null;
}

function toDailyUpdate(r: RawRow): DailyUpdate {
  return {
    id: r.id,
    workType: r.work_type,
    workDescription: r.work_description,
    reportDate: r.report_date,
    sftCompleted: r.sft_completed != null ? Number(r.sft_completed) : null,
    workforceCount: r.workforce_count,
    weatherCondition: r.weather_condition,
    materialsUsed: r.materials_used,
    equipmentUsed: r.equipment_used,
    siteIssues: r.site_issues,
    safetyObservations: r.safety_observations,
    visitorsOnSite: r.visitors_on_site,
    remarks: r.remarks,
    createdAtISO: r.server_received_at,
    photoCount: r.photos?.[0]?.count ?? 0,
    submittedByName: r.user_profiles?.full_name ?? null,
    slot: r.slot,
  };
}

// Bug fix — this embed was written as `photos(count)`, but the real table
// is `daily_progress_report_photos` (confirmed against both the live schema
// and admin-web's Prisma model, which only calls it `photos` as a
// client-side Prisma field alias — that alias is invisible to PostgREST,
// which resolves embeds by real table/FK name). PostgREST's error for this
// exact mistake — "Could not find a relationship between
// 'daily_progress_reports' and 'photos' in the schema cache" — reads like a
// missing-FK/stale-cache problem but isn't one; the FK has always existed.
// `photos:daily_progress_report_photos(count)` uses the real table name
// while keeping the response shaped as `photos` so toDailyUpdate's own
// `r.photos?.[0]?.count` below doesn't need to change.
//
// `photos(count)` is a PostgREST embedded aggregate — one row back per
// report either way, just with a count instead of the full photo list,
// which this screen doesn't need (admin-web's DPR detail page is the real
// photo viewer, see app/(app)/dpr/[id]/page.tsx).
const SELECT =
  'id, work_type, work_description, report_date, sft_completed, workforce_count, weather_condition, materials_used, equipment_used, site_issues, safety_observations, visitors_on_site, remarks, server_received_at, slot, photos:daily_progress_report_photos(count)';

export async function fetchMyDailyUpdates(userId: string): Promise<DailyUpdate[]> {
  const { data, error } = await supabase
    .from('daily_progress_reports')
    .select(SELECT)
    .eq('user_id', userId)
    .order('report_date', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data as unknown as RawRow[]).map(toDailyUpdate);
}

// Bug fix — the mobile Daily Updates screen was calling fetchMyDailyUpdates
// for EVERY staff role, including admin/manager, who don't submit reports
// themselves. That query is correctly scoped for the person actually
// submitting (a field role reviewing their own past entries), but it meant
// admin/manager always saw an empty list regardless of what site engineers
// had submitted — not a permissions or table problem (RLS's own
// "daily_progress_reports readable by staff" policy already allows any
// staff role to read every row; see prisma/add-mobile-attendance-dpr-rls.sql),
// purely a client-side query that never asked for anyone else's data.
// This is the admin/manager-facing counterpart: every report for a
// project (or every project, if none selected), not scoped to any one
// user, with the submitter's name embedded since a review view spanning
// multiple engineers needs to say whose report each row is.
export async function fetchProjectDailyUpdates(projectId: string | null): Promise<DailyUpdate[]> {
  let query = supabase
    .from('daily_progress_reports')
    .select(`${SELECT}, user_profiles(full_name)`)
    .order('report_date', { ascending: false })
    .limit(60);
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as unknown as RawRow[]).map(toDailyUpdate);
}

// Returns the new report's id so the caller can attach photos to it via
// insertDailyUpdatePhoto below.
export async function submitDailyUpdate(
  userId: string,
  projectId: string | null,
  slot: DailyUpdateSlot,
  input: DailyUpdateInput
): Promise<string> {
  const { data, error } = await supabase
    .from('daily_progress_reports')
    .insert({
      user_id: userId,
      project_id: projectId,
      work_type: input.workType.trim(),
      work_description: input.workDescription.trim(),
      report_date: todayDateString(),
      slot,
      sft_completed: input.sftCompleted,
      workforce_count: input.workforceCount,
      weather_condition: input.weatherCondition,
      materials_used: input.materialsUsed?.trim() || null,
      equipment_used: input.equipmentUsed?.trim() || null,
      site_issues: input.siteIssues?.trim() || null,
      safety_observations: input.safetyObservations?.trim() || null,
      visitors_on_site: input.visitorsOnSite?.trim() || null,
      remarks: input.remarks?.trim() || null,
      client_captured_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// Direct client-side insert (not through the upload-dpr-photo Edge
// Function — that function only uploads bytes to Storage and returns a
// path) — this table already has a working "insertable by report owner"
// RLS policy (admin-web/prisma/add-mobile-attendance-dpr-rls.sql), so no
// server-side gatekeeper is needed for the row itself, only for the
// Storage write.
export async function insertDailyUpdatePhoto(reportId: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from('daily_progress_report_photos').insert({
    report_id: reportId,
    storage_path: storagePath,
  });
  if (error) throw new Error(error.message);
}
