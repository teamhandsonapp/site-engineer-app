import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/AuthContext';
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
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
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
      // Everyone lands on the drawer-wrapped Home now — a client sees
      // ClientHome (their one project's dashboard), staff see AppHome (the
      // cross-project overview), both rendered inline by home.tsx itself.
      // Staff used to go to a separate, sidebar-less /app-home (Part 6);
      // the sidebar is now visible immediately after login instead.
      router.replace('/(authenticated)/home');
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

  const inputBorder = (field: 'email' | 'password') => (focused === field ? '#F0A227' : '#E5E7EB');

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-brand-navy"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerClassName="flex-grow"
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Brand header — navy, with the building illustration as a faint
            backdrop and the real app icon (the same orange helmet as the
            home-screen icon), so the first screen reads as this app. */}
        <View className="items-center px-6 pb-10 overflow-hidden" style={{ paddingTop: insets.top + 36 }}>
          <View pointerEvents="none" className="absolute left-0 right-0 bottom-0 items-center" style={{ opacity: 0.07 }}>
            <SvgXml xml={BUILDING_ILLUSTRATION_SVG} width="140%" style={{ aspectRatio: 870 / 724.95 }} />
          </View>
          <Image
            source={require('../assets/icon.png')}
            style={{ width: 72, height: 72, borderRadius: 18 }}
          />
          <Text className="mt-4 text-2xl text-white" style={{ fontFamily: 'IBMPlexSans_700Bold' }}>
            PMC Portal
          </Text>
          <Text className="mt-1 text-sm text-white/60" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
            Construction project management
          </Text>
        </View>

        {/* Form sheet */}
        <View
          className="flex-1 bg-white px-6 pt-8"
          style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + 16 }}
        >
          <Text className="text-xl text-neutral-900" style={{ fontFamily: 'IBMPlexSans_700Bold' }}>
            Welcome back
          </Text>
          <Text className="mt-1 mb-6 text-base text-neutral-500" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
            Sign in to continue to your projects
          </Text>

          <View className="gap-4">
            {forcedLogoutMessage && (
              <View className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 flex-row gap-2.5">
                <Ionicons name="shield-checkmark-outline" size={18} color="#B45309" style={{ marginTop: 1 }} />
                <View className="flex-1">
                  <Text className="text-sm text-amber-900 mb-0.5" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                    Session ended
                  </Text>
                  <Text className="text-sm text-amber-800" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
                    {forcedLogoutMessage}
                  </Text>
                </View>
              </View>
            )}
            {error && (
              <View className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 flex-row gap-2.5 items-center">
                <Ionicons name="alert-circle-outline" size={18} color="#DC2626" />
                <Text className="flex-1 text-sm text-red-700" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                  {error}
                </Text>
              </View>
            )}

            <View>
              <Text className="mb-2 text-sm text-neutral-700" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                Email
              </Text>
              <View
                className="flex-row items-center gap-2.5 rounded-xl bg-neutral-50 px-4"
                style={{ height: 52, borderWidth: 1.5, borderColor: inputBorder('email') }}
              >
                <Ionicons name="mail-outline" size={18} color="#9CA3AF" />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="name@company.com"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  returnKeyType="next"
                  editable={!loading}
                  className="flex-1 text-md text-neutral-900"
                  style={{ fontFamily: 'IBMPlexSans_400Regular' }}
                />
              </View>
            </View>

            <View>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-sm text-neutral-700" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                  Password
                </Text>
                <Pressable onPress={handleForgotPassword} hitSlop={8}>
                  <Text className="text-sm text-brand-navy-light" style={{ fontFamily: 'IBMPlexSans_600SemiBold' }}>
                    Forgot password?
                  </Text>
                </Pressable>
              </View>
              <View
                className="flex-row items-center gap-2.5 rounded-xl bg-neutral-50 px-4"
                style={{ height: 52, borderWidth: 1.5, borderColor: inputBorder('password') }}
              >
                <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  onSubmitEditing={handleSubmit}
                  placeholder="Enter your password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                  returnKeyType="go"
                  editable={!loading}
                  className="flex-1 text-md text-neutral-900"
                  style={{ fontFamily: 'IBMPlexSans_400Regular' }}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              className="mt-2 items-center justify-center rounded-xl bg-brand-amber flex-row gap-2"
              style={{ height: 52, opacity: loading ? 0.75 : 1 }}
            >
              {loading ? (
                <ActivityIndicator color="#0F1F33" />
              ) : (
                <>
                  <Text className="text-md text-brand-navy" style={{ fontFamily: 'IBMPlexSans_700Bold' }}>
                    Log in
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#0F1F33" />
                </>
              )}
            </Pressable>
          </View>

          <View className="mt-6 flex-row items-start gap-2 rounded-xl bg-neutral-50 px-3.5 py-3">
            <Ionicons name="information-circle-outline" size={18} color="#6B7280" />
            <Text className="flex-1 text-sm text-neutral-500" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
              Accounts are created by your admin. Contact your PMC office if you need access.
            </Text>
          </View>

          <View className="flex-1" />
          <Text className="mt-8 text-center text-xs text-neutral-400" style={{ fontFamily: 'IBMPlexSans_400Regular' }}>
            Developed by TeamHandsOn © 2026
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
