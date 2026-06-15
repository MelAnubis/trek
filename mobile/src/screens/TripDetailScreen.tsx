import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Share, useWindowDimensions, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTripStore } from '@/store/tripStore';
import { useAuthStore } from '@/store/authStore';
import { getGpxPoints } from '@/api/trips';
import type { RootStackParamList } from '../../App';
import type { Day, GpxTrack } from '@/types';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';
import { ElevationChart, ElevPoint } from '@/components/ElevationChart';
import { tilesForBbox, downloadTiles, hasCachedTiles } from '@/utils/offlineTiles';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'TripDetail'>;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
            {new Date(day.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        )}
        {(day.places?.length ?? 0) > 0 && (
          <Text style={styles.dayPlaces}>{`📍 ${day.places.length} lugar${day.places.length !== 1 ? 'es' : ''}`}</Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function TrackCard({
  track, tripId, chartWidth, onNavigate,
}: { track: GpxTrack; tripId: number; chartWidth: number; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [elevPts, setElevPts] = useState<ElevPoint[] | null>(null);
  const [loadingElev, setLoadingElev] = useState(false);

  const km = (track.totalDistance / 1000).toFixed(1);
  const gain = Math.round(track.totalElevationGain);
  const loss = Math.round(track.totalElevationLoss ?? 0);
  const calories = Math.round(parseFloat(km) * 65 + gain * 0.8);
  const maxEle = track.maxElevation != null ? `${Math.round(track.maxElevation)} m` : '–';
  const minEle = track.minElevation != null ? `${Math.round(track.minElevation)} m` : '–';
  const pace = track.durationSeconds && track.totalDistance > 0
    ? (() => {
        const minPerKm = track.durationSeconds / 60 / (track.totalDistance / 1000);
        return `${Math.floor(minPerKm)}'${String(Math.round((minPerKm % 1) * 60)).padStart(2, '0')}''/km`;
      })()
    : null;

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !elevPts) {
      setLoadingElev(true);
      try {
        const pts = await getGpxPoints(tripId, track.id);
        let d = 0;
        const mapped: ElevPoint[] = [];
        for (let i = 0; i < pts.length; i++) {
          if (i > 0) d += haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
          if (pts[i].ele != null) mapped.push({ dist: d, ele: pts[i].ele! });
        }
        setElevPts(mapped.length > 1 ? mapped : null);
      } catch { setElevPts(null); }
      setLoadingElev(false);
    }
  };

  return (
    <View style={styles.trackCard}>
      <TouchableOpacity style={styles.trackCardHeader} onPress={toggle} activeOpacity={0.75}>
        <Text style={styles.trackCardIcon}>🏔</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.trackCardName} numberOfLines={1}>{track.trackName}</Text>
          <Text style={styles.trackCardMeta}>{km} km · +{gain} m</Text>
        </View>
        <TouchableOpacity style={styles.navigateBtn} onPress={onNavigate} activeOpacity={0.8}>
          <Text style={styles.navigateBtnText}>Navegar</Text>
        </TouchableOpacity>
        <Text style={styles.expandChevron}>{expanded ? '∧' : '∨'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.trackExpanded}>
          {loadingElev ? (
            <ActivityIndicator color={COLORS.primary} size="small" style={{ marginVertical: 16 }} />
          ) : elevPts ? (
            <ElevationChart points={elevPts} width={chartWidth} height={90} />
          ) : null}

          <View style={styles.trackStatsRow}>
            {[
              { label: 'desnivel +', value: `+${gain} m` },
              { label: 'desnivel −', value: `−${loss} m` },
              { label: 'alt. máx', value: maxEle },
              { label: 'alt. mín', value: minEle },
              { label: 'kcal est.', value: `~${calories}` },
              ...(pace ? [{ label: 'ritmo', value: pace }] : []),
            ].map((s) => (
              <View key={s.label} style={styles.trackStat}>
                <Text style={styles.trackStatValue}>{s.value}</Text>
                <Text style={styles.trackStatLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export function TripDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { tripId } = route.params;
  const { currentTrip, days, tracks, loadingDetail, fetchTripDetail } = useTripStore();
  const { serverUrl } = useAuthStore();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = screenWidth - 64;
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => { hasCachedTiles().then(setOfflineReady); }, []);

  useEffect(() => { fetchTripDetail(tripId); }, [tripId]);

  const totalKm = tracks.reduce((sum, t) => sum + t.totalDistance, 0) / 1000;
  const totalGain = tracks.reduce((sum, t) => sum + t.totalElevationGain, 0);
  const totalCalories = Math.round(totalKm * 65 + totalGain * 0.8);

  const handleShare = async () => {
    const url = serverUrl ? `${serverUrl.replace(/\/$/, '')}/trips/${tripId}` : '';
    try {
      await Share.share({
        title: currentTrip?.name ?? 'Trek',
        message: url
          ? `${currentTrip?.name ?? 'Viaje'} — ${url}`
          : `${currentTrip?.name ?? 'Viaje'} · ${totalKm.toFixed(0)} km · +${Math.round(totalGain)} m`,
      });
    } catch {}
  };

  const handleDownloadOffline = async () => {
    if (tracks.length === 0) { Alert.alert('Sin rutas', 'No hay rutas GPX para descargar.'); return; }
    setDownloading(true);
    setDownloadProgress(0);
    try {
      let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
      for (const track of tracks) {
        const pts = await getGpxPoints(tripId, track.id);
        for (const p of pts) {
          if (p.lat < minLat) minLat = p.lat;
          if (p.lat > maxLat) maxLat = p.lat;
          if (p.lng < minLng) minLng = p.lng;
          if (p.lng > maxLng) maxLng = p.lng;
        }
      }
      const buf = 0.05;
      const tiles = tilesForBbox(minLat - buf, minLng - buf, maxLat + buf, maxLng + buf);
      await downloadTiles(tiles, (done, total) => setDownloadProgress(Math.round((done / total) * 100)));
      setOfflineReady(true);
      Alert.alert('Descarga completa', `${tiles.length} teselas descargadas para uso offline.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo descargar el mapa.');
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  };

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

        {/* Back + Share */}
        <TouchableOpacity style={[styles.backBtn, { top: insets.top + 10 }]} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.shareBtn, { top: insets.top + 10 }]} onPress={handleShare}>
          <Text style={styles.shareBtnText}>↑</Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.tripName}>{currentTrip?.name}</Text>
          {currentTrip?.description ? (
            <Text style={styles.tripDesc}>{currentTrip.description}</Text>
          ) : null}

          {/* Stats pills */}
          <View style={styles.statsRow}>
            <StatPill icon="📏" value={`${totalKm.toFixed(0)} km`} label="distancia" />
            <StatPill icon="⛰️" value={`+${Math.round(totalGain)} m`} label="desnivel" />
            <StatPill icon="🔥" value={`~${totalCalories}`} label="kcal" />
            <StatPill icon="🗓" value={`${days.length}`} label="días" />
          </View>

          {/* Map button */}
          <TouchableOpacity style={styles.mapBtn} onPress={() => navigation.navigate('DayMap', { tripId })} activeOpacity={0.85}>
            <Text style={styles.mapBtnText}>{'🗺  Ver en el mapa'}</Text>
          </TouchableOpacity>

          {/* Offline map download */}
          <TouchableOpacity
            style={[styles.offlineBtn, offlineReady && styles.offlineBtnReady, downloading && { opacity: 0.7 }]}
            onPress={handleDownloadOffline}
            disabled={downloading}
            activeOpacity={0.85}
          >
            {downloading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.offlineBtnText}>{`Descargando… ${downloadProgress}%`}</Text>
              </View>
            ) : (
              <Text style={styles.offlineBtnText}>
                {offlineReady ? '✓  Mapa offline disponible' : '⬇  Descargar mapa offline'}
              </Text>
            )}
          </TouchableOpacity>

          {/* GPX Tracks */}
          {tracks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>RUTAS GPX</Text>
              {tracks.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  tripId={tripId}
                  chartWidth={chartWidth}
                  onNavigate={() => navigation.navigate('Navigate', { tripId, trackId: track.id })}
                />
              ))}
            </View>
          )}

          {/* Days */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ITINERARIO</Text>
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
  shareBtn: {
    position: 'absolute', right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center',
  },
  shareBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  content: { padding: 20 },
  tripName: { ...TYPE.h1, color: COLORS.text, marginBottom: 6 },
  tripDesc: { ...TYPE.body, color: COLORS.textMuted, marginBottom: 16, lineHeight: 22 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statPill: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 10,
    alignItems: 'center', gap: 2,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  statIcon: { fontSize: 18 },
  statValue: { ...TYPE.h3, color: COLORS.text, fontSize: 13 },
  statLabel: { ...TYPE.caption, color: COLORS.textMuted, fontSize: 10 },

  mapBtn: {
    backgroundColor: COLORS.bg, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 10,
  },
  mapBtnText: { ...TYPE.label, color: COLORS.primary, fontSize: 15 },
  offlineBtn: {
    backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: COLORS.border,
  },
  offlineBtnReady: { backgroundColor: `${COLORS.primary}12`, borderColor: COLORS.primary },
  offlineBtnText: { ...TYPE.label, color: COLORS.textMuted, fontSize: 14 },

  section: { marginBottom: 24 },
  sectionTitle: { ...TYPE.caption, color: COLORS.textMuted, marginBottom: 10, letterSpacing: 1 },

  // Track card
  trackCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  trackCardHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10,
  },
  trackCardIcon: { fontSize: 22 },
  trackCardName: { ...TYPE.label, color: COLORS.text },
  trackCardMeta: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  navigateBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  navigateBtnText: { ...TYPE.caption, color: '#fff', fontWeight: '700' },
  expandChevron: { color: COLORS.textMuted, fontSize: 14, width: 16, textAlign: 'center' },

  trackExpanded: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: COLORS.border },
  trackStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 0, marginTop: 8 },
  trackStat: { width: '33.33%', alignItems: 'center', paddingVertical: 8 },
  trackStatValue: { ...TYPE.label, color: COLORS.text, fontSize: 13 },
  trackStatLabel: { ...TYPE.caption, color: COLORS.textMuted, fontSize: 10, marginTop: 1 },

  // Day row
  dayRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 12, padding: 14, marginBottom: 8, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  dayBadge: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${COLORS.primary}20`, justifyContent: 'center', alignItems: 'center',
  },
  dayBadgeNum: { ...TYPE.label, color: COLORS.primaryDark, fontSize: 15 },
  dayInfo: { flex: 1 },
  dayTitle: { ...TYPE.h3, color: COLORS.text, fontSize: 15 },
  dayDate: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  dayPlaces: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  chevron: { fontSize: 22, color: '#D1D5DB' },
});
