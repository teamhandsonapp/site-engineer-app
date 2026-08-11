import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PixelRatio, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EdgeLayer } from './EdgeLayer';
import { TaskNode } from './TaskNode';
import { TaskDetailSheet } from './TaskDetailSheet';
import { TaskActionMenu } from './TaskActionMenu';
import { RelationshipToolbar, type ToolMode } from './RelationshipToolbar';
import { CANVAS_THEMES, GridBackground, type CanvasTheme } from './GridBackground';
import { CreateTaskSheet } from './CreateTaskSheet';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { buildFlowchartAxisMaps, clampToSafeBitmapBudget, computeBounds, computeGridArea, fitInitialViewTransform, inverseAxisMap, layoutTasks, NODE_HEIGHT, NODE_WIDTH, type GridArea } from '../../lib/flowchart/layout';
import {
  createDependency,
  createParallelLink,
  deleteDependency,
  deleteParallelLink,
  deleteTask,
  fetchTaskById,
  updateTaskPosition,
} from '../../lib/flowchart/data';
import { getTaskTypeColors } from '../../lib/flowchart/taskTypeColor';
import {
  applyTaskFieldChanges,
  captureTaskDeleteSnapshot,
  MAX_HISTORY_DEPTH,
  parallelEdgesFromSnapshot,
  restoreTaskFromSnapshot,
  seriesEdgesFromSnapshot,
  type UndoableAction,
} from '../../lib/flowchart/undo';
import type {
  FlowchartParallelEdge,
  FlowchartSeriesEdge,
  FlowchartTask,
  PositionedTask,
  TaskTypeOption,
} from '../../lib/flowchart/types';

export function FlowchartCanvas({
  projectId,
  initialTasks,
  seriesEdges: initialSeriesEdges,
  parallelEdges: initialParallelEdges,
  taskTypes,
  canEdit,
}: {
  projectId: string;
  initialTasks: FlowchartTask[];
  seriesEdges: FlowchartSeriesEdge[];
  parallelEdges: FlowchartParallelEdge[];
  taskTypes: TaskTypeOption[];
  canEdit: boolean;
}) {
  // PixelRatio.get() never changes for a mounted app (not a ref/state — a
  // plain device constant), so this is safe to read directly on every
  // render. See clampToSafeBitmapBudget's own comment for why this needs
  // to be the ACTUAL device pixel ratio, not a fixed constant.
  const safeLayout = useCallback(
    (raw: FlowchartTask[]) => clampToSafeBitmapBudget(layoutTasks(raw), PixelRatio.get()),
    []
  );
  // Computed once, up front, so the two states seeded from it below (tasks +
  // nodeScale) never run the layout pass twice on mount.
  const initialLayout = useMemo(() => safeLayout(initialTasks), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tasks, setTasks] = useState<PositionedTask[]>(initialLayout.tasks);
  // See TaskNode/EdgeLayer's own nodeScale prop — 1 for every normal
  // project; only smaller when this graph had to be shrunk to stay under
  // Android's bitmap ceiling. MUST be kept in lockstep with `tasks` (both
  // come from the exact same safeLayout() call at every site below) — a
  // stale nodeScale left over from a previous layout pass while tasks moves
  // on to a new one is exactly the box-on-box overlap bug this was written
  // to prevent.
  const [nodeScale, setNodeScale] = useState<number>(initialLayout.nodeScale);
  const [seriesEdges, setSeriesEdges] = useState(initialSeriesEdges);
  const [parallelEdges, setParallelEdges] = useState(initialParallelEdges);

  // Part 1 — defaults to LOCKED (view-only) every time this screen is
  // freshly focused, and deliberately never persisted (no AsyncStorage/
  // SecureStore) — the drawer keeps this screen mounted across tab
  // switches, so a plain useState default alone would NOT reset on
  // re-entry; useFocusEffect is what actually re-locks every time someone
  // navigates back to this tab, not just on first mount.
  //
  // MUST be wrapped in useCallback with an empty dep array — expo-router's
  // useFocusEffect re-runs its whole focus/blur subscription setup whenever
  // the callback's REFERENCE changes (it's in that hook's own internal
  // useEffect dependency array), and re-fires immediately if the screen is
  // still focused. An inline (unmemoized) callback gets a new identity on
  // every render of THIS component — including the very render caused by
  // tapping the lock button itself — which re-ran this effect and called
  // setIsUnlocked(false) again a moment later, silently reverting every
  // unlock attempt back to locked. Confirmed live: this is exactly why
  // tapping "Locked" appeared to do nothing at all.
  const [isUnlocked, setIsUnlocked] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsUnlocked(false);
    }, [])
  );
  // The one true "can this session edit right now" gate — role (canEdit)
  // AND the lock both have to allow it. Everywhere below that used to check
  // bare `canEdit` for an edit affordance now checks this instead.
  const editable = canEdit && isUnlocked;

  // Canvas background theme — a plain viewing preference (not gated on
  // canEdit/editable), so it's available read-only too. Deliberately
  // session-only, matching admin-web's own darkCanvas convention (its own
  // toggle isn't persisted either — see CANVAS_THEMES's own comment).
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>('light');

  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // detailTaskId + detailEditable are deliberately separate from "editable"
  // above: a locked staff session (or any client session) can still open
  // this same sheet as a read-only peek (Part 6's "at most a lightweight
  // read-only peek") — only the explicit "Edit" action from the action menu
  // sets detailEditable true.
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailEditable, setDetailEditable] = useState(false);
  const [actionMenuTaskId, setActionMenuTaskId] = useState<string | null>(null);
  const [edgeDeleteConfirmId, setEdgeDeleteConfirmId] = useState<string | null>(null);
  const [deleteTaskConfirmId, setDeleteTaskConfirmId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  // ─── Undo/redo history — session-only (not persisted across app
  // restarts, per the request), capped at MAX_HISTORY_DEPTH. `past`/
  // `future` are plain state (not refs) since the toolbar's Undo/Redo
  // buttons need to re-render on every push/pop to enable/disable
  // correctly. `historyBusy` guards against double-tapping Undo/Redo
  // faster than its own await chain resolves, which could otherwise pop
  // the same stack entry twice.
  const [past, setPast] = useState<UndoableAction[]>([]);
  const [future, setFuture] = useState<UndoableAction[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  // Any NEW edit clears the redo stack — standard undo/redo semantics
  // (don't let Redo bring back something a fresh action just superseded).
  function pushHistory(action: UndoableAction) {
    setPast((prev) => {
      const next = [...prev, action];
      return next.length > MAX_HISTORY_DEPTH ? next.slice(next.length - MAX_HISTORY_DEPTH) : next;
    });
    setFuture([]);
  }

  // Shared by undo() and redo() — `direction` picks which side of each
  // action's before/after (or create/delete) pair to apply. Reads
  // `seriesEdges`/`parallelEdges` from this render's closure to resolve a
  // link action's CURRENT real id by its endpoints/type rather than a
  // fixed id captured at push-time — a link's id changes every time it's
  // deleted-then-recreated (Postgres assigns a fresh uuid), so re-deriving
  // "which row currently represents this relationship" from live state is
  // what keeps repeated undo/redo toggling correct instead of silently
  // no-op'ing after the first cycle.
  async function applyHistoryAction(action: UndoableAction, direction: 'undo' | 'redo'): Promise<void> {
    const isUndo = direction === 'undo';
    switch (action.type) {
      case 'move': {
        // action.before/after are REAL (uncompressed) coordinates — same
        // space commitDrag persists to manual_position_x/y (see its own
        // comment on why). The render position is re-derived through
        // layoutTasks() rather than set directly, so it goes through the
        // exact same compression every other task on screen uses.
        const pos = isUndo ? action.before : action.after;
        await updateTaskPosition(action.taskId, pos.x, pos.y);
        setTasks((prev) => {
          const result = safeLayout(prev.map((t) => (
            t.id === action.taskId ? { ...t, manualPositionX: pos.x, manualPositionY: pos.y } : t
          )));
          setNodeScale(result.nodeScale);
          return result.tasks;
        });
        return;
      }
      case 'editTask': {
        const from = isUndo ? action.after : action.before;
        const to = isUndo ? action.before : action.after;
        await applyTaskFieldChanges(action.taskId, from, to);
        setTasks((prev) => prev.map((t) => (t.id === action.taskId ? { ...t, ...to } : t)));
        return;
      }
      case 'deleteTask': {
        if (isUndo) {
          await restoreTaskFromSnapshot(action.snapshot);
          // Re-fetched rather than hand-mapped from the raw snapshot row —
          // workName/workAccountabilityType are resolved via a join
          // fetchTaskById already knows how to do (see its own comment).
          const restored = await fetchTaskById(action.taskId);
          setTasks((prev) => {
            const result = safeLayout([...prev, restored]);
            setNodeScale(result.nodeScale);
            return result.tasks;
          });
          setSeriesEdges((prev) => [...prev, ...seriesEdgesFromSnapshot(action.snapshot)]);
          setParallelEdges((prev) => [...prev, ...parallelEdgesFromSnapshot(action.snapshot)]);
        } else {
          await deleteTask(action.taskId);
          setTasks((prev) => prev.filter((t) => t.id !== action.taskId));
          setSeriesEdges((prev) => prev.filter((e) => e.taskId !== action.taskId && e.dependsOnTaskId !== action.taskId));
          setParallelEdges((prev) => prev.filter((e) => e.taskAId !== action.taskId && e.taskBId !== action.taskId));
        }
        return;
      }
      case 'createSeriesLink': {
        if (isUndo) {
          const edge = seriesEdges.find((e) => e.taskId === action.taskId && e.dependsOnTaskId === action.dependsOnTaskId);
          if (edge) {
            await deleteDependency(edge.id);
            setSeriesEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        } else {
          const edge = await createDependency(action.taskId, action.dependsOnTaskId, action.linkType);
          setSeriesEdges((prev) => [...prev, edge]);
        }
        return;
      }
      case 'createParallelLink': {
        if (isUndo) {
          const edge = parallelEdges.find(
            (e) => (e.taskAId === action.taskAId && e.taskBId === action.taskBId) || (e.taskAId === action.taskBId && e.taskBId === action.taskAId)
          );
          if (edge) {
            await deleteParallelLink(edge.id);
            setParallelEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        } else {
          const edge = await createParallelLink(action.taskAId, action.taskBId);
          setParallelEdges((prev) => [...prev, edge]);
        }
        return;
      }
      case 'deleteSeriesLink': {
        if (isUndo) {
          const edge = await createDependency(action.taskId, action.dependsOnTaskId, action.linkType);
          setSeriesEdges((prev) => [...prev, edge]);
        } else {
          const edge = seriesEdges.find((e) => e.taskId === action.taskId && e.dependsOnTaskId === action.dependsOnTaskId);
          if (edge) {
            await deleteDependency(edge.id);
            setSeriesEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        }
        return;
      }
      case 'deleteParallelLink': {
        if (isUndo) {
          const edge = await createParallelLink(action.taskAId, action.taskBId);
          setParallelEdges((prev) => [...prev, edge]);
        } else {
          const edge = parallelEdges.find(
            (e) => (e.taskAId === action.taskAId && e.taskBId === action.taskBId) || (e.taskAId === action.taskBId && e.taskBId === action.taskAId)
          );
          if (edge) {
            await deleteParallelLink(edge.id);
            setParallelEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        }
        return;
      }
    }
  }

  async function undo() {
    if (past.length === 0 || historyBusy) return;
    const action = past[past.length - 1];
    setHistoryBusy(true);
    try {
      await applyHistoryAction(action, 'undo');
      setPast((prev) => prev.slice(0, -1));
      setFuture((prev) => [...prev, action]);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not undo — try again.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function redo() {
    if (future.length === 0 || historyBusy) return;
    const action = future[future.length - 1];
    setHistoryBusy(true);
    try {
      await applyHistoryAction(action, 'redo');
      setFuture((prev) => prev.slice(0, -1));
      setPast((prev) => [...prev, action]);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not redo — try again.');
    } finally {
      setHistoryBusy(false);
    }
  }

  const typeColors = useMemo(() => getTaskTypeColors(taskTypes), [taskTypes]);

  const bounds = useMemo(() => computeBounds(tasks), [tasks]);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  // Read only from inside the effect below (never during render) — see the
  // identical boundsRef pattern this mirrors; a task drag changes `tasks`,
  // and re-fitting the view on every drag would fight the user's own
  // pan/zoom, so this is read via ref rather than listed as a dependency.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  });

  function handleContainerLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // The grid's own rendering rect — recentered on wherever the viewport
  // currently is (see computeGridArea's own comment) rather than sized to
  // the task bounds, so it never visibly cuts off no matter how far you pan.
  // Plain React state (not a shared value) since it only needs to update
  // once per gesture SETTLE, not every frame.
  const [gridArea, setGridArea] = useState<GridArea | null>(null);
  function recomputeGridArea() {
    if (!containerSize) return;
    setGridArea(computeGridArea(scale.value, translateX.value, translateY.value, containerSize.width, containerSize.height));
  }

  // Viewport culling — a real project's flowchart (311 tasks, confirmed
  // live) mounted every single TaskNode + edge unconditionally, each with
  // its own GestureDetector and Reanimated-driven style, which was enough
  // synchronous work on mount to trip Android's ANR watchdog ("mobile-
  // portal isn't responding"). Only tasks within the current viewport (plus
  // a margin, so a normal pan/pinch never visibly pops a node in) are
  // actually rendered — EdgeLayer already drops any edge whose endpoint
  // isn't in the list it's given (`byId.get` returns undefined, filtered
  // out), so passing it this same windowed list needs no changes there.
  // Plain React state, recomputed on gesture SETTLE (not per-frame) — same
  // shape as gridArea above, just filtering existing tasks instead of
  // generating a background rect.
  const [visibleTasks, setVisibleTasks] = useState<PositionedTask[]>([]);
  // Small relative to GridBackground's own 5x-viewport margin (a background
  // needs to survive a marathon pan without cutting off; a handful of
  // pre-rendered rows/columns just needs to survive one normal swipe/pinch
  // without a visible pop-in) — a few node-widths' worth of buffer on every
  // side.
  const VISIBLE_TASK_MARGIN = 500;
  function recomputeVisibleTasks() {
    if (!containerSize) return;
    const s = scale.value;
    const tx = translateX.value;
    const ty = translateY.value;
    const minX = (0 - tx) / s - VISIBLE_TASK_MARGIN;
    const maxX = (containerSize.width - tx) / s + VISIBLE_TASK_MARGIN;
    const minY = (0 - ty) / s - VISIBLE_TASK_MARGIN;
    const maxY = (containerSize.height - ty) / s + VISIBLE_TASK_MARGIN;
    // Closes over `tasks` directly (not tasksRef) — unlike the fit effect
    // below, this SHOULD see a fresh value on every tasks change (that's
    // exactly what the useEffect right after this function triggers on),
    // so there's no staleness concern to dodge with a ref here.
    setVisibleTasks(tasks.filter((t) => (
      t.x + NODE_WIDTH >= minX && t.x <= maxX && t.y + NODE_HEIGHT >= minY && t.y <= maxY
    )));
  }

  // Regression guard for the enableFreeze-based nav-perf fix (app/_layout.tsx)
  // — the drawer now FREEZES this screen while another tab is active instead
  // of leaving it mounted-and-rerendering, the same lifecycle change the
  // isUnlocked reset above already had to account for with its own
  // useFocusEffect. If containerSize/tasks/gesture state moved on while this
  // screen was frozen and blurred, force both derived-state recomputes to
  // re-sync against whatever they currently are the moment focus returns,
  // rather than trusting the effects below to have already caught it — cheap
  // even when nothing changed, and does NOT re-fit/re-center the view (that
  // would reset the user's own pan/zoom on every tab switch, a regression of
  // its own).
  //
  // Reads the LATEST recomputeGridArea/recomputeVisibleTasks via a ref
  // (synced unconditionally every render below) rather than calling them
  // directly, for the same reason isUnlocked's effect needs an empty-deps
  // useCallback: expo-router's useFocusEffect only re-subscribes when the
  // callback's REFERENCE changes, so a naive `useCallback(() => {
  // recomputeVisibleTasks() }, [])` would freeze in the FIRST render's
  // closure (containerSize still null) forever.
  const recomputeGridAreaRef = useRef(recomputeGridArea);
  const recomputeVisibleTasksRef = useRef(recomputeVisibleTasks);
  useEffect(() => {
    recomputeGridAreaRef.current = recomputeGridArea;
    recomputeVisibleTasksRef.current = recomputeVisibleTasks;
  });
  useFocusEffect(
    useCallback(() => {
      recomputeGridAreaRef.current();
      recomputeVisibleTasksRef.current();
    }, [])
  );

  // Covers task-list changes (drag, create, delete, undo/redo) that could
  // move a task into or out of the current viewport without the viewport
  // itself moving at all — NOT the initial fit (that's called explicitly
  // from inside the fit effect below, after scale/translate are actually
  // set; this effect runs in DECLARATION order same as any other, so keyed
  // on containerSize here too it would fire first, reading scale/translate
  // still at their useSharedValue defaults before the fit ever ran).
  useEffect(() => {
    recomputeVisibleTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Fits the topmost row group (the first main task + its parallel/SS
  // partner) at a comfortable, centered scale on first real layout / a
  // genuine resize — see fitInitialViewTransform's own comment for why this
  // replaced a whole-graph fit-to-view.
  useEffect(() => {
    if (!containerSize) return;
    const fit = fitInitialViewTransform(tasksRef.current, containerSize.width, containerSize.height);
    scale.value = fit.scale;
    savedScale.value = fit.scale;
    translateX.value = fit.translateX;
    savedTranslateX.value = fit.translateX;
    translateY.value = fit.translateY;
    savedTranslateY.value = fit.translateY;
    setGridArea(computeGridArea(fit.scale, fit.translateX, fit.translateY, containerSize.width, containerSize.height));
    recomputeVisibleTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize]);

  const draggingNodeId = useSharedValue<string | null>(null);
  const dragDeltaX = useSharedValue(0);
  const dragDeltaY = useSharedValue(0);

  function handleDragStart(taskId: string) {
    if (!editable) return;
    draggingNodeId.value = taskId;
    dragDeltaX.value = 0;
    dragDeltaY.value = 0;
  }

  function commitDrag(taskId: string, dx: number, dy: number) {
    const task = tasks.find((t) => t.id === taskId);
    draggingNodeId.value = null;
    dragDeltaX.value = 0;
    dragDeltaY.value = 0;
    if (!task) return;
    // A tap-and-release with no real movement isn't an edit — skip both the
    // write and the history entry so Undo never "reverts" a no-op drag.
    if (dx === 0 && dy === 0) return;
    const finalX = task.x + dx;
    const finalY = task.y + dy;

    // task.x/task.y are the CANVAS's compressed-for-display coordinates
    // (see layoutTasks's own comment on why mobile renders every stored
    // position tightened) — but manual_position_x/y in the DB must stay in
    // admin-web's real, uncompressed space, or every drag would slowly
    // corrupt the shared coordinate grid admin-web also reads. A task with
    // no real position yet (still on the fallback stack) was never run
    // through the axis maps in the first place, so its own on-screen
    // position already IS real.
    const hasRealPosition = task.manualPositionX != null && task.manualPositionY != null;
    const beforeReal = hasRealPosition
      ? { x: task.manualPositionX!, y: task.manualPositionY! }
      : { x: task.x, y: task.y };
    let afterReal = { x: finalX, y: finalY };
    if (hasRealPosition) {
      // Built fresh from the CURRENT full task list so this always inverts
      // through the exact same mapping layoutTasks() just rendered with —
      // the exact piecewise inverse of applyAxisMap, not an approximation.
      const { x: xMap, y: yMap } = buildFlowchartAxisMaps(tasks);
      afterReal = { x: inverseAxisMap(xMap, finalX), y: inverseAxisMap(yMap, finalY) };
    }

    setTasks((prev) => prev.map((t) => (
      t.id === taskId ? { ...t, x: finalX, y: finalY, manualPositionX: afterReal.x, manualPositionY: afterReal.y } : t
    )));
    updateTaskPosition(taskId, afterReal.x, afterReal.y).catch(() => {
      // Reverting on failure would need the pre-drag position remembered
      // separately; leaving the optimistic move in place and letting the
      // next real fetch correct it is the simpler, still-honest failure
      // mode here (matches how e.g. TaskDetailSheet's type-picker doesn't
      // roll back on error either).
    });
    // Stored as REAL coordinates — applyHistoryAction's own 'move' case
    // re-derives the compressed render position via layoutTasks(), same as
    // every other position-affecting action in this file.
    pushHistory({ type: 'move', taskId, before: beforeReal, after: afterReal });
  }

  function handleTap(taskId: string) {
    // Not staff, OR staff-but-locked: straight to the full checklist detail
    // screen — real feedback confirmed the earlier "quick-peek sheet"
    // (Name/Dates/Type only) wasn't what a plain tap should lead to; the
    // checklist is the substance of a task, and that screen already
    // degrades to read-only correctly on its own (its own `canEdit` is
    // role-based, independent of this canvas's lock toggle — the lock only
    // ever governed flowchart editing, not the checklist page). The quick
    // Edit-fields sheet is still reachable, just via the unlocked action
    // menu's explicit "Edit" option instead of being the default tap target.
    if (!editable) {
      router.push(`/task/${taskId}`);
      return;
    }
    if (activeTool === 'select') {
      setActionMenuTaskId(taskId);
      return;
    }
    // A relationship type is active: first tap picks the prerequisite/
    // source, second tap picks the target and creates the link immediately
    // using whichever type is active — no intermediate "pick a type" modal
    // anymore, since the type was already chosen from the toolbar.
    if (!pendingSourceId) {
      setPendingSourceId(taskId);
      return;
    }
    if (pendingSourceId === taskId) {
      setPendingSourceId(null); // tapping the same node again cancels
      return;
    }
    createLink(activeTool, pendingSourceId, taskId);
  }

  async function createLink(type: ToolMode, source: string, target: string) {
    if (type === 'select') return;
    setPendingSourceId(null);
    setLinkError(null);

    // Dedupe client-side — createDependency/createParallelLink have no
    // unique constraint backing them, so without this check re-tapping the
    // same pair (e.g. after a UI glitch) would silently insert a second,
    // overlapping edge that renders doubled-up in EdgeLayer.
    if (type === 'PARALLEL') {
      const exists = parallelEdges.some(
        (e) => (e.taskAId === source && e.taskBId === target) || (e.taskAId === target && e.taskBId === source)
      );
      if (exists) {
        setLinkError('These tasks are already linked as parallel.');
        return;
      }
    } else {
      const exists = seriesEdges.some((e) => e.taskId === target && e.dependsOnTaskId === source);
      if (exists) {
        setLinkError('This dependency already exists.');
        return;
      }
    }

    try {
      if (type === 'PARALLEL') {
        const edge = await createParallelLink(source, target);
        setParallelEdges((prev) => [...prev, edge]);
        pushHistory({ type: 'createParallelLink', taskAId: source, taskBId: target });
      } else {
        // Series edge direction: the SECOND tapped node is the one being
        // blocked (matches admin-web's own click-to-connect flow — the
        // first click is the prerequisite).
        const edge = await createDependency(target, source, type);
        setSeriesEdges((prev) => [...prev, edge]);
        pushHistory({ type: 'createSeriesLink', taskId: target, dependsOnTaskId: source, linkType: type });
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not create the link — try again.');
    }
    // activeTool is deliberately left untouched here (on both success and
    // failure) — see RelationshipToolbar's own comment: several links of
    // the same type should be creatable back to back without re-selecting.
  }

  function handleToolSelect(tool: ToolMode) {
    setPendingSourceId(null);
    setLinkError(null);
    // Re-tapping the already-active type deactivates it back to Select —
    // matches admin-web's own RelationshipPanel behavior.
    setActiveTool((prev) => (prev === tool ? 'select' : tool));
  }

  function handleEdgePress(edgeId: string, kind: 'series' | 'parallel') {
    if (!editable) return;
    if (kind === 'parallel') {
      // Captured BEFORE the optimistic removal below — the undo action
      // stores the relationship's content (endpoints), not this row's id,
      // since a later undo/redo recreates it with a fresh id (see
      // applyHistoryAction's own comment on why link actions never store a
      // fixed id).
      const edge = parallelEdges.find((e) => e.id === edgeId);
      // Purely visual/non-blocking — immediate delete, no confirmation,
      // matching admin-web's requestEdgeDelete exactly.
      setParallelEdges((prev) => prev.filter((e) => e.id !== edgeId));
      deleteParallelLink(edgeId).catch(() => {
        // Optimistic, same no-rollback precedent as commitDrag above.
      });
      if (edge) pushHistory({ type: 'deleteParallelLink', taskAId: edge.taskAId, taskBId: edge.taskBId });
    } else {
      setEdgeDeleteConfirmId(edgeId);
    }
  }

  function confirmSeriesEdgeDelete() {
    if (!edgeDeleteConfirmId) return;
    const id = edgeDeleteConfirmId;
    const edge = seriesEdges.find((e) => e.id === id);
    setEdgeDeleteConfirmId(null);
    setSeriesEdges((prev) => prev.filter((e) => e.id !== id));
    deleteDependency(id).catch(() => {
      // Optimistic, same no-rollback precedent as commitDrag above.
    });
    if (edge) pushHistory({ type: 'deleteSeriesLink', taskId: edge.taskId, dependsOnTaskId: edge.dependsOnTaskId, linkType: edge.type });
  }

  function handleOpenTask(taskId: string) {
    setActionMenuTaskId(null);
    router.push(`/task/${taskId}`);
  }

  function handleEditTask(taskId: string) {
    setActionMenuTaskId(null);
    setDetailTaskId(taskId);
    setDetailEditable(true);
  }

  function handleDeleteTaskRequest(taskId: string) {
    setActionMenuTaskId(null);
    setDeleteTaskConfirmId(taskId);
  }

  async function confirmDeleteTask() {
    if (!deleteTaskConfirmId) return;
    const id = deleteTaskConfirmId;
    setDeletingTask(true);
    try {
      // Snapshot MUST be captured before deleteTask() runs — its cascade
      // removes the checklist/links at the DB level the instant the task
      // row itself is deleted, so a snapshot taken after would just be
      // empty. If this fails, the delete itself is aborted rather than
      // proceeding without the ability to undo it.
      const snapshot = await captureTaskDeleteSnapshot(id);
      await deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      // task_dependencies/task_parallel_links rows cascade-delete at the DB
      // level (see deleteTask's own comment) — mirrored here in local state
      // so a stale edge referencing the now-gone task never lingers on
      // screen either.
      setSeriesEdges((prev) => prev.filter((e) => e.taskId !== id && e.dependsOnTaskId !== id));
      setParallelEdges((prev) => prev.filter((e) => e.taskAId !== id && e.taskBId !== id));
      setDeleteTaskConfirmId(null);
      pushHistory({ type: 'deleteTask', taskId: id, snapshot });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not delete the task — try again.');
      setDeleteTaskConfirmId(null);
    } finally {
      setDeletingTask(false);
    }
  }

  function handleTaskCreated(newTask: FlowchartTask, edge: FlowchartSeriesEdge | null) {
    // Re-runs the same fallback-positioning pass used on initial load
    // (layoutTasks) over the full task list plus the new one — the new
    // task has no manual_position_x/y yet, so it lands in the same
    // deterministic "stacked to the right of everything else" spot any
    // other never-yet-dragged task gets, not a separately-invented
    // placement rule just for creation.
    setTasks((prev) => {
      const result = safeLayout([...prev, newTask]);
      setNodeScale(result.nodeScale);
      return result.tasks;
    });
    if (edge) setSeriesEdges((prev) => [...prev, edge]);
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.2), 3);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Re-centers the grid's rect on wherever this pinch left the view —
      // see recomputeGridArea's own comment on why this is settle-triggered
      // rather than per-frame.
      runOnJS(recomputeGridArea)();
      runOnJS(recomputeVisibleTasks)();
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (draggingNodeId.value != null) {
        dragDeltaX.value = e.translationX / scale.value;
        dragDeltaY.value = e.translationY / scale.value;
        return;
      }
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd((e) => {
      if (draggingNodeId.value != null) {
        const id = draggingNodeId.value;
        const dx = e.translationX / scale.value;
        const dy = e.translationY / scale.value;
        runOnJS(commitDrag)(id, dx, dy);
        return;
      }
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(recomputeGridArea)();
      runOnJS(recomputeVisibleTasks)();
    });

  const composedGesture = Gesture.Simultaneous(pinch, pan);
  const insets = useSafeAreaInsets();

  // Explicit +/- controls alongside pinch-to-zoom — pinch alone isn't
  // discoverable (a user has no visual cue it's even possible), and a real
  // request came back for a plain on-screen way to zoom in/out. Zooms
  // toward the current viewport's center, keeping whatever content is
  // already centered under your thumb roughly where it was rather than
  // jumping the view around.
  function zoomBy(factor: number) {
    if (!containerSize) return;
    const cx = containerSize.width / 2;
    const cy = containerSize.height / 2;
    const oldScale = scale.value;
    const newScale = Math.min(Math.max(oldScale * factor, 0.2), 3);
    const actualFactor = newScale / oldScale;
    translateX.value = cx - (cx - translateX.value) * actualFactor;
    translateY.value = cy - (cy - translateY.value) * actualFactor;
    scale.value = newScale;
    savedScale.value = newScale;
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
    recomputeGridArea();
    recomputeVisibleTasks();
  }

  const canvasStyle = useAnimatedStyle(() => ({
    // transformOrigin defaults to the element's CENTER in CSS — fine for a
    // normal-sized element, but this container's real (untransformed) size
    // is the full graph bounds (tens of thousands of px tall for a large
    // real project), so scaling around its center threw the visible
    // viewport wildly far from where translateX/Y actually intended it to
    // land. Every pan/zoom canvas needs top-left-anchored scaling; this is
    // what fitInitialViewTransform's math (lib/flowchart/layout.ts) already
    // assumes.
    transformOrigin: '0 0',
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const detailTask = tasks.find((t) => t.id === detailTaskId) ?? null;
  const actionMenuTask = tasks.find((t) => t.id === actionMenuTaskId) ?? null;
  const deleteTaskTarget = tasks.find((t) => t.id === deleteTaskConfirmId) ?? null;
  const containerWidth = bounds.maxX + 400;
  const containerHeight = bounds.maxY + 400;

  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: CANVAS_THEMES[canvasTheme].bg }} onLayout={handleContainerLayout}>
      {/* Nothing real to show until the container's actual size is known —
          rendering the canvas against the placeholder scale=1 identity
          transform first would flash the graph at the wrong position/size
          for a frame on every load, on every device. */}
      {containerSize && (
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ width: containerWidth, height: containerHeight }, canvasStyle]}>
            {gridArea && (
              <GridBackground offsetX={gridArea.x} offsetY={gridArea.y} width={gridArea.width} height={gridArea.height} theme={canvasTheme} scale={gridArea.scale} />
            )}
            <EdgeLayer
              tasks={visibleTasks}
              seriesEdges={seriesEdges}
              parallelEdges={parallelEdges}
              onEdgePress={editable ? handleEdgePress : undefined}
              nodeScale={nodeScale}
            />
            {visibleTasks.map((task) => (
              <TaskNode
                key={task.id}
                task={task}
                typeColors={typeColors}
                draggingNodeId={draggingNodeId}
                dragDeltaX={dragDeltaX}
                dragDeltaY={dragDeltaY}
                onDragStart={handleDragStart}
                onTap={handleTap}
                nodeScale={nodeScale}
                isPendingLinkSource={pendingSourceId === task.id}
              />
            ))}
          </Animated.View>
        </GestureDetector>
      )}

      {canEdit && (
        <View className="absolute top-3 left-3 flex-row gap-2">
          <Pressable
            onPress={() => {
              setIsUnlocked((v) => !v);
              setActiveTool('select');
              setPendingSourceId(null);
            }}
            className="flex-row items-center gap-1.5 bg-white rounded-xl border border-neutral-200 px-3 py-2.5"
            style={{ elevation: 3 }}
          >
            <Ionicons name={isUnlocked ? 'lock-open-outline' : 'lock-closed-outline'} size={16} color={isUnlocked ? '#F0A227' : '#0F1F33'} />
            <Text className={`text-2xs font-bold ${isUnlocked ? 'text-brand-amber' : 'text-brand-navy'}`}>
              {isUnlocked ? 'Editing' : 'Locked'}
            </Text>
          </Pressable>

          {editable && (
            <>
              <Pressable
                onPress={undo}
                disabled={past.length === 0 || historyBusy}
                className="w-10 h-10 rounded-xl bg-white border border-neutral-200 items-center justify-center"
                style={{ elevation: 3, opacity: past.length === 0 || historyBusy ? 0.35 : 1 }}
              >
                <Ionicons name="arrow-undo-outline" size={18} color="#0F1F33" />
              </Pressable>
              <Pressable
                onPress={redo}
                disabled={future.length === 0 || historyBusy}
                className="w-10 h-10 rounded-xl bg-white border border-neutral-200 items-center justify-center"
                style={{ elevation: 3, opacity: future.length === 0 || historyBusy ? 0.35 : 1 }}
              >
                <Ionicons name="arrow-redo-outline" size={18} color="#0F1F33" />
              </Pressable>
              <Pressable
                onPress={() => setCreateTaskOpen(true)}
                className="flex-row items-center gap-1.5 bg-brand-navy rounded-xl px-3 py-2.5"
                style={{ elevation: 3 }}
              >
                <Ionicons name="add" size={16} color="#ffffff" />
                <Text className="text-2xs font-bold text-white">New Task</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* Canvas background theme — light vs. black, each circle IS the
          color it switches to. Was light/dark/black; dark (#0a0a0a) was
          dropped after real feedback that its swatch was indistinguishable
          from black's at this size ("two black options") — see
          GridBackground.tsx's own comment. Always visible (not gated on
          canEdit/editable) — this is a viewing preference, same as
          admin-web's own board-color toggle being independent of its edit
          lock. Positioned above the relationship-picker hint below (which
          shifts down to top-14 to clear this) rather than the two ever
          competing for the same corner. */}
      <View className="absolute top-3 right-3 flex-row items-center gap-1.5">
        {/* Total task count — real feedback after the pilot-mode restriction
            was lifted (see lib/pilot.ts) was that there was no quick way to
            confirm "yes, all ~311 real tasks are actually here" without
            manually counting boxes. */}
        <View className="bg-white rounded-full border border-neutral-200 px-2.5 py-1.5" style={{ elevation: 3 }}>
          <Text className="text-2xs font-bold text-neutral-700">{tasks.length} task{tasks.length === 1 ? '' : 's'}</Text>
        </View>
        <View className="flex-row gap-1.5 bg-white rounded-full border border-neutral-200 px-2 py-1.5" style={{ elevation: 3 }}>
          {(['light', 'black'] as CanvasTheme[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setCanvasTheme(t)}
              hitSlop={4}
              className="w-5 h-5 rounded-full"
              style={{
                backgroundColor: CANVAS_THEMES[t].bg,
                borderWidth: canvasTheme === t ? 2 : 1,
                borderColor: canvasTheme === t ? '#F0A227' : '#D4D4D4',
              }}
            />
          ))}
        </View>
      </View>

      {editable && activeTool !== 'select' && (
        <View className="absolute top-14 right-3 bg-white rounded-xl border border-neutral-200 px-3 py-2" style={{ elevation: 3 }}>
          <Text className="text-2xs text-neutral-500">
            {pendingSourceId ? 'Tap the task this one blocks/pairs with' : 'Tap the prerequisite task'}
          </Text>
        </View>
      )}

      {linkError && (
        <Pressable
          onPress={() => setLinkError(null)}
          className="absolute top-16 left-3 right-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
          style={{ elevation: 3 }}
        >
          <Text className="text-xs font-semibold text-red-600">{linkError} (tap to dismiss)</Text>
        </Pressable>
      )}

      {editable && (
        <RelationshipToolbar active={activeTool} onSelect={handleToolSelect} />
      )}

      {/* Explicit zoom controls, positioned to clear the bottom toolbar
          when it's showing (editable) vs. sitting just above the safe area
          when it's not (locked). */}
      <View
        className="absolute right-3 items-center gap-1.5"
        style={{ bottom: editable ? 108 : Math.max(insets.bottom, 12) + 4 }}
      >
        <Pressable
          onPress={() => zoomBy(1.25)}
          className="w-10 h-10 rounded-full bg-white border border-neutral-200 items-center justify-center"
          style={{ elevation: 3 }}
        >
          <Ionicons name="add" size={20} color="#0F1F33" />
        </Pressable>
        <Pressable
          onPress={() => zoomBy(0.8)}
          className="w-10 h-10 rounded-full bg-white border border-neutral-200 items-center justify-center"
          style={{ elevation: 3 }}
        >
          <Ionicons name="remove" size={20} color="#0F1F33" />
        </Pressable>
      </View>

      {actionMenuTask && (
        <TaskActionMenu
          taskCode={actionMenuTask.taskId}
          onOpen={() => handleOpenTask(actionMenuTask.id)}
          onEdit={() => handleEditTask(actionMenuTask.id)}
          onDelete={() => handleDeleteTaskRequest(actionMenuTask.id)}
          onCancel={() => setActionMenuTaskId(null)}
        />
      )}

      {edgeDeleteConfirmId && (
        <ConfirmDialog
          title="Remove Dependency?"
          description="This removes the blocking relationship between these two tasks — the downstream task may become unblocked as a result."
          confirmLabel="Remove"
          variant="danger"
          onConfirm={confirmSeriesEdgeDelete}
          onCancel={() => setEdgeDeleteConfirmId(null)}
        />
      )}

      {deleteTaskTarget && (
        <ConfirmDialog
          title="Delete Task"
          description="This permanently removes the task and its checklist/activity history."
          confirmLabel="Delete Task"
          variant="danger"
          busy={deletingTask}
          onConfirm={confirmDeleteTask}
          onCancel={() => setDeleteTaskConfirmId(null)}
        />
      )}

      <TaskDetailSheet
        task={detailTask}
        taskTypes={taskTypes}
        canEdit={detailEditable}
        onClose={() => { setDetailTaskId(null); setDetailEditable(false); }}
        onTaskEdited={(taskId, before, after) => {
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...after } : t)));
          pushHistory({ type: 'editTask', taskId, before, after });
          // workAccountabilityType (the RESOLVED value TaskNode's badge
          // actually renders) isn't part of EditableTaskFields — it also
          // depends on the Work's own default, which isn't available
          // locally. A plain merge above leaves it stale when the override
          // changes (including clearing it back to null), so re-fetch this
          // one task fresh to pick up the correctly re-resolved badge,
          // same fetchTaskById-after-a-DB-change pattern already used by
          // the undo/redo delete-restore path just above.
          if (before.accountabilityType !== after.accountabilityType) {
            fetchTaskById(taskId).then((fresh) => {
              setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...fresh } : t)));
            }).catch(() => {});
          }
        }}
      />

      {createTaskOpen && (
        <CreateTaskSheet
          projectId={projectId}
          existingTasks={tasks.map((t) => ({ id: t.id, taskId: t.taskId, taskName: t.taskName }))}
          taskTypes={taskTypes}
          onClose={() => setCreateTaskOpen(false)}
          onCreated={handleTaskCreated}
        />
      )}
    </View>
  );
}

// Re-exported so the screen file can size the initial fit-to-view without
// importing from lib/flowchart/layout directly for just these two constants.
export { NODE_WIDTH, NODE_HEIGHT };
