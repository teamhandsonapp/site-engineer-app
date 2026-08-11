import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DayTrailMap, type DayTrailMapHandle } from './DayTrailMap';
import { Card } from './ui/Card';
import {
  fetchDayTimeline,
  TIMELINE_EVENT_COLORS,
  type DayTimeline,
  type TimelineEvent,
} from '../lib/dayTimeline';
import { formatTime12h } from '../lib/formatTime';

// Sections 1-2/4.1-4.2 — the map trail + chronological checklist, factored
// out of day-timeline.tsx so BOTH the field role's own view of their day
// (day-timeline.tsx) and admin/manager's per-engineer detail view
// (team-attendance-detail/[userId].tsx) render the exact same thing from
// the exact same fetchDayTimeline(userId) call — userId is just whichever
// account this instance is showing, self or someone else. Works for "someone
// else" because every table fetchDayTimeline reads from (location_pings,
// geofence_alerts, restricted_zone_alerts, leave_events, attendance_records)
// already has staff-wide (not self-scoped) SELECT RLS — see lib/dayTimeline.ts's
// own comment on this.
//
// No ScrollView/RefreshControl of its own deliberately — both call sites
// already have (or need) their own single outer scroll container, and
// nesting a second same-orientation ScrollView inside that is a real bug
// class in React Native (ambiguous scroll/gesture ownership), not just a
// style preference. A forwardRef + refresh() lets each parent's own
// RefreshControl (or realtime hook) trigger a reload here without needing
// to own this component's internal fetch state.
export interface DayTimelineViewHandle {
  refresh: () => Promise<void>;
}

interface Props {
  userId: string;
  // Item 5 — which project's site location + restricted zones to draw as
  // static circles on the map. Optional: both call sites already have this
  // via useProject(), but a missing/unselected project just means no
  // circles draw, never an error — see fetchDayTimeline's own comment.
  projectId?: string | null;
  emptyLabel?: string;
}

export const DayTimelineView = forwardRef<DayTimelineViewHandle, Props>(function DayTimelineView(
  { userId, projectId, emptyLabel = 'No activity recorded yet today.' },
  ref
) {
  const [timeline, setTimeline] = useState<DayTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Item 6 — shared between the map's numbered markers and the timeline's
  // numbered rows; whichever side is tapped sets this, so both re-render
  // showing the same highlighted point.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const mapRef = useRef<DayTrailMapHandle>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTimeline(await fetchDayTimeline(userId, projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId, projectId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh: load }), [load]);

  // Extends the existing "tap a row, jump the map" behavior (rather than a
  // second, separate interaction) — now also sets the shared selection so
  // the tapped row AND its map marker both show as highlighted, not just
  // the map recentering.
  function handleRowPress(event: TimelineEvent) {
    setSelectedEventId(event.id);
    if (event.latitude == null || event.longitude == null) return;
    mapRef.current?.focusOnCoordinate(event.latitude, event.longitude);
  }

  // The reverse direction — tapping a MAP marker does the same thing a row
  // tap does (select + recenter), so either surface drives the other
  // identically instead of two different interactions.
  function handleMarkerPress(eventId: string) {
    setSelectedEventId(eventId);
    const event = timeline?.events.find((e) => e.id === eventId);
    if (event?.latitude != null && event?.longitude != null) {
      mapRef.current?.focusOnCoordinate(event.latitude, event.longitude);
    }
  }

  if (loading) {
    return (
      <View className="items-center justify-center py-10">
        <ActivityIndicator color="#0F1F33" />
      </View>
    );
  }

  return (
    <View>
      {error && (
        <View className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 mb-4">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      )}

      <View className="mb-4">
        <DayTrailMap
          ref={mapRef}
          timeline={timeline ?? { trail: [], events: [], leavePeriods: [], siteLocation: null, restrictedZones: [] }}
          selectedEventId={selectedEventId}
          onMarkerPress={handleMarkerPress}
        />
      </View>

      {!timeline || timeline.events.length === 0 ? (
        <Text className="text-sm text-neutral-400">{emptyLabel}</Text>
      ) : (
        timeline.events.map((event) => {
          const color = TIMELINE_EVENT_COLORS[event.kind];
          const tappable = event.latitude != null && event.longitude != null;
          const selected = event.id === selectedEventId;
          return (
            <Pressable key={event.id} onPress={() => handleRowPress(event)} disabled={!tappable}>
              <Card
                accentColor={color}
                className="mb-2.5 flex-row items-center gap-3"
                style={selected ? { borderWidth: 1.5, borderColor: color } : undefined}
              >
                {/* Item 6 — same colored-circle-with-number as this event's
                    map marker (NumberedMarkerIcon in DayTrailMap.tsx), so
                    the visual match between a list row and its marker is
                    immediate, not just an inferred same-number coincidence. */}
                <View
                  className="w-7 h-7 rounded-full items-center justify-center"
                  style={{ backgroundColor: color }}
                >
                  <Text className="text-xs font-bold text-white">{event.sequence}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-neutral-800">{event.title}</Text>
                  {event.detail && <Text className="text-xs text-neutral-400 mt-0.5">{event.detail}</Text>}
                </View>
                <Text className="text-xs text-neutral-400">{formatTime12h(new Date(event.atISO))}</Text>
                {tappable && <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />}
              </Card>
            </Pressable>
          );
        })
      )}
    </View>
  );
});
