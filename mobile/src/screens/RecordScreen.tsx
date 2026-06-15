import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { api } from '@/api/client';
import { useTripStore } from '@/store/tripStore';
import type { Trip } from '@/types';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

type RecordState = 'idle' | 'recording' | 'paused' | 'done';

interface RecordedPoint {
  lat: number;
  lng: number;
  ele: number | null;
  time: string;
  speed: number | null;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function buildMapHtml(pts: RecordedPoint[]): string {
  const coords = JSON.stringify(pts.map((p) => [p.lat, p.lng]));
  const center = pts.length > 0 ? pts[pts.length - 1] : { lat: 40.4168, lng: -3.7038 };
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head>
<body><div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${center.lat},${center.lng}],16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var coords=${coords};
var polyline=L.polyline(coords,{color:'${COLORS.primary}',weight:5}).addTo(map);
var marker=null;
if(coords.length>0){
  var last=coords[coords.length-1];
  marker=L.circleMarker(last,{radius:10,fillColor:'#2563EB',color:'#fff',weight:3,fillOpacity:1}).addTo(map);
}
window.addEventListener('message',function(e){
  var d=JSON.parse(e.data);
  if(d.type==='point'){
    coords.push([d.lat,d.lng]);
    polyline.setLatLngs(coords);
    if(marker)map.removeLayer(marker);
    marker=L.circleMarker([d.lat,d.lng],{radius:10,fillColor:'#2563EB',color:'#fff',weight:3,fillOpacity:1}).addTo(map);
    map.setView([d.lat,d.lng],16);
  }
});
</script>
</body></html>`;
}

function buildGpx(points: RecordedPoint[], name: string): string {
  const trkpts = points.map((p) => {
    const ele = p.ele != null ? `\n        <ele>${p.ele.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}\n        <time>${p.time}</time>\n      </trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trek Mobile" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function RecordScreen() {
  const insets = useSafeAreaInsets();
  const { trips, fetchTrips } = useTripStore();

  const [state, setState] = useState<RecordState>('idle');
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [trackName, setTrackName] = useState('');
  const [points, setPoints] = useState<RecordedPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [elevGain, setElevGain] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');

  const webViewRef = useRef<WebView>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const pausedMs = useRef(0);
  const lastEle = useRef<number | null>(null);
  const pointsRef = useRef<RecordedPoint[]>([]);
  const distRef = useRef(0);
  const gainRef = useRef(0);

  useEffect(() => {
    fetchTrips();
    return () => {
      locationSub.current?.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    startTimeRef.current = Date.now() - pausedMs.current;
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    pausedMs.current = Date.now() - startTimeRef.current;
  };

  const startRecording = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso denegado', 'Se necesita acceso a la ubicación para grabar la ruta.');
      return;
    }
    pointsRef.current = [];
    distRef.current = 0;
    gainRef.current = 0;
    lastEle.current = null;
    pausedMs.current = 0;
    setPoints([]);
    setDistanceM(0);
    setElevGain(0);
    setElapsedMs(0);
    setHtmlContent(buildMapHtml([]));
    setState('recording');
    startTimer();

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
      (loc) => {
        const { latitude: lat, longitude: lng, altitude: ele, speed: spd } = loc.coords;
        setSpeed(spd ?? 0);
        const pt: RecordedPoint = { lat, lng, ele, time: new Date(loc.timestamp).toISOString(), speed: spd };

        const prev = pointsRef.current[pointsRef.current.length - 1];
        if (prev) {
          distRef.current += haversineM(prev.lat, prev.lng, lat, lng);
          setDistanceM(distRef.current);
          if (ele != null && lastEle.current != null && ele > lastEle.current) {
            gainRef.current += ele - lastEle.current;
            setElevGain(gainRef.current);
          }
        }
        if (ele != null) lastEle.current = ele;

        pointsRef.current = [...pointsRef.current, pt];
        setPoints(pointsRef.current);
        webViewRef.current?.postMessage(JSON.stringify({ type: 'point', lat, lng }));
      }
    );
  }, []);

  const pause = () => {
    locationSub.current?.remove();
    locationSub.current = null;
    stopTimer();
    setState('paused');
  };

  const resume = useCallback(async () => {
    setState('recording');
    startTimer();
    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
      (loc) => {
        const { latitude: lat, longitude: lng, altitude: ele, speed: spd } = loc.coords;
        setSpeed(spd ?? 0);
        const pt: RecordedPoint = { lat, lng, ele, time: new Date(loc.timestamp).toISOString(), speed: spd };
        const prev = pointsRef.current[pointsRef.current.length - 1];
        if (prev) {
          distRef.current += haversineM(prev.lat, prev.lng, lat, lng);
          setDistanceM(distRef.current);
          if (ele != null && lastEle.current != null && ele > lastEle.current) {
            gainRef.current += ele - lastEle.current;
            setElevGain(gainRef.current);
          }
        }
        if (ele != null) lastEle.current = ele;
        pointsRef.current = [...pointsRef.current, pt];
        setPoints(pointsRef.current);
        webViewRef.current?.postMessage(JSON.stringify({ type: 'point', lat, lng }));
      }
    );
  }, []);

  const stop = () => {
    locationSub.current?.remove();
    locationSub.current = null;
    stopTimer();
    const now = new Date();
    const defaultName = `Ruta ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    setTrackName(defaultName);
    setState('done');
  };

  const save = async () => {
    if (!selectedTrip) { Alert.alert('Selecciona un viaje', 'Elige a qué viaje quieres añadir esta ruta.'); return; }
    if (pointsRef.current.length < 2) { Alert.alert('Ruta muy corta', 'Necesitas al menos 2 puntos grabados.'); return; }
    setSaving(true);
    try {
      const gpx = buildGpx(pointsRef.current, trackName || 'Ruta grabada');
      const path = `${FileSystem.cacheDirectory}trek_track.gpx`;
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });

      const formData = new FormData();
      formData.append('gpx', { uri: path, type: 'application/gpx+xml', name: 'trek_track.gpx' } as any);
      await api.post(`/api/trips/${selectedTrip.id}/gpx/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('¡Guardado!', `La ruta se ha añadido al viaje "${selectedTrip.name}".`, [
        { text: 'OK', onPress: () => { setState('idle'); setPoints([]); setDistanceM(0); setElevGain(0); setElapsedMs(0); } },
      ]);
    } catch (e: any) {
      Alert.alert('Error al guardar', e?.response?.data?.error ?? e?.message ?? 'Error desconocido');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    Alert.alert('Descartar ruta', '¿Seguro que quieres descartar la grabación?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => { setState('idle'); setPoints([]); setDistanceM(0); setElevGain(0); setElapsedMs(0); } },
    ]);
  };

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (state === 'idle') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Grabar ruta</Text>
        </View>
        <ScrollView contentContainerStyle={styles.idleContent}>
          <View style={styles.recordCard}>
            <Text style={styles.recordCardIcon}>📍</Text>
            <Text style={styles.recordCardTitle}>Nueva grabación GPS</Text>
            <Text style={styles.recordCardSub}>Graba tu ruta y guárdala en Trek</Text>
          </View>

          <Text style={styles.sectionLabel}>ASOCIAR A UN VIAJE (opcional)</Text>
          {trips.length === 0 ? (
            <Text style={styles.noTrips}>Sin viajes disponibles</Text>
          ) : (
            trips.map((trip) => (
              <TouchableOpacity
                key={trip.id}
                style={[styles.tripRow, selectedTrip?.id === trip.id && styles.tripRowSelected]}
                onPress={() => setSelectedTrip((prev) => prev?.id === trip.id ? null : trip)}
                activeOpacity={0.75}
              >
                <View style={[styles.tripDot, { backgroundColor: selectedTrip?.id === trip.id ? COLORS.primary : COLORS.border }]} />
                <Text style={styles.tripRowName} numberOfLines={1}>{trip.name}</Text>
                {selectedTrip?.id === trip.id && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity style={styles.startBtn} onPress={startRecording} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>⏺  Iniciar grabación</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (state === 'done') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Ruta grabada</Text>
          </View>
          <ScrollView contentContainerStyle={styles.idleContent} keyboardShouldPersistTaps="handled">
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{formatDist(distanceM)}</Text>
                  <Text style={styles.summaryLabel}>distancia</Text>
                </View>
                <View style={styles.summaryDiv} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{formatTime(elapsedMs)}</Text>
                  <Text style={styles.summaryLabel}>tiempo</Text>
                </View>
                <View style={styles.summaryDiv} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>+{Math.round(elevGain)} m</Text>
                  <Text style={styles.summaryLabel}>desnivel</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>NOMBRE DE LA RUTA</Text>
            <TextInput
              style={styles.nameInput}
              value={trackName}
              onChangeText={setTrackName}
              placeholder="Nombre de la ruta"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>GUARDAR EN VIAJE</Text>
            {trips.map((trip) => (
              <TouchableOpacity
                key={trip.id}
                style={[styles.tripRow, selectedTrip?.id === trip.id && styles.tripRowSelected]}
                onPress={() => setSelectedTrip(trip)}
                activeOpacity={0.75}
              >
                <View style={[styles.tripDot, { backgroundColor: selectedTrip?.id === trip.id ? COLORS.primary : COLORS.border }]} />
                <Text style={styles.tripRowName} numberOfLines={1}>{trip.name}</Text>
                {selectedTrip?.id === trip.id && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.startBtn, saving && { opacity: 0.6 }]}
              onPress={save}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.startBtnText}>💾  Guardar ruta</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.discardBtn} onPress={discard} activeOpacity={0.8}>
              <Text style={styles.discardBtnText}>Descartar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Recording / Paused ────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {htmlContent ? (
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.mapBg }]} />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.recordingDot, state === 'paused' && styles.recordingDotPaused]} />
        <Text style={styles.topBarTitle}>{state === 'paused' ? 'En pausa' : 'Grabando…'}</Text>
        <Text style={styles.topBarTime}>{formatTime(elapsedMs)}</Text>
      </View>

      {/* Stats HUD */}
      <View style={[styles.hud, { top: insets.top + 70 }]}>
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>{formatDist(distanceM)}</Text>
          <Text style={styles.hudLabel}>distancia</Text>
        </View>
        <View style={styles.hudDiv} />
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>{(speed * 3.6).toFixed(1)}</Text>
          <Text style={styles.hudLabel}>km/h</Text>
        </View>
        <View style={styles.hudDiv} />
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>+{Math.round(elevGain)} m</Text>
          <Text style={styles.hudLabel}>desnivel</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        {state === 'recording' ? (
          <TouchableOpacity style={styles.pauseBtn} onPress={pause} activeOpacity={0.85}>
            <Text style={styles.pauseBtnText}>⏸  Pausar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.pauseBtn} onPress={resume} activeOpacity={0.85}>
            <Text style={styles.pauseBtnText}>▶  Continuar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.stopBtn} onPress={stop} activeOpacity={0.85}>
          <Text style={styles.stopBtnText}>⏹  Finalizar</Text>
        </TouchableOpacity>
      </View>
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

  idleContent: { padding: 20, gap: 0 },

  recordCard: {
    backgroundColor: COLORS.bg, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 28,
  },
  recordCardIcon: { fontSize: 40, marginBottom: 8 },
  recordCardTitle: { ...TYPE.h3, color: '#fff', marginBottom: 4 },
  recordCardSub: { ...TYPE.body, color: 'rgba(255,255,255,0.6)' },

  sectionLabel: { ...TYPE.caption, color: COLORS.textMuted, marginBottom: 10, marginTop: 4, letterSpacing: 0.8 },
  noTrips: { ...TYPE.body, color: COLORS.textMuted, marginBottom: 16 },

  tripRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 12, padding: 14, marginBottom: 8, gap: 12,
    borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  tripRowSelected: { borderColor: COLORS.primary },
  tripDot: { width: 10, height: 10, borderRadius: 5 },
  tripRowName: { ...TYPE.label, color: COLORS.text, flex: 1 },
  checkmark: { fontSize: 16, color: COLORS.primary, fontWeight: '700' },

  startBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  startBtnText: { ...TYPE.h3, color: '#fff', fontSize: 16 },

  summaryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryValue: { ...TYPE.h3, color: COLORS.text },
  summaryLabel: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  summaryDiv: { width: 1, height: 40, backgroundColor: COLORS.border },

  nameInput: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: COLORS.text, marginBottom: 4,
  },

  discardBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  discardBtnText: { ...TYPE.label, color: COLORS.textMuted },

  // Recording map styles
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 10,
    backgroundColor: 'rgba(13,43,30,0.88)',
  },
  recordingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444',
  },
  recordingDotPaused: { backgroundColor: '#F59E0B' },
  topBarTitle: { ...TYPE.label, color: '#fff', flex: 1 },
  topBarTime: { ...TYPE.h3, color: '#fff', fontSize: 18 },

  hud: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, elevation: 6,
  },
  hudStat: { flex: 1, alignItems: 'center' },
  hudValue: { ...TYPE.h3, color: COLORS.text },
  hudLabel: { ...TYPE.caption, color: COLORS.textMuted, marginTop: 2 },
  hudDiv: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  pauseBtn: {
    backgroundColor: COLORS.bg, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  pauseBtnText: { ...TYPE.h3, color: COLORS.primary, fontSize: 15 },
  stopBtn: {
    backgroundColor: COLORS.danger + '15', borderWidth: 1.5, borderColor: COLORS.danger,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  stopBtnText: { ...TYPE.h3, color: COLORS.danger, fontSize: 15 },
});
