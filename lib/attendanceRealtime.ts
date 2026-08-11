import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

const REALTIME_TABLES = ['attendance_records', 'location_disabled_alerts', 'restricted_zone_alerts', 'user_profiles'] as const;

// Subscribes to live changes across every table the admin Attendance
// screens' derived state depends on, and calls onChange (debounced 500ms,
// so a burst of changes across several tables collapses into one refresh)
// rather than trying to hand-patch each row's complex derived fields
// (score, isCurrentlyClockedIn, live elapsed hours, etc.) from a raw
// postgres_changes payload — a full refetch through the existing
// attendanceReview.ts functions is simpler and far less error-prone than
// incrementally patching state this derived, and a real team's data volume
// makes the extra network cost genuinely negligible.
//
// Requires these tables to actually be in the supabase_realtime
// publication (see prisma/enable-realtime-attendance-tables.sql) — none of
// them were before that migration, confirmed live, so a subscription
// without it would silently receive nothing regardless of how correctly
// this hook itself is written.
export function useAttendanceRealtime(onChange: () => void, options: { projectId?: string | null; userId?: string } = {}): void {
  const onChangeRef = useRef(onChange);
  // Kept current via an effect (not a plain render-time assignment, which
  // the React Compiler's lint rule flags — refs may only be written outside
  // render) — same "always-latest callback" pattern as FlowchartCanvas's
  // own tasksRef.
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const { projectId, userId } = options;

  useEffect(() => {
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    function scheduleRefresh() {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => onChangeRef.current(), 500);
    }

    // Unique per mount (not just per user/project) so two screens open at
    // once, or a fast remount, never collide on the same channel name.
    const channelName = `attendance-realtime-${userId ?? projectId ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let channel = supabase.channel(channelName);

    for (const table of REALTIME_TABLES) {
      let filter: string | undefined;
      if (userId) {
        // Detail screen — scoped to exactly this engineer.
        filter = table === 'user_profiles' ? `id=eq.${userId}` : `user_id=eq.${userId}`;
      } else if (projectId && table !== 'user_profiles') {
        // List screen with a specific project selected — user_profiles
        // isn't project-scoped (tracking_status is a per-user field
        // regardless of project), so it stays unfiltered even here.
        filter = `project_id=eq.${projectId}`;
      }
      channel = channel.on(
        'postgres_changes',
        filter ? { event: '*', schema: 'public', table, filter } : { event: '*', schema: 'public', table },
        scheduleRefresh
      );
    }
    channel.subscribe();

    return () => {
      if (debounceId) clearTimeout(debounceId);
      supabase.removeChannel(channel);
    };
  }, [projectId, userId]);
}
