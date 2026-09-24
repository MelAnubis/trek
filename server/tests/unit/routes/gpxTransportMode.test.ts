// GPXTRANSPORT-001 to GPXTRANSPORT-010
import { describe, it, expect } from 'vitest';
import { detectTransportMode, parseGpxBuffer, TRANSPORT_MODES } from '../../../src/routes/gpxTracks';

describe('detectTransportMode', () => {
  it('GPXTRANSPORT-001: matches common GPX <type> values to their canonical mode', () => {
    expect(detectTransportMode('hiking')).toBe('hiking');
    expect(detectTransportMode('Cycling')).toBe('cycling');
    expect(detectTransportMode('driving')).toBe('driving');
    expect(detectTransportMode('walking')).toBe('walking');
    expect(detectTransportMode('running')).toBe('running');
  });

  it('GPXTRANSPORT-002: a compound value like "mountain_biking" matches cycling, not hiking\'s own "mountain" keyword', () => {
    expect(detectTransportMode('mountain_biking')).toBe('cycling');
  });

  it('GPXTRANSPORT-003: "trail_running" matches running, not hiking\'s own "trail" keyword', () => {
    expect(detectTransportMode('trail_running')).toBe('running');
  });

  it('GPXTRANSPORT-004: an unrecognized value, or none at all, returns null rather than guessing', () => {
    expect(detectTransportMode('something_else')).toBeNull();
    expect(detectTransportMode(null)).toBeNull();
    expect(detectTransportMode(undefined)).toBeNull();
    expect(detectTransportMode('')).toBeNull();
  });

  it('GPXTRANSPORT-005: every returned mode is one of the small fixed set the client has a color for', () => {
    for (const raw of ['hiking', 'cycling', 'driving', 'walking', 'running']) {
      expect(TRANSPORT_MODES).toContain(detectTransportMode(raw));
    }
  });
});

function gpxWithType(type: string | null, points = 2): string {
  const trkpts = Array.from({ length: points }, (_, i) =>
    `<trkpt lat="42.60${i}" lon="0.69${i}"><ele>1800</ele></trkpt>`
  ).join('');
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test Track</name>${type ? `<type>${type}</type>` : ''}<trkseg>${trkpts}</trkseg></trk></gpx>`;
}

describe('parseGpxBuffer — transport mode', () => {
  it('GPXTRANSPORT-006: extracts and resolves <type> when the GPX file carries one', () => {
    const parsed = parseGpxBuffer(gpxWithType('hiking'));
    expect(parsed.transportMode).toBe('hiking');
  });

  it('GPXTRANSPORT-007: an unrecognized <type> resolves to null rather than throwing', () => {
    const parsed = parseGpxBuffer(gpxWithType('paragliding'));
    expect(parsed.transportMode).toBeNull();
  });

  it('GPXTRANSPORT-008: a GPX file with no <type> at all (most real-world exports) resolves to null', () => {
    const parsed = parseGpxBuffer(gpxWithType(null));
    expect(parsed.transportMode).toBeNull();
  });

  it('GPXTRANSPORT-009: CDATA-wrapped <type> text is unwrapped the same way <name> already is', () => {
    const parsed = parseGpxBuffer(gpxWithType('<![CDATA[Cycling]]>'));
    expect(parsed.transportMode).toBe('cycling');
  });

  it('GPXTRANSPORT-010: still parses the track\'s points correctly alongside the new <type> extraction', () => {
    const parsed = parseGpxBuffer(gpxWithType('hiking', 3));
    expect(parsed.points).toHaveLength(3);
    expect(parsed.trackName).toBe('Test Track');
  });

  it('GPXTRANSPORT-011: a named <wpt> listed before <trk> (the GPX schema\'s own convention) is not mistaken for the track\'s own name', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1">
      <wpt lat="42.60" lon="0.70"><name>Refugio</name></wpt>
      <trk><name>Real Track Name</name><type>hiking</type><trkseg>
        <trkpt lat="42.60" lon="0.70"><ele>1800</ele></trkpt>
        <trkpt lat="42.61" lon="0.71"><ele>1810</ele></trkpt>
      </trkseg></trk>
    </gpx>`;
    const parsed = parseGpxBuffer(gpx);
    expect(parsed.trackName).toBe('Real Track Name');
    expect(parsed.transportMode).toBe('hiking');
    expect(parsed.waypoints).toEqual([{ lat: 42.60, lng: 0.70, name: 'Refugio' }]);
  });
});
