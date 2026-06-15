import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

export function AtlasScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Atlas</Text>
      <Text style={styles.sub}>Visited countries coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center' },
  title: { ...TYPE.h2, color: COLORS.text },
  sub: { ...TYPE.body, color: COLORS.textMuted, marginTop: 8 },
});
