import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/theme/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: Record<string, { active: IoniconName; inactive: IoniconName; label: string }> = {
  Trips:   { active: 'compass',         inactive: 'compass-outline',       label: 'Viajes'  },
  Grabar:  { active: 'radio-button-on', inactive: 'radio-button-off',      label: 'Grabar'  },
  Profile: { active: 'person-circle',   inactive: 'person-circle-outline', label: 'Perfil'  },
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 10 }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const cfg = TABS[route.name];

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
            {focused && <View style={styles.activePill} />}
            <Ionicons
              name={focused ? cfg?.active : cfg?.inactive}
              size={25}
              color={focused ? COLORS.primary : '#9CA3AF'}
            />
            <Text style={[styles.label, focused && styles.labelActive]}>
              {cfg?.label ?? route.name}
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
    borderTopColor: '#F3F4F6',
    paddingTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 6 },
  activePill: {
    position: 'absolute',
    top: -6,
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  label: { fontSize: 10, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.3 },
  labelActive: { color: COLORS.primary },
});
