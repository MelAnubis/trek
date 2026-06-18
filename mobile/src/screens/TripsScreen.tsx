import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, RefreshControl, TouchableOpacity,
  Image, FlatList, ImageBackground,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import type { Trip } from '@/types';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const dateRange =
    trip.startDate && trip.endDate
      ? `${new Date(trip.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – ${new Date(trip.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : null;

  const statusLabel =
    trip.status === 'ongoing' ? 'En curso' :
    trip.status === 'completed' ? 'Completado' : 'Planeado';

  const statusColor =
    trip.status === 'ongoing' ? COLORS.success :
    trip.status === 'completed' ? COLORS.textMuted :
    COLORS.accent;

  if (trip.coverImage) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
        <ImageBackground source={{ uri: trip.coverImage }} style={styles.cardImage} imageStyle={styles.cardImageStyle}>
          <View style={styles.cardOverlay}>
            {(trip.totalDays ?? 0) > 0 && (
              <View style={styles.daysBadge}>
                <Text style={styles.daysBadgeText}>{trip.totalDays}d</Text>
              </View>
            )}
            <View style={styles.overlayContent}>
              {!!trip.countries?.length && (
                <Text style={styles.overlayCountries} numberOfLines={1}>
                  {trip.countries!.join(' · ')}
                </Text>
              )}
              <Text style={styles.overlayTitle} numberOfLines={2}>{trip.name}</Text>
              <View style={styles.overlayMeta}>
                {dateRange && <Text style={styles.overlayDate}>{dateRange}</Text>}
                <View style={[styles.statusPill, { backgroundColor: statusColor + '33', borderColor: statusColor + '66' }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>
            </View>
          </View>
        </ImageBackground>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.card, styles.cardNoImage]} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.cardNoImageBg}>
        <Ionicons name="map-outline" size={48} color={COLORS.primary} style={{ opacity: 0.25 }} />
      </View>
      <View style={styles.cardNoImageContent}>
        <View style={styles.cardNoImageTop}>
          {(trip.totalDays ?? 0) > 0 && (
            <View style={styles.daysBadgeDark}>
              <Text style={styles.daysBadgeDarkText}>{trip.totalDays} días</Text>
            </View>
          )}
          <View style={[styles.statusPillDark, { borderColor: statusColor + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={styles.cardNoImageTitle} numberOfLines={2}>{trip.name}</Text>
        {dateRange && <Text style={styles.cardNoImageDate}>{dateRange}</Text>}
        {!!trip.countries?.length && (
          <Text style={styles.cardNoImageCountries} numberOfLines={1}>
            {trip.countries!.join(' · ')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function TripsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { trips, loadingTrips, fetchTrips } = useTripStore();

  useEffect(() => { fetchTrips(); }, []);

  const renderItem = useCallback(({ item }: { item: Trip }) => (
    <TripCard
      trip={item}
      onPress={() => navigation.navigate('TripDetail', { tripId: item.id })}
    />
  ), [navigation]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="bicycle" size={20} color={COLORS.accent} style={{ marginRight: 6 }} />
          <Text style={styles.headerBrand}>trekwanderer</Text>
        </View>
        {trips.length > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{trips.length} viajes</Text>
          </View>
        )}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>Mis viajes</Text>
      </View>

      <FlatList
        data={trips}
        renderItem={renderItem}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loadingTrips} onRefresh={fetchTrips} tintColor={COLORS.primary} />
        }
        ListEmptyComponent={
          !loadingTrips ? (
            <View style={styles.empty}>
              <Ionicons name="compass-outline" size={60} color={COLORS.primary} style={{ opacity: 0.35, marginBottom: 18 }} />
              <Text style={styles.emptyTitle}>Sin viajes aún</Text>
              <Text style={styles.emptyText}>Crea tu primer viaje en la web</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 4,
    backgroundColor: COLORS.cream,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerBrand: { fontSize: 12, fontWeight: '800', color: COLORS.accent, letterSpacing: 1.2 },
  headerBadge: {
    backgroundColor: COLORS.primary + '18',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },

  titleRow: {
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 10,
    backgroundColor: COLORS.cream,
  },
  pageTitle: { fontSize: 26, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },

  list: { paddingHorizontal: 14, paddingBottom: 20, paddingTop: 4 },

  // Card with image (full-bleed)
  card: {
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  cardImage: { width: '100%', height: 160 },
  cardImageStyle: { borderRadius: 18 },
  cardOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  daysBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  daysBadgeText: { fontSize: 11, fontWeight: '800', color: '#FFF' },
  overlayContent: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 12,
    padding: 12,
  },
  overlayCountries: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginBottom: 4, letterSpacing: 0.3 },
  overlayTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3, marginBottom: 8 },
  overlayMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overlayDate: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },

  // Card without image
  cardNoImage: {
    backgroundColor: '#FFFFFF',
    height: 110,
  },
  cardNoImageBg: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  cardNoImageContent: { flex: 1, padding: 16, justifyContent: 'space-between' },
  cardNoImageTop: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  daysBadgeDark: {
    backgroundColor: COLORS.accent + '1A',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  daysBadgeDarkText: { fontSize: 11, fontWeight: '700', color: COLORS.accent },
  statusPillDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  cardNoImageTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3, flex: 1 },
  cardNoImageDate: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500', marginTop: 4 },
  cardNoImageCountries: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500', marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { ...TYPE.h3, color: COLORS.text },
  emptyText: { ...TYPE.body, color: COLORS.textMuted, marginTop: 6, textAlign: 'center' },
});
