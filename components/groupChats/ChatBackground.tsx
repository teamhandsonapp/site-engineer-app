// The chat wallpaper: one small tile (256 px, ≤ 20 KB, our own faint line
// icons) repeated by the image view — never a screen-sized bitmap or SVG.
// No props and memoised, so new messages never re-render it; only a
// colour-scheme change does.

import { memo } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import { useChatScheme } from '../../lib/groupChats/chatTheme';

const TILES = {
  light: require('../../assets/site-groups/chat-tile-light.png'),
  dark: require('../../assets/site-groups/chat-tile-dark.png'),
};

function Background() {
  const scheme = useChatScheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <ImageBackground source={TILES[scheme]} resizeMode="repeat" style={styles.fill} />
    </View>
  );
}

export const ChatBackground = memo(Background);

const styles = StyleSheet.create({ fill: { flex: 1 } });
