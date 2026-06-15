import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import MapLibreGL, {
  MapView, Camera, ShapeSource, LineLayer, CircleLayer, SymbolLayer,
  RasterSource, RasterLayer,
} from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { getGpxPoints, getTripDays } from '@/api/trips';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

MapLibreGL.setAccessToken(null);

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'DayMap'>;

interface TrackGeoJSON {
  trackId: number;
  name: string;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
  bounds: [number, number, number, number];
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

function boundsFromCoords(coords: [number, number][]): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function DayMapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { tripId, dayId } = route.params;

  const { tracks, currentTrip } = useTripStore();
  const [trackFeatures, setTrackFeatures] = useState<TrackGeoJSON[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<TrackGeoJSON | null>(null);
  const cameraRef = useRef<Camera>(null);

  const filteredTracks = dayId
    ? tracks.filter((t) => t.dayId === dayId || !t.dayId)
    : tracks;

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation([loc.coords.longitude, loc.coords.latitude]);
      }

      const features: TrackGeoJSON[] = [];
      for (const track of filteredTracks) {
        try {
          const points = await getGpxPoints(tripId, track.id);
          if (points.length < 2) continue;
          const coords: [number, number][] = points.map((p) => [p.lng, p.lat]);
          features.push({
            trackId: track.id,
            name: track.trackName,
            geojson: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: { trackId: track.id, name: track.trackName },
            },
            bounds: boundsFromCoords(coords),
          });
        } catch {}
      }

      setTrackFeatures(features);
      setLoading(false);

      if (features.length > 0) {
        const all = features.flatMap((f) => f.geojson.geometry.coordinates as [number, number][]);
        const bounds = boundsFromCoords(all);
        setTimeout(() => {
          cameraRef.current?.fitBounds(
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
            60,
            600
          );
        }, 800);
      }
    })();
  }, [tripId, filteredTracks.map((t) => t.id).join(',')]);

  const handleNavigate = (tf: TrackGeoJSON) => {
    const track = tracks.find((t) => t.id === tf.trackId);
    if (track) navigation.navigate('Navigate', { tripId, trackId: track.id });
  };

  const centerOnUser = async () => {
    if (userLocation) {
      cameraRef.current?.setCamera({ centerCoordinate: userLocation, zoomLevel: 14, animationDuration: 600 });
    }
  };

  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFill} styleJSON={JSON.stringify(OSM_STYLE)} compassEnabled compassViewPosition={3}>
        <Camera ref={cameraRef} zoomLevel={10} />

        {userLocation && (
          <ShapeSource id="user-loc" shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: userLocation }, properties: {} }}>
            <CircleLayer id="user-dot" style={{ circleRadius: 8, circleColor: '#2563EB', circleStrokeColor: '#fff', circleStrokeWidth: 2 }} />
          </ShapeSource>
        )}

        {trackFeatures.map((tf, i) => (
          <ShapeSource key={tf.trackId} id={`track-${tf.trackId}`} shape={tf.geojson}>
            <LineLayer
              id={`track-line-${tf.trackId}`}
              style={{
                lineColor: i === 0 ? COLORS.primary : ['#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'][i % 4],
                lineWidth: 4,
                lineOpacity: selectedTrack && selectedTrack.trackId !== tf.trackId ? 0.4 : 1,
              }}
            />
          </ShapeSource>
        ))}
      </MapView>

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {currentTrip?.name ?? 'Mapa'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      )}

      {/* User location button */}
      <TouchableOpacity style={[styles.fabLocation, { bottom: insets.bottom + 160 }]} onPress={centerOnUser}>
        <Text style={styles.fabIcon}>📍</Text>
      </TouchableOpacity>

      {/* Track list bottom sheet */}
      {trackFeatures.length > 0 && (
        <View style={[styles.trackSheet, { paddingBottom: insets.bottom + 8 }]}>
          {trackFeatures.map((tf, i) => (
            <TouchableOpacity
              key={tf.trackId}
              style={styles.trackRow}
              onPress={() => handleNavigate(tf)}
              activeOpacity={0.8}
            >
              <View style={[styles.trackColorBar, { backgroundColor: i === 0 ? COLORS.primary : ['#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'][i % 4] }]} />
              <View style={styles.trackRowInfo}>
                <Text style={styles.trackRowName} numberOfLines={1}>{tf.name}</Text>
              </View>
              <View style={styles.trackNavBtn}>
                <Text style={styles.trackNavBtnText}>▶ Navegar</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingBottom: 10, gap: 10,
    backgroundColor: 'rgba(13,43,30,0.85)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontSize: 24, lineHeight: 28, marginTop: -2 },
  headerTitle: { ...TYPE.h3, color: '#fff', flex: 1, textAlign: 'center' },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },

  fabLocation: {
    position: 'absolute', right: 16,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  fabIcon: { fontSize: 22 },

  trackSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingHorizontal: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
    gap: 8,
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
  },
  trackColorBar: { width: 4, height: 36, borderRadius: 2 },
  trackRowInfo: { flex: 1 },
  trackRowName: { ...TYPE.label, color: COLORS.text },
  trackNavBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  trackNavBtnText: { ...TYPE.caption, color: '#fff', fontWeight: '700' },
});
