import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, RefreshControl, TouchableOpacity, Image, FlatList,
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

  const statusColor =
    trip.status === 'ongoing' ? COLORS.success :
    trip.status === 'completed' ? COLORS.textMuted :
    COLORS.accent;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {trip.coverImage ? (
        <Image source={{ uri: trip.coverImage }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Text style={styles.placeholderEmoji}>🗺️</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{trip.name}</Text>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>
        {dateRange && <Text style={styles.cardDate}>{dateRange}</Text>}
        {!!trip.countries?.length && (
          <Text style={styles.cardCountries} numberOfLines={1}>
            📍 {trip.countries!.join(' · ')}
          </Text>
        )}
        {(trip.totalDays ?? 0) > 0 && (
          <View style={styles.cardDaysBadge}>
            <Text style={styles.cardDaysText}>{trip.totalDays} dias</Text>
          </View>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>Trek Wanderer</Text>
          <Text style={styles.headerTitle}>Mis viajes</Text>
        </View>
        {trips.length > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{trips.length}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={trips}
        renderItem={renderItem}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loadingTrips} onRefresh={fetchTrips} tintColor={COLORS.primary} />
        }
        ListEmptyComponent={
          !loadingTrips ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>✈️</Text>
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
  container: { flex: 1, backgroundColor: '#F5F0E8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  headerEyebrow: { fontSize: 11, fontWeight: '700', color: COLORS.primary, letterSpacing: 0.8, marginBottom: 2 },
  headerTitle: { ...TYPE.h2, color: COLORS.text },
  headerBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 30,
    alignItems: 'center',
  },
  headerBadgeText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },

  list: { padding: 16, paddingTop: 18 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  cardImage: { width: '100%', height: 170 },
  cardImagePlaceholder: {
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderEmoji: { fontSize: 52, opacity: 0.6 },
  cardBody: { padding: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  cardTitle: { ...TYPE.h3, color: COLORS.text, flex: 1, fontSize: 17 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  cardDate: { ...TYPE.caption, color: COLORS.textMuted, marginBottom: 5 },
  cardCountries: { ...TYPE.caption, color: COLORS.textMuted },
  cardDaysBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
  },
  cardDaysText: { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },

  empty: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: { fontSize: 56, marginBottom: 18 },
  emptyTitle: { ...TYPE.h3, color: COLORS.text },
  emptyText: { ...TYPE.body, color: COLORS.textMuted, marginTop: 6, textAlign: 'center' },
});
