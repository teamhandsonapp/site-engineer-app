jest.mock('../supabase', () => ({ supabase: {} }));
import { istDay, testerDays, TESTER_DAYS } from '../testerActivity';

describe('Testers: last 14 days', () => {
  // 21 Nov 2026, 6 PM IST.
  const now = Date.parse('2026-11-21T12:30:00Z');

  it('IST day keys (an 11:30 PM IST open counts for that IST day)', () => {
    expect(istDay(now)).toBe('2026-11-21');
    expect(istDay(Date.parse('2026-11-20T18:00:00Z'))).toBe('2026-11-20'); // 11:30 PM IST, 20 Nov
    expect(istDay(Date.parse('2026-11-20T18:31:00Z'))).toBe('2026-11-21'); // 12:01 AM IST, 21 Nov
    expect(istDay(now, 13)).toBe('2026-11-08');
  });

  it('dots oldest → today, count, and not-used-today first', () => {
    const out = testerDays(
      [
        { id: 'k', full_name: 'Kabilan', email: 'kabilan@testerpmc.com' },
        { id: 'r', full_name: 'Ravi', email: 'ravi@testerpmc.com' },
      ],
      [
        { user_id: 'k', day: '2026-11-21' },
        { user_id: 'k', day: '2026-11-20' },
        { user_id: 'k', day: '2026-11-01' }, // older than 14 days — ignored
        { user_id: 'r', day: '2026-11-19' },
      ],
      now
    );
    expect(out.map((t) => t.name)).toEqual(['Ravi', 'Kabilan']); // Ravi hasn't opened today
    const k = out[1];
    expect(k.days).toHaveLength(TESTER_DAYS);
    expect(k.days.slice(-2)).toEqual([true, true]);
    expect([k.usedToday, k.daysUsed]).toEqual([true, 2]);
    expect([out[0].usedToday, out[0].daysUsed]).toEqual([false, 1]);
  });
});
