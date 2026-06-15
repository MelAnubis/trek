export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'user';
}

export interface Trip {
  id: number;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  coverImage?: string;
  countries?: string[];
  totalDays?: number;
  members?: TripMember[];
  status: 'planning' | 'ongoing' | 'completed';
}

export interface TripMember {
  userId: number;
  username: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface Day {
  id: number;
  tripId: number;
  dayNumber: number;
  date?: string;
  title?: string;
  notes?: string;
  places: Place[];
}

export interface Place {
  id: number;
  dayId: number;
  tripId: number;
  name: string;
  lat?: number;
  lng?: number;
  type?: string;
  address?: string;
  notes?: string;
  sortOrder: number;
}

export interface Reservation {
  id: number;
  tripId: number;
  dayId?: number;
  type: string;
  title: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  origin?: string;
  destination?: string;
  confirmationNumber?: string;
  notes?: string;
}

export interface GpxTrack {
  id: number;
  tripId: number;
  dayId?: number;
  trackName: string;
  totalDistance: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  maxElevation?: number;
  minElevation?: number;
  durationSeconds?: number;
  pointCount: number;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
  isActive: boolean;
  sortOrder: number;
}

export interface GpxPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
}
