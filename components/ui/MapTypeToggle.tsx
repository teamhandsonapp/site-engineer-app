import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Shared floating control for every react-native-maps view in this app
// (SiteLocationMapPicker, DayTrailMap) — one toggle component so satellite
// view behaves and looks identical everywhere it appears, per the client's
// own request to match what they see directly in Google Maps. Hybrid (not
// plain satellite) is what "active" switches to — satellite imagery alone
// has no road/place labels, which makes it hard to orient on; hybrid keeps
// them overlaid on top, almost always what people mean by "satellite view."
export function MapTypeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 10,
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#0F1F33' : '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 4,
      }}
    >
      <Ionicons name="layers-outline" size={18} color={active ? '#ffffff' : '#0F1F33'} />
    </Pressable>
  );
}
