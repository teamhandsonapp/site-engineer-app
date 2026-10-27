import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/AuthContext';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  DUMMY_NOTIFICATIONS,
  KIND_COLOR,
  KIND_LABEL,
  type NotificationCategory,
  type NotificationItem,
} from '../../lib/notifications';
import { formatTime12h } from '../../lib/formatTime';
import { Card } from '../../components/ui/Card';

// One row inside an expanded category box — no longer individually
// pressable (dummy items all have target: null anyway for this pass; the
// box header is the interactive element now, not each row).
function NotificationRow({ item }: { item: NotificationItem }) {
  const color = KIND_COLOR[item.kind];
  return (
    <View className="rounded-xl px-3 py-2.5 mb-2" style={{ backgroundColor: `${color}0D`, borderWidth: 1, borderColor: `${color}33` }}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-2xs font-bold" style={{ color }}>{KIND_LABEL[item.kind]}</Text>
        <Text className="text-2xs text-neutral-400">{formatTime12h(new Date(item.atISO))}</Text>
      </View>
      <Text className="text-xs font-bold text-neutral-700 mb-0.5">
        {item.projectName ?? 'Unassigned'} — {item.title}
      </Text>
      {item.detail && <Text className="text-xs text-neutral-500">{item.detail}</Text>}
    </View>
  );
}

// One collapsible box per category — collapsed by default (same convention
// as DrawerContent.tsx's Reports section: "real feedback wanted them
// collapsed by default, not a permanently-expanded list"), header shows a
// red circle count badge, tapping expands to reveal that category's own
// items inline.
function CategorySection({
  category,
  items,
  expanded,
  onToggle,
}: {
  category: NotificationCategory;
  items: NotificationItem[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="mb-3" style={{ paddingVertical: 4 }}>
      <Pressable onPress={onToggle} className="flex-row items-center justify-between py-2.5">
        <Text className="text-sm font-bold text-neutral-900">{CATEGORY_LABEL[category]}</Text>
        <View className="flex-row items-center gap-2">
          {items.length > 0 && (
            <View className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 items-center justify-center">
              <Text className="text-2xs font-bold text-white">{items.length}</Text>
            </View>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </View>
      </Pressable>

      {expanded && (
        <View className="pb-1.5">
          {items.length === 0 ? (
            <Text className="text-xs text-neutral-400 py-2">Nothing here right now.</Text>
          ) : (
            items.map((item) => <NotificationRow key={item.id} item={item} />)
          )}
        </View>
      )}
    </Card>
  );
}

// The cross-project notification center — every unresolved alert across
// EVERY project the account can see, not scoped to whichever project
// happens to be currently selected (that's what critical-alerts.tsx
// already is). Reachable from the home screen and via the bell icon
// (present in headerRight on every drawer screen, including this one).
//
// Admin/manager-only, NOT staff-wide — this is a team-wide/admin-perspective
// view (other people's leave requests, checklist verifications across the
// whole project, etc.), not something a site_engineer should see about
// themselves or their peers. Same gate as access-roles/team-attendance/
// leave-log (DrawerContent.tsx's ADMIN_MANAGER_ONLY_ROUTES).
//
// Organized as 7 expandable boxes (one per category), not a tab bar
// filtering one flat list — by explicit request. Placeholder data pass —
// DUMMY_NOTIFICATIONS (5 realistic items per category, 35 total) stands in
// for all 7 categories for now, including the 3 (critical_alerts/location/
// messages) that already have a REAL fetch function (fetchAllNotifications,
// still exported from lib/notifications.ts untouched) — mixing real+dummy
// would make this review inconsistent, so every category is dummy together
// until each is wired up for real, one at a time.
export default function NotificationsScreen() {
  const { state } = useAuth();
  const isAdminOrManager =
    state.status === 'signed-in' && (state.profile.role === 'admin' || state.profile.role === 'manager');
  const [expanded, setExpanded] = useState<Partial<Record<NotificationCategory, boolean>>>({});

  function toggle(category: NotificationCategory) {
    setExpanded((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  if (!isAdminOrManager || state.status !== 'signed-in') {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
        <Text className="text-2xs text-neutral-400 mb-3">{DUMMY_NOTIFICATIONS.length} across all categories</Text>
        {CATEGORIES.map((category) => (
          <CategorySection
            key={category}
            category={category}
            items={DUMMY_NOTIFICATIONS.filter((i) => i.category === category)}
            expanded={!!expanded[category]}
            onToggle={() => toggle(category)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
