import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ImageBackground } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';
import { COLORS } from '@/theme/colors';

const BRAND_BG = require('../../assets/brand-bg.png');

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, serverUrl } = useAuthStore();
  const { trips } = useTripStore();

  const handleLogout = () => {
    Alert.alert('Cerrar sesion', 'Seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  const tripCount = trips.length;
  const completedCount = trips.filter((t) => t.status === 'completed').length;
  const allCountries = [...new Set(trips.flatMap((t) => t.countries ?? []))];
  const countryCount = allCountries.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Dark header banner with brand background */}
      <ImageBackground source={BRAND_BG} style={styles.bannerBg} resizeMode="cover">
        <View style={[styles.bannerOverlay, { paddingTop: insets.top + 28 }]}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.username?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
          </View>
          <Text style={styles.name}>{user?.username ?? 'Usuario'}</Text>
          <Text style={styles.email}>{user?.email ?? ''}</Text>
        </View>
      </ImageBackground>

      {/* Floating stats card */}
      <View style={styles.statsCard}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{tripCount}</Text>
          <Text style={styles.statLabel}>Viajes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{completedCount}</Text>
          <Text style={styles.statLabel}>Completados</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{countryCount > 0 ? countryCount : '--'}</Text>
          <Text style={styles.statLabel}>Paises</Text>
        </View>
      </View>

      {/* Countries visited */}
      {allCountries.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PAISES VISITADOS</Text>
          <View style={styles.chipRow}>
            {allCountries.map((c) => (
              <View key={c} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Server */}
      {serverUrl ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SERVIDOR</Text>
          <View style={styles.listItem}>
            <Ionicons name="server-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.listItemText} numberOfLines={1}>
              {serverUrl.replace(/^https?:\/\//, '')}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Account actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CUENTA</Text>
        <TouchableOpacity style={[styles.listItem, styles.listItemBtn]} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={[styles.listItemText, { color: COLORS.danger }]}>Cerrar sesion</Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.danger} style={styles.chevron} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0E8' },

  bannerBg: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  bannerOverlay: {
    alignItems: 'center',
    paddingBottom: 36,
    backgroundColor: 'rgba(13,43,29,0.65)',
  },
  avatarRing: {
    padding: 3,
    borderRadius: 48,
    backgroundColor: COLORS.primary,
    marginBottom: 14,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 36, fontWeight: '800', color: COLORS.primary },
  name: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3, marginBottom: 4 },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginTop: -22,
    borderRadius: 18,
    paddingVertical: 22,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginTop: 3, letterSpacing: 0.3 },
  statDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  section: {
    marginTop: 24,
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.primaryDark },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  listItemBtn: { paddingVertical: 16 },
  listItemText: { fontSize: 15, fontWeight: '500', color: COLORS.text, flex: 1 },
  chevron: { marginLeft: 'auto' },
});
