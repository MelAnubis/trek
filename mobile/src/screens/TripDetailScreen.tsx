import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import type { Day, GpxTrack } from '@/types';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'TripDetail'>;

function StatPill({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DayRow({ day, onPress }: { day: Day; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.dayRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.dayBadge}>
        <Text style={styles.dayBadgeNum}>{day.dayNumber}</Text>
      </View>
      <View style={styles.dayInfo}>
        <Text style={styles.dayTitle}>{day.title || `Día ${day.dayNumber}`}</Text>
        {day.date && (
          <Text style={styles.dayDate}>
            {new Date(day.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        )}
        {day.places?.length > 0 && (
          <Text style={styles.dayPlaces}>📍 {day.places.length} lugar{day.places.length !== 1 ? 'es' : ''}</Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function TrackChip({ track, onPress }: { track: GpxTrack; onPress: () => void }) {
  const km = (track.totalDistance / 1000).toFixed(1);
  const gain = Math.round(track.totalElevationGain);
  return (
    <TouchableOpacity style={styles.trackChip} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.trackChipIcon}>🏔</Text>
      <View>
        <Text style={styles.trackChipName} numberOfLines={1}>{track.trackName}</Text>
        <Text style={styles.trackChipStats}>{km} km · +{gain} m</Text>
      </View>
      <View style={styles.navigateBtn}>
        <Text style={styles.navigateBtnText}>Navegar</Text>
      </View>
    </TouchableOpacity>
  );
}

export function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { tripId } = route.params;
  const { currentTrip, days, tracks, loadingDetail, fetchTripDetail } = useTripStore();

  useEffect(() => { fetchTripDetail(tripId); }, [tripId]);

  const totalKm = tracks.reduce((sum, t) => sum + t.totalDistance, 0) / 1000;
  const totalGain = tracks.reduce((sum, t) => sum + t.totalElevationGain, 0);

  if (loadingDetail && !currentTrip) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <ScrollView>
        {/* Hero */}
        {currentTrip?.coverImage ? (
          <Image source={{ uri: currentTrip.coverImage }} style={styles.hero} />
        ) : (
          <View style={[styles.hero, { backgroundColor: COLORS.bg }]}>
            <Text style={styles.heroEmoji}>🗺️</Text>
          </View>
        )}

        {/* Back button */}
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + 10 }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.tripName}>{currentTrip?.name}</Text>
          {currentTrip?.description && (
            <Text style={styles.tripDesc}>{currentTrip.description}</Text>
          )}

          {/* Stats */}
          {(tracks.length > 0) && (
            <View style={styles.statsRow}>
              <StatPill icon="📏" value={`${totalKm.toFixed(0)} km`} label="distancia" />
              <StatPill icon="⛰️" value={`${Math.round(totalGain).toLocaleString()} m`} label="desnivel" />
              <StatPill icon="🗓" value={`${days.length}`} label="días" />
            </View>
          )}

          {/* Map button */}
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => navigation.navigate('DayMap', { tripId })}
            activeOpacity={0.85}
          >
            <Text style={styles.mapBtnText}>🗺  Ver en el mapa</Text>
          </TouchableOpacity>

          {/* GPX Tracks */}
          {tracks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rutas GPX</Text>
              {tracks.map((track) => (
                <TrackChip
                  key={track.id}
                  track={track}
                  onPress={() => navigation.navigate('Navigate', { tripId, trackId: track.id })}
                />
              ))}
            </View>
          )}

          {/* Days */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Itinerario</Text>
            {days.map((day) => (
              <DayRow
                key={day.id}
                day={day}
                onPress={() => navigation.navigate('DayMap', { tripId, dayId: day.id })}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },

  hero: { width: '100%', height: 240, justifyContent: 'center', alignItems: 'center' },
  heroEmoji: { fontSize: 64 },
  backBtn: {
    position: 'absolute', left: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontSize: 24, lineHeight: 28, marginTop: -2 },

  content: { padding: 20 },
  tripName: { ...TYPE.h1, color: COLORS.text, marginBottom: 6 },
  tripDesc: { ...TYPE.body, color: COLORS.textMuted, marginBottom: 16, lineHeight: 22 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statPill: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 3,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  statIcon: { fontSize: 20 },
  statValue: { ...TYPE.h3, color: COLORS.text },
  statLabel: { ...TYPE.caption, color: COLORS.textMuted },

  mapBtn: {
    backgroundColor: COLORS.bg, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 24,
  },
  mapBtnText: { ...TYPE.label, color: COLORS.primary, fontSize: 15 },

  section: { marginBottom: 24 },
  sectionTitle: { ...TYPE.label, color: COLORS.textMuted, marginBottom: 10, letterSpacing: 0.8 },

  dayRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 12, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  dayBadge: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  dayBadgeNum: { ...TYPE.label, color: COLORS.primaryDark, fontSize: 15 },
  dayInfo: { flex: 1 },
  dayTitle: { ...TYPE.h3, color: COLORS.text, fontSize: 15 },
  dayDate: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  dayPlaces: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  chevron: { fontSize: 22, color: '#D1D5DB' },

  trackChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 12, padding: 14, marginBottom: 8, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  trackChipIcon: { fontSize: 24 },
  trackChipName: { ...TYPE.label, color: COLORS.text, flex: 1 },
  trackChipStats: { ...TYPE.caption, color: COLORS.textMuted },
  navigateBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  navigateBtnText: { ...TYPE.caption, color: '#fff', fontWeight: '700' },
});
