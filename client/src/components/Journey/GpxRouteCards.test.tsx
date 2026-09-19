// FE-GPXCARD-001 to FE-GPXCARD-004
import { render } from '@testing-library/react';
import { DayRouteCard, JourneyRouteSummary } from './GpxRouteCards';
import type { PdfGpxTrack } from '../PDF/gpxDrawing';

function track(overrides: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  return {
    id: 1, track_name: 'Stage', total_distance: 42.5, total_elevation_gain: 812,
    total_elevation_loss: 640, max_elevation: 1500, min_elevation: 200,
    points: [{ lat: 41, lng: 2, ele: 200 }, { lat: 41.1, lng: 2.1, ele: 600 }],
    date: '2026-04-01', day_number: null,
    ...overrides,
  };
}

describe('DayRouteCard', () => {
  it('FE-GPXCARD-001: renders nothing when the track has no points ("si existe" guard)', () => {
    const { container } = render(<DayRouteCard tracks={[track({ points: [] })]} />);
    expect(container.firstChild).toBeNull();
  });

  it('FE-GPXCARD-002: renders nothing when there are no tracks at all for the day', () => {
    const { container } = render(<DayRouteCard tracks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('FE-GPXCARD-003: shows the total distance and elevation gain for the day\'s track(s)', () => {
    const { getByText } = render(<DayRouteCard tracks={[track()]} />);
    expect(getByText('42.5 journey.route.km')).toBeTruthy();
    expect(getByText('+812 journey.route.m')).toBeTruthy();
  });
});

describe('JourneyRouteSummary', () => {
  it('FE-GPXCARD-004: renders nothing when no track in the journey has any points', () => {
    const { container } = render(<JourneyRouteSummary tracks={[track({ points: [] })]} />);
    expect(container.firstChild).toBeNull();
  });

  it('FE-GPXCARD-005: sums distance and elevation gain across every linked track', () => {
    const { getByText } = render(<JourneyRouteSummary tracks={[track({ total_distance: 10, total_elevation_gain: 100 }), track({ id: 2, total_distance: 5, total_elevation_gain: 50 })]} />);
    expect(getByText('15.0 journey.route.km')).toBeTruthy();
    expect(getByText('+150 journey.route.m')).toBeTruthy();
  });
});
