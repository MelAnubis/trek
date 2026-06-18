import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getGpxPoints } from '@/api/trips';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';
import { ElevationChart, ElevPoint } from '@/components/ElevationChart';
import {
  checkVoiceAnnouncements, resetVoiceState, setVoiceMuted, announceVoice,
} from '@/utils/voiceNavigation';
import { hasCachedTiles, getTilesDir } from '@/utils/offlineTiles';

type Route = RouteProp<RootStackParamList, 'Navigate'>;
type ViewMode = 'map' | 'elevation' | 'stats';

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

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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
  const [viewMode, setViewMode] = useState<ViewMode>('map');

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
    setMuted((prev) => { setVoiceMuted(!prev); return !prev; });
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

    // Announce navigation start
    const distText = totalDist >= 1000
      ? `${(totalDist / 1000).toFixed(1)} kilómetros`
      : `${Math.round(totalDist)} metros`;
    announceVoice(`Navegación iniciada. Distancia total: ${distText}`);

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
  const avgSpeedKmh = elapsedMs > 0 ? (distanceDone / (elapsedMs / 1000)) * 3.6 : 0;
  const etaMs = speed > 0.5 ? (distanceLeft / speed) * 1000 : 0;

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

  const elevStats = useMemo(() => {
    if (elevPoints.length === 0) return null;
    const eles = elevPoints.map((p) => p.ele);
    let gain = 0;
    for (let i = 1; i < elevPoints.length; i++) {
      const diff = elevPoints[i].ele - elevPoints[i - 1].ele;
      if (diff > 0) gain += diff;
    }
    return {
      min: Math.round(Math.min(...eles)),
      max: Math.round(Math.max(...eles)),
      gain: Math.round(gain),
    };
  }, [elevPoints]);

  const hasOfflineTiles = tilesDirRef.current !== '';

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[TYPE.body, { color: COLORS.textMuted, marginTop: 12 }]}>Cargando ruta...</Text>
      </View>
    );
  }

  const topBarHeight = insets.top + 56;

  return (
    <View style={styles.container}>

      {/* WebView — always mounted, hidden when not in map mode */}
      <View style={[StyleSheet.absoluteFill, viewMode !== 'map' && styles.hidden]}>
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
      </View>

      {/* Elevation view */}
      {viewMode === 'elevation' && (
        <View style={[styles.fullPanel, { paddingTop: topBarHeight }]}>
          <Text style={styles.panelTitle}>Perfil de elevacion</Text>
          {elevPoints.length > 1 ? (
            <>
              <ElevationChart
                points={elevPoints}
                width={screenWidth - 32}
                height={Math.round(screenHeight * 0.35)}
                currentDist={started ? distanceDone : undefined}
                compact={false}
              />
              {elevStats && (
                <View style={styles.elevStatRow}>
                  <View style={styles.elevStat}>
                    <Ionicons name="trending-up" size={18} color={COLORS.primary} />
                    <Text style={styles.elevStatVal}>{elevStats.gain} m</Text>
                    <Text style={styles.elevStatLbl}>desnivel +</Text>
                  </View>
                  <View style={styles.elevStat}>
                    <Ionicons name="arrow-up" size={18} color={COLORS.primary} />
                    <Text style={styles.elevStatVal}>{elevStats.max} m</Text>
                    <Text style={styles.elevStatLbl}>cota max</Text>
                  </View>
                  <View style={styles.elevStat}>
                    <Ionicons name="arrow-down" size={18} color='#9CA3AF' />
                    <Text style={styles.elevStatVal}>{elevStats.min} m</Text>
                    <Text style={styles.elevStatLbl}>cota min</Text>
                  </View>
                  {track && (
                    <View style={styles.elevStat}>
                      <Ionicons name="footsteps" size={18} color={COLORS.primary} />
                      <Text style={styles.elevStatVal}>{formatDist(totalDist)}</Text>
                      <Text style={styles.elevStatLbl}>distancia</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          ) : (
            <View style={styles.noData}>
              <Ionicons name="trending-up-outline" size={48} color='rgba(255,255,255,0.2)' />
              <Text style={styles.noDataText}>Sin datos de elevacion</Text>
            </View>
          )}
        </View>
      )}

      {/* Stats view */}
      {viewMode === 'stats' && (
        <ScrollView
          style={[styles.fullPanel, { paddingTop: topBarHeight }]}
          contentContainerStyle={{ paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.panelTitle}>Estadisticas</Text>
          <View style={styles.statsGrid}>
            <StatCard
              icon="walk"
              label="Recorrido"
              value={formatDist(distanceDone)}
              active={started}
            />
            <StatCard
              icon="flag"
              label="Restante"
              value={formatDist(distanceLeft)}
              active={started}
              highlight
            />
            <StatCard
              icon="speedometer"
              label="Velocidad"
              value={`${(speed * 3.6).toFixed(1)} km/h`}
              active={started}
            />
            <StatCard
              icon="pulse"
              label="Vel. media"
              value={started ? `${avgSpeedKmh.toFixed(1)} km/h` : '--'}
              active={started}
            />
            <StatCard
              icon="time"
              label="Tiempo"
              value={started ? formatTime(elapsedMs) : '--'}
              active={started}
            />
            <StatCard
              icon="navigate"
              label="ETA llegada"
              value={etaMs > 0 ? formatTime(etaMs) : '--'}
              active={started}
            />
            <StatCard
              icon="location"
              label="Marcadores"
              value={String(highlights.length)}
              active={started}
            />
            <StatCard
              icon="trending-up"
              label="Desnivel +"
              value={elevStats ? `+${elevStats.gain} m` : '--'}
              active={true}
            />
          </View>
        </ScrollView>
      )}

      {/* Map mode: Stats HUD */}
      {viewMode === 'map' && started && (
        <View style={[styles.hud, { top: topBarHeight + 8 }]}>
          <HudStat value={formatDist(distanceLeft)} label="restante" />
          <View style={styles.hudDiv} />
          <HudStat value={`${(speed * 3.6).toFixed(1)}`} label="km/h" />
          <View style={styles.hudDiv} />
          <HudStat value={formatDist(distanceDone)} label="recorrido" />
        </View>
      )}

      {/* Highlight button (map mode only) */}
      {viewMode === 'map' && started && (
        <View style={[styles.hlGroup, { top: topBarHeight + 8 + 72 }]}>
          <TouchableOpacity style={styles.hlBtn} onPress={markHighlight} activeOpacity={0.8}>
            <Ionicons name="location" size={20} color={COLORS.text} />
          </TouchableOpacity>
          {highlights.length > 0 && (
            <View style={styles.hlBadge}>
              <Text style={styles.hlBadgeText}>{highlights.length}</Text>
            </View>
          )}
        </View>
      )}

      {/* Progress bar */}
      {started && (
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any }]} />
        </View>
      )}

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={stop}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.topCenter}>
          <Text style={styles.trackName} numberOfLines={1}>{track?.trackName ?? 'Ruta'}</Text>
          {started && <Text style={styles.elapsed}>{formatTime(elapsedMs)}</Text>}
        </View>

        {/* View switcher */}
        <View style={styles.switcher}>
          <SwitchTab icon="map" mode="map" current={viewMode} onPress={setViewMode} />
          <SwitchTab icon="trending-up" mode="elevation" current={viewMode} onPress={setViewMode} />
          <SwitchTab icon="stats-chart" mode="stats" current={viewMode} onPress={setViewMode} />
        </View>

        <TouchableOpacity style={styles.iconBtn} onPress={toggleMute}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Bottom panel */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {viewMode === 'map' && elevPoints.length > 1 && (
          <View style={styles.elevStrip}>
            <ElevationChart
              points={elevPoints}
              width={screenWidth - 40}
              height={55}
              currentDist={started ? distanceDone : undefined}
              compact={false}
            />
          </View>
        )}
        {!started ? (
          <>
            <View style={styles.routeRow}>
              <Text style={styles.routeStat}>{formatDist(totalDist)}</Text>
              {elevStats && <Text style={styles.routeStat}>+{elevStats.gain} m</Text>}
            </View>
            <TouchableOpacity style={styles.startBtn} onPress={startNavigation} activeOpacity={0.85}>
              <Ionicons name="play" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.startBtnText}>Iniciar navegacion</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={stop} activeOpacity={0.85}>
            <Ionicons name="stop" size={18} color={COLORS.danger} style={{ marginRight: 8 }} />
            <Text style={styles.stopBtnText}>Finalizar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function HudStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.hudStat}>
      <Text style={styles.hudValue}>{value}</Text>
      <Text style={styles.hudLabel}>{label}</Text>
    </View>
  );
}

function SwitchTab({
  icon, mode, current, onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  mode: ViewMode;
  current: ViewMode;
  onPress: (m: ViewMode) => void;
}) {
  const active = mode === current;
  return (
    <TouchableOpacity
      style={[styles.switchTab, active && styles.switchTabActive]}
      onPress={() => onPress(mode)}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={15} color={active ? COLORS.text : 'rgba(255,255,255,0.6)'} />
    </TouchableOpacity>
  );
}

function StatCard({
  icon, label, value, active, highlight,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  active: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <Ionicons name={icon} size={20} color={highlight ? COLORS.primary : 'rgba(255,255,255,0.5)'} />
      <Text style={[styles.statCardValue, !active && styles.statCardValueDim]}>{value}</Text>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  hidden: { opacity: 0, pointerEvents: 'none' } as any,

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12, gap: 8,
    backgroundColor: 'rgba(13,43,30,0.92)',
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  topCenter: { flex: 1 },
  trackName: { fontSize: 14, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  elapsed: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 },

  switcher: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  switchTab: {
    width: 30, height: 28, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  switchTabActive: { backgroundColor: COLORS.primary },

  hud: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, elevation: 8,
  },
  hudStat: { flex: 1, alignItems: 'center' },
  hudValue: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  hudLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  hudDiv: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  hlGroup: { position: 'absolute', right: 16 },
  hlBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.96)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  hlBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  hlBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  progressBg: { position: 'absolute', bottom: 120, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  progressFill: { height: 3, backgroundColor: COLORS.primary },

  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  elevStrip: { marginBottom: 10, marginTop: -4 },
  routeRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 14 },
  routeStat: { fontSize: 15, fontWeight: '600', color: COLORS.textMuted },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primaryDark, borderRadius: 14, paddingVertical: 16,
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  startBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${COLORS.danger}18`,
    borderWidth: 1.5, borderColor: COLORS.danger,
    borderRadius: 14, paddingVertical: 16,
  },
  stopBtnText: { fontSize: 16, fontWeight: '700', color: COLORS.danger },

  // Full panel (elevation / stats)
  fullPanel: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 16,
  },
  panelTitle: {
    fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: 20, marginTop: 16,
  },
  elevStatRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    marginTop: 24,
  },
  elevStat: { alignItems: 'center', gap: 4 },
  elevStatVal: { fontSize: 18, fontWeight: '800', color: '#fff' },
  elevStatLbl: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)', letterSpacing: 0.3 },

  noData: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  noDataText: { fontSize: 15, color: 'rgba(255,255,255,0.3)' },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  statCard: {
    width: '47%', backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 18, gap: 6,
  },
  statCardHighlight: { backgroundColor: 'rgba(46,204,113,0.12)', borderWidth: 1, borderColor: 'rgba(46,204,113,0.3)' },
  statCardValue: { fontSize: 22, fontWeight: '800', color: '#fff' },
  statCardValueDim: { color: 'rgba(255,255,255,0.3)' },
  statCardLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)', letterSpacing: 0.3 },
});
