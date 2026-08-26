import { api } from './client';
import type { Trip, Day, Place, GpxTrack } from '@/types';

function mapTrip(t: any): Trip {
  const now = new Date();
  const start = t.start_date ? new Date(t.start_date) : null;
  const end = t.end_date ? new Date(t.end_date) : null;
  const status: Trip['status'] = t.is_archived
    ? 'completed'
    : start && end && start <= now && end >= now
    ? 'ongoing'
    : 'planning';

  const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
  const coverImage = t.cover_image
    ? (t.cover_image.startsWith('http') ? t.cover_image : `${base}${t.cover_image}`)
    : undefined;

  return {
    id: t.id,
    name: t.title,
    description: t.description,
    startDate: t.start_date,
    endDate: t.end_date,
    coverImage,
    totalDays: t.day_count,
    status,
  };
}

function mapDay(d: any): Day {
  return {
    id: d.id,
    tripId: d.trip_id,
    dayNumber: d.day_number,
    date: d.date,
    title: d.title,
    notes: d.notes,
    places: (d.places ?? []).map(mapPlace),
  };
}

function mapPlace(p: any): Place {
  return {
    id: p.id,
    dayId: p.day_id,
    tripId: p.trip_id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    type: p.type,
    address: p.address,
    notes: p.notes,
    sortOrder: p.sort_order,
  };
}

function mapTrack(t: any): GpxTrack {
  return {
    id: t.id,
    tripId: t.trip_id,
    dayId: t.day_id,
    trackName: t.track_name,
    totalDistance: t.total_distance,
    totalElevationGain: t.total_elevation_gain,
    totalElevationLoss: t.total_elevation_loss,
    maxElevation: t.max_elevation,
    minElevation: t.min_elevation,
    durationSeconds: t.duration_seconds,
    pointCount: t.point_count,
    startLat: t.start_lat,
    startLng: t.start_lng,
    endLat: t.end_lat,
    endLng: t.end_lng,
    isActive: !!t.is_active,
    sortOrder: t.sort_order,
  };
}

export async function getTrips(): Promise<Trip[]> {
  const { data } = await api.get('/api/trips');
  return (data.trips ?? []).map(mapTrip);
}

export async function getTrip(tripId: number): Promise<Trip> {
  const { data } = await api.get(`/api/trips/${tripId}`);
  return mapTrip(data.trip ?? data);
}

export async function getTripDays(tripId: number): Promise<Day[]> {
  const { data } = await api.get(`/api/trips/${tripId}/days`);
  return (Array.isArray(data) ? data : []).map(mapDay);
}

export async function getDayPlaces(tripId: number, dayId: number): Promise<Place[]> {
  const { data } = await api.get(`/api/trips/${tripId}/days/${dayId}/places`);
  return (Array.isArray(data) ? data : []).map(mapPlace);
}

export async function getGpxTracks(tripId: number): Promise<GpxTrack[]> {
  const { data } = await api.get(`/api/trips/${tripId}/gpx`);
  return (Array.isArray(data) ? data : []).map(mapTrack);
}

export async function getGpxPoints(tripId: number, trackId: number): Promise<{ lat: number; lng: number; ele?: number }[]> {
  const { data } = await api.get(`/api/trips/${tripId}/gpx/${trackId}/points`);
  const pts: any[] = data.points ?? [];
  return pts.map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele ?? undefined }));
}

export async function getReservations(tripId: number) {
  const { data } = await api.get(`/api/trips/${tripId}/reservations`);
  return Array.isArray(data) ? data : (data.reservations ?? []);
}
