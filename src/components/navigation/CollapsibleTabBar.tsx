import React, { useState } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  Boxes,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react-native';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme } from '../../context/AppProviders';
import {
  sidebarNavigationWidth,
  usesSidebarNavigation,
} from '../../domain/mainNavigation';

const routeLabels: Record<string, string> = {
  Dashboard: 'Home',
  Inventory: 'Inventory',
  Settings: 'Settings',
};

function RouteIcon({
  color,
  routeName,
  size,
}: {
  color: string;
  routeName: string;
  size: number;
}) {
  if (routeName === 'Inventory') return <Boxes color={color} size={size} strokeWidth={2} />;
  if (routeName === 'Settings') return <Settings color={color} size={size} strokeWidth={2} />;
  return <House color={color} size={size} strokeWidth={2} />;
}

function navigateToRoute(
  route: BottomTabBarProps['state']['routes'][number],
  focused: boolean,
  navigation: BottomTabBarProps['navigation'],
) {
  const event = navigation.emit({
    type: 'tabPress',
    target: route.key,
    canPreventDefault: true,
  });
  if (!focused && !event.defaultPrevented) {
    navigation.navigate(route.name, route.params);
  }
}

export function CollapsibleTabBar({
  descriptors,
  insets,
  navigation,
  state,
}: BottomTabBarProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const sidebar = usesSidebarNavigation(width);
  const [expanded, setExpanded] = useState(true);

  if (!sidebar) {
    return (
      <View
        accessibilityRole="tablist"
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key].options;
          const label = routeLabels[route.name] ?? options.title ?? route.name;
          const color = focused ? colors.primary : colors.mutedForeground;
          return (
            <Pressable
              accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label} tab`}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              onPress={() => navigateToRoute(route, focused, navigation)}
              style={({ pressed }) => [styles.bottomItem, pressed && styles.pressed]}
            >
              <RouteIcon color={color} routeName={route.name} size={23} />
              <Text style={[styles.bottomLabel, { color }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Field App Complete navigation"
      accessibilityRole="tablist"
      style={[
        styles.sidebar,
        {
          backgroundColor: colors.navigationSurface,
          borderRightColor: colors.navigationBorder,
          marginTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
          paddingTop: 16,
          width: sidebarNavigationWidth(expanded),
        },
      ]}
    >
      <View style={[styles.brandRow, !expanded && styles.brandRowCollapsed]}>
        <View style={[styles.brandMark, { borderColor: colors.navigationBorder }]}>
          <Text style={[styles.brandMarkText, { color: colors.navigationForeground }]}>SW</Text>
        </View>
        {expanded ? (
          <View style={styles.brandCopy}>
            <Text numberOfLines={1} style={[styles.brandTitle, { color: colors.navigationForeground }]}>
              Field App Complete
            </Text>
            <Text numberOfLines={1} style={[styles.brandSubtitle, { color: colors.navigationMuted }]}>
              SUSTAINABILITY WISE
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityHint="Changes the width of the navigation sidebar"
        accessibilityLabel={expanded ? 'Collapse navigation sidebar' : 'Expand navigation sidebar'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          styles.toggle,
          !expanded && styles.toggleCollapsed,
          { borderColor: colors.navigationBorder },
          pressed && styles.pressed,
        ]}
      >
        {expanded ? (
          <PanelLeftClose color={colors.navigationForeground} size={22} />
        ) : (
          <PanelLeftOpen color={colors.navigationForeground} size={22} />
        )}
        {expanded ? (
          <Text style={[styles.toggleLabel, { color: colors.navigationForeground }]}>Collapse sidebar</Text>
        ) : null}
      </Pressable>

      <View style={styles.sidebarItems}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key].options;
          const label = routeLabels[route.name] ?? options.title ?? route.name;
          const foreground = focused
            ? colors.navigationForeground
            : colors.navigationMuted;
          return (
            <Pressable
              accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label} tab`}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              onPress={() => navigateToRoute(route, focused, navigation)}
              style={({ pressed }) => [
                styles.sidebarItem,
                !expanded && styles.sidebarItemCollapsed,
                focused && { backgroundColor: colors.navigationSurfaceActive },
                pressed && styles.pressed,
              ]}
            >
              <RouteIcon color={foreground} routeName={route.name} size={24} />
              {expanded ? (
                <Text style={[styles.sidebarLabel, { color: foreground }]}>{label}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
    paddingTop: 8,
  },
  bottomItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 48,
  },
  bottomLabel: { fontSize: 11, fontWeight: '600' },
  brandCopy: { flex: 1, minWidth: 0 },
  brandMark: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  brandMarkText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  brandRowCollapsed: { justifyContent: 'center', paddingHorizontal: 12 },
  brandSubtitle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginTop: 3 },
  brandTitle: { fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  sidebar: {
    alignSelf: 'stretch',
    borderRightWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  sidebarItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  sidebarItemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  sidebarItems: { gap: 8, paddingHorizontal: 12 },
  sidebarLabel: { fontSize: 15, fontWeight: '700' },
  toggle: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
    marginHorizontal: 12,
    marginTop: 18,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  toggleCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  toggleLabel: { fontSize: 13, fontWeight: '700' },
});
