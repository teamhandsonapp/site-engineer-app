import type { EngineerAttendanceSummary } from './attendanceReview';

// DEMO-ONLY attendance data for the client presentation, by explicit request:
// three site engineers (Prakash + two dummy names, first names only) shown on ROAST @
// Kokapet's admin Attendance list, each with a dummy activity page. Nothing
// here touches the database — real attendance reports/scores are unaffected.
// Delete this file (and its two call sites: team-attendance.tsx and
// team-attendance-detail/[userId].tsx) to remove the demo.

export const DEMO_ATTENDANCE_PROJECT_ID = 'fc450651-4c21-4f85-aca7-d20774aecbd8'; // ROAST @ Kokapet

export const isDemoEngineerId = (id: string | undefined | null) => !!id && id.startsWith('demo-');

export interface DemoActivityEvent {
  time: string;
  title: string;
  detail?: string;
  kind: 'in' | 'out' | 'dpr' | 'photo' | 'leave' | 'back' | 'alert';
}

export interface DemoDay {
  date: string; // display label
  checkIn: string | null;
  checkOut: string | null;
  hours: string;
  score: number;
  late: boolean;
  leftEarly: boolean;
}

export interface DemoEngineer {
  id: string;
  name: string;
  role: string;
  phone: string;
  device: string;
  score: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  earlyDepartureDays: number;
  clockedIn: boolean;
  checkIn: [number, number]; // today's check-in (hour, minute)
  checkOut: [number, number] | null; // today's check-out, if checked out
  today: DemoActivityEvent[];
  days: DemoDay[];
}

function dayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.toLocaleString('en-US', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
}

const PCC = 'PCC works @ -6\'-0" & -2\'-0" levels';
const MIVAN = 'Mivan columns casting @ -7\'-6" level';
const SLAB = '+3\'-6" level Slab casting';

export const DEMO_ENGINEERS: DemoEngineer[] = [
  {
    id: 'demo-prakash',
    name: 'Prakash',
    role: 'Site Engineer',
    phone: '+91 98480 21345',
    device: 'Samsung Galaxy M34',
    score: 92,
    presentDays: 24,
    absentDays: 0,
    lateDays: 1,
    earlyDepartureDays: 0,
    clockedIn: true,
    checkIn: [9, 4],
    checkOut: null,
    today: [
      { time: '09:04 AM', kind: 'in', title: 'Checked in at site', detail: 'Main gate · inside site boundary' },
      { time: '09:30 AM', kind: 'photo', title: 'Uploaded 3 progress photos', detail: PCC },
      { time: '11:45 AM', kind: 'dpr', title: 'Submitted DPR', detail: `${PCC} — 60% of today's share` },
      { time: '01:10 PM', kind: 'leave', title: 'Left site — Lunch', detail: 'Back in 40 min' },
      { time: '01:50 PM', kind: 'back', title: 'Back on site' },
      { time: '03:20 PM', kind: 'dpr', title: 'Updated subtask', detail: 'soil levelling — 100%' },
    ],
    days: [
      { date: dayLabel(1), checkIn: '09:02 AM', checkOut: '06:15 PM', hours: '9h 13m', score: 96, late: false, leftEarly: false },
      { date: dayLabel(2), checkIn: '08:58 AM', checkOut: '06:05 PM', hours: '9h 07m', score: 98, late: false, leftEarly: false },
      { date: dayLabel(3), checkIn: '09:40 AM', checkOut: '06:20 PM', hours: '8h 40m', score: 84, late: true, leftEarly: false },
      { date: dayLabel(4), checkIn: '09:05 AM', checkOut: '06:00 PM', hours: '8h 55m', score: 95, late: false, leftEarly: false },
      { date: dayLabel(5), checkIn: '09:01 AM', checkOut: '06:10 PM', hours: '9h 09m', score: 97, late: false, leftEarly: false },
      { date: dayLabel(6), checkIn: '09:10 AM', checkOut: '05:55 PM', hours: '8h 45m', score: 90, late: false, leftEarly: false },
    ],
  },
  {
    id: 'demo-ravi',
    name: 'Ravi',
    role: 'Site Engineer',
    phone: '+91 90005 67812',
    device: 'Redmi Note 13',
    score: 78,
    presentDays: 21,
    absentDays: 2,
    lateDays: 3,
    earlyDepartureDays: 1,
    clockedIn: true,
    checkIn: [9, 48],
    checkOut: null,
    today: [
      { time: '09:48 AM', kind: 'in', title: 'Checked in at site (late)', detail: 'Shift starts 09:30 AM' },
      { time: '10:30 AM', kind: 'photo', title: 'Uploaded 2 progress photos', detail: MIVAN },
      { time: '12:15 PM', kind: 'alert', title: 'Entered restricted zone', detail: 'Crane swing area · 4 min' },
      { time: '02:40 PM', kind: 'dpr', title: 'Submitted DPR', detail: `${MIVAN} — 45% of today's share` },
    ],
    days: [
      { date: dayLabel(1), checkIn: '09:35 AM', checkOut: '06:05 PM', hours: '8h 30m', score: 86, late: true, leftEarly: false },
      { date: dayLabel(2), checkIn: null, checkOut: null, hours: '—', score: 0, late: false, leftEarly: false },
      { date: dayLabel(3), checkIn: '09:20 AM', checkOut: '05:10 PM', hours: '7h 50m', score: 72, late: false, leftEarly: true },
      { date: dayLabel(4), checkIn: '09:12 AM', checkOut: '06:00 PM', hours: '8h 48m', score: 92, late: false, leftEarly: false },
      { date: dayLabel(5), checkIn: '09:55 AM', checkOut: '06:10 PM', hours: '8h 15m', score: 80, late: true, leftEarly: false },
      { date: dayLabel(6), checkIn: '09:15 AM', checkOut: '06:02 PM', hours: '8h 47m', score: 91, late: false, leftEarly: false },
    ],
  },
  {
    id: 'demo-sandeep',
    name: 'Sandeep',
    role: 'Site Engineer',
    phone: '+91 99590 34420',
    device: 'Vivo T2',
    score: 64,
    presentDays: 18,
    absentDays: 4,
    lateDays: 5,
    earlyDepartureDays: 3,
    clockedIn: false,
    checkIn: [10, 5],
    checkOut: [2, 30],
    today: [
      { time: '10:05 AM', kind: 'in', title: 'Checked in at site (late)', detail: 'Shift starts 09:30 AM' },
      { time: '11:20 AM', kind: 'dpr', title: 'Saved DPR draft', detail: `${SLAB} — not submitted` },
      { time: '12:40 PM', kind: 'alert', title: 'Location turned off', detail: '18 min' },
      { time: '02:30 PM', kind: 'out', title: 'Checked out early', detail: 'Reason: material purchase at vendor' },
    ],
    days: [
      { date: dayLabel(1), checkIn: '09:50 AM', checkOut: '05:30 PM', hours: '7h 40m', score: 66, late: true, leftEarly: true },
      { date: dayLabel(2), checkIn: '09:25 AM', checkOut: '06:00 PM', hours: '8h 35m', score: 88, late: false, leftEarly: false },
      { date: dayLabel(3), checkIn: null, checkOut: null, hours: '—', score: 0, late: false, leftEarly: false },
      { date: dayLabel(4), checkIn: '10:10 AM', checkOut: '06:05 PM', hours: '7h 55m', score: 70, late: true, leftEarly: false },
      { date: dayLabel(5), checkIn: null, checkOut: null, hours: '—', score: 0, late: false, leftEarly: false },
      { date: dayLabel(6), checkIn: '09:30 AM', checkOut: '04:45 PM', hours: '7h 15m', score: 68, late: false, leftEarly: true },
    ],
  },
];

function todayAt([h, m]: [number, number], pm = false): Date {
  const d = new Date();
  d.setHours(pm && h < 12 ? h + 12 : h, m, 0, 0);
  return d;
}

// Rows for the Attendance list — built at render time so "last signal" is
// always fresh (a static timestamp would turn the chip to "No recent signal").
export function buildDemoSummaries(now: Date): EngineerAttendanceSummary[] {
  return DEMO_ENGINEERS.map((e) => ({
    userId: e.id,
    fullName: e.name,
    role: 'site_engineer',
    averageScore: e.score,
    presentDays: e.presentDays,
    absentDays: e.absentDays,
    lateDays: e.lateDays,
    earlyDepartureDays: e.earlyDepartureDays,
    totalUnresolvedRedZoneEntries: e.id === 'demo-ravi' ? 1 : 0,
    isCurrentlyClockedIn: e.clockedIn,
    todayCheckInTime: todayAt(e.checkIn),
    todayCheckOutTime: e.checkOut ? todayAt(e.checkOut, true) : null,
    todayDeviceManufacturer: null,
    todayDeviceModel: e.device,
    todayLocationDisabledEpisodes: [],
    todayRedZoneEntries: [],
    liveTrackingStatus: 'active',
    liveTrackingStatusReason: null,
    liveTrackingStatusAt: now,
    isLocked: false,
  }));
}
