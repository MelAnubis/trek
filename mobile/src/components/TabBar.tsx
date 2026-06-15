import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/theme/colors';

const ICONS: Record<string, string> = {
  Trips: '🗺',
  Grabar: '⏺',
  Profile: '👤',
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 8 }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = options.tabBarLabel ?? route.name;

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tab}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.icon, focused && styles.iconActive]}>
              {ICONS[route.name] ?? '●'}
            </Text>
            <Text style={[styles.label, focused && styles.labelActive]}>
              {String(label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  icon: { fontSize: 22, opacity: 0.4 },
  iconActive: { opacity: 1 },
  label: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.3 },
  labelActive: { color: '#2ECC71' },
});
