import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '../components/Logo';
import { BrandSplash } from '../components/BrandSplash';
import { useAuth } from '../lib/AuthContext';
import { hasSeenOpeningScreen, markOpeningScreenSeen } from '../lib/onboarding';
import { TEAM_ILLUSTRATION_SVG } from '../assets/illustrations/teamIllustration';

// Single opening screen, not a multi-slide carousel — simplified down from
// an earlier multi-slide onboarding design to just this one screen before
// Login. Shown once per device (see lib/onboarding.ts's AsyncStorage flag)
// and skipped entirely for an already-authenticated session, which
// AuthGate (app/_layout.tsx) guarantees has already resolved out of
// 'loading' by the time this component ever mounts.
export default function OpeningScreen() {
  const { state } = useAuth();
  const [checkedFlag, setCheckedFlag] = useState(false);
  const [showOpening, setShowOpening] = useState(false);

  useEffect(() => {
    if (state.status !== 'signed-out') return; // signed-in redirects below without needing the flag at all
    hasSeenOpeningScreen()
      .then((seen) => setShowOpening(!seen))
      .finally(() => setCheckedFlag(true));
  }, [state.status]);

  if (state.status === 'signed-in') {
    return <Redirect href="/(authenticated)/home" />;
  }

  if (state.status !== 'signed-out' || !checkedFlag) {
    // Brief gap between session restore resolving and the AsyncStorage
    // flag read finishing — same brand splash as AuthGate/the native splash,
    // so nothing visibly changes until the real next screen is ready.
    return <BrandSplash />;
  }

  if (!showOpening) {
    return <Redirect href="/login" />;
  }

  function handleContinue() {
    markOpeningScreenSeen().catch(() => {});
    router.replace('/login');
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-1 items-center px-6 pt-10 pb-8">
        <View className="items-center">
          <Logo size={44} variant="mono" />
          <Text className="mt-3 text-lg font-semibold text-white" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
            PMC Portal
          </Text>
        </View>

        <View className="flex-1 items-center justify-center w-full">
          <SvgXml xml={TEAM_ILLUSTRATION_SVG} width="82%" style={{ aspectRatio: 781.43 / 756.44 }} />
          <Text
            className="mt-8 text-center text-sm text-white/70 px-4"
            style={{ fontFamily: 'IBMPlexSans_400Regular' }}
          >
            Everything your site team needs, in one place.
          </Text>
        </View>

        <View className="w-full items-end">
          <Pressable
            onPress={handleContinue}
            hitSlop={10}
            className="w-14 h-14 rounded-full bg-white items-center justify-center"
          >
            <Ionicons name="arrow-forward" size={24} color="#000000" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
