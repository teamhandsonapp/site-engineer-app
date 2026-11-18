import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { formatActualDateRange, formatCardDateRange, splitTaskName } from '../../lib/flowchart/delay';
import type { ProjectedRange } from '../../lib/flowchart/projected';
import { delaySplit, formatDelaySplit } from '../../lib/flowchart/delaySplit';
import { getTaskBoxBackground } from '../../lib/flowchart/taskTypeColor';
import type { PositionedTask } from '../../lib/flowchart/types';
import { ChecklistWheel } from './ChecklistWheel';


export function TaskNode({
  task,
  typeColors,
  draggingNodeId,
  dragDeltaX,
  dragDeltaY,
  onDragStart,
  onTap,
  editable,
  isPendingLinkSource,
  isSelected,
  selectionNumber,
  milestone,
  projected,
  runningDelayDays = 0,
  hidePlanned = false,
  checklistDots,
  onChecklistPress,
  onDprPress,
  onConnectorPress,
  directDrag = false,
  canvasScale,
  onDragEnd,
  // 1 for every normal project (the overwhelmingly common case) — only ever
  // smaller than 1 when clampToSafeBitmapBudget (lib/flowchart/layout.ts)
  // had to shrink an unusually large graph to stay under Android's bitmap
  // ceiling. MUST scale both the box itself and the chip offsets below by
  // this same factor — see that function's own comment on why a
  // position-only shrink guarantees box-on-box overlap otherwise.
  nodeScale,
}: {
  task: PositionedTask;
  typeColors: Record<string, string>;
  draggingNodeId: SharedValue<string | null>;
  dragDeltaX: SharedValue<number>;
  dragDeltaY: SharedValue<number>;
  onDragStart: (taskId: string) => void;
  onTap: (taskId: string) => void;
  // Disables the long-press-to-drag gesture entirely when the canvas is
  // locked (or the viewer can't edit) — see the fix comment on `longPress`
  // below for why this can't just be a no-op check inside onDragStart.
  editable: boolean;
  isPendingLinkSource: boolean;
  // "Push to Site Engineer" multi-select — a distinct amber highlight from
  // isPendingLinkSource's navy one, so the two selection concepts never
  // read as the same thing (they can't both be active at once anyway, but
  // the color language still shouldn't overlap).
  isSelected?: boolean;
  // Order this task was picked in select mode (1-based), shown as a badge.
  selectionNumber?: number;
  // "This task to this task = Milestone 1" — a colored badge, mirrored on
  // the opposite (left) side from the AC/AV badge's own top-right slot, at
  // the same already-proven-clear -20 tier, so the two never compete for
  // the same corner.
  milestone?: { name: string; color: string } | null;
  // Projected start–end (blue chip, Flowchart 2) — null/undefined = hidden.
  projected?: ProjectedRange | null;
  /** Not started yet and the projected start has passed: days overdue. */
  runningDelayDays?: number;
  /** Hide the yellow planned chip (the task before has real dates, so the blue projected chip replaces it). */
  hidePlanned?: boolean;
  // Client-checklist wheel (Flowchart 2): one flag per checklist point —
  // undefined = no icon. Tapping it opens that task's Checklist tab.
  checklistDots?: boolean[];
  onChecklistPress?: (taskId: string) => void;
  // DPR / PR note icon (Flowchart 2 only, 2026-11-18): undefined = no icon.
  // Tapping it opens the DPR / PR chooser so both can be filled from the board.
  onDprPress?: (taskId: string) => void;
  // Link dots on all four sides ("Flowchart" board, Editing mode, 2026-11-18):
  // tap a dot here, then a dot on another box, to link the two. undefined = no dots.
  onConnectorPress?: (taskId: string) => void;
  // Direct drag (Main Flowchart, Editing mode, 2026-11-18): the box moves as
  // soon as it is dragged — no press-and-hold — and the board stays still.
  // The box's own Pan owns the whole drag (canvasScale converts screen
  // movement to board units); onDragEnd saves the new position.
  directDrag?: boolean;
  canvasScale?: SharedValue<number>;
  onDragEnd?: (taskId: string, dx: number, dy: number) => void;
  nodeScale: number;
}) {
  const isDragging = useDerivedValue(() => draggingNodeId.value === task.id);

  // Movement itself is owned by the CANVAS's single Pan gesture (see
  // FlowchartCanvas) — this node only needs to (a) claim "I'm the one being
  // dragged" via long-press, and (b) recognize a plain tap. Giving this node
  // its OWN Pan gesture too would put two competing Pan recognizers in the
  // same touch area (this node's GestureDetector nested inside the canvas's),
  // which is exactly the kind of gesture-arbitration conflict that's hard to
  // get right and harder to verify without a physical device to test on.
  // .enabled(editable) — NOT a no-op check inside onDragStart — matters
  // because Gesture.Race below hands the touch to WHICHEVER gesture
  // activates first. longPress activates at exactly 350ms regardless of
  // what onDragStart then does with it, so a held-locked-mode touch used to
  // still "win" the race the instant it crossed 350ms, silently swallowing
  // the touch (onDragStart no-ops when !editable, and by then tap has
  // already lost the race) — a tap held even a little past 350ms opened
  // nothing at all, contradicting handleTap's own documented intent that
  // "a tap should always offer Edit" while locked. Disabling the gesture
  // outright means Race only ever has `tap` to award the touch to.
  const longPress = Gesture.LongPress()
    .enabled(editable)
    .minDuration(350)
    .onStart(() => {
      runOnJS(onDragStart)(task.id);
    });

  // maxDuration matches longPress's own minDuration exactly — previously
  // 250 vs. longPress's 350 left a real 250-350ms dead zone where a touch
  // released in that window satisfied neither gesture's own window and
  // nothing happened at all (confirmed live: an ordinary, not-even-slow tap
  // routinely lands in that range).
  const tap = Gesture.Tap()
    .maxDuration(350)
    .onEnd((_e, success) => {
      if (success) runOnJS(onTap)(task.id);
    });

  // Direct drag: the innermost Pan activates first (tiny minDistance), which
  // cancels the board's own pan for this touch — so only the box moves.
  const useDirectDrag = directDrag && editable && !!canvasScale && !!onDragEnd;
  const dragPan = Gesture.Pan()
    .enabled(useDirectDrag)
    .minDistance(3)
    .onStart(() => {
      draggingNodeId.value = task.id;
      dragDeltaX.value = 0;
      dragDeltaY.value = 0;
    })
    .onUpdate((e) => {
      const s = canvasScale ? canvasScale.value : 1;
      dragDeltaX.value = e.translationX / s;
      dragDeltaY.value = e.translationY / s;
    })
    // onFinalize (not onEnd): runs however the touch finishes, even if the
    // drag is cancelled, so a box can never stay stuck mid-drag.
    .onFinalize((e) => {
      if (draggingNodeId.value !== task.id) return;
      const s = canvasScale ? canvasScale.value : 1;
      if (onDragEnd) runOnJS(onDragEnd)(task.id, e.translationX / s, e.translationY / s);
    });

  const gesture = useDirectDrag ? Gesture.Race(dragPan, tap) : Gesture.Race(longPress, tap);

  // Its own Tap, nested inside the card's detector: the innermost gesture
  // activates first, so tapping the wheel opens the checklist instead of
  // the card's action menu.
  const checklistTap = Gesture.Tap()
    .maxDuration(400)
    .onEnd((_e, success) => {
      if (success && onChecklistPress) runOnJS(onChecklistPress)(task.id);
    });
  // Same nesting for the DPR / PR note icon.
  const dprTap = Gesture.Tap()
    .maxDuration(400)
    .onEnd((_e, success) => {
      if (success && onDprPress) runOnJS(onDprPress)(task.id);
    });
  // One Tap per link dot (a gesture object belongs to one detector only).
  const connectorTap = () =>
    Gesture.Tap()
      .maxDuration(400)
      .hitSlop(8)
      .onEnd((_e, success) => {
        if (success && onConnectorPress) runOnJS(onConnectorPress)(task.id);
      });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: task.x + (isDragging.value ? dragDeltaX.value : 0) },
      { translateY: task.y + (isDragging.value ? dragDeltaY.value : 0) },
    ],
    zIndex: isDragging.value ? 10 : 1,
    opacity: isDragging.value ? 0.85 : 1,
  }));

  // Box background is the task's own Task Type color mixed with its AC/AV
  // identity (dark tint for AC, light pastel for AV) — same
  // getTaskBoxBackground mix admin-web's flowchart uses, falls back to the
  // same neutral gray admin-web's own FORCED_GRAY.bg uses (#F9FAFB) when
  // either input is missing (no type set, or no accountability resolved) —
  // not plain white, which would be a visible mismatch from admin-web.
  const typeColor = task.taskTypeId ? typeColors[task.taskTypeId] ?? null : null;
  const boxMix = getTaskBoxBackground(typeColor, task.workAccountabilityType);
  // A per-task colour (tasks.flowchart_card_color, e.g. light red) wins over the type colour.
  const textColor = task.cardColor ? '#171717' : boxMix?.textColor ?? '#171717';

  // NativeWind's className styling doesn't reach react-native-reanimated's
  // Animated.View reliably (confirmed live: the box rendered with zero
  // background/border while its plain-View children — the badge, the date
  // chips — styled correctly via className right next to it) — so this
  // node's own box appearance is set via plain inline style instead of
  // Tailwind classes, only on this one wrapper.
  // Outer wrapper: position + drag transform only, NOT clipped, so the link
  // dots can sit on the box's edges. The box itself (boxStyle, clipped) is
  // the plain View inside it, so everything in the box renders as before.
  const outerStyle = {
    position: 'absolute' as const,
    width: NODE_WIDTH * nodeScale,
    height: NODE_HEIGHT * nodeScale,
  };
  const boxStyle = {
    width: '100%' as const,
    height: '100%' as const,
    // 8 -> 14, by explicit request ("smooth, consistent corner rounding").
    // Border and fill are both set on this SAME object/View, so there's no
    // risk of the two ever drifting to different radii.
    borderRadius: 14,
    // Milestone-tagged tasks get a thicker, colored border always, by
    // explicit correction — the floating milestone-name badge above the box
    // (rendered lower down in this file) is real but gets visually
    // swallowed in a tight vertical chain, where each node's badge sits
    // right against the box above it. A border is part of the node's own
    // bounding box, so it can never get overlapped that way, whatever the
    // zoom or stacking. Still loses to the interaction states below it.
    borderWidth: isSelected || isPendingLinkSource ? 2 : milestone ? 2.5 : 1,
    borderColor: isSelected ? '#F0A227' : isPendingLinkSource ? '#0F1F33' : milestone ? milestone.color : '#000000',
    backgroundColor: task.cardColor ?? boxMix?.background ?? '#F9FAFB',
    // A backstop for the padding/box-size change below, not a style choice
    // on its own — if a rare, unusually long real task name still needs
    // more room than the estimate gives it, this clips cleanly at the
    // rounded border instead of visibly spilling past it.
    overflow: 'hidden' as const,
    // 3/3/3/1 (asymmetric, closer to a floor than real padding) -> a real
    // uniform padding, by explicit request. NODE_HEIGHT/NODE_WIDTH were
    // bumped in lockstep (see layout.ts) to keep real headroom for text —
    // see that file's own comment on why this couldn't be re-verified
    // against all 311 real tasks from this environment.
    padding: 10 * nodeScale,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  // Confirmed live on the 311-task project (the one that needs nodeScale <
  // 1 at all — see clampToSafeBitmapBudget's own comment): the box
  // width/height above already scale down correctly, but every Text in
  // this file used to render at a FIXED Tailwind font size (text-2xs/
  // text-xs) regardless of nodeScale — so on a heavily-shrunk graph the
  // box shrank to a fraction of its normal size while the text inside it
  // stayed full-size, and spilled straight out over the neighboring rows
  // above/below (exactly the illegible overlapping-text screenshot this
  // was reported against). Text needs to shrink in lockstep with the box
  // it's rendered inside, the same way the box itself already shrinks in
  // lockstep with the overall graph compression — these are the scaled
  // equivalents of this app's own text-2xs (10/14) and text-xs (11/15)
  // tokens (tailwind.config.js), used as plain inline styles here instead
  // of those classes so the multiplication actually applies.
  const font2xs = { fontSize: 10 * nodeScale, lineHeight: 14 * nodeScale };
  const fontXs = { fontSize: 11 * nodeScale, lineHeight: 15 * nodeScale };

  const { category, action } = splitTaskName(task.taskName);
  const dateRange = formatCardDateRange(task.plannedStartDate, task.dueDate);
  const actualDateRange = formatActualDateRange(task.actualStartDate, task.actualEndDate);
  // Actual-date chip is always the red "Actual" colour — the green
  // "finished on time" variant was removed by request (2026-11-15).
  const actualChipBg = '#FCA5A5';
  const actualChipText = '#7F1D1D';
  // Dates only on the actual chip — no "+Nd"/"−Nd", by request 2026-11-14.
  const actualLabel = actualDateRange;
  // Finished late → pre-construction / construction / total delay lines under the actual chip
  // (every day counted — lib/flowchart/delaySplit.ts).
  const split = delaySplit({
    plannedStart: task.currentPlannedStartDate ?? task.plannedStartDate,
    plannedEnd: task.currentDueDate ?? task.dueDate,
    actualStart: task.actualStartDate,
    actualEnd: task.actualEndDate,
  });
  const delaySplitLabel = split && split.total > 0 ? formatDelaySplit(split) : null;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[outerStyle, animatedStyle]}>
      <View style={boxStyle}>
        {/* Restored — repeating the same +Nd on every downstream task is
            correct, not a bug: cascade_delay_days is one flat push applied
            uniformly across the whole downstream closure (see
            cascadePlannedDatesFromActualDelay in admin-web), so if task 1a
            slips by N days, every task after it genuinely IS delayed by
            that same N days too, all the way down the chain. The
            phase-level Expected Completion badges above the canvas
            (PhaseCompletionBar) show the resulting completion-date impact;
            this is the per-task "why" underneath it. */}
        {/* Two fixed rows now, not a conditional single row: the planned
            (yellow) chip always sits at the far row (-40) regardless of
            delay/actual data, and the near row (-20) holds whichever of
            delay/actual-dates chips actually apply (0, 1, or 2 of them,
            side by side) — same two-row split as admin-web's canvas. An
            "own" delay (real actual-vs-planned gap, not a cascaded
            estimate) always implies actual dates exist too (see
            ownDelayDays in lib/flowchart/delay.ts), so those two
            frequently appear together on the near row. */}
        {/* The old floating chips above the box (+Nd delay with a black
            border, actual dates, planned dates) were removed 2026-11-15: the
            box's overflow:hidden clipped them, leaving only a black edge
            poking into the card's top. The same dates show inside the card. */}

        {/* AC/AV badge above the box removed 2026-11-15 (the box clipped it to a black corner). */}

        {/* Selection order (1, 2, 3…) in select mode. */}
        {selectionNumber ? (
          <View
            testID={`flowchart-selected-${selectionNumber}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -11 * nodeScale,
              right: -11 * nodeScale,
              width: 24 * nodeScale,
              height: 24 * nodeScale,
              borderRadius: 12 * nodeScale,
              backgroundColor: '#F0A227',
              borderWidth: 2,
              borderColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 5,
            }}
          >
            <Text style={{ fontSize: 12 * nodeScale, fontWeight: '800', color: '#0F1F33' }}>{selectionNumber}</Text>
          </View>
        ) : null}

        {milestone && (
          <View
            className="absolute rounded"
            style={{
              top: -20 * nodeScale,
              left: 0,
              paddingHorizontal: 6 * nodeScale,
              paddingVertical: 2 * nodeScale,
              backgroundColor: milestone.color,
            }}
          >
            <Text className="font-bold text-white" style={font2xs} numberOfLines={1}>{milestone.name}</Text>
          </View>
        )}

        {/* Task ID, top-left inside the card (2026-11-16), e.g. "CIV-05". */}
        <Text
          testID={`flowchart-node-code-${task.taskId}`}
          numberOfLines={1}
          // Inset 10 / 16 so the rounded corner never cuts into the ID (2026-11-18).
          style={{ position: 'absolute', top: 10 * nodeScale, left: 16 * nodeScale, fontSize: 10 * nodeScale, fontWeight: '800', color: textColor, opacity: 0.8 }}
        >
          {task.taskId}
        </Text>

        {/* DPR / PR note icon, top-right corner inside the card (Flowchart 2). */}
        {onDprPress && (
          <GestureDetector gesture={dprTap}>
            <View
              testID={`flowchart-node-dpr-${task.taskId}`}
              accessibilityRole="button"
              accessibilityLabel={`Open DPR / PR for ${task.taskId}`}
              // Plain outline icon in the card's own text colour (no filled
              // square), inset clear of the rounded corner.
              style={{ position: 'absolute', top: 8 * nodeScale, right: 14 * nodeScale, padding: 2 * nodeScale, zIndex: 4, opacity: 0.8 }}
            >
              <Ionicons name="document-text-outline" size={16 * nodeScale} color={textColor} />
            </View>
          </GestureDetector>
        )}

        {/* Client-checklist wheel, top-right inside the card (Flowchart 2) —
            just left of the DPR / PR icon when that is shown. */}
        {checklistDots && (
          <GestureDetector gesture={checklistTap}>
            <View
              testID={`flowchart-node-checklist-${task.taskId}`}
              accessibilityRole="button"
              accessibilityLabel="Open checklist"
              style={{ position: 'absolute', top: 8 * nodeScale, right: (onDprPress ? 36 : 14) * nodeScale, padding: 2 * nodeScale, zIndex: 4 }}
            >
              <ChecklistWheel size={16 * nodeScale} filled={checklistDots} />
            </View>
          </GestureDetector>
        )}

        {/* taskId/category/action now center as one block (boxStyle's own
            justifyContent/alignItems: 'center') instead of the old
            left-aligned stack — textAlign: 'center' on each is still needed
            too, for when category/action actually wrap to a 2nd line (the
            block being centered only centers each line's own bounding box,
            not the text WITHIN a wrapped multi-line block). */}
        {/* MILE-xx codes hidden here specifically, by explicit request — a
            "MILE-01"-style code is an ID this app had to invent just for
            DB uniqueness, not a real site-engineering task code like "8d"
            the team actually uses, so it's just noise on this node. Every
            other real task's own code (8d, 10a, ...) still shows as
            before — this only checks the one prefix these milestone-only
            tasks share (see add-hidden-from-flowchart.sql's own tasks). */}
        {/* Planned date range INSIDE the box now too, not just the floating
            yellow chip above it — by explicit, repeated correction: in a
            tight FS chain, that chip's own -40 offset sits inside the
            space the PREVIOUS node in the chain occupies, so it reads as
            simply missing there. This one is part of the box's own bounding
            box, so it can't get overlapped by a neighboring node however
            tightly they're chained. */}
        {/* Actual highlighter-yellow pill now, not plain muted text — same
            #FEF08A/yellow-900 pairing as the floating chip above the box
            and the Task Detail screen's own date pill, so "yellow = planned
            date" reads as one consistent signal everywhere it shows up. */}
        {!hidePlanned && (
          <View
            className="rounded-full self-center"
            style={{ backgroundColor: '#FEF08A', paddingHorizontal: 6 * nodeScale, paddingVertical: 1 * nodeScale, marginBottom: 2 * nodeScale }}
          >
            <Text numberOfLines={1} className="font-bold" style={[font2xs, { color: '#713F12', textAlign: 'center' }]}>{dateRange}</Text>
          </View>
        )}
        {/* Actual start – end, red, right under the yellow planned pill —
            by request 2026-11-10. Inside the box for the same reason as the
            planned pill: the floating actual chip above the box gets covered
            by the card above it in a tight column. */}
        {actualDateRange && (
          <View
            className="rounded-full self-center"
            style={{ backgroundColor: actualChipBg, paddingHorizontal: 6 * nodeScale, paddingVertical: 1 * nodeScale, marginBottom: 2 * nodeScale }}
          >
            <Text numberOfLines={1} className="font-bold" style={[font2xs, { color: actualChipText, textAlign: 'center' }]}>{actualLabel}</Text>
          </View>
        )}
        {delaySplitLabel?.map((line, i) => (
          <Text
            key={line}
            testID={i === 0 ? `flowchart-node-delay-split-${task.taskId}` : undefined}
            numberOfLines={2}
            className="font-bold"
            style={[font2xs, { color: '#B91C1C', textAlign: 'center', marginBottom: 2 * nodeScale }]}
          >
            {line}
          </Text>
        ))}
        {/* Projected start – end, blue (2026-11-14): the planned length pushed
            later by the delays coming down the links (lib/flowchart/projected.ts). */}
        {projected && (
          <View
            testID={`flowchart-node-projected-${task.taskId}`}
            className="rounded-full self-center"
            style={{ backgroundColor: '#BFDBFE', paddingHorizontal: 6 * nodeScale, paddingVertical: 1 * nodeScale, marginBottom: 2 * nodeScale }}
          >
            <Text numberOfLines={1} className="font-bold" style={[font2xs, { color: '#1E3A8A', textAlign: 'center' }]}>
              {/* Dates only — no "+Nd" on the blue chip, by request 2026-11-14. */}
              {formatCardDateRange(projected.start, projected.end)}
            </Text>
          </View>
        )}
        {/* Running "not started" delay (red), right under the blue chip —
            the box is tall enough for this extra line (NODE_HEIGHT 128). */}
        {runningDelayDays > 0 && (
          <Text
            testID={`flowchart-node-running-delay-${task.taskId}`}
            numberOfLines={1}
            className="font-bold"
            style={[font2xs, { color: '#B91C1C', textAlign: 'center', marginBottom: 2 * nodeScale }]}
          >
            Not started · {runningDelayDays} {runningDelayDays === 1 ? 'day' : 'days'} delay running
          </Text>
        )}
        {/* Every other not-started task with a projected date (2026-11-15):
            how far the projection is behind the plan (projected − planned start). */}
        {runningDelayDays <= 0 && projected && !task.actualStartDate && (
          <Text
            testID={`flowchart-node-projected-delay-${task.taskId}`}
            numberOfLines={1}
            className="font-bold"
            style={[font2xs, { color: projected.delayDays > 0 ? '#B91C1C' : '#525252', textAlign: 'center', marginBottom: 2 * nodeScale }]}
          >
            {projected.delayDays > 0
              ? `Not started · ${projected.delayDays} ${projected.delayDays === 1 ? 'day' : 'days'} delay`
              : 'Not started · on time'}
          </Text>
        )}
        {/* Task code (TASK-001 / CIVIL-123456) hidden — names only, by request 2026-11-09. */}
        {/* category wraps up to 2 lines instead of truncating at 1 — a long
            category (well above the ~15-char median) used to read as
            overflowing/running past the box's own width rather than
            cleanly ellipsizing. Still capped (not unbounded) so the box
            doesn't need to grow to fit BOTH a long wrapped category AND a
            long wrapped action at once.
            action's own cap was trimmed from 3 lines back to 2 — real data
            showed 2-line-category + 3-line-action together needed a
            genuinely taller box (108px) than the common case (80-91px),
            and shrinking the fixed box back down for the common case (per
            real feedback) means that combination can no longer fit;
            action now ellipsizes instead of the box overflowing for that
            handful of the longest real task names. */}
        {category && (
          <Text numberOfLines={2} style={[font2xs, { color: textColor, opacity: 0.75, textAlign: 'center' }]}>{category}</Text>
        )}
        <Text className="font-semibold" numberOfLines={2} style={[fontXs, { color: textColor, textAlign: 'center' }]}>{action}</Text>
        {/* Department under the name (2026-11-14) — change it from the task's
            edit sheet (Department) and it shows here after saving. */}
        {task.workName && task.workName !== 'Unassigned' ? (
          <Text
            testID={`flowchart-node-dept-${task.taskId}`}
            numberOfLines={1}
            style={[font2xs, { color: textColor, opacity: 0.7, textAlign: 'center', marginTop: 1 * nodeScale, fontStyle: 'italic' }]}
          >
            {task.workName}
          </Text>
        ) : null}
      </View>

      {/* Link dots: middle of each side, half over the edge. The link
          source's dots turn amber while it waits for a second dot. */}
      {onConnectorPress &&
        (['top', 'right', 'bottom', 'left'] as const).map((side) => {
          const d = 14 * nodeScale;
          const pos =
            side === 'top'
              ? { top: -d / 2, left: '50%' as const, marginLeft: -d / 2 }
              : side === 'bottom'
                ? { bottom: -d / 2, left: '50%' as const, marginLeft: -d / 2 }
                : side === 'left'
                  ? { left: -d / 2, top: '50%' as const, marginTop: -d / 2 }
                  : { right: -d / 2, top: '50%' as const, marginTop: -d / 2 };
          return (
            <GestureDetector key={side} gesture={connectorTap()}>
              <View
                testID={`flowchart-node-connector-${side}-${task.taskId}`}
                accessibilityRole="button"
                accessibilityLabel={`Link from ${task.taskId}`}
                style={{
                  position: 'absolute',
                  ...pos,
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  borderWidth: 2,
                  borderColor: isPendingLinkSource ? '#B45309' : '#0F1F33',
                  backgroundColor: isPendingLinkSource ? '#F0A227' : '#FFFFFF',
                  zIndex: 6,
                }}
              />
            </GestureDetector>
          );
        })}
      </Animated.View>
    </GestureDetector>
  );
}
