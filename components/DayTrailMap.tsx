import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { TIMELINE_EVENT_COLORS, type DayTimeline, type TimelineEvent } from '../lib/dayTimeline';
import { MapTypeToggle } from './ui/MapTypeToggle';
import { gapLabel, splitTrailIntoRuns, type TrackingGap } from '../lib/trackingGaps';

// Section 1 — the map half of the timeline view. Mirrors
// SiteLocationMapPicker.tsx's platform handling (react-native-maps has zero
// web support and crashes at import time under react-native-web — see this
// component's own .web.tsx sibling, whose Props/Handle shapes are
// deliberately duplicated rather than cross-imported, same as
// SiteLocationMapPicker's two files).
export interface DayTrailMapHandle {
  focusOnCoordinate: (latitude: number, longitude: number) => void;
  showGap: (gapId: string) => void;
}

interface Props {
  timeline: DayTimeline;
  height?: number;
  // Item 6 — which event's marker/list-row is currently highlighted, and
  // the callback fired when a MARKER (not a list row — that's the parent's
  // own onPress) is tapped, so tapping either surface drives the same
  // shared selection state in the parent.
  selectedEventId?: string | null;
  onMarkerPress?: (eventId: string) => void;
}

// Neutral (spec's word for "normal movement") — the plain route line color,
// distinct from every event marker color in dayTimeline.ts's own palette.
const TRAIL_COLOR = '#9CA3AF';
const LEAVE_SEGMENT_COLOR = TIMELINE_EVENT_COLORS.leave;
const REGION_DELTA = 0.01;
// Tracking gaps — dashed red, the same "urgent" red family used for
// red-zone circles, so a hole in the data reads as a problem, not a route.
const GAP_COLOR = '#DC2626';

// Item 5 — same blue site-boundary convention as SiteLocationMapPicker.tsx
// (admin's own Site Location settings map), reused here rather than
// invented separately, so a boundary reads the same way in both places.
const SITE_PIN_COLOR = '#2563EB';
const SITE_CIRCLE_STROKE_COLOR = 'rgba(37,99,235,0.8)';
const SITE_CIRCLE_FILL_COLOR = 'rgba(37,99,235,0.15)';
// Red zones reuse the same red already used for a red-zone-entry EVENT
// marker (dayTimeline.ts's TIMELINE_EVENT_COLORS.red_zone_entry) — the
// static boundary and the event of entering it are the same color family
// deliberately, so they read as related at a glance.
const ZONE_CIRCLE_STROKE_COLOR = 'rgba(220,38,38,0.8)';
const ZONE_CIRCLE_FILL_COLOR = 'rgba(220,38,38,0.15)';

// Item 6 — a numbered badge instead of a plain colored pin. react-native-maps
// swaps in this custom view wholesale wherever a Marker is given children,
// callouts (title/description) keep working exactly as before regardless.
function NumberedMarkerIcon({ color, number, selected }: { color: string; number: number; selected: boolean }) {
  const size = selected ? 30 : 24;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: selected ? 3 : 2,
        borderColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
        elevation: 3,
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: selected ? 13 : 11, fontWeight: '700' }}>{number}</Text>
    </View>
  );
}

export const DayTrailMap = forwardRef<DayTrailMapHandle, Props>(function DayTrailMap(
  { timeline, height = 300, selectedEventId, onMarkerPress },
  ref
) {
  const mapRef = useRef<MapView>(null);
  const [satellite, setSatellite] = useState(false);
  const [selectedGap, setSelectedGap] = useState<TrackingGap | null>(null);

  useImperativeHandle(ref, () => ({
    focusOnCoordinate(latitude: number, longitude: number) {
      mapRef.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA },
        300
      );
    },
    showGap(gapId: string) {
      const gap = timeline.gaps.find((g) => g.id === gapId) ?? null;
      setSelectedGap(gap);
      const at = gap?.fromPoint ?? gap?.toPoint;
      if (at) {
        mapRef.current?.animateToRegion(
          { latitude: at.latitude, longitude: at.longitude, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA },
          300
        );
      }
    },
  }));

  const { trail, gaps, events, leavePeriods, siteLocation, restrictedZones } = timeline;
  const coordinates = trail.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  // Solid line only within continuous runs — never drawn across a gap.
  const runs = splitTrailIntoRuns(trail, gaps)
    .map((run) => run.map((p) => ({ latitude: p.latitude, longitude: p.longitude })))
    .filter((run) => run.length >= 2);
  // A gap is drawable only when we know where tracking stopped AND resumed.
  const drawableGaps = gaps.filter((g) => g.fromPoint && g.toPoint);
  const markers = events.filter((e) => e.latitude != null && e.longitude != null);

  // Ping points that fall inside an active Leave window get a dashed
  // overlay on top of the plain route (Section 1's "small icon/segment for
  // an active Leave period") — the base line is left in place underneath
  // rather than replaced, so the route still reads as one continuous trail.
  const leaveSegments = leavePeriods
    .map((period) => ({
      period,
      coordinates: trail
        .filter((p) => {
          const ms = new Date(p.occurredAtISO).getTime();
          return ms >= period.startMs && ms <= period.endMs;
        })
        .map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    }))
    .filter((s) => s.coordinates.length >= 2);

  // Falls back to the site's own location when there's no trail yet (e.g.
  // viewing before any ping has landed today) — a real place to center on,
  // rather than react-native-maps' own arbitrary default region.
  const initialCenter = coordinates[0] ?? (siteLocation ? { latitude: siteLocation.latitude, longitude: siteLocation.longitude } : null);
  const initialRegion = initialCenter
    ? { ...initialCenter, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA }
    : undefined;

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <MapTypeToggle active={satellite} onToggle={() => setSatellite((s) => !s)} />
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={satellite ? 'hybrid' : 'standard'}
        initialRegion={initialRegion}
      >
        {/* Item 5 — static boundaries, drawn under everything else (trail,
            leave segments, event markers all render after these in the
            same z-order react-native-maps uses for overlapping overlays —
            listed first so they sit visually underneath). Circle's radius
            is a real-world meters value, not a pixel size, so it scales
            correctly with zoom automatically — same as SiteLocationMapPicker's
            own Circle usage. */}
        {siteLocation && (
          <>
            <Circle
              center={{ latitude: siteLocation.latitude, longitude: siteLocation.longitude }}
              radius={siteLocation.radiusMeters}
              strokeColor={SITE_CIRCLE_STROKE_COLOR}
              fillColor={SITE_CIRCLE_FILL_COLOR}
              strokeWidth={2}
            />
            <Marker
              coordinate={{ latitude: siteLocation.latitude, longitude: siteLocation.longitude }}
              pinColor={SITE_PIN_COLOR}
              title="Site boundary"
            />
          </>
        )}
        {/* Circle only, deliberately no center Marker (unlike siteLocation's
            circle+pin pair above) — this circle is a STATIC boundary, drawn
            regardless of whether anyone ever entered it, while an ACTUAL
            red-zone-entry EVENT gets its own NumberedMarkerIcon marker
            further below in the same red_zone_entry color. Confirmed live:
            a plain red pin here, at the zone's center, in the exact same
            red as a real entry marker, was mistaken for "the visit showing
            up on the map" during a real test where the actual entry event
            was never actually rendered — the circle alone still fully
            conveys "this is a red zone," with no ambiguous pin to confuse
            it with a real numbered visit marker. */}
        {restrictedZones.map((zone) => (
          <Circle
            key={zone.id}
            center={{ latitude: zone.latitude, longitude: zone.longitude }}
            radius={zone.radiusMeters}
            strokeColor={ZONE_CIRCLE_STROKE_COLOR}
            fillColor={ZONE_CIRCLE_FILL_COLOR}
            strokeWidth={2}
          />
        ))}
        {runs.map((run, i) => (
          <Polyline key={`run-${i}`} coordinates={run} strokeColor={TRAIL_COLOR} strokeWidth={3} />
        ))}
        {drawableGaps.map((g) => (
          <Polyline
            key={g.id}
            coordinates={[
              { latitude: g.fromPoint!.latitude, longitude: g.fromPoint!.longitude },
              { latitude: g.toPoint!.latitude, longitude: g.toPoint!.longitude },
            ]}
            strokeColor={GAP_COLOR}
            strokeWidth={selectedGap?.id === g.id ? 5 : 3}
            lineDashPattern={[10, 8]}
            tappable
            onPress={() => setSelectedGap(g)}
            zIndex={2}
          />
        ))}
        {leaveSegments.map((s) => (
          <Polyline
            key={s.period.leaveId}
            coordinates={s.coordinates}
            strokeColor={LEAVE_SEGMENT_COLOR}
            strokeWidth={4}
            lineDashPattern={[6, 6]}
          />
        ))}
        {/* title/description still render react-native-maps' own default
            callout bubble on tap (a custom marker view via `children` below
            doesn't disable that) — satisfies "reason shown on tap" without
            a custom Callout component. onPress additionally drives Item 6's
            shared map<->list selection. */}
        {markers.map((event: TimelineEvent) => (
          <Marker
            key={event.id}
            coordinate={{ latitude: event.latitude!, longitude: event.longitude! }}
            title={`${event.sequence}. ${event.title}`}
            description={event.detail ?? undefined}
            onPress={() => onMarkerPress?.(event.id)}
            // Selected marker draws last within this same .map() output, so
            // it visually sits above its immediate un-selected neighbors —
            // full above-everything stacking isn't available cross-platform
            // for react-native-maps overlays, but this covers the common
            // near-duplicate-coordinate case (e.g. check-in and a nearby
            // boundary exit) without needing z-index support that doesn't
            // exist here.
            zIndex={event.id === selectedEventId ? 1 : 0}
          >
            <NumberedMarkerIcon
              color={TIMELINE_EVENT_COLORS[event.kind]}
              number={event.sequence}
              selected={event.id === selectedEventId}
            />
          </Marker>
        ))}
      </MapView>
      {selectedGap && (
        <Pressable
          onPress={() => setSelectedGap(null)}
          className="absolute left-3 right-3 bottom-3 rounded-xl bg-white px-3.5 py-2.5 flex-row items-center gap-2"
          style={{ borderWidth: 1.5, borderColor: GAP_COLOR, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4 }}
        >
          <View style={{ width: 18, borderTopWidth: 3, borderColor: GAP_COLOR, borderStyle: 'dashed' }} />
          <Text className="flex-1 text-xs font-semibold text-neutral-900">{gapLabel(selectedGap)}</Text>
          <Text className="text-2xs text-neutral-400">✕</Text>
        </Pressable>
      )}
    </View>
  );
});
