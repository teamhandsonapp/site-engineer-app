import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, TextInput } from '../components/ui/AppText';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Polygon, SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/AuthContext';
import { openPrivacyPolicy } from '../lib/legal';
import { CONSTRUCTION_LINE_ART_SVG } from '../assets/illustrations/constructionLineArt';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAVY = '#0F1F33';
const FONT = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
};

// Login (2026-11-21, client's reference designs): navy top with the company
// logo and a line about PMC Portal, cut by a slanted edge; below it only
// "Welcome back.", Email + Password boxes and a Sign in pill — no sign-up, no
// forgot-password. Sign-in itself is unchanged (signIn() in lib/AuthContext.tsx).
export default function LoginScreen() {
  const { state, signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` (a wrong password): an admin ended this session.
  const [forcedLogoutMessage, setForcedLogoutMessage] = useState<string | null>(
    state.status === 'signed-out' ? (state.forcedLogoutMessage ?? null) : null
  );

  async function handleSubmit() {
    setError(null);
    setForcedLogoutMessage(null);
    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }
    setLoading(true);
    // signIn() is already try/caught; this keeps a stuck spinner impossible.
    try {
      const result = await signIn(email.trim(), password);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace('/(authenticated)/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in — try again');
    } finally {
      setLoading(false);
    }
  }

  const box = (field: 'email' | 'password') => ({
    height: 52,
    borderWidth: 1.5,
    borderRadius: 8,
    borderColor: focused === field ? NAVY : '#D1D5DB',
    backgroundColor: '#FFFFFF',
  });

  // Phone width, or a centred column on web / tablets.
  const columnWidth = Math.min(width, 460);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#FFFFFF' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={{ width: columnWidth, flexGrow: 1 }}>
          {/* Top: company logo + about PMC Portal, slanted bottom edge. */}
          <View style={{ backgroundColor: NAVY, paddingTop: insets.top + 44, paddingBottom: 104, paddingHorizontal: 28, alignItems: 'center', overflow: 'hidden' }}>
            {/* Faint construction-site line drawing filling the whole navy area. */}
            {/* Sits just above the slant so the ground, machines and workers always show. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 40, top: 0, opacity: 0.14 }}>
              <SvgXml xml={CONSTRUCTION_LINE_ART_SVG} width="100%" height="100%" preserveAspectRatio="xMidYMax slice" />
            </View>
            {/* The app's own logo (same as the app icon). */}
            <Image source={require('../assets/icon.png')} style={{ width: 80, height: 80, borderRadius: 20 }} />
            <Text style={{ fontFamily: FONT.bold, fontSize: 28, color: '#FFFFFF', marginTop: 10, letterSpacing: -0.3 }}>PMC Portal</Text>
            <Text style={{ fontFamily: FONT.regular, fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginTop: 8 }}>
              Plan, track and report every construction project.
            </Text>
            <Text style={{ fontFamily: FONT.semibold, fontSize: 15, lineHeight: 22, color: '#FFFFFF', textAlign: 'center', marginTop: 2 }}>
              Flowcharts, daily progress and status in one place.
            </Text>
            {/* Slanted bottom edge (higher on the left), drawn over the doodles. */}
            <Svg width={columnWidth} height={46} style={{ position: 'absolute', left: 0, bottom: 0 }}>
              <Polygon points={`0,4 ${columnWidth},44 ${columnWidth},46 0,46`} fill="#FFFFFF" />
            </Svg>
          </View>

          {/* Bottom: sign in only. */}
          <View style={{ paddingHorizontal: 24, paddingTop: 10, flexGrow: 1, marginTop: -2, backgroundColor: '#FFFFFF' }}>
            <Text style={{ fontFamily: FONT.bold, fontSize: 26, color: '#111827', marginBottom: 22 }}>Welcome back.</Text>

            {forcedLogoutMessage ? (
              <View className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-3 flex-row gap-2.5 mb-4">
                <Ionicons name="shield-checkmark-outline" size={18} color="#B45309" style={{ marginTop: 1 }} />
                <View className="flex-1">
                  <Text className="text-sm text-amber-900 mb-0.5" style={{ fontFamily: FONT.semibold }}>
                    Session ended
                  </Text>
                  <Text className="text-sm text-amber-800" style={{ fontFamily: FONT.regular }}>
                    {forcedLogoutMessage}
                  </Text>
                </View>
              </View>
            ) : null}
            {error ? (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-3 flex-row gap-2.5 items-center mb-4">
                <Ionicons name="alert-circle-outline" size={18} color="#DC2626" />
                <Text className="flex-1 text-sm text-red-700" style={{ fontFamily: FONT.medium }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: '#111827', marginBottom: 8 }}>Email address</Text>
            <View className="flex-row items-center px-4" style={box('email')}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                placeholder="Email address"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
                editable={!loading}
                className="flex-1 text-md text-neutral-900"
                style={{ fontFamily: FONT.regular }}
              />
            </View>

            <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: '#111827', marginTop: 18, marginBottom: 8 }}>Password</Text>
            <View className="flex-row items-center px-4" style={box('password')}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                onSubmitEditing={handleSubmit}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                returnKeyType="go"
                editable={!loading}
                className="flex-1 text-md text-neutral-900"
                style={{ fontFamily: FONT.regular }}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#374151" />
              </Pressable>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              accessibilityRole="button"
              className="items-center justify-center"
              style={{ height: 54, borderRadius: 27, backgroundColor: NAVY, marginTop: 28, opacity: loading ? 0.75 : 1 }}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ fontFamily: FONT.semibold, fontSize: 16.5, color: '#FFFFFF' }}>Sign in</Text>
              )}
            </Pressable>

            <View className="flex-row items-center justify-center" style={{ gap: 6, marginTop: 16 }}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#6B7280" />
              <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: '#6B7280' }}>Accounts are created only by your admin</Text>
            </View>

            <View style={{ flexGrow: 1, minHeight: 32 }} />
            <View className="items-center" style={{ paddingBottom: insets.bottom + 16 }}>
              <Text style={{ fontFamily: FONT.regular, fontSize: 12, color: '#9CA3AF' }}>Developed by TeamHandsOn © 2026</Text>
              <Pressable onPress={openPrivacyPolicy} hitSlop={8} className="mt-1.5" accessibilityRole="link">
                <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: '#6B7280', textDecorationLine: 'underline' }}>Privacy Policy</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Per-screen crash fallback (keeps the rest of the app usable).
export { RouteErrorBoundary as ErrorBoundary } from '../components/RouteErrorBoundary';
