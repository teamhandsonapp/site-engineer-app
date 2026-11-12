import { useCallback, useEffect, useState } from 'react';
import { fetchAttendanceForDate, markAttendance, type AttendanceStatus, type WorkforceFolder } from '../../lib/workforce';

// Loads one day's marks for every person in `folders`, and marks with an
// optimistic update (rolled back on error).
export function useAttendanceMarks(folders: WorkforceFolder[] | null, dateKey: string, userId: string | null) {
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const memberKey = (folders ?? []).flatMap((f) => f.members.map((m) => m.id)).join(',');

  useEffect(() => {
    if (!memberKey) {
      setMarks({});
      return;
    }
    let cancelled = false;
    fetchAttendanceForDate(memberKey.split(','), dateKey)
      .then((m) => !cancelled && setMarks(m))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [memberKey, dateKey]);

  const mark = useCallback(
    async (memberId: string, status: AttendanceStatus | null) => {
      setError(null);
      const prev = marks[memberId];
      setMarks((m) => {
        const next = { ...m };
        if (status) next[memberId] = status;
        else delete next[memberId];
        return next;
      });
      setSavingIds((s) => new Set(s).add(memberId));
      try {
        await markAttendance(memberId, dateKey, status, userId);
      } catch (err) {
        setMarks((m) => {
          const next = { ...m };
          if (prev) next[memberId] = prev;
          else delete next[memberId];
          return next;
        });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingIds((s) => {
          const next = new Set(s);
          next.delete(memberId);
          return next;
        });
      }
    },
    [marks, dateKey, userId]
  );

  return { marks, savingIds, mark, error };
}
