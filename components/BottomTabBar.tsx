// Bottom tab bar for the most-used sections, per role. Rendered under every
// drawer screen via the Drawer's screenLayout (app/(authenticated)/_layout.tsx),
// so no routes moved — tabs just navigate to the existing drawer screens.
// "More" opens the side menu for everything else.
//
//   Site engineer:   Home · Attendance · DPR · Alerts · More
//   Admin:           Home · Site Attendance · DPR · Notifications · More
//   Manager:         Home · Site Attendance · Tasks · Notifications · More
//                    (DPR is field/admin-only, so managers get Task List)
//   Client:          Home · Status · More

import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appRoleFor, isFieldRole, useAuth } from '../lib/AuthContext';
import { colors, space } from '../lib/theme';
import { haptic } from '../lib/haptics';
import { AppText } from './ui/AppText';
import { useSiteGroupsEnabled } from '../lib/groupChats/access';
import { useSiteGroupsUnreadTotal } from '../lib/groupChats/chatsStore';
import { unreadLabel } from '../lib/groupChats/format';

interface Tab {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  route?: string; // drawer route name
  href?: string; // non-drawer route (e.g. /reports)
}

const HOME: Tab = { key: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home', route: 'home' };
const MORE: Tab = { key: 'more', label: 'More', icon: 'menu-outline', iconActive: 'menu' };
const SITE_GROUPS: Tab = { key: 'site-groups', label: 'Site Groups', icon: 'chatbubbles-outline', iconActive: 'chatbubbles', route: 'site-groups' };

// siteGroups: user is in whatsapp_access AND WHATSAPP_ENABLED. Only the
// admin/manager set changes (Site Groups takes the Alerts/Notifications
// slot; Notifications stays in the header bell and the More menu). Field
// roles and clients keep today's tabs even with access, until their tab set
// is agreed — they reach Site Groups from the More menu.
function tabsFor(role: string, siteGroups: boolean): Tab[] {
  if (appRoleFor(role as never) === 'client') {
    return [HOME, { key: 'status', label: 'Status', icon: 'stats-chart-outline', iconActive: 'stats-chart', href: '/reports' }, MORE];
  }
  if (isFieldRole(role as never)) {
    return [
      HOME,
      { key: 'attendance', label: 'Attendance', icon: 'finger-print-outline', iconActive: 'finger-print', route: 'attendance' },
      { key: 'dpr', label: 'DPR', icon: 'document-text-outline', iconActive: 'document-text', route: 'daily-updates' },
      { key: 'alerts', label: 'Alerts', icon: 'warning-outline', iconActive: 'warning', route: 'critical-alerts' },
      MORE,
    ];
  }
  const third: Tab =
    role === 'admin'
      ? { key: 'dpr', label: 'DPR', icon: 'document-text-outline', iconActive: 'document-text', route: 'daily-updates' }
      : { key: 'tasks', label: 'Tasks', icon: 'list-outline', iconActive: 'list', route: 'task-list' };
  return [
    HOME,
    { key: 'site-attendance', label: 'Attendance', icon: 'people-outline', iconActive: 'people', route: 'team-attendance' },
    third,
    siteGroups ? SITE_GROUPS : { key: 'notifications', label: 'Alerts', icon: 'notifications-outline', iconActive: 'notifications', route: 'notifications' },
    MORE,
  ];
}

export const TAB_BAR_HEIGHT = 58;

export function BottomTabBar({
  routeName,
  navigate,
  openDrawer,
}: {
  routeName: string;
  navigate: (route: string) => void;
  openDrawer: () => void;
}) {
  const { state } = useAuth();
  const siteGroups = useSiteGroupsEnabled();
  const unread = useSiteGroupsUnreadTotal();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (state.status !== 'signed-in' || keyboardOpen) return null;
  const tabs = tabsFor(state.profile.role, siteGroups);

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: Math.max(insets.bottom, space.xs),
        paddingTop: space.xs,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.route != null && tab.route === routeName;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic.select();
              if (tab.key === 'more') openDrawer();
              else if (tab.href) router.push(tab.href as never);
              else if (tab.route && !active) navigate(tab.route);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: TAB_BAR_HEIGHT - space.xs * 2,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View style={{ paddingHorizontal: 14, paddingVertical: 3, borderRadius: 999, backgroundColor: active ? colors.amberSoft : 'transparent' }}>
              <Ionicons name={active ? tab.iconActive : tab.icon} size={22} color={active ? colors.navy : colors.textMuted} />
              {tab.key === 'site-groups' && unread > 0 ? (
                <View style={badgeStyle} accessibilityLabel={`${unread} unread`}>
                  <AppText variant="caption" style={badgeTextStyle}>
                    {unreadLabel(unread)}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ color: active ? colors.navy : colors.textMuted, fontFamily: active ? 'IBMPlexSans_600SemiBold' : 'IBMPlexSans_500Medium', fontSize: 12 }}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const badgeStyle = {
  position: 'absolute' as const,
  top: -2,
  right: 2,
  minWidth: 18,
  height: 18,
  paddingHorizontal: 4,
  borderRadius: 9,
  backgroundColor: colors.amber,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
const badgeTextStyle = { color: colors.amberDeep, fontSize: 11, lineHeight: 14, fontFamily: 'IBMPlexSans_600SemiBold' };
