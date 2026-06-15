import { create } from 'zustand';
import { getTrips, getTrip, getTripDays, getGpxTracks } from '@/api/trips';
import type { Trip, Day, GpxTrack } from '@/types';

interface TripState {
  trips: Trip[];
  currentTrip: Trip | null;
  days: Day[];
  tracks: GpxTrack[];
  loadingTrips: boolean;
  loadingDetail: boolean;

  fetchTrips: () => Promise<void>;
  fetchTripDetail: (tripId: number) => Promise<void>;
}

export const useTripStore = create<TripState>((set) => ({
  trips: [],
  currentTrip: null,
  days: [],
  tracks: [],
  loadingTrips: false,
  loadingDetail: false,

  fetchTrips: async () => {
    set({ loadingTrips: true });
    try {
      const trips = await getTrips();
      set({ trips, loadingTrips: false });
    } catch {
      set({ loadingTrips: false });
    }
  },

  fetchTripDetail: async (tripId) => {
    set({ loadingDetail: true });
    try {
      const [trip, days, tracks] = await Promise.all([
        getTrip(tripId),
        getTripDays(tripId),
        getGpxTracks(tripId),
      ]);
      set({ currentTrip: trip, days, tracks, loadingDetail: false });
    } catch {
      set({ loadingDetail: false });
    }
  },
}));
