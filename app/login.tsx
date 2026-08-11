import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { Logo } from '../components/Logo';
import { appRoleFor, useAuth } from '../lib/AuthContext';
import { BUILDING_ILLUSTRATION_SVG } from '../assets/illustrations/buildingIllustration';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Email or phone" is the field's label/placeholder per the current design
// spec, but validation and the actual sign-in call underneath are
// unchanged — this app has no phone-based auth anywhere (Supabase sign-in
// is email+password only, see signIn() in AuthContext.tsx), so a real
// phone number typed here would still be rejected same as before. Cosmetic
// label choice only, not a new auth capability.
export default function LoginScreen() {
  const { state, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deliberately separate from `error` below (a wrong-password message) —
  // this needs to read as "something specific and administrative just
  // happened to you," not a generic form-validation failure.
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
    // signIn() itself is already try/caught end-to-end (see AuthContext.tsx),
    // but this stays defense-in-depth — the whole point of that fix was "a
    // stuck spinner with no error is never acceptable here again," and that
    // guarantee shouldn't depend on every future caller remembering why.
    try {
      const result = await signIn(email.trim(), password);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Client stays on the drawer-wrapped Home (it's already their one
      // project's dashboard, no picker needed); staff go straight to the
      // sidebar-less App Home / project picker (Part 6) — reading the role
      // off `result` (not `state`) since `state` in this closure is still
      // the pre-sign-in value the moment this line runs.
      router.replace(appRoleFor(result.profile.role) === 'client' ? '/(authenticated)/home' : '/app-home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in — try again');
    } finally {
      setLoading(false);
    }
  }

  // No self-service reset flow exists in this app by design — access
  // (including password resets) is admin-provisioned, same message this
  // screen already gave in its footer before this redesign. This link
  // surfaces that directly rather than pointing at a screen that doesn't
  // exist.
  function handleForgotPassword() {
    Alert.alert('Forgot password?', 'Access is provisioned by your admin. Contact your PMC office to reset your password.');
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-black"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Fixed behind the ScrollView (a sibling, not a scrolling child) so
          it stays put regardless of scroll position — a construction/
          architecture-themed backdrop, low-opacity and monochrome so the
          form stays the clearly legible, functional focus of this screen,
          same "fast and functional" login reasoning as before, just no
          longer completely bare. pointerEvents="none" so it never
          intercepts taps meant for the form on top of it. */}
      <View pointerEvents="none" className="absolute top-0 left-0 right-0 items-center" style={{ opacity: 0.1 }}>
        <SvgXml xml={BUILDING_ILLUSTRATION_SVG} width="150%" style={{ aspectRatio: 870 / 724.95 }} />
      </View>

      <ScrollView
        contentContainerClassName="flex-grow px-6 pt-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 items-center justify-center">
          <Text
            className="text-3xl font-bold text-white tracking-tight"
            style={{ fontFamily: 'IBMPlexSans_700Bold' }}
          >
            PMC Portal
          </Text>

          <View className="mt-5">
            <Logo size={40} variant="mono" />
          </View>

          <Text
            className="mt-6 text-2xl font-bold text-white"
            style={{ fontFamily: 'IBMPlexSans_700Bold' }}
          >
            Log in
          </Text>
          <Text
            className="mt-1.5 mb-8 text-center text-sm text-white/55"
            style={{ fontFamily: 'IBMPlexSans_400Regular' }}
          >
            For clients and site staff
          </Text>

          <View className="w-full gap-4">
            {forcedLogoutMessage && (
              <View className="rounded-xl border border-white/20 bg-white/5 px-3.5 py-3 flex-row gap-2.5">
                <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" style={{ marginTop: 1 }} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-white mb-0.5" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                    Session Ended
                  </Text>
                  <Text className="text-xs leading-[17px] text-white/80" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
                    {forcedLogoutMessage}
                  </Text>
                </View>
              </View>
            )}
            {error && (
              <View className="rounded-xl border border-white/25 bg-white/5 px-3.5 py-3">
                <Text className="text-sm font-medium text-white" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                  {error}
                </Text>
              </View>
            )}

            <View>
              <Text className="mb-1.5 text-xs font-medium text-white/70" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                Email or phone
              </Text>
              <View
                className="flex-row items-center gap-2 rounded-xl px-3.5 py-3"
                style={{ backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#3A3A3A' }}
              >
                <Ionicons name="mail-outline" size={16} color="#8A8A8A" />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@company.com"
                  placeholderTextColor="#8A8A8A"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  editable={!loading}
                  className="flex-1 text-base text-white"
                  style={{ fontFamily: 'IBMPlexSans_400Regular' }}
                />
              </View>
            </View>

            <View>
              <Text className="mb-1.5 text-xs font-medium text-white/70" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                Password
              </Text>
              <View
                className="flex-row items-center gap-2 rounded-xl px-3.5 py-3"
                style={{ backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#3A3A3A' }}
              >
                <Ionicons name="lock-closed-outline" size={16} color="#8A8A8A" />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#8A8A8A"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  editable={!loading}
                  className="flex-1 text-base text-white"
                  style={{ fontFamily: 'IBMPlexSans_400Regular' }}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={16}
                    color="#8A8A8A"
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleForgotPassword}
              hitSlop={8}
              className="self-end -mt-1"
            >
              <Text className="text-xs text-white/55" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
                Forgot password?
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              className="items-center justify-center rounded-xl bg-white mt-1 disabled:opacity-60"
              style={{ minHeight: 48 }}
            >
              {loading ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <Text className="text-base font-bold text-black" style={{ fontFamily: 'IBMPlexSans_700Bold' }}>
                  Log In
                </Text>
              )}
            </Pressable>
          </View>

          <Text
            className="mt-6 text-center text-xs leading-[18px] text-white/55"
            style={{ fontFamily: 'IBMPlexSans_400Regular' }}
          >
            Access is provisioned by your admin.{'\n'}Contact your PMC office if you need help.
          </Text>
        </View>

        <View className="items-center pb-3">
          <Text className="text-2xs text-white/45" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
            Developed by TeamHandsOn © 2026
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
