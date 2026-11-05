import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetInfo } from '@react-native-community/netinfo';
import { colors, space } from '../../lib/theme';
import { AppText } from '../ui/AppText';

// Shown only when NetInfo is sure there's no connection (isConnected ===
// false); unknown (null) at startup shows nothing.
export function OfflineBanner() {
  const net = useNetInfo();
  if (net.isConnected !== false) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      <AppText variant="label" tone="warning" style={{ flex: 1 }}>
        You&apos;re offline. New messages will appear when you reconnect.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colors.warningSoft },
});
