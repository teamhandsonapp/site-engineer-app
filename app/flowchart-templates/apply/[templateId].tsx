import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoleFor, useAuth } from '../../../lib/AuthContext';
import { useProject } from '../../../lib/ProjectContext';
import { fetchWorksForProject, type WorkOption } from '../../../lib/flowchart/data';
import {
  applyFlowchartTemplate,
  computeTemplateApplyPreview,
  fetchTemplateDetail,
  matchTemplateWorks,
  type ApplyTemplateResult,
  type TemplateApplyPreviewTask,
  type TemplateDetail,
  type WorkMatch,
  type WorkResolution,
} from '../../../lib/flowchart/templates';
import { DateField } from '../../../components/ui/DateField';
import { Card } from '../../../components/ui/Card';

const CODE_PATTERN = /^[A-Za-z0-9]{2,10}$/;

type Step = 'setup' | 'works' | 'preview' | 'done';

interface NewWorkDraft {
  name: string;
  code: string;
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function StepHeader({ step }: { step: Step }) {
  const labels: Record<Step, string> = { setup: 'Start', works: 'Match Works', preview: 'Preview', done: 'Done' };
  const order: Step[] = ['setup', 'works', 'preview', 'done'];
  const idx = order.indexOf(step);
  return (
    <View className="flex-row items-center gap-1.5 px-4 pt-3 pb-2">
      {order.map((s, i) => (
        <View key={s} className="flex-row items-center gap-1.5">
          <View className={`w-5 h-5 rounded-full items-center justify-center ${i <= idx ? 'bg-brand-navy' : 'bg-neutral-200'}`}>
            <Text className={`text-2xs font-bold ${i <= idx ? 'text-white' : 'text-neutral-500'}`}>{i + 1}</Text>
          </View>
          {i < order.length - 1 && <View className={`w-4 h-px ${i < idx ? 'bg-brand-navy' : 'bg-neutral-200'}`} />}
        </View>
      ))}
      <Text className="text-2xs font-semibold text-neutral-400 ml-2 uppercase tracking-wide">{labels[step]}</Text>
    </View>
  );
}

// Part 3 of the Flowchart Template Kit — apply a saved template to a real
// project at a chosen anchor date. Four steps: pick the target project +
// anchor date, resolve each TemplateTask's workName against a real Work in
// that project (map to an existing one or create a new one — never
// silently duplicated), preview the exact computed dates, then commit.
// Nothing is written to the database until "Confirm & Create" on the
// preview step.
export default function ApplyFlowchartTemplateScreen() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  const { state } = useAuth();
  const isStaff = state.status === 'signed-in' && appRoleFor(state.profile.role) === 'staff';
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();

  const [step, setStep] = useState<Step>('setup');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [targetProjectId, setTargetProjectId] = useState<string | null>(selectedProjectId);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  const [workMatches, setWorkMatches] = useState<WorkMatch[]>([]);
  const [projectWorks, setProjectWorks] = useState<WorkOption[]>([]);
  const [workChoiceMode, setWorkChoiceMode] = useState<Record<string, 'existing' | 'new'>>({});
  const [workExistingChoice, setWorkExistingChoice] = useState<Record<string, string>>({});
  const [workNewDraft, setWorkNewDraft] = useState<Record<string, NewWorkDraft>>({});
  const [workPickerOpenFor, setWorkPickerOpenFor] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [preview, setPreview] = useState<TemplateApplyPreviewTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyTemplateResult | null>(null);

  useEffect(() => {
    if (!templateId) return;
    fetchTemplateDetail(templateId)
      .then(setTemplate)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [templateId]);

  const targetProjectName = projects.find((p) => p.id === targetProjectId)?.name ?? null;

  async function proceedFromSetup() {
    if (!template || !targetProjectId || !anchorDate) return;
    setAdvancing(true);
    setError(null);
    try {
      const works = await fetchWorksForProject(targetProjectId);
      const matches = matchTemplateWorks(template.tasks, works);
      setProjectWorks(works);
      setWorkMatches(matches);
      if (matches.every((m) => m.matchedWorkId)) {
        await proceedToPreview(matches);
      } else {
        setStep('works');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdvancing(false);
    }
  }

  function buildResolutions(matches: WorkMatch[]): WorkResolution[] | null {
    const resolutions: WorkResolution[] = [];
    for (const m of matches) {
      if (m.matchedWorkId && m.matchedWorkCode) {
        resolutions.push({ workName: m.workName, existing: { workId: m.matchedWorkId, workCode: m.matchedWorkCode }, createNew: null });
        continue;
      }
      const mode = workChoiceMode[m.workName] ?? 'existing';
      if (mode === 'existing') {
        const workId = workExistingChoice[m.workName];
        const work = projectWorks.find((w) => w.id === workId);
        if (!work) return null;
        resolutions.push({ workName: m.workName, existing: { workId: work.id, workCode: work.code }, createNew: null });
      } else {
        const draft = workNewDraft[m.workName];
        if (!draft || !draft.name.trim() || !CODE_PATTERN.test(draft.code.trim())) return null;
        resolutions.push({ workName: m.workName, existing: null, createNew: { name: draft.name.trim(), code: draft.code.trim().toUpperCase() } });
      }
    }
    return resolutions;
  }

  const worksStepValid = buildResolutions(workMatches) !== null;

  async function proceedToPreview(matches: WorkMatch[]) {
    if (!template || !anchorDate) return;
    const resolutions = buildResolutions(matches);
    if (!resolutions) return;
    setAdvancing(true);
    setError(null);
    try {
      const computed = await computeTemplateApplyPreview(template.tasks, anchorDate);
      setPreview(computed);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdvancing(false);
    }
  }

  async function confirmApply() {
    if (!template || !targetProjectId) return;
    const resolutions = buildResolutions(workMatches);
    if (!resolutions) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await applyFlowchartTemplate({
        projectId: targetProjectId,
        previewTasks: preview,
        links: template.links,
        workResolutions: resolutions,
      });
      setResult(res);
      setStep('done');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!isStaff) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <Stack.Screen options={{ headerShown: true, title: template?.name ?? 'Apply Template', headerStyle: { backgroundColor: '#0F1F33' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '600' } }} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error && !template ? (
        <View className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      ) : !template ? null : (
        <>
          <StepHeader step={step} />

          {step === 'setup' && (
            <ScrollView contentContainerClassName="px-4 pt-1 pb-10">
              <Card className="mb-4">
                <Text className="text-sm font-semibold text-neutral-900">{template.name}</Text>
                {template.description && <Text className="text-xs text-neutral-500 mt-1">{template.description}</Text>}
                <Text className="text-2xs text-neutral-400 mt-1.5">{template.tasks.length} task{template.tasks.length === 1 ? '' : 's'}</Text>
              </Card>

              <Text className="text-xs text-neutral-400 mb-1">Target Project</Text>
              <Pressable
                onPress={() => setProjectPickerOpen((v) => !v)}
                className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 mb-1 bg-white"
              >
                <Text className="text-sm text-neutral-900">{targetProjectName ?? 'Select a project'}</Text>
                <Text className="text-neutral-400">{projectPickerOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {projectPickerOpen && (
                <View className="mb-3">
                  {projects.map((p) => {
                    const active = targetProjectId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => { setTargetProjectId(p.id); setProjectPickerOpen(false); }}
                        className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-white border border-neutral-100'}`}
                      >
                        <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <View className="mt-2">
                <DateField label="Anchor Start Date" value={anchorDate} onChange={setAnchorDate} />
              </View>
              <Text className="text-2xs text-neutral-400 mt-1.5">
                The template&apos;s first task starts on this date — every other task&apos;s date is computed from it, using the same offsets it was saved with.
              </Text>

              {error && (
                <View className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <Pressable
                onPress={proceedFromSetup}
                disabled={!targetProjectId || !anchorDate || advancing}
                className="mt-5 rounded-xl py-3 items-center bg-brand-navy"
                style={{ opacity: !targetProjectId || !anchorDate || advancing ? 0.5 : 1 }}
              >
                {advancing ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Next</Text>}
              </Pressable>
            </ScrollView>
          )}

          {step === 'works' && (
            <ScrollView contentContainerClassName="px-4 pt-1 pb-10">
              <Pressable onPress={() => setStep('setup')} className="flex-row items-center gap-1 mb-3">
                <Ionicons name="chevron-back" size={16} color="#0F1F33" />
                <Text className="text-xs font-semibold text-brand-navy">Back</Text>
              </Pressable>

              <Text className="text-xs text-neutral-500 mb-3">
                Match each Work this template uses to a real Work in &ldquo;{targetProjectName}&rdquo; — map to an existing one, or create a new one. Nothing is created until you confirm on the preview step.
              </Text>

              {workMatches.map((m) => {
                const matched = !!m.matchedWorkId;
                const mode = workChoiceMode[m.workName] ?? 'existing';
                return (
                  <Card key={m.workName} className="mb-3">
                    <Text className="text-sm font-semibold text-neutral-900">{m.workName}</Text>
                    {matched ? (
                      <View className="flex-row items-center gap-1.5 mt-1.5">
                        <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                        <Text className="text-xs text-green-700">Matched to an existing Work</Text>
                      </View>
                    ) : (
                      <View className="mt-2">
                        <View className="flex-row gap-2 mb-2">
                          <Pressable
                            onPress={() => setWorkChoiceMode((prev) => ({ ...prev, [m.workName]: 'existing' }))}
                            className={`flex-1 py-2 rounded-lg items-center ${mode === 'existing' ? 'bg-brand-navy' : 'bg-neutral-100'}`}
                          >
                            <Text className={`text-xs font-semibold ${mode === 'existing' ? 'text-white' : 'text-neutral-600'}`}>Map to existing</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setWorkChoiceMode((prev) => ({ ...prev, [m.workName]: 'new' }))}
                            className={`flex-1 py-2 rounded-lg items-center ${mode === 'new' ? 'bg-brand-navy' : 'bg-neutral-100'}`}
                          >
                            <Text className={`text-xs font-semibold ${mode === 'new' ? 'text-white' : 'text-neutral-600'}`}>Create new</Text>
                          </Pressable>
                        </View>

                        {mode === 'existing' && (
                          <>
                            <Pressable
                              onPress={() => setWorkPickerOpenFor((v) => (v === m.workName ? null : m.workName))}
                              className="flex-row items-center justify-between border border-neutral-200 rounded-lg px-3 py-2 bg-white"
                            >
                              <Text className="text-xs text-neutral-800">
                                {projectWorks.find((w) => w.id === workExistingChoice[m.workName])?.name ?? 'Select a Work'}
                              </Text>
                              <Text className="text-neutral-400">{workPickerOpenFor === m.workName ? '▲' : '▼'}</Text>
                            </Pressable>
                            {workPickerOpenFor === m.workName && (
                              <View className="mt-1">
                                {projectWorks.length === 0 && (
                                  <Text className="text-2xs text-neutral-400 px-1 py-1">This project has no Works yet — create a new one instead.</Text>
                                )}
                                {projectWorks.map((w) => {
                                  const active = workExistingChoice[m.workName] === w.id;
                                  return (
                                    <Pressable
                                      key={w.id}
                                      onPress={() => { setWorkExistingChoice((prev) => ({ ...prev, [m.workName]: w.id })); setWorkPickerOpenFor(null); }}
                                      className={`px-3 py-2 rounded-lg mb-1 ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                                    >
                                      <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{w.name} ({w.code})</Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            )}
                          </>
                        )}

                        {mode === 'new' && (
                          <View className="gap-2">
                            <TextInput
                              value={workNewDraft[m.workName]?.name ?? m.workName}
                              onChangeText={(v) => setWorkNewDraft((prev) => ({ ...prev, [m.workName]: { name: v, code: prev[m.workName]?.code ?? '' } }))}
                              placeholder="Work name"
                              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
                            />
                            <TextInput
                              value={workNewDraft[m.workName]?.code ?? ''}
                              onChangeText={(v) => setWorkNewDraft((prev) => ({ ...prev, [m.workName]: { name: prev[m.workName]?.name ?? m.workName, code: v.toUpperCase() } }))}
                              placeholder="Code (2-10 letters/numbers)"
                              autoCapitalize="characters"
                              maxLength={10}
                              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white"
                            />
                          </View>
                        )}
                      </View>
                    )}
                  </Card>
                );
              })}

              {error && (
                <View className="mt-1 mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <Pressable
                onPress={() => proceedToPreview(workMatches)}
                disabled={!worksStepValid || advancing}
                className="mt-2 rounded-xl py-3 items-center bg-brand-navy"
                style={{ opacity: !worksStepValid || advancing ? 0.5 : 1 }}
              >
                {advancing ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Preview</Text>}
              </Pressable>
            </ScrollView>
          )}

          {step === 'preview' && (
            <ScrollView contentContainerClassName="px-4 pt-1 pb-10">
              <Pressable onPress={() => setStep(workMatches.some((m) => !m.matchedWorkId) ? 'works' : 'setup')} className="flex-row items-center gap-1 mb-3">
                <Ionicons name="chevron-back" size={16} color="#0F1F33" />
                <Text className="text-xs font-semibold text-brand-navy">Back</Text>
              </Pressable>

              <Text className="text-xs text-neutral-500 mb-3">
                Nothing has been created yet — review the computed dates below, then confirm.
              </Text>

              {preview.map((t) => (
                <Card key={t.id} className="mb-2">
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-neutral-900">{t.taskName}</Text>
                      <Text className="text-2xs text-neutral-400 mt-0.5">{t.workName}{t.trackLabel ? ` · ${t.trackLabel}` : ''}</Text>
                    </View>
                    <Text className="text-2xs font-semibold text-neutral-600 flex-shrink-0">{formatShortDate(t.plannedStartDate)} – {formatShortDate(t.dueDate)}</Text>
                  </View>
                </Card>
              ))}

              {submitError && (
                <View className="mt-1 mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <Text className="text-xs text-red-600">{submitError}</Text>
                </View>
              )}

              <Pressable
                onPress={confirmApply}
                disabled={submitting}
                className="mt-2 rounded-xl py-3 items-center bg-brand-navy"
                style={{ opacity: submitting ? 0.5 : 1 }}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-bold text-white">Confirm & Create ({preview.length} task{preview.length === 1 ? '' : 's'})</Text>}
              </Pressable>
            </ScrollView>
          )}

          {step === 'done' && result && (
            <View className="flex-1 items-center justify-center px-8">
              <Ionicons name="checkmark-circle" size={48} color="#16A34A" />
              <Text className="text-md font-bold text-neutral-900 text-center mt-3">Template applied</Text>
              <Text className="text-sm text-neutral-500 text-center mt-1.5">
                Created {result.createdTaskCount} task{result.createdTaskCount === 1 ? '' : 's'}, {result.createdLinkCount} link{result.createdLinkCount === 1 ? '' : 's'}
                {result.createdWorkCount > 0 ? `, and ${result.createdWorkCount} new Work${result.createdWorkCount === 1 ? '' : 's'}` : ''} in &ldquo;{targetProjectName}&rdquo;.
              </Text>
              <Pressable
                onPress={() => { if (targetProjectId) setSelectedProjectId(targetProjectId); router.replace('/project-dashboard'); }}
                className="mt-6 rounded-xl px-5 py-3 bg-brand-navy"
              >
                <Text className="text-sm font-bold text-white">Done</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}
