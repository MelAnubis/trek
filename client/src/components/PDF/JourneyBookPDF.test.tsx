// FE-COMP-JOURNEYPDF-001 to FE-COMP-JOURNEYPDF-006
//
// JourneyBookPDF.tsx exports an async function `downloadJourneyBookPDF(journey)`
// that renders a PDF preview in an srcdoc iframe overlay (Safari-safe pattern).
// Tests verify the overlay DOM structure and HTML content.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock `marked` so we don't need the real markdown parser
vi.mock('marked', () => ({
  marked: {
    parse: (str: string) => `<p>${str}</p>`,
  },
}));

import { downloadJourneyBookPDF } from './JourneyBookPDF';
import type { JourneyDetail } from '../../store/journeyStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildJourney(overrides: Partial<JourneyDetail> = {}): JourneyDetail {
  return {
    id: 1,
    user_id: 1,
    title: 'Iceland Ring Road',
    subtitle: 'Two weeks around the island',
    status: 'active',
    cover_image: null,
    cover_gradient: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    entries: [
      {
        id: 10,
        journey_id: 1,
        author_id: 1,
        type: 'entry',
        title: 'Golden Circle',
        story: 'An incredible day of geysers and waterfalls.',
        entry_date: '2026-07-01',
        entry_time: '09:00',
        location_name: 'Thingvellir',
        location_lat: 64.255,
        location_lng: -21.13,
        mood: 'excited',
        weather: 'sunny',
        tags: [],
        pros_cons: { pros: ['Amazing views'], cons: ['Crowded'] },
        visibility: 'private',
        sort_order: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        source_trip_id: null,
        source_place_id: null,
        source_trip_name: null,
        photos: [
          {
            id: 100,
            entry_id: 10,
            provider: 'local',
            file_path: 'journey/geyser.jpg',
            thumbnail_path: null,
            asset_id: null,
            owner_id: null,
            shared: 0,
            caption: 'Strokkur erupting',
            sort_order: 0,
            created_at: Date.now(),
          },
        ],
      },
    ],
    trips: [],
    contributors: [],
    stats: { entries: 1, photos: 1, cities: 1 },
    ...overrides,
  } as unknown as JourneyDetail;
}

// ── Helpers to inspect the overlay ───────────────────────────────────────────

function getOverlay(): HTMLElement | null {
  return document.getElementById('journey-pdf-overlay');
}

function getIframe(): HTMLIFrameElement | null {
  return getOverlay()?.querySelector('iframe') ?? null;
}

// ── Setup ────────────────────────────────────────────────────────────────────

afterEach(() => {
  document.getElementById('journey-pdf-overlay')?.remove();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('downloadJourneyBookPDF', () => {
  it('FE-COMP-JOURNEYPDF-001: appends overlay to document body', async () => {
    await downloadJourneyBookPDF(buildJourney());
    expect(getOverlay()).not.toBeNull();
    expect(document.body.contains(getOverlay())).toBe(true);
  });

  it('FE-COMP-JOURNEYPDF-002: overlay contains an iframe with srcdoc HTML', async () => {
    await downloadJourneyBookPDF(buildJourney());
    const iframe = getIframe();
    expect(iframe).not.toBeNull();
    const html = iframe!.srcdoc;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('FE-COMP-JOURNEYPDF-003: overlay has close and save buttons', async () => {
    await downloadJourneyBookPDF(buildJourney());
    const overlay = getOverlay()!;
    expect(overlay.querySelector('#journey-pdf-close')).not.toBeNull();
    expect(overlay.querySelector('#journey-pdf-save')).not.toBeNull();
  });

  it('FE-COMP-JOURNEYPDF-004: HTML contains the journey title', async () => {
    await downloadJourneyBookPDF(buildJourney());
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Iceland Ring Road');
  });

  it('FE-COMP-JOURNEYPDF-005: HTML contains entry content', async () => {
    await downloadJourneyBookPDF(buildJourney());
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Golden Circle');
    // Story text is rendered via markdown
    expect(html).toContain('An incredible day of geysers and waterfalls.');
    // Pros/cons verdict cards are included
    expect(html).toContain('Amazing views');
    expect(html).toContain('Crowded');
  });

  it('FE-COMP-JOURNEYPDF-006: handles empty entries gracefully', async () => {
    const journey = buildJourney({ entries: [] });
    await downloadJourneyBookPDF(journey);
    expect(getOverlay()).not.toBeNull();
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Iceland Ring Road');
    // No entry pages, but cover and closing page are still present
    expect(html).toContain('Journey Book');
    expect(html).toContain('The End');
  });

  it('FE-COMP-JOURNEYPDF-007: a track linked to a specific day gets its own "Day N Route" page instead of one shared overview', async () => {
    const journey = buildJourney({
      entries: [
        {
          id: 10, journey_id: 1, author_id: 1, type: 'entry', title: 'Golden Circle',
          story: 'Day one.', entry_date: '2026-07-01', entry_time: '09:00',
          location_name: 'Thingvellir', location_lat: 64.255, location_lng: -21.13,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 0, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
        {
          id: 11, journey_id: 1, author_id: 1, type: 'entry', title: 'Vík',
          story: 'Day two.', entry_date: '2026-07-02', entry_time: '09:00',
          location_name: 'Vík', location_lat: 63.418, location_lng: -19.006,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 1, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
      ] as unknown as JourneyDetail['entries'],
    });

    const tracks = [
      {
        id: 1, track_name: 'Day 1 hike', total_distance: 12, total_elevation_gain: 300,
        total_elevation_loss: 300, max_elevation: 400, min_elevation: 100, ibp: null,
        date: '2026-07-01',
        points: [
          { lat: 64.255, lng: -21.13, ele: 100 },
          { lat: 64.26, lng: -21.14, ele: 400 },
        ],
      },
      {
        id: 2, track_name: 'Day 2 hike', total_distance: 8, total_elevation_gain: 200,
        total_elevation_loss: 200, max_elevation: 350, min_elevation: 150, ibp: null,
        date: '2026-07-02',
        points: [
          { lat: 63.418, lng: -19.006, ele: 150 },
          { lat: 63.42, lng: -19.02, ele: 350 },
        ],
      },
    ];

    await downloadJourneyBookPDF(journey, tracks as any);
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Day 1 Route');
    expect(html).toContain('Day 2 Route');
  });

  it('FE-COMP-JOURNEYPDF-008: a single continuous track with no day link splits into per-day pages by point timestamp', async () => {
    const journey = buildJourney({
      entries: [
        {
          id: 10, journey_id: 1, author_id: 1, type: 'entry', title: 'Golden Circle',
          story: 'Day one.', entry_date: '2026-07-01', entry_time: '09:00',
          location_name: 'Thingvellir', location_lat: 64.255, location_lng: -21.13,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 0, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
        {
          id: 11, journey_id: 1, author_id: 1, type: 'entry', title: 'Vík',
          story: 'Day two.', entry_date: '2026-07-02', entry_time: '09:00',
          location_name: 'Vík', location_lat: 63.418, location_lng: -19.006,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 1, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
      ] as unknown as JourneyDetail['entries'],
    });

    // One continuous multi-day recording, no day_id/date — like a Garmin/
    // Strava export imported as a single track. Only the point timestamps
    // tell us which calendar day each segment belongs to.
    const tracks = [
      {
        id: 1, track_name: 'Full trip', total_distance: 20, total_elevation_gain: 500,
        total_elevation_loss: 500, max_elevation: 400, min_elevation: 100, ibp: null,
        points: [
          { lat: 64.255, lng: -21.13, ele: 100, time: '2026-07-01T09:00:00Z' },
          { lat: 64.26, lng: -21.14, ele: 400, time: '2026-07-01T15:00:00Z' },
          { lat: 63.418, lng: -19.006, ele: 150, time: '2026-07-02T09:00:00Z' },
          { lat: 63.42, lng: -19.02, ele: 350, time: '2026-07-02T15:00:00Z' },
        ],
      },
    ];

    await downloadJourneyBookPDF(journey, tracks as any);
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Day 1 Route');
    expect(html).toContain('Day 2 Route');
    // No leftover single combined overview page duplicating the split days
    // (the CSS has an unrelated "Route Overview Page" comment, so match the
    // actual rendered heading rather than a bare substring)
    expect(html).not.toContain('<div class="route-section-label">Route Overview</div>');
  });

  it('FE-COMP-JOURNEYPDF-009: a day-linked track with no date or timestamps pairs with the journal\'s Nth day by day_number', async () => {
    const journey = buildJourney({
      entries: [
        {
          id: 10, journey_id: 1, author_id: 1, type: 'entry', title: 'Golden Circle',
          story: 'Day one.', entry_date: '2026-07-01', entry_time: '09:00',
          location_name: 'Thingvellir', location_lat: 64.255, location_lng: -21.13,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 0, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
        {
          id: 11, journey_id: 1, author_id: 1, type: 'entry', title: 'Vík',
          story: 'Day two.', entry_date: '2026-07-02', entry_time: '09:00',
          location_name: 'Vík', location_lat: 63.418, location_lng: -19.006,
          mood: null, weather: null, tags: [], pros_cons: null, visibility: 'private',
          sort_order: 1, created_at: Date.now(), updated_at: Date.now(),
          source_trip_id: null, source_place_id: null, source_trip_name: null, photos: [],
        },
      ] as unknown as JourneyDetail['entries'],
    });

    // Tracks already split per trip day (via the manual split wizard) but
    // the trip itself has no fixed calendar dates — day_id is set, but
    // neither `date` nor point timestamps are available to match on.
    const tracks = [
      {
        id: 1, track_name: 'Stage 1', total_distance: 12, total_elevation_gain: 300,
        total_elevation_loss: 300, max_elevation: 400, min_elevation: 100, ibp: null,
        date: null, day_number: 1,
        points: [
          { lat: 64.255, lng: -21.13, ele: 100 },
          { lat: 64.26, lng: -21.14, ele: 400 },
        ],
      },
      {
        id: 2, track_name: 'Stage 2', total_distance: 8, total_elevation_gain: 200,
        total_elevation_loss: 200, max_elevation: 350, min_elevation: 150, ibp: null,
        date: null, day_number: 2,
        points: [
          { lat: 63.418, lng: -19.006, ele: 150 },
          { lat: 63.42, lng: -19.02, ele: 350 },
        ],
      },
    ];

    await downloadJourneyBookPDF(journey, tracks as any);
    const html = getIframe()!.srcdoc;
    expect(html).toContain('Day 1 Route');
    expect(html).toContain('Day 2 Route');
  });
});
