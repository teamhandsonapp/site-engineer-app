import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DONT_KILL_MY_APP_URL } from '../lib/locationTracking/deviceInfo';
import { markManufacturerChecklistComplete, type ManufacturerChecklist } from '../lib/locationTracking/manufacturerChecklist';

// Escalation from the optional "If tracking seems unreliable" help card
// (attendance.tsx's TrackingHelpCard) to a MANDATORY, blocking gate for the
// worst-offender manufacturers — built directly from a real live failure
// where an engineer's Oppo phone never once successfully sent a location
// ping, most likely because none of these OEM toggles were ever set and an
// optional card was easy to skip. Same full-screen visual weight as
// BackgroundLocationExplainer/BatteryOptimizationPrompt, chained right
// after them in FieldLocationGuard's boot sequence — but with no "skip"
// escape hatch, since these specific manufacturers are known to silently
// break tracking entirely, not just degrade it.
export function ManufacturerChecklistGate({
  checklist,
  userId,
  onDone,
}: {
  checklist: ManufacturerChecklist;
  userId: string;
  onDone: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const allChecked = checklist.steps.every((s) => checked[s.id]);

  function toggle(id: string) {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  }

  async function handleContinue() {
    if (!allChecked) return;
    setSaving(true);
    try {
      await markManufacturerChecklistComplete(userId);
    } finally {
      setSaving(false);
      onDone();
    }
  }

  return (
    <View className="flex-1 bg-brand-navy">
      <ScrollView contentContainerClassName="px-8 pt-16 pb-10" showsVerticalScrollIndicator={false}>
        <View className="w-16 h-16 rounded-full bg-brand-amber/15 items-center justify-center mb-5 self-center">
          <Ionicons name="phone-portrait-outline" size={32} color="#F0A227" />
        </View>
        <Text className="text-lg font-bold text-white text-center">One More Setup Step</Text>
        <Text className="text-sm text-white/65 text-center mt-2.5 leading-5 mb-6">
          Your phone ({checklist.displayName}) is known to aggressively stop background apps to
          save battery, which silently breaks site tracking. Complete each step below in your
          phone&apos;s Settings app, then check it off — this only takes a minute.
        </Text>

        {checklist.steps.map((step, i) => {
          const isChecked = !!checked[step.id];
          return (
            <Pressable
              key={step.id}
              onPress={() => toggle(step.id)}
              className="flex-row items-start gap-3 mb-3 px-4 py-3.5 rounded-xl"
              style={{ backgroundColor: isChecked ? 'rgba(240,162,39,0.15)' : 'rgba(255,255,255,0.06)' }}
            >
              <View
                className="w-5 h-5 rounded-md items-center justify-center mt-0.5"
                style={{
                  backgroundColor: isChecked ? '#F0A227' : 'transparent',
                  borderWidth: 1.5,
                  borderColor: isChecked ? '#F0A227' : 'rgba(255,255,255,0.4)',
                }}
              >
                {isChecked && <Ionicons name="checkmark" size={13} color="#0F1F33" />}
              </View>
              <Text className="text-sm text-white/85 flex-1 leading-5">
                {i + 1}. {step.instruction}
              </Text>
            </Pressable>
          );
        })}

        <Pressable onPress={() => Linking.openURL(DONT_KILL_MY_APP_URL)} className="self-center mt-1 mb-6">
          <Text className="text-2xs font-bold text-brand-amber">Learn more for your device →</Text>
        </Pressable>

        <Pressable
          onPress={handleContinue}
          disabled={!allChecked || saving}
          className="px-5 py-3.5 rounded-xl bg-brand-amber flex-row items-center justify-center gap-2"
          style={{ opacity: allChecked && !saving ? 1 : 0.4 }}
        >
          <Text className="text-sm font-bold text-brand-navy">{saving ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
        {!allChecked && (
          <Text className="text-2xs text-white/40 text-center mt-3">Check off every step above to continue.</Text>
        )}
      </ScrollView>
    </View>
  );
}
