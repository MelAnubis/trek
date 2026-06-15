import { api } from './client';
import type { Trip, Day, Place, GpxTrack } from '@/types';

export async function getTrips(): Promise<Trip[]> {
  const { data } = await api.get('/api/trips');
  return data;
}

export async function getTrip(tripId: number): Promise<Trip> {
  const { data } = await api.get(`/api/trips/${tripId}`);
  return data;
}

export async function getTripDays(tripId: number): Promise<Day[]> {
  const { data } = await api.get(`/api/trips/${tripId}/days`);
  return data;
}

export async function getDayPlaces(tripId: number, dayId: number): Promise<Place[]> {
  const { data } = await api.get(`/api/trips/${tripId}/days/${dayId}/places`);
  return data;
}

export async function getGpxTracks(tripId: number): Promise<GpxTrack[]> {
  const { data } = await api.get(`/api/trips/${tripId}/gpx-tracks`);
  return data;
}

export async function getGpxPoints(tripId: number, trackId: number): Promise<{ lat: number; lng: number; ele?: number }[]> {
  const { data } = await api.get(`/api/trips/${tripId}/gpx-tracks/${trackId}/points`);
  return data;
}

export async function getReservations(tripId: number) {
  const { data } = await api.get(`/api/trips/${tripId}/reservations`);
  return data;
}
