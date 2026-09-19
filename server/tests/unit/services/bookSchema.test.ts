// BOOKSCHEMA-001 to BOOKSCHEMA-006
import { bookElementSchema, normalizeBookDocument, MAX_IMAGE_SRC_LENGTH } from '../../../src/services/journeyBook/bookSchema';

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
