import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, PixelRatio, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TemplateEdgeLayer } from './TemplateEdgeLayer';
import { TemplateTaskNode } from './TemplateTaskNode';
import { TemplateTaskSheet } from './TemplateTaskSheet';
import { TemplateSheetPreviewModal } from './TemplateSheetPreviewModal';
import { TaskActionMenu } from './TaskActionMenu';
import { RelationshipToolbar, type ToolMode } from './RelationshipToolbar';
import { CANVAS_THEMES, GridBackground, type CanvasTheme } from './GridBackground';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { buildAxisMapsGeneric, clampToSafeBitmapBudget, computeBounds, computeGridArea, fitInitialViewTransform, inverseAxisMap, layoutGeneric, NODE_HEIGHT, NODE_WIDTH, type GridArea } from '../../lib/flowchart/layout';
import {
  commitTemplateSheetUpload,
  createTemplateParallelLink,
  createTemplateSeriesLink,
  createTemplateTask,
  deleteTemplateLink,
  deleteTemplateTask,
  updateTemplateTaskPosition,
  type TemplateTaskFields,
} from '../../lib/flowchart/templateData';
import { pickAndParseTemplateSheet, type PickedTemplateSheet } from '../../lib/flowchart/templateSheetFile';
import {
  applyTemplateTaskFieldChanges,
  captureTemplateTaskDeleteSnapshot,
  MAX_HISTORY_DEPTH,
  restoreTemplateTaskFromSnapshot,
  templateParallelEdgesFromSnapshot,
  templateSeriesEdgesFromSnapshot,
  type TemplateUndoableAction,
} from '../../lib/flowchart/templateUndo';
import type { PositionedTemplateTask, TemplateParallelEdge, TemplateSeriesEdge, TemplateTask } from '../../lib/flowchart/templateTypes';

// A direct sibling of FlowchartCanvas.tsx — same canvas mechanics (pan/zoom,
// drag-to-reposition, tap-to-link, undo/redo, light/black theme, lock
// toggle), operating on template_tasks/template_links instead of real
// tasks. Reachable only by staff (gated one level up, at the screen), so
// there's no separate canEdit prop — the lock toggle alone gates editing,
// same reasoning as the real canvas (guards against an accidental drag
// while just browsing, not a role check).
export function TemplateCanvas({
  templateId,
  initialTasks,
  seriesEdges: initialSeriesEdges,
  parallelEdges: initialParallelEdges,
}: {
  templateId: string;
  initialTasks: TemplateTask[];
  seriesEdges: TemplateSeriesEdge[];
  parallelEdges: TemplateParallelEdge[];
}) {
  // See FlowchartCanvas's identical safeLayout for why PixelRatio.get() is
  // read directly here rather than via ref/state (clampToSafeBitmapBudget's
  // own comment in lib/flowchart/layout.ts has the full crash context).
  const safeLayout = useCallback(
    <T,>(raw: (T & { manualPositionX: number | null; manualPositionY: number | null; id: string })[]) =>
      clampToSafeBitmapBudget(layoutGeneric(raw), PixelRatio.get()),
    []
  );
  // Computed once, up front, so the two states seeded from it below (tasks +
  // nodeScale) never run the layout pass twice on mount.
  const initialLayout = useMemo(() => safeLayout(initialTasks), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tasks, setTasks] = useState<PositionedTemplateTask[]>(initialLayout.tasks);
  // See TemplateTaskNode/TemplateEdgeLayer's own nodeScale prop — MUST stay
  // in lockstep with `tasks` (see FlowchartCanvas's identical state for why).
  const [nodeScale, setNodeScale] = useState<number>(initialLayout.nodeScale);
  const [seriesEdges, setSeriesEdges] = useState(initialSeriesEdges);
  const [parallelEdges, setParallelEdges] = useState(initialParallelEdges);

  const [isUnlocked, setIsUnlocked] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsUnlocked(false);
    }, [])
  );
  const editable = isUnlocked;

  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>('light');

  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [actionMenuTaskId, setActionMenuTaskId] = useState<string | null>(null);
  const [edgeDeleteConfirmId, setEdgeDeleteConfirmId] = useState<string | null>(null);
  const [deleteTaskConfirmId, setDeleteTaskConfirmId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const [sheetPreview, setSheetPreview] = useState<PickedTemplateSheet | null>(null);
  const [sheetPicking, setSheetPicking] = useState(false);
  const [sheetCommitting, setSheetCommitting] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [past, setPast] = useState<TemplateUndoableAction[]>([]);
  const [future, setFuture] = useState<TemplateUndoableAction[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  function pushHistory(action: TemplateUndoableAction) {
    setPast((prev) => {
      const next = [...prev, action];
      return next.length > MAX_HISTORY_DEPTH ? next.slice(next.length - MAX_HISTORY_DEPTH) : next;
    });
    setFuture([]);
  }

  async function applyHistoryAction(action: TemplateUndoableAction, direction: 'undo' | 'redo'): Promise<void> {
    const isUndo = direction === 'undo';
    switch (action.type) {
      case 'move': {
        const pos = isUndo ? action.before : action.after;
        await updateTemplateTaskPosition(action.taskId, pos.x, pos.y);
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
        await applyTemplateTaskFieldChanges(action.taskId, from, to);
        setTasks((prev) => prev.map((t) => (t.id === action.taskId ? { ...t, ...to } : t)));
        return;
      }
      case 'deleteTask': {
        if (isUndo) {
          await restoreTemplateTaskFromSnapshot(action.snapshot);
          setTasks((prev) => {
            const result = safeLayout([...prev, {
              id: action.taskId,
              trackLabel: (action.snapshot.task.track_label as string | null),
              taskName: action.snapshot.task.task_name as string,
              workName: action.snapshot.task.work_name as string,
              dayOffsetStart: action.snapshot.task.day_offset_start as number,
              dayOffsetEnd: action.snapshot.task.day_offset_end as number,
              sortOrder: action.snapshot.task.sort_order as number,
              manualPositionX: action.snapshot.task.position_x as number | null,
              manualPositionY: action.snapshot.task.position_y as number | null,
            }]);
            setNodeScale(result.nodeScale);
            return result.tasks;
          });
          setSeriesEdges((prev) => [...prev, ...templateSeriesEdgesFromSnapshot(action.snapshot)]);
          setParallelEdges((prev) => [...prev, ...templateParallelEdgesFromSnapshot(action.snapshot)]);
        } else {
          await deleteTemplateTask(action.taskId);
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
            await deleteTemplateLink(edge.id);
            setSeriesEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        } else {
          const edge = await createTemplateSeriesLink(templateId, action.taskId, action.dependsOnTaskId, action.linkType);
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
            await deleteTemplateLink(edge.id);
            setParallelEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        } else {
          const edge = await createTemplateParallelLink(templateId, action.taskAId, action.taskBId);
          setParallelEdges((prev) => [...prev, edge]);
        }
        return;
      }
      case 'deleteSeriesLink': {
        if (isUndo) {
          const edge = await createTemplateSeriesLink(templateId, action.taskId, action.dependsOnTaskId, action.linkType);
          setSeriesEdges((prev) => [...prev, edge]);
        } else {
          const edge = seriesEdges.find((e) => e.taskId === action.taskId && e.dependsOnTaskId === action.dependsOnTaskId);
          if (edge) {
            await deleteTemplateLink(edge.id);
            setSeriesEdges((prev) => prev.filter((e) => e.id !== edge.id));
          }
        }
        return;
      }
      case 'deleteParallelLink': {
        if (isUndo) {
          const edge = await createTemplateParallelLink(templateId, action.taskAId, action.taskBId);
          setParallelEdges((prev) => [...prev, edge]);
        } else {
          const edge = parallelEdges.find(
            (e) => (e.taskAId === action.taskAId && e.taskBId === action.taskBId) || (e.taskAId === action.taskBId && e.taskBId === action.taskAId)
          );
          if (edge) {
            await deleteTemplateLink(edge.id);
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

  const bounds = useMemo(() => computeBounds(tasks), [tasks]);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
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

  // The grid's own rendering rect, recentered on the current viewport every
  // time a pan/pinch gesture settles — see computeGridArea's own comment
  // (lib/flowchart/layout.ts) for why this replaced sizing the grid to the
  // task bounds (which, for a template that can easily be much sparser than
  // a real 300-task project, visibly cut off the moment you panned past a
  // small set of tasks).
  const [gridArea, setGridArea] = useState<GridArea | null>(null);
  function recomputeGridArea() {
    if (!containerSize) return;
    setGridArea(computeGridArea(scale.value, translateX.value, translateY.value, containerSize.width, containerSize.height));
  }

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
    if (dx === 0 && dy === 0) return;
    const finalX = task.x + dx;
    const finalY = task.y + dy;

    const hasRealPosition = task.manualPositionX != null && task.manualPositionY != null;
    const beforeReal = hasRealPosition ? { x: task.manualPositionX!, y: task.manualPositionY! } : { x: task.x, y: task.y };
    let afterReal = { x: finalX, y: finalY };
    if (hasRealPosition) {
      const { x: xMap, y: yMap } = buildAxisMapsGeneric(tasks);
      afterReal = { x: inverseAxisMap(xMap, finalX), y: inverseAxisMap(yMap, finalY) };
    }

    setTasks((prev) => prev.map((t) => (
      t.id === taskId ? { ...t, x: finalX, y: finalY, manualPositionX: afterReal.x, manualPositionY: afterReal.y } : t
    )));
    updateTemplateTaskPosition(taskId, afterReal.x, afterReal.y).catch(() => {});
    pushHistory({ type: 'move', taskId, before: beforeReal, after: afterReal });
  }

  function handleTap(taskId: string) {
    // Unlike the real canvas, locked taps go nowhere — a template task has
    // no separate checklist/detail screen worth a read-only peek at.
    if (!editable) return;
    if (activeTool === 'select') {
      setActionMenuTaskId(taskId);
      return;
    }
    if (!pendingSourceId) {
      setPendingSourceId(taskId);
      return;
    }
    if (pendingSourceId === taskId) {
      setPendingSourceId(null);
      return;
    }
    createLink(activeTool, pendingSourceId, taskId);
  }

  async function createLink(type: ToolMode, source: string, target: string) {
    if (type === 'select') return;
    setPendingSourceId(null);
    setLinkError(null);

    if (type === 'PARALLEL') {
      const exists = parallelEdges.some((e) => (e.taskAId === source && e.taskBId === target) || (e.taskAId === target && e.taskBId === source));
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
        const edge = await createTemplateParallelLink(templateId, source, target);
        setParallelEdges((prev) => [...prev, edge]);
        pushHistory({ type: 'createParallelLink', taskAId: source, taskBId: target });
      } else {
        const edge = await createTemplateSeriesLink(templateId, target, source, type);
        setSeriesEdges((prev) => [...prev, edge]);
        pushHistory({ type: 'createSeriesLink', taskId: target, dependsOnTaskId: source, linkType: type });
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not create the link — try again.');
    }
  }

  function handleToolSelect(tool: ToolMode) {
    setPendingSourceId(null);
    setLinkError(null);
    setActiveTool((prev) => (prev === tool ? 'select' : tool));
  }

  function handleEdgePress(edgeId: string, kind: 'series' | 'parallel') {
    if (!editable) return;
    if (kind === 'parallel') {
      const edge = parallelEdges.find((e) => e.id === edgeId);
      setParallelEdges((prev) => prev.filter((e) => e.id !== edgeId));
      deleteTemplateLink(edgeId).catch(() => {});
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
    deleteTemplateLink(id).catch(() => {});
    if (edge) pushHistory({ type: 'deleteSeriesLink', taskId: edge.taskId, dependsOnTaskId: edge.dependsOnTaskId, linkType: edge.type });
  }

  function handleEditTask(taskId: string) {
    setActionMenuTaskId(null);
    setDetailTaskId(taskId);
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
      const snapshot = await captureTemplateTaskDeleteSnapshot(id);
      await deleteTemplateTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
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

  async function handlePickSheet() {
    setSheetError(null);
    setSheetPicking(true);
    try {
      const picked = await pickAndParseTemplateSheet();
      if (picked) setSheetPreview(picked);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Could not read that file — is it a valid Excel workbook?');
    } finally {
      setSheetPicking(false);
    }
  }

  async function handleConfirmSheetUpload() {
    if (!sheetPreview) return;
    setSheetCommitting(true);
    try {
      const { tasks: newTasks, seriesEdges: newSeries, parallelEdges: newParallel } = await commitTemplateSheetUpload(
        templateId,
        sheetPreview.parsed.tasks,
        sheetPreview.parsed.links,
        tasks.length
      );
      const { tasks: merged, nodeScale: mergedScale } = safeLayout([...tasks, ...newTasks]);
      setTasks(merged);
      setNodeScale(mergedScale);
      setSeriesEdges((prev) => [...prev, ...newSeries]);
      setParallelEdges((prev) => [...prev, ...newParallel]);
      setSheetPreview(null);

      // A bulk upload can go from an empty (or near-empty) canvas to dozens
      // of tasks in one shot — unlike a single New Task add, the existing
      // viewport (fit once, on mount, to whatever was there at the time)
      // can easily leave every new task off-screen. Re-fit onto the
      // combined set so "land on the canvas with the new tasks" is actually
      // true, not just true in the underlying data.
      if (containerSize) {
        const fit = fitInitialViewTransform(merged, containerSize.width, containerSize.height);
        scale.value = fit.scale;
        savedScale.value = fit.scale;
        translateX.value = fit.translateX;
        savedTranslateX.value = fit.translateX;
        translateY.value = fit.translateY;
        savedTranslateY.value = fit.translateY;
        setGridArea(computeGridArea(fit.scale, fit.translateX, fit.translateY, containerSize.width, containerSize.height));
      }
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Could not add these tasks — try again.');
      setSheetPreview(null);
    } finally {
      setSheetCommitting(false);
    }
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.2), 3);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(recomputeGridArea)();
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
    });

  const composedGesture = Gesture.Simultaneous(pinch, pan);
  const insets = useSafeAreaInsets();

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
  }

  const canvasStyle = useAnimatedStyle(() => ({
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
  // A brand-new template starts with zero tasks — computeBounds' own
  // empty-case fallback is just one box's worth of area (NODE_WIDTH/HEIGHT),
  // so the grid background (sized to this same container) rendered as a
  // tiny patterned rect surrounded by plain canvas-color everywhere else,
  // visibly cutting off the instant you panned past it (confirmed live: a
  // real screenshot showed exactly this on a fresh, still-empty template).
  // The real Flowchart canvas never hits this — a real project always has
  // substantial existing bounds — so this floor is template-specific.
  const MIN_CONTAINER_SIZE = 2000;
  const containerWidth = Math.max(bounds.maxX + 400, MIN_CONTAINER_SIZE);
  const containerHeight = Math.max(bounds.maxY + 400, MIN_CONTAINER_SIZE);

  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: CANVAS_THEMES[canvasTheme].bg }} onLayout={handleContainerLayout}>
      {containerSize && (
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ width: containerWidth, height: containerHeight }, canvasStyle]}>
            {gridArea && (
              <GridBackground offsetX={gridArea.x} offsetY={gridArea.y} width={gridArea.width} height={gridArea.height} theme={canvasTheme} scale={gridArea.scale} />
            )}
            <TemplateEdgeLayer
              tasks={tasks}
              seriesEdges={seriesEdges}
              parallelEdges={parallelEdges}
              onEdgePress={editable ? handleEdgePress : undefined}
              nodeScale={nodeScale}
            />
            {tasks.map((task) => (
              <TemplateTaskNode
                key={task.id}
                task={task}
                nodeScale={nodeScale}
                draggingNodeId={draggingNodeId}
                dragDeltaX={dragDeltaX}
                dragDeltaY={dragDeltaY}
                onDragStart={handleDragStart}
                onTap={handleTap}
                isPendingLinkSource={pendingSourceId === task.id}
              />
            ))}
          </Animated.View>
        </GestureDetector>
      )}

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
            <Pressable
              onPress={handlePickSheet}
              disabled={sheetPicking}
              className="flex-row items-center gap-1.5 bg-white rounded-xl border border-neutral-200 px-3 py-2.5"
              style={{ elevation: 3, opacity: sheetPicking ? 0.6 : 1 }}
            >
              {sheetPicking ? <ActivityIndicator size="small" color="#0F1F33" /> : <Ionicons name="cloud-upload-outline" size={16} color="#0F1F33" />}
              <Text className="text-2xs font-bold text-brand-navy">Upload Sheet</Text>
            </Pressable>
          </>
        )}
      </View>

      <View className="absolute top-3 right-3 flex-row gap-1.5 bg-white rounded-full border border-neutral-200 px-2 py-1.5" style={{ elevation: 3 }}>
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

      {sheetError && (
        <Pressable
          onPress={() => setSheetError(null)}
          className="absolute top-16 left-3 right-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
          style={{ elevation: 3 }}
        >
          <Text className="text-xs font-semibold text-red-600">{sheetError} (tap to dismiss)</Text>
        </Pressable>
      )}

      {editable && <RelationshipToolbar active={activeTool} onSelect={handleToolSelect} />}

      <View className="absolute right-3 items-center gap-1.5" style={{ bottom: editable ? 108 : Math.max(insets.bottom, 12) + 4 }}>
        <Pressable onPress={() => zoomBy(1.25)} className="w-10 h-10 rounded-full bg-white border border-neutral-200 items-center justify-center" style={{ elevation: 3 }}>
          <Ionicons name="add" size={20} color="#0F1F33" />
        </Pressable>
        <Pressable onPress={() => zoomBy(0.8)} className="w-10 h-10 rounded-full bg-white border border-neutral-200 items-center justify-center" style={{ elevation: 3 }}>
          <Ionicons name="remove" size={20} color="#0F1F33" />
        </Pressable>
      </View>

      {actionMenuTask && (
        <TaskActionMenu
          taskCode={`#${actionMenuTask.sortOrder + 1}`}
          onEdit={() => handleEditTask(actionMenuTask.id)}
          onDelete={() => handleDeleteTaskRequest(actionMenuTask.id)}
          onCancel={() => setActionMenuTaskId(null)}
        />
      )}

      {edgeDeleteConfirmId && (
        <ConfirmDialog
          title="Remove Dependency?"
          description="This removes the blocking relationship between these two template tasks."
          confirmLabel="Remove"
          variant="danger"
          onConfirm={confirmSeriesEdgeDelete}
          onCancel={() => setEdgeDeleteConfirmId(null)}
        />
      )}

      {deleteTaskTarget && (
        <ConfirmDialog
          title="Delete Template Task"
          description="This permanently removes the task from this template."
          confirmLabel="Delete Task"
          variant="danger"
          busy={deletingTask}
          onConfirm={confirmDeleteTask}
          onCancel={() => setDeleteTaskConfirmId(null)}
        />
      )}

      {detailTask && (
        <TemplateTaskSheet
          task={detailTask}
          onClose={() => setDetailTaskId(null)}
          onSave={async (fields: TemplateTaskFields) => {
            const before: TemplateTaskFields = {
              taskName: detailTask.taskName,
              workName: detailTask.workName,
              trackLabel: detailTask.trackLabel,
              dayOffsetStart: detailTask.dayOffsetStart,
              dayOffsetEnd: detailTask.dayOffsetEnd,
            };
            await applyTemplateTaskFieldChanges(detailTask.id, before, fields);
            setTasks((prev) => prev.map((t) => (t.id === detailTask.id ? { ...t, ...fields } : t)));
            pushHistory({ type: 'editTask', taskId: detailTask.id, before, after: fields });
          }}
          onDelete={async () => {
            setDetailTaskId(null);
            setDeleteTaskConfirmId(detailTask.id);
          }}
        />
      )}

      {createTaskOpen && (
        <TemplateTaskSheet
          task={null}
          onClose={() => setCreateTaskOpen(false)}
          onSave={async (fields: TemplateTaskFields) => {
            const newTask = await createTemplateTask(templateId, fields, tasks.length);
            setTasks((prev) => {
              const result = safeLayout([...prev, newTask]);
              setNodeScale(result.nodeScale);
              return result.tasks;
            });
          }}
        />
      )}

      {sheetPreview && (
        <TemplateSheetPreviewModal
          fileName={sheetPreview.fileName}
          preview={sheetPreview.parsed}
          committing={sheetCommitting}
          onConfirm={handleConfirmSheetUpload}
          onCancel={() => setSheetPreview(null)}
        />
      )}
    </View>
  );
}

export { NODE_WIDTH, NODE_HEIGHT };
