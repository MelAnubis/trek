import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, RefreshControl, TouchableOpacity, Image,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
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
        {trip.countries && trip.countries.length > 0 && (
          <Text style={styles.cardCountries} numberOfLines={1}>
            📍 {trip.countries.join(' · ')}
          </Text>
        )}
        {trip.totalDays && (
          <Text style={styles.cardDays}>{trip.totalDays} días</Text>
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
        <Text style={styles.headerTitle}>Mis viajes</Text>
      </View>

      <FlashList
        data={trips}
        renderItem={renderItem}
        estimatedItemSize={200}
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
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 8,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { ...TYPE.h2, color: COLORS.text },

  list: { padding: 16 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardImage: { width: '100%', height: 160 },
  cardImagePlaceholder: { backgroundColor: COLORS.mapBg, justifyContent: 'center', alignItems: 'center' },
  placeholderEmoji: { fontSize: 48 },
  cardBody: { padding: 14 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { ...TYPE.h3, color: COLORS.text, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  cardDate: { ...TYPE.caption, color: COLORS.textMuted, marginBottom: 4 },
  cardCountries: { ...TYPE.caption, color: COLORS.textMuted },
  cardDays: { ...TYPE.label, color: COLORS.primary, marginTop: 6 },

  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { ...TYPE.h3, color: COLORS.text },
  emptyText: { ...TYPE.body, color: COLORS.textMuted, marginTop: 6 },
});
