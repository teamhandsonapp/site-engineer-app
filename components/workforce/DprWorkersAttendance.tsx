import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WorkerFolderCard } from './WorkerFolderCard';
import { useAttendanceMarks } from './useAttendanceMarks';
import { fetchWorkforceFolders, type WorkforceFolder } from '../../lib/workforce';

// DPR list — a separate Workers Attendance section (outside the task rows):
// the department folders of today's tasks. Every P/A tap autosaves to the
// same records each task's own DPR page uses (which still requires it
// complete before Submit), so it can be filled here or inside the DPR.
export function DprWorkersAttendance({
  projectId,
  departments,
  dateKey,
  userId,
}: {
  projectId: string;
  departments: { workId: string; workName: string }[];
  dateKey: string;
  userId: string | null;
}) {
  const [folders, setFolders] = useState<WorkforceFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workKey = departments.map((d) => d.workId).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    fetchWorkforceFolders(projectId)
      .then((all) => {
        if (cancelled) return;
        const wanted = new Set(workKey.split(','));
        setFolders(all.filter((f) => wanted.has(f.workId)));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId, workKey]);

  const { marks, savingIds, mark, error: markError } = useAttendanceMarks(folders, dateKey, userId);
  const withFolder = new Set((folders ?? []).map((f) => f.workId));
  const missing = departments.filter((d) => !withFolder.has(d.workId));

  if (departments.length === 0) return null;

  return (
    <View className="mb-4">
      <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-1">Workers Attendance · today</Text>
      <Text className="text-2xs text-neutral-400 mb-2.5">Saves as you tap. Also inside each task&apos;s DPR — needed before Submit.</Text>
      {error || markError ? <Text className="text-xs text-red-600 mb-2">{error ?? markError}</Text> : null}
      {folders === null ? (
        <ActivityIndicator color="#0F1F33" />
      ) : (
        <>
          {folders.map((f) => (
            <WorkerFolderCard key={f.id} folder={f} marks={marks} savingIds={savingIds} onMark={(id, s) => void mark(id, s)} defaultOpen={false} />
          ))}
          {missing.length > 0 ? (
            <Text className="text-xs text-neutral-400">
              No worker folder yet for {missing.map((d) => d.workName).join(', ')} — add one in the Attendance tab.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
