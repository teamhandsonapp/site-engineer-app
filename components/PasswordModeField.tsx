import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { generatePassword } from '../lib/accessRoles';
import { validatePassword } from '../lib/passwordPolicy';

export type PasswordMode = 'generate' | 'manual';

export interface PasswordFieldState {
  mode: PasswordMode;
  manualPassword: string;
  manualConfirm: string;
  generatedPassword: string | null;
}

export const INITIAL_PASSWORD_STATE: PasswordFieldState = {
  mode: 'generate',
  manualPassword: '',
  manualConfirm: '',
  generatedPassword: null,
};

// Resolves the current field state into exactly what accessRoles.ts's
// createUser/resetUserPassword expect, or a validation error to show
// instead of submitting — one place both call sites share so they can't
// validate differently.
export function resolvePasswordField(state: PasswordFieldState): { passwordMode: PasswordMode; password?: string } | { error: string } {
  if (state.mode === 'manual') {
    const validationError = validatePassword(state.manualPassword);
    if (validationError) return { error: validationError };
    if (state.manualPassword !== state.manualConfirm) return { error: 'Passwords do not match' };
    return { passwordMode: 'manual', password: state.manualPassword };
  }
  if (!state.generatedPassword) return { error: 'Generate a password first' };
  return { passwordMode: 'generate', password: state.generatedPassword };
}

const inputClass = 'border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 flex-1';

// Shared by the Create User and Reset Password sheets — a "Generate"/
// "Type manually" segmented toggle. Generate mode previews a real,
// server-generated password (see accessRoles.ts's generatePassword) with
// copy-to-clipboard + Regenerate; manual mode is a password + confirm
// pair with a show/hide eye icon on each and inline strength/match
// validation. Generate is the default (safer), manual is one tap away —
// per the brief this was built against.
export function PasswordModeField({
  state,
  onChange,
}: {
  state: PasswordFieldState;
  onChange: (next: PasswordFieldState) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  async function regenerate() {
    setGenerating(true);
    try {
      const password = await generatePassword();
      onChange({ ...state, generatedPassword: password });
    } finally {
      setGenerating(false);
    }
  }

  // Auto-generate the first time this mode is entered (with nothing to
  // show yet) — the admin still gets an explicit Regenerate button for a
  // different one, but shouldn't have to press Generate just to see the
  // default happy path work.
  useEffect(() => {
    if (state.mode === 'generate' && !state.generatedPassword && !generating) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      regenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode]);

  async function copyToClipboard() {
    if (!state.generatedPassword) return;
    await Clipboard.setStringAsync(state.generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const manualError = state.mode === 'manual' && state.manualPassword ? validatePassword(state.manualPassword) : null;
  const mismatchError =
    state.mode === 'manual' && state.manualConfirm && state.manualPassword !== state.manualConfirm
      ? 'Passwords do not match'
      : null;

  return (
    <View>
      <View className="flex-row gap-1.5 mb-2.5 bg-neutral-100 rounded-lg p-1">
        {(['generate', 'manual'] as const).map((m) => {
          const active = state.mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => onChange({ ...state, mode: m })}
              className="flex-1 py-1.5 rounded-md items-center"
              style={{ backgroundColor: active ? '#0F1F33' : 'transparent' }}
            >
              <Text className="text-xs font-semibold" style={{ color: active ? '#fff' : '#525252' }}>
                {m === 'generate' ? 'Generate' : 'Type manually'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.mode === 'generate' ? (
        <View>
          <View className="flex-row items-center gap-2 mb-1.5">
            <View className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 bg-neutral-50 flex-row items-center justify-center" style={{ minHeight: 38 }}>
              {generating ? (
                <ActivityIndicator size="small" color="#0F1F33" />
              ) : (
                <Text className="text-sm font-mono text-neutral-900">{state.generatedPassword ?? ''}</Text>
              )}
            </View>
            <Pressable
              onPress={copyToClipboard}
              disabled={!state.generatedPassword}
              className="w-9 h-9 rounded-lg bg-neutral-100 items-center justify-center"
            >
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#0F1F33" />
            </Pressable>
          </View>
          <Pressable onPress={regenerate} disabled={generating} className="self-start px-3 py-1.5 rounded-lg bg-neutral-100">
            <Text className="text-2xs font-semibold text-neutral-600">Regenerate</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <View className="flex-row items-center gap-1.5 mb-2">
            <TextInput
              value={state.manualPassword}
              onChangeText={(v) => onChange({ ...state, manualPassword: v })}
              placeholder="New password"
              secureTextEntry={!showManual}
              autoCapitalize="none"
              className={inputClass}
            />
            <Pressable onPress={() => setShowManual((v) => !v)} className="w-9 h-9 items-center justify-center">
              <Ionicons name={showManual ? 'eye-off-outline' : 'eye-outline'} size={18} color="#737373" />
            </Pressable>
          </View>
          <View className="flex-row items-center gap-1.5 mb-1.5">
            <TextInput
              value={state.manualConfirm}
              onChangeText={(v) => onChange({ ...state, manualConfirm: v })}
              placeholder="Confirm password"
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              className={inputClass}
            />
            <Pressable onPress={() => setShowConfirm((v) => !v)} className="w-9 h-9 items-center justify-center">
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#737373" />
            </Pressable>
          </View>
          {(manualError || mismatchError) && (
            <Text className="text-2xs text-red-600 mb-1">{manualError ?? mismatchError}</Text>
          )}
          <Text className="text-2xs text-neutral-400">At least 8 characters, with a letter and a number.</Text>
        </View>
      )}
    </View>
  );
}
