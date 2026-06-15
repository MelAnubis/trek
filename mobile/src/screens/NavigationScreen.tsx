import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, AppState,
} from 'react-native';
import MapLibreGL, {
  MapView, Camera, ShapeSource, LineLayer, CircleLayer,
} from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as Location from 'expo-location';
import { getGpxPoints } from '@/api/trips';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

MapLibreGL.setAccessToken(null);

type Route = RouteProp<RootStackParamList, 'Navigate'>;

interface GpxPoint { lat: number; lng: number; ele?: number }
interface NavState {
  position: [number, number] | null;
  speed: number;
  heading: number;
  distanceDone: number;
  distanceLeft: number;
  elapsedMs: number;
  nearestIdx: number;
}

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as any;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestIdx(points: GpxPoint[], lat: number, lng: number, fromIdx: number): number {
  let best = fromIdx;
  let bestDist = Infinity;
  const search = Math.min(fromIdx + 50, points.length);
  for (let i = fromIdx; i < search; i++) {
    const d = haversineM(lat, lng, points[i].lat, points[i].lng);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function totalTrackDistance(points: GpxPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return total;
}

function distanceFromStart(points: GpxPoint[], idx: number): number {
  let total = 0;
  for (let i = 1; i <= idx && i < points.length; i++) {
    total += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return total;
}

function formatDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export function NavigationScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { tripId, trackId } = route.params;

  const { tracks } = useTripStore();
  const track = tracks.find((t) => t.id === trackId);

  const [points, setPoints] = useState<GpxPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [nav, setNav] = useState<NavState>({
    position: null, speed: 0, heading: 0,
    distanceDone: 0, distanceLeft: 0, elapsedMs: 0, nearestIdx: 0,
  });
  const [totalDist, setTotalDist] = useState(0);
  const [followUser, setFollowUser] = useState(true);
  const cameraRef = useRef<Camera>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pts = await getGpxPoints(tripId, trackId);
        setPoints(pts);
        setTotalDist(totalTrackDistance(pts));
      } catch {}
      setLoading(false);
    })();
    return () => {
      locationSub.current?.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tripId, trackId]);

  const startNavigation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    setStarted(true);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setNav((prev) => ({ ...prev, elapsedMs: Date.now() - startTimeRef.current }));
    }, 1000);

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1500, distanceInterval: 3 },
      (loc) => {
        const { latitude: lat, longitude: lng, speed, heading } = loc.coords;
        setNav((prev) => {
          const nearIdx = findNearestIdx(points, lat, lng, Math.max(0, prev.nearestIdx - 2));
          const done = distanceFromStart(points, nearIdx);
          return {
            position: [lng, lat],
            speed: speed ?? 0,
            heading: heading ?? 0,
            distanceDone: done,
            distanceLeft: totalDist - done,
            elapsedMs: prev.elapsedMs,
            nearestIdx: nearIdx,
          };
        });

        if (followUser) {
          cameraRef.current?.setCamera({
            centerCoordinate: [lng, lat],
            zoomLevel: 15,
            heading: heading ?? 0,
            animationDuration: 400,
          });
        }
      }
    );
  }, [points, totalDist, followUser]);

  const stopNavigation = () => {
    locationSub.current?.remove();
    if (timerRef.current) clearInterval(timerRef.current);
    navigation.goBack();
  };

  const trackCoords: [number, number][] = points.map((p) => [p.lng, p.lat]);
  const doneCoords = trackCoords.slice(0, nav.nearestIdx + 1);

  const geojsonFull: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: trackCoords },
    properties: {},
  };
  const geojsonDone: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: doneCoords.length >= 2 ? doneCoords : [] },
    properties: {},
  };

  const progressPct = totalDist > 0 ? (nav.distanceDone / totalDist) * 100 : 0;

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[TYPE.body, { color: COLORS.textMuted, marginTop: 12 }]}>Cargando ruta…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFill} styleJSON={JSON.stringify(OSM_STYLE)} rotateEnabled compassEnabled compassViewPosition={3}>
        <Camera ref={cameraRef} zoomLevel={13}
          centerCoordinate={points.length > 0 ? [points[0].lng, points[0].lat] : [0, 0]}
        />

        {trackCoords.length >= 2 && (
          <ShapeSource id="track-full" shape={geojsonFull}>
            <LineLayer id="track-full-line" style={{ lineColor: '#D1FAE5', lineWidth: 5, lineOpacity: 0.7 }} />
          </ShapeSource>
        )}
        {doneCoords.length >= 2 && (
          <ShapeSource id="track-done" shape={geojsonDone}>
            <LineLayer id="track-done-line" style={{ lineColor: COLORS.primary, lineWidth: 5 }} />
          </ShapeSource>
        )}
        {nav.position && (
          <ShapeSource id="user-pos" shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: nav.position }, properties: {} }}>
            <CircleLayer id="user-circle" style={{ circleRadius: 10, circleColor: '#2563EB', circleStrokeColor: '#fff', circleStrokeWidth: 3 }} />
          </ShapeSource>
        )}
      </MapView>

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeBtn} onPress={stopNavigation}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.trackName} numberOfLines={1}>{track?.trackName ?? 'Ruta'}</Text>
          {started && <Text style={styles.elapsedText}>{formatTime(nav.elapsedMs)}</Text>}
        </View>
        <TouchableOpacity
          style={[styles.followBtn, followUser && styles.followBtnActive]}
          onPress={() => setFollowUser((v) => !v)}
        >
          <Text style={styles.followBtnText}>🧭</Text>
        </TouchableOpacity>
      </View>

      {/* Stats HUD */}
      {started && (
        <View style={[styles.statsHud, { top: insets.top + 70 }]}>
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{formatDist(nav.distanceLeft)}</Text>
            <Text style={styles.hudLabel}>restante</Text>
          </View>
          <View style={styles.hudDivider} />
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{((nav.speed ?? 0) * 3.6).toFixed(1)}</Text>
            <Text style={styles.hudLabel}>km/h</Text>
          </View>
          <View style={styles.hudDivider} />
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{formatDist(nav.distanceDone)}</Text>
            <Text style={styles.hudLabel}>recorrido</Text>
          </View>
        </View>
      )}

      {/* Progress bar */}
      {started && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any }]} />
        </View>
      )}

      {/* Bottom panel */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]}>
        {!started ? (
          <>
            <View style={styles.routeSummary}>
              <Text style={styles.routeStat}>📏 {formatDist(totalDist)}</Text>
              {track && <Text style={styles.routeStat}>⛰ +{Math.round(track.totalElevationGain)} m</Text>}
            </View>
            <TouchableOpacity style={styles.startBtn} onPress={startNavigation} activeOpacity={0.85}>
              <Text style={styles.startBtnText}>▶  Iniciar navegación</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={stopNavigation} activeOpacity={0.85}>
            <Text style={styles.stopBtnText}>⏹  Finalizar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.mapBg },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 10,
    backgroundColor: 'rgba(13,43,30,0.88)',
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16 },
  topBarCenter: { flex: 1 },
  trackName: { ...TYPE.h3, color: '#fff', fontSize: 15 },
  elapsedText: { ...TYPE.caption, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  followBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  followBtnActive: { backgroundColor: COLORS.primary },
  followBtnText: { fontSize: 18 },

  statsHud: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14, padding: 14, gap: 0,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  hudStat: { flex: 1, alignItems: 'center' },
  hudValue: { ...TYPE.h3, color: COLORS.text },
  hudLabel: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  hudDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  progressBar: {
    position: 'absolute', bottom: 110, left: 0, right: 0,
    height: 3, backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressFill: { height: 3, backgroundColor: COLORS.primary },

  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  routeSummary: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 14 },
  routeStat: { ...TYPE.body, color: COLORS.text },
  startBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  startBtnText: { ...TYPE.h3, color: '#fff', fontSize: 16 },
  stopBtn: {
    backgroundColor: COLORS.danger + '15', borderWidth: 1.5, borderColor: COLORS.danger,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  stopBtnText: { ...TYPE.h3, color: COLORS.danger, fontSize: 16 },
});
