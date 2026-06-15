import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as Location from 'expo-location';
import { getGpxPoints } from '@/api/trips';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';
import { ElevationChart, ElevPoint } from '@/components/ElevationChart';
import {
  checkVoiceAnnouncements, resetVoiceState, setVoiceMuted, isVoiceMuted,
} from '@/utils/voiceNavigation';
import { hasCachedTiles, getTilesDir } from '@/utils/offlineTiles';

type Route = RouteProp<RootStackParamList, 'Navigate'>;

interface GpxPoint { lat: number; lng: number; ele?: number }
interface Highlight { lat: number; lng: number; label: string }

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function findNearest(points: GpxPoint[], lat: number, lng: number, from: number): number {
  let best = from;
  let bestDist = Infinity;
  const end = Math.min(from + 50, points.length);
  for (let i = from; i < end; i++) {
    const d = haversineM(lat, lng, points[i].lat, points[i].lng);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function formatDist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`; }
function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function buildNavHtml(points: GpxPoint[], nearestIdx: number, tilesDir = ''): string {
  const fullCoords = JSON.stringify(points.map((p) => [p.lat, p.lng]));
  const doneCoords = JSON.stringify(points.slice(0, nearestIdx + 1).map((p) => [p.lat, p.lng]));
  const center = points[0] ?? { lat: 40.4168, lng: -3.7038 };
  const escapedDir = tilesDir.replace(/'/g, "\\'");
  const tileLayerJs = `
var TILES_DIR='${escapedDir}';
var HybridTile=L.TileLayer.extend({createTile:function(c,done){
  var t=document.createElement('img');t.setAttribute('role','presentation');
  var local=TILES_DIR?TILES_DIR+c.z+'/'+c.x+'/'+c.y+'.png':null;
  var remote='https://tile.openstreetmap.org/'+c.z+'/'+c.x+'/'+c.y+'.png';
  var usedR=false;
  t.onload=function(){done(null,t);};
  t.onerror=function(){if(!usedR){usedR=true;t.src=remote;}else{done(new Error(),t);}};
  t.src=local||remote;return t;
}});
new HybridTile('',{maxZoom:19}).addTo(map);`;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;}
.hl-icon{font-size:20px;line-height:1;}</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${center.lat},${center.lng}],14);
${tileLayerJs}
var full=${fullCoords};
var done=${doneCoords};
if(full.length>1)L.polyline(full,{color:'#D1FAE5',weight:5,opacity:0.7}).addTo(map);
if(done.length>1)L.polyline(done,{color:'${COLORS.primary}',weight:5}).addTo(map);
var userMarker=null;
var hlCount=0;
function updateUser(lat,lng){
  if(userMarker)map.removeLayer(userMarker);
  userMarker=L.circleMarker([lat,lng],{radius:10,fillColor:'#2563EB',color:'#fff',weight:3,fillOpacity:1}).addTo(map);
  map.setView([lat,lng],15);
}
window.addEventListener('message',function(e){
  var d=JSON.parse(e.data);
  if(d.type==='location')updateUser(d.lat,d.lng);
  if(d.type==='update'){
    if(done.length>1){map.eachLayer(function(l){if(l._latlngs&&l.options.color==='${COLORS.primary}')map.removeLayer(l);});}
    done=d.done;
    if(done.length>1)L.polyline(done,{color:'${COLORS.primary}',weight:5}).addTo(map);
  }
  if(d.type==='highlight'){
    hlCount++;
    var ico=L.divIcon({html:'<span class="hl-icon">📌</span>',iconSize:[24,24],iconAnchor:[12,24],className:''});
    L.marker([d.lat,d.lng],{icon:ico}).addTo(map)
     .bindPopup(d.label||('Punto '+hlCount)).openPopup();
  }
});
</script>
</body>
</html>`;
}

export function NavigationScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { tripId, trackId } = route.params;
  const { tracks } = useTripStore();
  const track = tracks.find((t) => t.id === trackId);

  const { width: screenWidth } = useWindowDimensions();
  const [points, setPoints] = useState<GpxPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [nearestIdx, setNearestIdx] = useState(0);
  const [distanceDone, setDistanceDone] = useState(0);
  const [distanceLeft, setDistanceLeft] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [totalDist, setTotalDist] = useState(0);
  const [htmlContent, setHtmlContent] = useState('');
  const [muted, setMuted] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  const webViewRef = useRef<WebView>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const nearestIdxRef = useRef(0);
  const lastLatRef = useRef<number | null>(null);
  const lastLngRef = useRef<number | null>(null);
  const tilesDirRef = useRef('');

  useEffect(() => {
    (async () => {
      try {
        const [pts, hasOffline] = await Promise.all([
          getGpxPoints(tripId, trackId),
          hasCachedTiles(),
        ]);
        const tDir = hasOffline ? getTilesDir() : '';
        tilesDirRef.current = tDir;
        setPoints(pts);
        setTotalDist(totalTrackDistance(pts));
        setDistanceLeft(totalTrackDistance(pts));
        setHtmlContent(buildNavHtml(pts, 0, tDir));
      } catch {}
      setLoading(false);
    })();
    return () => {
      locationSub.current?.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tripId, trackId]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      setVoiceMuted(!prev);
      return !prev;
    });
  }, []);

  const markHighlight = useCallback(() => {
    const lat = lastLatRef.current;
    const lng = lastLngRef.current;
    if (lat == null || lng == null) return;
    const label = `Punto ${highlights.length + 1}`;
    setHighlights((prev) => [...prev, { lat, lng, label }]);
    webViewRef.current?.postMessage(JSON.stringify({ type: 'highlight', lat, lng, label }));
  }, [highlights.length]);

  const startNavigation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    setStarted(true);
    resetVoiceState();
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 1000);

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1500, distanceInterval: 3 },
      (loc) => {
        const { latitude: lat, longitude: lng, speed: spd } = loc.coords;
        lastLatRef.current = lat;
        lastLngRef.current = lng;
        setSpeed(spd ?? 0);
        webViewRef.current?.postMessage(JSON.stringify({ type: 'location', lat, lng }));
        setPoints((prev) => {
          const idx = findNearest(prev, lat, lng, Math.max(0, nearestIdxRef.current - 2));
          nearestIdxRef.current = idx;
          setNearestIdx(idx);
          const done = distanceFromStart(prev, idx);
          setDistanceDone(done);
          setDistanceLeft(totalDist - done);
          checkVoiceAnnouncements(done, totalDist);
          const doneCoords = prev.slice(0, idx + 1).map((p) => [p.lat, p.lng]);
          webViewRef.current?.postMessage(JSON.stringify({ type: 'update', done: doneCoords }));
          return prev;
        });
      }
    );
  }, [totalDist]);

  const stop = () => {
    locationSub.current?.remove();
    if (timerRef.current) clearInterval(timerRef.current);
    navigation.goBack();
  };

  const progressPct = totalDist > 0 ? (distanceDone / totalDist) * 100 : 0;

  const elevPoints = useMemo<ElevPoint[]>(() => {
    if (points.length < 2) return [];
    let d = 0;
    const result: ElevPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0) d += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      if (points[i].ele != null) result.push({ dist: d, ele: points[i].ele! });
    }
    return result;
  }, [points]);

  const hasOfflineTiles = tilesDirRef.current !== '';

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
      {htmlContent ? (
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent, baseUrl: hasOfflineTiles ? getTilesDir() : undefined }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          allowFileAccess={hasOfflineTiles}
          allowUniversalAccessFromFileURLs={hasOfflineTiles}
          mixedContentMode={hasOfflineTiles ? 'always' : 'never'}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.mapBg }]} />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeBtn} onPress={stop}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.topCenter}>
          <Text style={styles.trackName} numberOfLines={1}>{track?.trackName ?? 'Ruta'}</Text>
          {started && <Text style={styles.elapsed}>{formatTime(elapsedMs)}</Text>}
        </View>
        <TouchableOpacity style={styles.muteBtn} onPress={toggleMute}>
          <Text style={styles.muteBtnText}>{muted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
      </View>

      {/* Stats HUD */}
      {started && (
        <View style={[styles.hud, { top: insets.top + 70 }]}>
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{formatDist(distanceLeft)}</Text>
            <Text style={styles.hudLabel}>restante</Text>
          </View>
          <View style={styles.hudDiv} />
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{(speed * 3.6).toFixed(1)}</Text>
            <Text style={styles.hudLabel}>km/h</Text>
          </View>
          <View style={styles.hudDiv} />
          <View style={styles.hudStat}>
            <Text style={styles.hudValue}>{formatDist(distanceDone)}</Text>
            <Text style={styles.hudLabel}>recorrido</Text>
          </View>
        </View>
      )}

      {/* Mark highlight button (floating, during navigation) */}
      {started && (
        <TouchableOpacity
          style={[styles.hlBtn, { top: insets.top + 70 + 80 }]}
          onPress={markHighlight}
          activeOpacity={0.8}
        >
          <Text style={styles.hlBtnText}>📌</Text>
        </TouchableOpacity>
      )}

      {/* Highlight count badge */}
      {started && highlights.length > 0 && (
        <View style={[styles.hlBadge, { top: insets.top + 70 + 80 }]}>
          <Text style={styles.hlBadgeText}>{highlights.length}</Text>
        </View>
      )}

      {/* Progress bar */}
      {started && (
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any }]} />
        </View>
      )}

      {/* Bottom panel */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {elevPoints.length > 1 && (
          <View style={styles.elevStrip}>
            <ElevationChart
              points={elevPoints}
              width={screenWidth - 40}
              height={60}
              currentDist={started ? distanceDone : undefined}
              compact={false}
            />
          </View>
        )}
        {!started ? (
          <>
            <View style={styles.routeRow}>
              <Text style={styles.routeStat}>{`📏 ${formatDist(totalDist)}`}</Text>
              {track ? <Text style={styles.routeStat}>{`⛰ +${Math.round(track.totalElevationGain)} m`}</Text> : null}
            </View>
            <TouchableOpacity style={styles.startBtn} onPress={startNavigation} activeOpacity={0.85}>
              <Text style={styles.startBtnText}>▶  Iniciar navegación</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={stop} activeOpacity={0.85}>
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
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { color: '#fff', fontSize: 16 },
  topCenter: { flex: 1 },
  trackName: { ...TYPE.h3, color: '#fff', fontSize: 15 },
  elapsed: { ...TYPE.caption, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  muteBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  muteBtnText: { fontSize: 16 },
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
  hlBtn: {
    position: 'absolute', right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  hlBtnText: { fontSize: 22 },
  hlBadge: {
    position: 'absolute', right: 10,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
  },
  hlBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  progressBg: { position: 'absolute', bottom: 110, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: 3, backgroundColor: COLORS.primary },
  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  elevStrip: { marginBottom: 10, marginTop: -4 },
  routeRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 14 },
  routeStat: { ...TYPE.body, color: COLORS.text },
  startBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  startBtnText: { ...TYPE.h3, color: '#fff', fontSize: 16 },
  stopBtn: { backgroundColor: COLORS.danger + '15', borderWidth: 1.5, borderColor: COLORS.danger, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  stopBtnText: { ...TYPE.h3, color: COLORS.danger, fontSize: 16 },
});
