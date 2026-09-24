// BOOKSCHEMA-001 to BOOKSCHEMA-025
import { bookElementSchema, bookPageSetupSchema, normalizeBookDocument, MAX_IMAGE_SRC_LENGTH, BOOK_FONTS_IDS } from '../../../src/services/journeyBook/bookSchema';

const base = { id: 'el-1', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false };

function imageEl(overrides: Record<string, unknown> = {}) {
  return { ...base, kind: 'image', src: 'data:image/png;base64,AAAA', fit: 'cover', radius: 0, ...overrides };
}

describe('bookElementSchema — image kind', () => {
  it('BOOKSCHEMA-001: accepts a well-formed PNG data: URI', () => {
    const parsed = bookElementSchema.safeParse(imageEl());
    expect(parsed.success).toBe(true);
  });

  it('BOOKSCHEMA-002: accepts an SVG data: URI (the elevation profile\'s format)', () => {
    const parsed = bookElementSchema.safeParse(imageEl({ src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }));
    expect(parsed.success).toBe(true);
  });

  it('BOOKSCHEMA-003: rejects a non-data: URI — a live URL would be unprintable inside the sandboxed export iframe', () => {
    const parsed = bookElementSchema.safeParse(imageEl({ src: 'https://example.com/map.png' }));
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-004: rejects a non-image data: URI (e.g. a disguised text/html payload)', () => {
    const parsed = bookElementSchema.safeParse(imageEl({ src: 'data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=' }));
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-005: rejects a src longer than MAX_IMAGE_SRC_LENGTH', () => {
    const oversized = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_SRC_LENGTH);
    const parsed = bookElementSchema.safeParse(imageEl({ src: oversized }));
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-006: normalizeBookDocument keeps a valid image element and strips an invalid one alongside otherwise-valid siblings', () => {
    const doc = normalizeBookDocument({
      version: 1,
      title: 'Trip',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [{
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [
          imageEl({ id: 'good' }),
          imageEl({ id: 'bad', src: 'not-a-data-uri' }),
        ],
      }],
    });
    const ids = doc.spreads[0].elements.map(e => e.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('bad');
  });
});

function textEl(overrides: Record<string, unknown> = {}) {
  return { ...base, kind: 'text', text: 'Hi', font: 'sans', size: 11, weight: 400, italic: false, align: 'left', leading: 1.45, tracking: 0, color: '#1a1a1a', binding: null, ...overrides };
}

describe('bookElementSchema — text kind — self-hosted font library', () => {
  it('BOOKSCHEMA-024: accepts every font id in the self-hosted @fontsource library, not just the original 3 back-compat slots', () => {
    expect(BOOK_FONTS_IDS).toEqual(['sans', 'serif', 'display', 'inter', 'garamond', 'playfair', 'bebas']);
    for (const font of BOOK_FONTS_IDS) {
      const parsed = bookElementSchema.safeParse(textEl({ font }));
      expect(parsed.success, font).toBe(true);
    }
  });

  it('BOOKSCHEMA-025: rejects a font id that isn\'t in the library', () => {
    const parsed = bookElementSchema.safeParse(textEl({ font: 'comic-sans' }));
    expect(parsed.success).toBe(false);
  });
});

describe('bookPageSetupSchema — pageNumbers', () => {
  it('BOOKSCHEMA-007: a page saved before pageNumbers existed defaults to off', () => {
    const parsed = bookPageSetupSchema.parse({ preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 });
    expect(parsed.pageNumbers).toEqual({ show: false });
  });

  it('BOOKSCHEMA-008: an explicit show:true round-trips', () => {
    const parsed = bookPageSetupSchema.parse({ preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5, pageNumbers: { show: true } });
    expect(parsed.pageNumbers).toEqual({ show: true });
  });
});

describe('bookElementSchema — travel element kinds', () => {
  it('BOOKSCHEMA-009: a stats element accepts its own fields and drops an unknown metric key from values', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'stats', metrics: ['distance', 'days'], layout: 'grid', showIcons: true, units: 'metric',
      values: { distance: 12000, days: 5, madeUpMetric: 99 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'stats') {
      expect(parsed.data.values).toEqual({ distance: 12000, days: 5 });
    }
  });

  it('BOOKSCHEMA-010: a stats element rejects more than 7 metrics', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'stats',
      metrics: ['distance', 'days', 'steps', 'photos', 'countries', 'places', 'furthest', 'distance'],
    });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-011: a places element accepts a list of places, each with an optional note', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'places', places: [{ name: 'Reykjavik', note: 'Blue Lagoon' }, { name: 'Oslo' }], layout: 'list', align: 'center',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'places') {
      expect(parsed.data.places).toEqual([{ name: 'Reykjavik', note: 'Blue Lagoon' }, { name: 'Oslo', note: '' }]);
    }
  });

  it('BOOKSCHEMA-012: a places element rejects a place name longer than MAX_PLACE_NAME', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'places', places: [{ name: 'A'.repeat(81) }] });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-013: a badge element accepts every documented variant', () => {
    for (const variant of ['flag', 'date', 'day', 'coords', 'country', 'distance', 'weather', 'altitude', 'mood']) {
      const parsed = bookElementSchema.safeParse({ ...base, kind: 'badge', variant, text: '13', sub: 'April', code: null, style: 'chip' });
      expect(parsed.success, variant).toBe(true);
    }
  });

  it('BOOKSCHEMA-014: a badge element rejects an undocumented variant', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'badge', variant: 'not-a-real-variant', text: '13' });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-015: an icon element requires a PascalCase lucide-style name', () => {
    expect(bookElementSchema.safeParse({ ...base, kind: 'icon', name: 'MountainSnow', color: '#111827', lineWidth: 2 }).success).toBe(true);
    expect(bookElementSchema.safeParse({ ...base, kind: 'icon', name: 'mountain-snow', color: '#111827', lineWidth: 2 }).success).toBe(false);
  });

  it('BOOKSCHEMA-016: a list element accepts pro/con/plain items', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'list',
      items: [{ text: 'Great views', tone: 'pro' }, { text: 'Rained all day', tone: 'con' }],
      layout: 'columns', showMarks: true, proLabel: 'Pros', conLabel: 'Cons',
    });
    expect(parsed.success).toBe(true);
  });

  it('BOOKSCHEMA-017: a list element rejects an undocumented tone', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'list', items: [{ text: 'x', tone: 'neutral' }] });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-018: a map element accepts a null src (not yet rendered) as well as a real data: URI', () => {
    expect(bookElementSchema.safeParse({ ...base, kind: 'map', src: null, fit: 'cover', radius: 0 }).success).toBe(true);
    expect(bookElementSchema.safeParse({ ...base, kind: 'map', src: 'data:image/png;base64,AAAA', fit: 'cover', radius: 0 }).success).toBe(true);
  });

  it('BOOKSCHEMA-019: a map element rejects a live URL for src, same as the image kind', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'map', src: 'https://example.com/map.png', fit: 'cover', radius: 0 });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-020: every travel element\'s color/accent fields are plain #rrggbb, rejecting rgba()', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'stats', color: 'rgba(0,0,0,0.5)' });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-021: normalizeBookDocument keeps a valid travel element and strips an invalid one alongside otherwise-valid siblings', () => {
    const doc = normalizeBookDocument({
      version: 1,
      title: 'Trip',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [{
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [
          { ...base, id: 'good', kind: 'icon', name: 'Compass', color: '#111827', lineWidth: 2 },
          { ...base, id: 'bad', kind: 'icon', name: 'not-pascal-case', color: '#111827', lineWidth: 2 },
        ],
      }],
    });
    const ids = doc.spreads[0].elements.map(e => e.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('bad');
  });

  it('BOOKSCHEMA-022: a stats element accepts the elevationGain/elevationLoss metrics', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'stats', metrics: ['elevationGain', 'elevationLoss'], layout: 'grid', showIcons: true, units: 'metric',
      values: { elevationGain: 843, elevationLoss: 621 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'stats') {
      expect(parsed.data.values).toEqual({ elevationGain: 843, elevationLoss: 621 });
    }
  });

  it('BOOKSCHEMA-023: an old book still carrying the removed "countries" element kind degrades gracefully — that one element is dropped, not the whole document', () => {
    const doc = normalizeBookDocument({
      version: 1,
      title: 'Trip',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [{
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [
          { ...base, id: 'good', kind: 'icon', name: 'Compass', color: '#111827', lineWidth: 2 },
          { ...base, id: 'stale-countries', kind: 'countries', codes: ['IS'], names: ['Iceland'], layout: 'list', showFlag: true, showName: true, align: 'center' },
        ],
      }],
    });
    const ids = doc.spreads[0].elements.map(e => e.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('stale-countries');
  });
});
