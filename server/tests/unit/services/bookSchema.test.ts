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
    expect(BOOK_FONTS_IDS).toEqual(['sans', 'serif', 'display', 'inter', 'garamond', 'playfair', 'bebas', 'montserrat', 'oswald', 'merriweather', 'cormorant', 'caveat', 'dancing', 'typewriter', 'jost', 'fraunces', 'dmserif', 'bodoni', 'anton', 'league', 'shoulders', 'archivo', 'shrikhand', 'alfa', 'bricolage', 'abril', 'pacifico', 'vibes', 'sacramento', 'kaushan', 'allura', 'parisienne', 'satisfy', 'yellowtail', 'homemade', 'marker', 'mono']);
    for (const font of BOOK_FONTS_IDS) {
      const parsed = bookElementSchema.safeParse(textEl({ font }));
      expect(parsed.success, font).toBe(true);
    }
  });

  it('BOOKSCHEMA-025: a font id that isn\'t in the library falls back to the default face (the text survives)', () => {
    // Rejecting it used to make the whole text element unreadable, and the
    // document salvage pass then dropped it from the book.
    const parsed = bookElementSchema.safeParse(textEl({ font: 'comic-sans' }));
    expect(parsed.success).toBe(true);
    expect((parsed as any).data.font).toBe('sans');
  });
});

describe('bookPageSetupSchema — pageNumbers', () => {
  it('BOOKSCHEMA-007: a page saved before pageNumbers existed defaults to off', () => {
    const parsed = bookPageSetupSchema.parse({ preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 });
    expect(parsed.pageNumbers).toEqual({ show: false, startAt: 2, position: 'outer', margin: 12, size: 8, autoColor: true, color: '#8a8578', font: 'sans' });
  });

  it('BOOKSCHEMA-008: an explicit show:true round-trips', () => {
    const parsed = bookPageSetupSchema.parse({ preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5, pageNumbers: { show: true } });
    expect(parsed.pageNumbers).toMatchObject({ show: true, position: 'outer', startAt: 2 });
  });

  it('BOOKSCHEMA-008b: folio settings round-trip, and a bad field falls back instead of failing the page', () => {
    const page = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 };
    const ok = bookPageSetupSchema.parse({ ...page, pageNumbers: { show: true, startAt: 1, position: 'centre', margin: 8, size: 10, autoColor: false, color: '#112233', font: 'serif' } });
    expect(ok.pageNumbers).toEqual({ show: true, startAt: 1, position: 'centre', margin: 8, size: 10, autoColor: false, color: '#112233', font: 'serif' });
    const bad = bookPageSetupSchema.parse({ ...page, pageNumbers: { show: true, position: 'diagonal', size: 999, color: 'red' } });
    expect(bad.pageNumbers).toMatchObject({ show: true, position: 'outer', size: 8, color: '#8a8578' });
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

  it('BOOKSCHEMA-023: an element of a kind this version does not know degrades gracefully — that one element is dropped, not the whole document; a countries element (supported again) survives', () => {
    const doc = normalizeBookDocument({
      version: 1,
      title: 'Trip',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [{
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [
          { ...base, id: 'good', kind: 'icon', name: 'Compass', color: '#111827', lineWidth: 2 },
          { ...base, id: 'unknown-kind', kind: 'hologram', beams: 3 },
          { ...base, id: 'countries', kind: 'countries', codes: ['IS'], names: ['Iceland'], layout: 'list', showFlag: true, showName: true, align: 'center' },
        ],
      }],
    });
    const ids = doc.spreads[0].elements.map(e => e.id);
    expect(ids).toEqual(['good', 'countries']);
  });

  it('BOOKSCHEMA-026: a packing element accepts a list of items with category/checked/quantity, applying defaults for missing fields', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'packing',
      items: [{ name: 'Passport', category: 'Documents', checked: true, quantity: 1 }, { name: 'Socks' }],
      groupByCategory: true, showQuantity: true, columns: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'packing') {
      expect(parsed.data.items).toEqual([
        { name: 'Passport', category: 'Documents', checked: true, quantity: 1 },
        { name: 'Socks', category: '', checked: false, quantity: 1 },
      ]);
    }
  });

  it('BOOKSCHEMA-027: a packing element rejects an item name longer than MAX_PACKING_NAME', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'packing', items: [{ name: 'A'.repeat(101) }] });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-028: a packing element rejects columns outside {1, 2}', () => {
    const parsed = bookElementSchema.safeParse({ ...base, kind: 'packing', items: [], columns: 3 });
    expect(parsed.success).toBe(false);
  });

  it('BOOKSCHEMA-029: an accommodation element accepts a list of stays, defaulting optional fields', () => {
    const parsed = bookElementSchema.safeParse({
      ...base, kind: 'accommodation',
      stays: [{ name: 'Hotel Roma', address: 'Rome', checkIn: '2026-04-01', checkOut: '2026-04-04', confirmation: 'XYZ123' }, { name: 'Cabin' }],
      showConfirmation: true, layout: 'cards',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'accommodation') {
      expect(parsed.data.stays).toEqual([
        { name: 'Hotel Roma', address: 'Rome', checkIn: '2026-04-01', checkOut: '2026-04-04', confirmation: 'XYZ123' },
        { name: 'Cabin', address: '', checkIn: null, checkOut: null, confirmation: '' },
      ]);
    }
  });

  it('BOOKSCHEMA-030: normalizeBookDocument keeps a valid packing element and strips an invalid accommodation element alongside it', () => {
    const doc = normalizeBookDocument({
      version: 1,
      title: 'Trip',
      page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
      spreads: [{
        id: 'sp-1', role: 'inner', background: null, entryId: null, parked: [],
        elements: [
          { ...base, id: 'good', kind: 'packing', items: [{ name: 'Passport' }], groupByCategory: true, showQuantity: true, columns: 2 },
          { ...base, id: 'bad', kind: 'accommodation', stays: [{ name: 'A'.repeat(200) }] },
        ],
      }],
    });
    const ids = doc.spreads[0].elements.map(e => e.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('bad');
  });
});

describe('bookElementSchema — Studio styles', () => {
  const photo = (o: Record<string, unknown> = {}) => ({ ...base, kind: 'photo', photoId: 1, ...o });

  it('BOOKSCHEMA-STYLE-001: the new photo filters and frames round-trip', () => {
    for (const filter of ['sepia', 'vintage', 'vivid', 'matte', 'noir', 'golden', 'dramatic']) {
      const r = bookElementSchema.parse(photo({ filter })) as any;
      expect(r.filter).toBe(filter);
    }
    for (const frameStyle of ['thin', 'double', 'stamp', 'corners', 'vignette', 'tape']) {
      const r = bookElementSchema.parse(photo({ frameStyle })) as any;
      expect(r.frameStyle).toBe(frameStyle);
    }
  });

  it('BOOKSCHEMA-STYLE-002: an unknown filter, frame or font falls back instead of dropping the element', () => {
    const p = bookElementSchema.parse(photo({ filter: 'lomo', frameStyle: 'neon' })) as any;
    expect(p).toMatchObject({ kind: 'photo', filter: 'none', frameStyle: 'none' });
    const t = bookElementSchema.parse(textEl({ font: 'comic-sans-pro' })) as any;
    expect(t.font).toBe('sans');
  });

  it('BOOKSCHEMA-STYLE-003: the new fonts are accepted', () => {
    for (const font of ['montserrat', 'oswald', 'merriweather', 'cormorant', 'caveat', 'dancing', 'typewriter']) {
      expect(BOOK_FONTS_IDS).toContain(font);
      expect((bookElementSchema.parse(textEl({ font })) as any).font).toBe(font);
    }
  });

  it('BOOKSCHEMA-STYLE-004: text effects default off for old text, and round-trip when set', () => {
    const old = bookElementSchema.parse(textEl()) as any;
    expect(old).toMatchObject({ effect: 'none', uppercase: false });
    expect(old.highlight).toBeUndefined();
    // Rev 5: a marker colour stored as a string becomes the band of that colour (normalizeBookDocument).
    const doc = normalizeBookDocument({ spreads: [{ id: 's', elements: [textEl({ effect: 'highlight', highlight: '#a1b2c3', uppercase: true }), textEl({ id: 't2', highlight: '#fde68a' })] }] }) as any;
    expect(doc.spreads[0].elements[0]).toMatchObject({ effect: 'highlight', highlight: { color: '#a1b2c3' }, uppercase: true });
    expect(doc.spreads[0].elements[1].highlight).toBeUndefined();
    expect((bookElementSchema.parse(textEl({ effect: 'glow' })) as any).effect).toBe('none');
  });
});

describe('bookSpreadSchema — first and last pages', () => {
  it('BOOKSCHEMA-ROLE-001: a document with first/last single pages round-trips', () => {
    const page = { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 };
    const sp = (id: string, role: string) => ({ id, role, background: null, elements: [], parked: [], entryId: null });
    const doc = normalizeBookDocument({ version: 1, title: 'T', page, spreads: [sp('c', 'cover'), sp('f', 'first'), sp('i', 'inner'), sp('l', 'last'), sp('b', 'back')] }) as any;
    expect(doc.spreads.map((s: any) => s.role)).toEqual(['cover', 'first', 'inner', 'last', 'back']);
  });
});

describe('bookElementSchema — photo look (rev 3)', () => {
  const photo = (o: Record<string, unknown> = {}) => ({ id: 'p', frame: { x: 0, y: 0, w: 50, h: 40 }, rotation: 0, opacity: 1, locked: false, kind: 'photo', photoId: 1, ...o });

  it('BOOKSCHEMA-LOOK-001: every part of the look round-trips', () => {
    const look = {
      border: { width: 4, color: '#ffffff' }, shadow: { dx: 2, dy: -3, color: '#1a1a1a', alpha: 0.35 }, zoom: 2.5, flipX: true,
      adjust: { brightness: 0.2, contrast: -0.4, saturation: 1, warmth: -1 }, duotone: { dark: '#1e3a8a', light: '#f5e6c8' },
      cutout: { width: 3, color: '#ffffff' },
    };
    expect(bookElementSchema.parse(photo(look))).toMatchObject(look);
  });

  it('BOOKSCHEMA-LOOK-002: a photo without a look stores none of it, and null means off', () => {
    const r = bookElementSchema.parse(photo()) as any;
    for (const k of ['border', 'shadow', 'zoom', 'flipX', 'adjust', 'duotone', 'cutout']) expect(r[k]).toBeUndefined();
    expect((bookElementSchema.parse(photo({ border: null })) as any).border).toBeNull();
  });

  it('BOOKSCHEMA-LOOK-003: an unreadable part falls back to off instead of dropping the photo', () => {
    const r = bookElementSchema.parse(photo({ zoom: 12, border: { width: 99, color: '#fff' }, shadow: 'big', adjust: { brightness: 3 }, flipX: 'yes' })) as any;
    expect(r).toMatchObject({ kind: 'photo', photoId: 1 });
    for (const k of ['zoom', 'border', 'shadow', 'adjust', 'flipX']) expect(r[k]).toBeUndefined();
  });
});


describe('bookSchema — rev 4 (5.7.6): paint, edges, lines, themes', () => {
  const at = { id: 'x', frame: { x: 0, y: 0, w: 50, h: 40 }, rotation: 0, opacity: 1, locked: false };

  it('BOOKSCHEMA-P3-001: a shape keeps its paint, edge and theme links; unreadable ones fall back to none', () => {
    const paint = { type: 'linear', angle: 90, stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff', alpha: 0.5 }] };
    const r = bookElementSchema.parse({ ...at, kind: 'shape', paint, edge: 'torn', edgeSize: 4.256, token: 'accent', strokeToken: 'ink' }) as any;
    expect(r).toMatchObject({ paint, edge: 'torn', edgeSize: 4.26, token: 'accent', strokeToken: 'ink' });
    const bad = bookElementSchema.parse({ ...at, kind: 'shape', paint: { type: 'linear', stops: [] }, edge: 'lace', token: 'sky' }) as any;
    expect(bad.kind).toBe('shape');
    expect([bad.paint, bad.edge, bad.token]).toEqual([undefined, undefined, undefined]);
    for (const pattern of ['checker', 'sunburst', 'grain']) {
      const p = bookElementSchema.parse({ ...at, kind: 'shape', paint: { type: 'pattern', pattern, fg: '#111111', bg: null, scale: 1, angle: 0 } }) as any;
      expect(p.paint.pattern).toBe(pattern);
    }
  });

  it('BOOKSCHEMA-P3-002: a line reads with its defaults and keeps up to 32 points', () => {
    const r = bookElementSchema.parse({ ...at, kind: 'line' }) as any;
    expect(r).toMatchObject({ kind: 'line', points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], curve: 'straight', strokeWidth: 0.5, startCap: 'none', ornament: 'none' });
    const points = Array.from({ length: 32 }, (_, i) => ({ x: i / 31, y: 0.5 }));
    expect((bookElementSchema.parse({ ...at, kind: 'line', points, endCap: 'arrow', squiggle: 'wave', wobble: 0.4 }) as any).points).toHaveLength(32);
    expect(bookElementSchema.safeParse({ ...at, kind: 'line', points: [...points, { x: 1, y: 1 }] }).success).toBe(false);
    expect((bookElementSchema.parse({ ...at, kind: 'line', endCap: 'rocket' }) as any).endCap).toBe('none');
  });

  it('BOOKSCHEMA-P3-003: a document keeps its theme and a page its background paint; an unreadable theme is no theme', () => {
    const theme = {
      id: 'riviera', palette: { paper: '#fffaf0', ink: '#22324a', accent: '#2a78bd', accent2: '#6f7f34', accent3: '#e9b824' },
      fonts: { display: { font: 'playfair', weight: 600 }, heading: { font: 'montserrat' }, body: { font: 'serif' }, script: null },
      motifs: ['sea', 'nope'], decoration: 'light', frameStyle: 'none', tilt: 0,
    };
    const doc = normalizeBookDocument({
      title: 'T', theme,
      spreads: [{ id: 'a', background: '#ffeedd', backgroundToken: 'paper', backgroundPaint: { type: 'solid', color: '#ffeedd', alpha: 0.5 }, elements: [{ ...at, kind: 'text', token: 'ink', fontRole: 'body' }] }],
    }) as any;
    expect(doc.theme.motifs).toEqual(['sea']);
    expect(doc.theme.palette.accent).toBe('#2a78bd');
    expect(doc.spreads[0]).toMatchObject({ backgroundToken: 'paper', backgroundPaint: { type: 'solid', alpha: 0.5 } });
    expect(doc.spreads[0].elements[0]).toMatchObject({ token: 'ink', fontRole: 'body' });
    expect((normalizeBookDocument({ theme: { palette: 'red' } }) as any).theme).toBeUndefined();
  });
});

describe('5.7.9 — designed pages: text effects, stickers, weights, the second shelf of shapes', () => {
  it('BOOKSCHEMA-P5-001: a text keeps its effects, an unreadable one is dropped, and nothing is added to a plain text', () => {
    const fx = {
      transform: 'upper', vAlign: 'middle', outline: { color: '#ffffff', width: 0.4 }, shadow: { dx: 1, dy: 1, color: '#000000', alpha: 0.5 },
      highlight: { color: '#ff0000', alpha: 1, padX: 1, padY: 0.3, radius: 0 }, curve: { type: 'arc', bend: 40, start: 0 },
      fillPaint: { type: 'photo', photoId: 9, focalX: 0.2, focalY: 0.8, zoom: 1.5 }, fit: 'shrink', fitMax: 48, size: 300,
    };
    expect(bookElementSchema.parse(textEl(fx))).toMatchObject(fx);
    const bad = bookElementSchema.parse(textEl({ outline: { color: 'red', width: 99 }, curve: { type: 'spiral' }, vAlign: 'side', transform: 'title' })) as any;
    expect(bad.outline).toBeUndefined();
    expect(bad.curve).toBeUndefined();
    expect(bad.vAlign).toBeUndefined();
    expect(bad.transform).toBeUndefined();
    const plain = bookElementSchema.parse(textEl()) as any;
    for (const k of ['transform', 'vAlign', 'outline', 'shadow', 'highlight', 'curve', 'fillPaint', 'fit', 'fitMax']) expect(k in plain && plain[k] !== undefined).toBe(false);
    expect((bookElementSchema.parse(textEl({ outline: null })) as any).outline).toBeNull();
  });

  it('BOOKSCHEMA-P5-002: weights run 100 to 900 in hundreds; anything else reads as 400', () => {
    expect((bookElementSchema.parse(textEl({ weight: 800 })) as any).weight).toBe(800);
    expect((bookElementSchema.parse(textEl({ weight: 450 })) as any).weight).toBe(400);
    expect((bookElementSchema.parse(textEl({ weight: 1000 })) as any).weight).toBe(400);
  });

  it('BOOKSCHEMA-P5-003: a sticker keeps its id, up to four slot colours and its mirroring', () => {
    const st = bookElementSchema.parse({ ...base, kind: 'sticker', stickerId: 'palmLeaf', colors: ['#112233', '#445566'], flipX: true }) as any;
    expect(st).toMatchObject({ kind: 'sticker', stickerId: 'palmLeaf', colors: ['#112233', '#445566'], flipX: true });
    expect((bookElementSchema.parse({ ...base, kind: 'sticker', stickerId: 'sun', colors: ['nope'] }) as any).colors).toEqual([]);
    expect(bookElementSchema.safeParse({ ...base, kind: 'sticker', stickerId: '../evil' }).success).toBe(false);
  });

  it('BOOKSCHEMA-P5-004: the second shelf of shapes is a shape and a mask', () => {
    expect(bookElementSchema.parse({ ...base, kind: 'shape', shape: 'leaf-monstera', fill: '#000000' })).toMatchObject({ shape: 'leaf-monstera' });
    const p = bookElementSchema.parse({ ...base, kind: 'photo', photoId: 1, mask: 'arch-tall' }) as any;
    expect(p.mask).toBe('arch-tall');
  });

  it('BOOKSCHEMA-P5-005: a pre-rev-5 marker colour becomes a band only on texts whose effect was the marker, also when parked', () => {
    const doc = normalizeBookDocument({ spreads: [{ id: 's', elements: [], parked: [textEl({ id: 'pk', effect: 'highlight', highlight: '#123456' })] }] }) as any;
    expect(doc.spreads[0].parked[0].highlight).toMatchObject({ color: '#123456', alpha: 1 });
  });
});

describe('5.7.12 — the book\'s own layouts', () => {
  it('BOOKSCHEMA-P6-001: a document keeps its layouts; an unreadable layout or element is dropped, not the rest', () => {
    const layout = { id: 'ly1', name: 'Diseño 1', role: 'single', pageWidth: 210, pageHeight: 297, background: '#ffffff', elements: [textEl({ id: 'a' }), { kind: 'nonsense' }] };
    const doc = normalizeBookDocument({ spreads: [], layouts: [layout, { id: 'bad' }] }) as any;
    expect(doc.layouts).toHaveLength(1);
    expect(doc.layouts[0]).toMatchObject({ id: 'ly1', name: 'Diseño 1', role: 'single' });
    expect(doc.layouts[0].elements.map((e: any) => e.id)).toEqual(['a']);
    expect((normalizeBookDocument({ spreads: [] }) as any).layouts).toBeUndefined();
    expect((normalizeBookDocument({ spreads: [], layouts: 'x' }) as any).layouts).toBeUndefined();
    const many = Array.from({ length: 30 }, (_, i) => ({ ...layout, id: `l${i}` }));
    expect((normalizeBookDocument({ spreads: [], layouts: many }) as any).layouts).toHaveLength(24);
  });
});
