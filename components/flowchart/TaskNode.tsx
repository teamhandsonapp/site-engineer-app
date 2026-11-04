import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import { NODE_WIDTH, NODE_HEIGHT } from '../../lib/flowchart/layout';
import { resolveDelayChip, formatActualDateRange, formatCardDateRange, splitTaskName } from '../../lib/flowchart/delay';
import { getTaskBoxBackground } from '../../lib/flowchart/taskTypeColor';
import type { PositionedTask } from '../../lib/flowchart/types';

const ACC_BADGE_STYLE = { bg: '#111111', text: '#ffffff', border: '#111111' };
const ACV_BADGE_STYLE = { bg: '#ffffff', text: '#111111', border: '#9CA3AF' };

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
  milestone,
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
  // "This task to this task = Milestone 1" — a colored badge, mirrored on
  // the opposite (left) side from the AC/AV badge's own top-right slot, at
  // the same already-proven-clear -20 tier, so the two never compete for
  // the same corner.
  milestone?: { name: string; color: string } | null;
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

  const gesture = Gesture.Race(longPress, tap);

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
  const textColor = boxMix?.textColor ?? '#171717';

  // NativeWind's className styling doesn't reach react-native-reanimated's
  // Animated.View reliably (confirmed live: the box rendered with zero
  // background/border while its plain-View children — the badge, the date
  // chips — styled correctly via className right next to it) — so this
  // node's own box appearance is set via plain inline style instead of
  // Tailwind classes, only on this one wrapper.
  const boxStyle = {
    position: 'absolute' as const,
    width: NODE_WIDTH * nodeScale,
    height: NODE_HEIGHT * nodeScale,
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
    backgroundColor: boxMix?.background ?? '#F9FAFB',
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
  const delayChip = resolveDelayChip(task);
  const dateRange = formatCardDateRange(task.plannedStartDate, task.dueDate);
  const actualDateRange = formatActualDateRange(task.actualStartDate, task.actualEndDate);
  const badge = task.workAccountabilityType === 'ACC' ? ACC_BADGE_STYLE : task.workAccountabilityType === 'ACV' ? ACV_BADGE_STYLE : null;
  const badgeLabel = task.workAccountabilityType === 'ACC' ? 'AC' : 'AV';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[boxStyle, animatedStyle]}>
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
        {(delayChip || actualDateRange) && (
          <View className="absolute left-0 right-0 flex-row justify-center items-center" style={{ top: -20 * nodeScale, gap: 6 * nodeScale }}>
            {delayChip && (
              <View
                className="rounded-full flex-row"
                style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale, backgroundColor: '#FEE2E2', borderWidth: delayChip.isOwnDelay ? 1.5 : 0, borderColor: '#000' }}
              >
                <Text className="font-bold text-red-700" style={font2xs}>+{delayChip.days}d</Text>
              </View>
            )}
            {actualDateRange && (
              <View className="rounded-full" style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale, backgroundColor: '#FCA5A5' }}>
                <Text className="font-bold text-red-900" style={font2xs}>{actualDateRange}</Text>
              </View>
            )}
          </View>
        )}
        <View className="absolute left-0 right-0 items-center" style={{ top: -40 * nodeScale }}>
          <View className="rounded-full" style={{ paddingHorizontal: 6 * nodeScale, paddingVertical: 2 * nodeScale, backgroundColor: '#FEF08A' }}>
            <Text className="font-bold text-yellow-900" style={font2xs}>{dateRange}</Text>
          </View>
        </View>

        {/* AC/AV badge — ABOVE the box now, not sharing the taskId's own row
            inside it, by explicit (repeated) request. Pinned to the same
            -20 offset the delay/actual-date chip row already uses (proven
            clear of the row above on all 311 real tasks) rather than a new
            tier of its own, which would need its own from-scratch
            clearance check this environment can't run. Its own
            `right: 0, top` sibling to that row's `left-0 right-0` — both
            absolutely positioned, so they coexist without affecting each
            other's layout; only overlaps if a delay/actual chip run wide
            enough to reach the right edge, which none of the 311 real ones
            do today. */}
        {badge && (
          <View
            className="absolute rounded"
            style={{
              top: -20 * nodeScale,
              right: 0,
              paddingHorizontal: 6 * nodeScale,
              paddingVertical: 2 * nodeScale,
              backgroundColor: badge.bg,
              borderWidth: 1.5,
              borderColor: badge.border,
            }}
          >
            <Text className="font-bold" style={[font2xs, { color: badge.text }]}>{badgeLabel}</Text>
          </View>
        )}

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
        <View
          className="rounded-full self-center"
          style={{ backgroundColor: '#FEF08A', paddingHorizontal: 6 * nodeScale, paddingVertical: 1 * nodeScale, marginBottom: 2 * nodeScale }}
        >
          <Text numberOfLines={1} className="font-bold" style={[font2xs, { color: '#713F12', textAlign: 'center' }]}>{dateRange}</Text>
        </View>
        {!task.taskId.startsWith('MILE-') && (
          <Text className="font-mono font-bold" style={[font2xs, { color: textColor, opacity: 0.75, textAlign: 'center' }]}>{task.taskId}</Text>
        )}
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
      </Animated.View>
    </GestureDetector>
  );
}
