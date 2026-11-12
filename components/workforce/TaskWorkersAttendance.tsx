import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '../ui/AppText';
import { WorkerFolderCard } from './WorkerFolderCard';
import { useAttendanceMarks } from './useAttendanceMarks';
import { fetchWorkforceFolders, folderStats, type WorkforceFolder } from '../../lib/workforce';

export interface TaskAttendanceState {
  loaded: boolean;
  hasFolder: boolean;
  total: number;
  unmarked: number;
}

// Inside one task's DPR (app/dpr-edit/[taskId].tsx): the Workers Attendance
// folder of THIS task's department, for THIS DPR day. The DPR can't be
// submitted until everyone here is marked (onStateChange feeds that check) —
// attendance not filled = DPR not filled. Same records as the Attendance tab.
export function TaskWorkersAttendance({
  projectId,
  workId,
  workName,
  dateKey,
  userId,
  onStateChange,
}: {
  projectId: string;
  workId: string | null;
  workName: string;
  dateKey: string;
  userId: string | null;
  onStateChange: (state: TaskAttendanceState) => void;
}) {
  const [folder, setFolder] = useState<WorkforceFolder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkforceFolders(projectId)
      .then((all) => !cancelled && setFolder(all.find((f) => f.workId === workId) ?? null))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [projectId, workId]);

  const folders = folder ? [folder] : folder === null ? [] : null;
  const { marks, savingIds, mark, error: markError } = useAttendanceMarks(folders, dateKey, userId);

  const stats = folder ? folderStats(folder, marks) : null;
  const loaded = folder !== undefined;
  const hasFolder = !!folder;
  const total = stats?.total ?? 0;
  const unmarked = stats?.unmarked ?? 0;
  useEffect(() => {
    onStateChange({ loaded, hasFolder, total, unmarked });
  }, [loaded, hasFolder, total, unmarked, onStateChange]);

  if (error) return <Text className="text-xs text-red-600">{error}</Text>;
  if (folder === undefined) return <ActivityIndicator color="#0F1F33" />;
  if (folder === null || folder.members.length === 0) {
    return (
      <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <Text className="text-xs text-amber-800">
          No workers added for {workName} yet. Add them in the Attendance tab — this DPR can&apos;t be submitted until attendance is filled.
        </Text>
      </View>
    );
  }
  return (
    <View>
      <WorkerFolderCard folder={folder} marks={marks} savingIds={savingIds} onMark={(id, s) => void mark(id, s)} />
      {markError ? <Text className="text-xs text-red-600 mb-1">{markError}</Text> : null}
      {unmarked > 0 ? (
        <Text className="text-xs text-amber-700">
          {unmarked} {unmarked === 1 ? 'person' : 'people'} not marked — mark everyone before submitting.
        </Text>
      ) : (
        <Text className="text-xs text-green-700">Attendance filled for this day.</Text>
      )}
    </View>
  );
}
