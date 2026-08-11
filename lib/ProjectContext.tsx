import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { appRoleFor, useAuth } from './AuthContext';
import { fetchStaffProjects, type ProjectOption } from './projects';
import { getPersistedSelectedProjectId, persistSelectedProjectId } from './locationTracking/currentFieldSession';

// The single shared "which project am I looking at" source for the whole
// app — replaces each screen (Gantt, Flowchart) previously managing its own
// independent selectedProjectId + project-picker chips. Provided once at
// the root layout (above both the (authenticated) drawer AND any stacked
// screens like /project-dashboard or /task/[id]), so every screen reads the
// SAME value via useProject() instead of re-deriving it.
//
// A client account isn't really "selecting" anything — its one project
// (profile.clientProjectId) is fixed for the life of the session, same as
// every existing screen's own `profile?.clientProjectId ?? null` fallback
// already assumed; this just centralizes that assumption in one place.
interface ProjectContextValue {
  projects: ProjectOption[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  // True for a client (or before staff has picked anything) — screens that
  // need a project chosen should treat a null selectedProjectId as "show a
  // pick-a-project prompt," not silently default to the first one, now
  // that project selection is a deliberate, visible step (App Home) rather
  // than an implicit default.
  isClient: boolean;
  reload: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isClient = profile != null && appRoleFor(profile.role) === 'client';

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) {
      setLoading(false);
      return;
    }
    if (isClient) {
      // Not a real "selection" — permanently pinned, same as every screen's
      // previous local clientProjectId fallback.
      setSelectedProjectIdState(profile.clientProjectId ?? null);
      setProjects([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const list = await fetchStaffProjects();
      setProjects(list);
      // Rehydrates a staff selection that survived a JS process restart —
      // e.g. Android killed the backgrounded app, then relaunched it
      // directly onto a persisted route like Attendance/Settings that
      // skips Home's own project-picker step entirely. In-memory state
      // alone is lost across that restart; this persisted value isn't.
      // Only restores if nothing has already set a selection THIS session
      // (the functional-update form checks "is it still null" atomically,
      // so a real user pick landing between the await above and here never
      // gets clobbered) and only if the persisted project is still one
      // this account can actually see (list membership) — a stale id from
      // a project this account lost access to since should fall through to
      // Home's own picker instead of silently selecting something invalid.
      const persisted = await getPersistedSelectedProjectId();
      if (persisted && list.some((p) => p.id === persisted)) {
        setSelectedProjectIdState((current) => current ?? persisted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [profile, isClient]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A client's selection can't be changed — their project is fixed by their
  // account, not a per-session choice, so this is a deliberate no-op for
  // them rather than silently accepting a value that RLS would reject
  // anyway the moment any project-scoped query ran. useCallback (not a
  // plain function) specifically so it has a stable identity across
  // renders — the memoized value object below depends on it, and a
  // fresh-every-render function reference would defeat that memoization.
  const setSelectedProjectId = useCallback((id: string | null) => {
    if (isClient) return;
    setSelectedProjectIdState(id);
    // Persisted for every role now (previously only ever written from
    // useFieldLocationTracking.ts, which is exclusively active for field
    // roles — admin/manager selections were never persisted at all, hence
    // the load() rehydration above having nothing to restore for them).
    persistSelectedProjectId(id).catch(() => {});
  }, [isClient]);

  // Memoized so a re-render of ProjectProvider that doesn't actually change
  // any of these values (e.g. one triggered by a re-rendering ancestor,
  // not by this provider's own state) doesn't hand every useProject()
  // consumer a brand-new object reference — confirmed live: this was
  // cascading into every still-mounted drawer screen on every single
  // navigation, since context consumers re-render on value identity, not
  // deep equality.
  const value = useMemo(
    () => ({ projects, selectedProjectId, setSelectedProjectId, loading, error, isClient, reload: load }),
    [projects, selectedProjectId, setSelectedProjectId, loading, error, isClient, load]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject() must be called within a ProjectProvider');
  return ctx;
}
