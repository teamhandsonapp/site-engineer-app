import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type MapPressEvent, type MarkerDragStartEndEvent } from 'react-native-maps';
import { MapTypeToggle } from './ui/MapTypeToggle';

// Mirrors admin-web's SiteLocationMap.tsx (admin-web/components/projects/
// SiteLocationMap.tsx) — same draggable-marker + click-to-place +
// radius-circle behavior. Previously a WebView hosting Leaflet + OpenStreetMap
// tiles (chosen specifically to avoid a native maps SDK and the Google Maps
// API key that comes with it on Android) — swapped to react-native-maps once
// a Google Maps key was actually provisioned (see app.json's
// android.config.googleMaps.apiKey). iOS has no Google key yet, so it keeps
// Apple's own default map provider rather than forcing PROVIDER_GOOGLE and
// silently rendering blank.
//
// Web has its own SiteLocationMapPicker.web.tsx (react-native-maps crashes
// at import time under react-native-web, before any runtime Platform check
// here would even run) — see that file's own comment.
interface Props {
  latitude: number;
  longitude: number;
  radiusMeters: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

const CIRCLE_STROKE_COLOR = 'rgba(37,99,235,0.8)';
const CIRCLE_FILL_COLOR = 'rgba(37,99,235,0.15)';
// Roughly the same "close enough to see the pin and its neighborhood"
// framing the previous WebView's zoom={16} gave.
const REGION_DELTA = 0.01;

export function SiteLocationMapPicker({ latitude, longitude, radiusMeters, onChange, height = 260 }: Props) {
  const mapRef = useRef<MapView>(null);
  const [satellite, setSatellite] = useState(false);

  // The Marker's own `coordinate` prop already re-renders it reactively on
  // every latitude/longitude change — this effect only needs to move the
  // CAMERA to follow, for a change that came from something other than
  // dragging the pin on this map itself (e.g. "Use current location," or
  // typing directly into the numeric fields below the map). animateToRegion
  // (not an imperative jump) mirrors the previous WebView version's
  // map.panTo smoothing.
  useEffect(() => {
    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA },
      300
    );
  }, [latitude, longitude]);

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <MapTypeToggle active={satellite} onToggle={() => setSatellite((s) => !s)} />
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={satellite ? 'hybrid' : 'standard'}
        initialRegion={{ latitude, longitude, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA }}
        onPress={(e: MapPressEvent) => {
          const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
          onChange(lat, lng);
        }}
      >
        <Marker
          coordinate={{ latitude, longitude }}
          draggable
          onDragEnd={(e: MarkerDragStartEndEvent) => {
            const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
            onChange(lat, lng);
          }}
        />
        {radiusMeters != null && radiusMeters > 0 && (
          <Circle
            center={{ latitude, longitude }}
            radius={radiusMeters}
            strokeColor={CIRCLE_STROKE_COLOR}
            fillColor={CIRCLE_FILL_COLOR}
            strokeWidth={2}
          />
        )}
      </MapView>
    </View>
  );
}
