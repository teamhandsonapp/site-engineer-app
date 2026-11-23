import { buildMeetingEvent, cleanEmails, eventIdFor, wallClockRange, type MeetingEventInput } from '../../supabase/functions/_shared/meetingEvent';

const base: MeetingEventInput = {
  meetingId: 'mhx2k9z1-ab12cd',
  title: 'Weekly site review',
  projectName: 'ROAST @ Kokapet',
  date: '2026-11-20',
  time: '10:30',
  durationMinutes: 60,
  venue: 'Site office',
  agenda: 'Slab casting plan',
  discussionItems: ['CIV-05 Hot Kitchen 1st Slab', 'Lift shaft'],
  attendeeEmails: ['A@Example.com', 'a@example.com', 'bad-email', '', 'b@example.com'],
  createdByName: 'Banu',
};

describe('Google Calendar event for a MoM meeting', () => {
  it('uses a fixed, Google-valid event id per meeting', () => {
    const id = eventIdFor(base.meetingId);
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(eventIdFor(base.meetingId)).toBe(id);
    expect(eventIdFor('other-meeting')).not.toBe(id);
  });

  it('keeps IST wall-clock times and adds the duration', () => {
    expect(wallClockRange('2026-11-20', '10:30', 60)).toEqual({ start: '2026-11-20T10:30:00', end: '2026-11-20T11:30:00' });
    // Runs past midnight into the next day.
    expect(wallClockRange('2026-12-31', '23:30', 90)).toEqual({ start: '2026-12-31T23:30:00', end: '2027-01-01T01:00:00' });
    expect(() => wallClockRange('20-11-2026', '10:30', 60)).toThrow();
  });

  it('builds the event: title with project, agenda in the description, de-duplicated guests', () => {
    const e = buildMeetingEvent(base);
    expect(e.summary).toBe('Weekly site review — ROAST @ Kokapet');
    expect(e.location).toBe('Site office');
    expect(e.start).toEqual({ dateTime: '2026-11-20T10:30:00', timeZone: 'Asia/Kolkata' });
    expect(e.description).toContain('Agenda:\nSlab casting plan');
    expect(e.description).toContain('1. CIV-05 Hot Kitchen 1st Slab');
    expect(e.attendees).toEqual([{ email: 'a@example.com' }, { email: 'b@example.com' }]);
  });

  it('caps guests at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => `p${i}@x.com`);
    expect(cleanEmails(many)).toHaveLength(50);
  });
});
