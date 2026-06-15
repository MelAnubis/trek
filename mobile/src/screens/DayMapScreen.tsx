import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getGpxPoints } from '@/api/trips';
import { useTripStore } from '@/store/tripStore';
import type { RootStackParamList } from '../../App';
import { COLORS } from '@/theme/colors';
import { TYPE } from '@/theme/typography';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'DayMap'>;

interface TrackData {
  trackId: number;
  name: string;
  coords: [number, number][];
  color: string;
}

const TRACK_COLORS = [COLORS.primary, '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];

function buildLeafletHtml(tracks: TrackData[], centerLat: number, centerLng: number): string {
  const tracksJson = JSON.stringify(tracks);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e8efe8;}
.track-popup{font-family:sans-serif;font-size:14px;font-weight:600;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:true,attributionControl:false}).setView([${centerLat},${centerLng}],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var tracks=${tracksJson};
var allLL=[];
tracks.forEach(function(t){
  var ll=t.coords.map(function(c){return[c[1],c[0]];});
  allLL=allLL.concat(ll);
  L.polyline(ll,{color:t.color,weight:4,opacity:0.9}).addTo(map)
   .bindPopup('<div class="track-popup">'+t.name+'</div>');
  if(ll.length>0){
    L.circleMarker(ll[0],{radius:7,fillColor:'#fff',color:t.color,weight:3,fillOpacity:1}).addTo(map);
    L.circleMarker(ll[ll.length-1],{radius:7,fillColor:t.color,color:'#fff',weight:2,fillOpacity:1}).addTo(map);
  }
});
if(allLL.length>1)map.fitBounds(L.latLngBounds(allLL),{padding:[30,30]});
map.locate({watch:false});
map.on('locationfound',function(e){
  L.circleMarker(e.latlng,{radius:9,fillColor:'#2563EB',color:'#fff',weight:2.5,fillOpacity:1}).addTo(map);
});
</script>
</body>
</html>`;
}

export function DayMapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { tripId, dayId } = route.params;
  const { tracks, currentTrip } = useTripStore();
  const webViewRef = useRef<WebView>(null);
  const [trackData, setTrackData] = useState<TrackData[]>([]);
  const [htmlContent, setHtmlContent] = useState('');

  const filteredTracks = dayId
    ? tracks.filter((t) => t.dayId === dayId || !t.dayId)
    : tracks;

  useEffect(() => {
    (async () => {
      const result: TrackData[] = [];
      for (let i = 0; i < filteredTracks.length; i++) {
        const t = filteredTracks[i];
        try {
          const pts = await getGpxPoints(tripId, t.id);
          if (pts.length >= 2) {
            result.push({
              trackId: t.id,
              name: t.trackName,
              coords: pts.map((p) => [p.lng, p.lat]),
              color: TRACK_COLORS[i % TRACK_COLORS.length],
            });
          }
        } catch {}
      }
      setTrackData(result);
      const mid = result[0]?.coords[Math.floor((result[0]?.coords.length ?? 0) / 2)] ?? [0, 40];
      setHtmlContent(buildLeafletHtml(result, mid[1], mid[0]));
    })();
  }, [tripId]);

  return (
    <View style={styles.container}>
      {htmlContent ? (
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent }}
          style={StyleSheet.absoluteFill}
          geolocationEnabled
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      )}

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{currentTrip?.name ?? 'Mapa'}</Text>
        <View style={{ width: 36 }} />
      </View>

      {trackData.length > 0 && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
          {trackData.map((t) => (
            <TouchableOpacity
              key={t.trackId}
              style={styles.trackRow}
              onPress={() => navigation.navigate('Navigate', { tripId, trackId: t.trackId })}
              activeOpacity={0.8}
            >
              <View style={[styles.colorBar, { backgroundColor: t.color }]} />
              <Text style={styles.trackName} numberOfLines={1}>{t.name}</Text>
              <View style={styles.navBtn}>
                <Text style={styles.navBtnText}>▶ Navegar</Text>
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
  placeholder: { backgroundColor: COLORS.mapBg, justifyContent: 'center', alignItems: 'center' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10,
    backgroundColor: 'rgba(13,43,30,0.85)',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#fff', fontSize: 24, lineHeight: 28, marginTop: -2 },
  headerTitle: { ...TYPE.h3, color: '#fff', flex: 1, textAlign: 'center' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12, paddingHorizontal: 16, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  colorBar: { width: 4, height: 36, borderRadius: 2 },
  trackName: { ...TYPE.label, color: COLORS.text, flex: 1 },
  navBtn: { backgroundColor: COLORS.primaryDark, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  navBtnText: { ...TYPE.caption, color: '#fff', fontWeight: '700' },
});
