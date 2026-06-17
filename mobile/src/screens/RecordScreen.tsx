import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/api/client';
import { useTripStore } from '@/store/tripStore';
import type { Trip } from '@/types';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

const BG_TASK = 'trek-gps-recording';

type RecordState = 'idle' | 'recording' | 'paused' | 'done';
type ActivityType = 'hiking' | 'cycling' | 'mountain_biking' | 'running';

const ACTIVITIES: { type: ActivityType; icon: string; label: string }[] = [
  { type: 'hiking', icon: '🥾', label: 'Senderismo' },
  { type: 'cycling', icon: '🚴', label: 'Ciclismo' },
  { type: 'mountain_biking', icon: '🚵', label: 'MTB' },
  { type: 'running', icon: '🏃', label: 'Running' },
];

export interface RecordedPoint {
  lat: number;
  lng: number;
  ele: number | null;
  time: string;
  speed: number | null;
}

interface PhotoWaypoint {
  lat: number;
  lng: number;
  time: string;
  uri: string;
}

// Module-level bridge between background task and React component
let _pts: RecordedPoint[] = [];
let _photos: PhotoWaypoint[] = [];
let _onNewPoint: ((pt: RecordedPoint) => void) | null = null;

TaskManager.defineTask(BG_TASK, ({ data, error }: any) => {
  if (error || !data?.locations) return;
  for (const loc of data.locations as Location.LocationObject[]) {
    const pt: RecordedPoint = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      ele: loc.coords.altitude,
      time: new Date(loc.timestamp).toISOString(),
      speed: loc.coords.speed,
    };
    _pts.push(pt);
    _onNewPoint?.(pt);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function buildMapHtml(initLat = 40.4168, initLng = -3.7038): string {
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
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${initLat},${initLng}],16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var coords=[];
var polyline=L.polyline(coords,{color:'${COLORS.primary}',weight:5}).addTo(map);
var userMarker=L.circleMarker([${initLat},${initLng}],{radius:10,fillColor:'#2563EB',color:'#fff',weight:3,fillOpacity:1}).addTo(map);
window.addEventListener('message',function(e){
  var d=JSON.parse(e.data);
  if(d.type==='locate'){
    map.setView([d.lat,d.lng],16);
    userMarker.setLatLng([d.lat,d.lng]);
  }
  if(d.type==='point'){
    coords.push([d.lat,d.lng]);
    polyline.setLatLngs(coords);
    userMarker.setLatLng([d.lat,d.lng]);
    map.setView([d.lat,d.lng],16);
  }
  if(d.type==='reset'){
    coords=[];polyline.setLatLngs(coords);
  }
});
</script>
</body></html>`;
}

function buildGpx(points: RecordedPoint[], photos: PhotoWaypoint[], name: string, activityType: ActivityType = 'hiking'): string {
  const wpts = photos.map((w, i) =>
    `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">\n    <name>Foto ${i + 1}</name>\n    <time>${w.time}</time>\n  </wpt>`
  ).join('\n');
  const trkpts = points.map((p) => {
    const ele = p.ele != null ? `\n        <ele>${p.ele.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}\n        <time>${p.time}</time>\n      </trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trek Mobile" xmlns="http://www.topografix.com/GPX/1/1">
${wpts ? wpts + '\n' : ''}  <trk>
    <name>${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</name>
    <type>${activityType}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function RecordScreen() {
  const insets = useSafeAreaInsets();
  const { trips, fetchTrips } = useTripStore();

  const [state, setState] = useState<RecordState>('idle');
  const [activityType, setActivityType] = useState<ActivityType>('hiking');
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [trackName, setTrackName] = useState('');
  const [distanceM, setDistanceM] = useState(0);
  const [elevGain, setElevGain] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mapHtml, setMapHtml] = useState('');
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);

  const webViewRef = useRef<WebView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const pausedMsRef = useRef(0);
  const lastEleRef = useRef<number | null>(null);
  const distRef = useRef(0);
  const gainRef = useRef(0);

  useEffect(() => {
    fetchTrips();
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMapHtml(buildMapHtml(loc.coords.latitude, loc.coords.longitude));
        } catch {
          setMapHtml(buildMapHtml());
        }
      } else {
        setMapHtml(buildMapHtml());
      }
    })();
    return () => {
      _onNewPoint = null;
      stopTimer();
      Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
    };
  }, []);

  const startTimer = () => {
    startTimeRef.current = Date.now() - pausedMsRef.current;
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    pausedMsRef.current = Date.now() - startTimeRef.current;
  };

  const handleNewPoint = useCallback((pt: RecordedPoint) => {
    const prev = _pts[_pts.length - 2]; // -1 is current pt, -2 is previous
    if (prev) {
      const d = haversineM(prev.lat, prev.lng, pt.lat, pt.lng);
      distRef.current += d;
      setDistanceM(distRef.current);
      if (pt.ele != null && lastEleRef.current != null && pt.ele > lastEleRef.current) {
        gainRef.current += pt.ele - lastEleRef.current;
        setElevGain(gainRef.current);
      }
    }
    if (pt.ele != null) lastEleRef.current = pt.ele;
    if (pt.speed != null) setSpeed(pt.speed);
    webViewRef.current?.postMessage(JSON.stringify({ type: 'point', lat: pt.lat, lng: pt.lng }));
  }, []);

  const startRecording = useCallback(async () => {
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert('Permiso denegado', 'Se necesita acceso a la ubicación.');
      return;
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert('Permiso de fondo denegado', 'Para grabar con la pantalla apagada activa "Permitir siempre" en ajustes de ubicación.');
    }

    _pts = [];
    _photos = [];
    distRef.current = 0;
    gainRef.current = 0;
    lastEleRef.current = null;
    pausedMsRef.current = 0;
    _onNewPoint = handleNewPoint;

    setDistanceM(0);
    setElevGain(0);
    setElapsedMs(0);
    setState('recording');
    startTimer();

    webViewRef.current?.postMessage(JSON.stringify({ type: 'reset' }));
    // Center on current position immediately
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      webViewRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: loc.coords.latitude, lng: loc.coords.longitude }));
    } catch {}

    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 3000,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Trek Wanderer',
        notificationBody: 'Grabando tu ruta GPS…',
        notificationColor: COLORS.primary,
      },
    });
  }, [handleNewPoint]);

  const pause = async () => {
    await Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
    _onNewPoint = null;
    stopTimer();
    setState('paused');
  };

  const resume = useCallback(async () => {
    _onNewPoint = handleNewPoint;
    setState('recording');
    startTimer();
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 3000,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Trek Wanderer',
        notificationBody: 'Grabando tu ruta GPS…',
        notificationColor: COLORS.primary,
      },
    });
  }, [handleNewPoint]);

  const stop = async () => {
    await Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
    _onNewPoint = null;
    stopTimer();
    const now = new Date();
    setTrackName(`Ruta ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`);
    setState('done');
  };

  const save = async () => {
    if (!selectedTrip) { Alert.alert('Selecciona un viaje', 'Elige a qué viaje añadir la ruta.'); return; }
    if (_pts.length < 2) { Alert.alert('Ruta muy corta', 'Necesitas al menos 2 puntos grabados.'); return; }
    setSaving(true);
    try {
      const gpx = buildGpx(_pts, _photos, trackName || 'Ruta grabada', activityType);
      const path = `${FileSystem.cacheDirectory}trek_track.gpx`;
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });
      const formData = new FormData();
      formData.append('gpx', { uri: path, type: 'application/gpx+xml', name: 'trek_track.gpx' } as any);
      await api.post(`/api/trips/${selectedTrip.id}/gpx/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('¡Guardado!', `Ruta añadida al viaje "${selectedTrip.name}".`, [
        { text: 'OK', onPress: () => { _pts = []; setState('idle'); setDistanceM(0); setElevGain(0); setElapsedMs(0); } },
      ]);
    } catch (e: any) {
      Alert.alert('Error al guardar', e?.response?.data?.error ?? e?.message ?? 'Error desconocido');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    Alert.alert('Descartar ruta', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => { _pts = []; setState('idle'); setDistanceM(0); setElevGain(0); setElapsedMs(0); } },
    ]);
  };

  // These hooks MUST be declared before any early returns (Rules of Hooks)
  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permiso denegado', 'Se necesita acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    const current = _pts[_pts.length - 1];
    if (current) {
      _photos.push({ lat: current.lat, lng: current.lng, time: new Date().toISOString(), uri });
    }
    setLastPhoto(uri);
    setTimeout(() => setLastPhoto(null), 3000);
  }, []);

  const reCenter = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      webViewRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: loc.coords.latitude, lng: loc.coords.longitude }));
    } catch {}
  }, []);

  // ── Idle ─────────────────────────────────────────────────────────────────
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
            <Text style={styles.recordCardSub}>Funciona con pantalla apagada</Text>
          </View>

          <Text style={styles.sectionLabel}>TIPO DE ACTIVIDAD</Text>
          <View style={styles.activityRow}>
            {ACTIVITIES.map((a) => (
              <TouchableOpacity
                key={a.type}
                style={[styles.activityBtn, activityType === a.type && styles.activityBtnActive]}
                onPress={() => setActivityType(a.type)}
                activeOpacity={0.75}
              >
                <Text style={styles.activityIcon}>{a.icon}</Text>
                <Text style={[styles.activityLabel, activityType === a.type && styles.activityLabelActive]}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
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

  // ── Done ─────────────────────────────────────────────────────────────────
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
                  <Text style={styles.summaryValue}>{`+${Math.round(elevGain)} m`}</Text>
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
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.startBtnText}>{'💾  Guardar ruta'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.discardBtn} onPress={discard} activeOpacity={0.8}>
              <Text style={styles.discardBtnText}>Descartar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Recording / Paused ───────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHtml || buildMapHtml() }}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.recordingDot, state === 'paused' && styles.recordingDotPaused]} />
        <Text style={styles.topBarTitle}>{state === 'paused' ? 'En pausa' : 'Grabando…'}</Text>
        <Text style={styles.topBarTime}>{formatTime(elapsedMs)}</Text>
      </View>

      <View style={[styles.hud, { top: insets.top + 70 }]}>
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>{formatDist(distanceM)}</Text>
          <Text style={styles.hudLabel}>distancia</Text>
        </View>
        <View style={styles.hudDiv} />
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>{`${(speed * 3.6).toFixed(1)}`}</Text>
          <Text style={styles.hudLabel}>km/h</Text>
        </View>
        <View style={styles.hudDiv} />
        <View style={styles.hudStat}>
          <Text style={styles.hudValue}>{`+${Math.round(elevGain)} m`}</Text>
          <Text style={styles.hudLabel}>desnivel</Text>
        </View>
      </View>

      {/* Side buttons */}
      <TouchableOpacity style={[styles.sideBtn, { top: insets.top + 70 + 80 }]} onPress={reCenter} activeOpacity={0.8}>
        <Text style={styles.sideBtnText}>◎</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.sideBtn, { top: insets.top + 70 + 136 }]} onPress={takePhoto} activeOpacity={0.8}>
        <Text style={styles.sideBtnText}>📷</Text>
      </TouchableOpacity>

      {/* Photo flash confirmation */}
      {lastPhoto && (
        <Image source={{ uri: lastPhoto }} style={[styles.photoThumb, { top: insets.top + 70 + 192 }]} />
      )}

      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        {state === 'recording' ? (
          <TouchableOpacity style={styles.pauseBtn} onPress={pause} activeOpacity={0.85}>
            <Text style={styles.pauseBtnText}>{'⏸  Pausar'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.pauseBtn} onPress={resume} activeOpacity={0.85}>
            <Text style={styles.pauseBtnText}>{'▶  Continuar'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.stopBtn} onPress={stop} activeOpacity={0.85}>
          <Text style={styles.stopBtnText}>{'⏹  Finalizar'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },
  header: {
    paddingHorizontal: 20, paddingBottom: 16, paddingTop: 10,
    backgroundColor: COLORS.bg,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  headerTitle: { ...TYPE.h2, color: COLORS.textInverse },
  idleContent: { padding: 20 },
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
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 10,
    backgroundColor: 'rgba(13,43,30,0.88)',
  },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
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
  pauseBtn: { backgroundColor: COLORS.bg, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  pauseBtnText: { ...TYPE.h3, color: COLORS.primary, fontSize: 15 },
  stopBtn: {
    backgroundColor: `${COLORS.danger}15`, borderWidth: 1.5, borderColor: COLORS.danger,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  stopBtnText: { ...TYPE.h3, color: COLORS.danger, fontSize: 15 },
  sideBtn: {
    position: 'absolute', right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  sideBtnText: { fontSize: 20, color: COLORS.primaryDark },
  photoThumb: {
    position: 'absolute', right: 16,
    width: 60, height: 60, borderRadius: 10,
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
  },
  activityRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  activityBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  activityBtnActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}12` },
  activityIcon: { fontSize: 22, marginBottom: 4 },
  activityLabel: { ...TYPE.caption, color: COLORS.textMuted, fontSize: 10 },
  activityLabelActive: { color: COLORS.primaryDark, fontWeight: '700' },
});
