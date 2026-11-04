import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useProject } from '../../lib/ProjectContext';
import { Card } from '../ui/Card';

// Inline project picker for the 3 mobile report screens (Task/Weekly/Monthly
// Report) — same tap-to-expand dropdown pattern already used by
// flowchart-templates/apply/[templateId].tsx's own "Target Project" picker,
// reused here rather than inventing a second style. Added so picking a
// project (and switching it) happens right on the report screen itself,
// not only via a prior trip to Home — these screens used to silently
// <Redirect href="/home" /> whenever nothing was selected yet, which from
// the drawer just looked like the report link did nothing.
export function ReportProjectPicker() {
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const [open, setOpen] = useState(false);
  const selectedName = projects.find((p) => p.id === selectedProjectId)?.name ?? null;

  return (
    <Card className="mb-3">
      <Text className="text-2xs text-neutral-400 mb-1">Project</Text>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 bg-white"
      >
        <Text className={`text-sm ${selectedName ? 'text-neutral-900 font-medium' : 'text-neutral-400'}`}>
          {selectedName ?? 'Select a project'}
        </Text>
        <Text className="text-neutral-400">{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View className="mt-2">
          {projects.map((p) => {
            const active = selectedProjectId === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => {
                  setSelectedProjectId(p.id);
                  setOpen(false);
                }}
                className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
              >
                <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}
