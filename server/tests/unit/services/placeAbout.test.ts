import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const mock = { db, closeDb: () => {}, reinitialize: () => {}, getPlaceWithTags: () => null, canAccessTrip: () => null, isOwner: () => false };
  return { testDb: db, dbMock: mock };
});
vi.mock('../../../src/db/database', () => dbMock);

const overpass = vi.hoisted(() => ({ fetchOverpassDetails: vi.fn() }));
vi.mock('../../../src/services/mapsService', () => overpass);

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import {
  enrichPlace, titleMatches, toWikiLang, stripHtml, toPhoto, nearbyWouldMislead, parseWikipediaTag, factsFromEntity,
} from '../../../src/services/placeAbout';

// ── a tiny fake Wikimedia ───────────────────────────────────────────────────

type Handler = (url: URL) => unknown | undefined;
let handlers: Handler[] = [];
const calls: string[] = [];

function respond(handler: Handler) { handlers.push(handler); }

const fetchMock = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  calls.push(url.toString());
  for (const h of handlers) {
    const body = h(url);
    if (body !== undefined) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
});

const img = (title: string, extra: Record<string, unknown> = {}) => ({
  title: `File:${title}`,
  imageinfo: [{
    thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/640px.jpg`,
    url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
    mime: 'image/jpeg',
    extmetadata: { Artist: { value: '<a href="//x">Ana <b>Pérez</b></a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } },
    ...extra,
  }],
});

const ALHAMBRA = {
  sitelinks: { eswiki: { title: 'Alhambra' }, enwiki: { title: 'Alhambra' } },
  claims: {
    P2044: [{ mainsnak: { datavalue: { value: { amount: '+740', unit: 'http://www.wikidata.org/entity/Q11573' } } } }],
    P571: [{ mainsnak: { datavalue: { value: { time: '+1238-00-00T00:00:00Z', precision: 7 } } } }],
    P1435: [{ mainsnak: { datavalue: { value: { id: 'Q9259' } } } }],
    P856: [{ mainsnak: { datavalue: { value: 'https://www.alhambra-patronato.es/' } } }],
    P18: [{ mainsnak: { datavalue: { value: 'Alhambra view.jpg' } } }],
    P373: [{ mainsnak: { datavalue: { value: 'Alhambra' } } }],
  },
};

beforeAll(() => { createTables(testDb); runMigrations(testDb); });
beforeEach(() => {
  testDb.exec('DELETE FROM place_details_cache');
  handlers = [];
  calls.length = 0;
  overpass.fetchOverpassDetails.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => { testDb.close(); });

function wikidataFor(entities: Record<string, unknown>) {
  respond(u => {
    const m = u.pathname.match(/Special:EntityData\/(Q\d+)\.json$/);
    if (m && entities[m[1]]) return { entities: { [m[1]]: entities[m[1]] } };
    if (u.hostname === 'www.wikidata.org' && u.searchParams.get('action') === 'wbgetentities') {
      return { entities: { Q9259: { labels: { es: { value: 'Patrimonio de la Humanidad' } } } } };
    }
    return undefined;
  });
}

function summaries(map: Record<string, { extract: string; type?: string }>) {
  respond(u => {
    const m = u.pathname.match(/\/api\/rest_v1\/page\/summary\/(.+)$/);
    if (!m) return undefined;
    const key = `${u.hostname}/${decodeURIComponent(m[1])}`;
    const hit = map[key];
    return hit ? { ...hit, content_urls: { desktop: { page: `https://${u.hostname}/wiki/${m[1]}` } } } : undefined;
  });
}

describe('enrichPlace', () => {
  it('ABOUT-001: an OSM place with a wikidata tag gets the article in the reader\'s language, Wikidata facts and Commons photos with credits', async () => {
    overpass.fetchOverpassDetails.mockResolvedValue({ tags: { wikidata: 'Q132629', wikimedia_commons: 'Category:Alhambra' } });
    wikidataFor({ Q132629: ALHAMBRA });
    summaries({ 'es.wikipedia.org/Alhambra': { extract: 'La Alhambra es una ciudad palatina andalusí situada en Granada, España.' } });
    respond(u => (u.hostname === 'commons.wikimedia.org' && u.searchParams.get('titles') === 'File:Alhambra view.jpg' ? { query: { pages: { 1: img('Alhambra view.jpg') } } } : undefined));
    respond(u => (u.hostname === 'commons.wikimedia.org' && u.searchParams.get('generator') === 'categorymembers'
      ? { query: { pages: { 2: { ...img('Patio de los Leones.jpg'), index: 1 }, 3: { ...img('Plano.svg', { mime: 'image/svg+xml' }), index: 2 } } } } : undefined));

    const r = await enrichPlace({ name: 'Alhambra', lat: 37.176, lng: -3.588, osmId: 'way:27434185', lang: 'es-ES', kind: 'Monumento' });

    expect(overpass.fetchOverpassDetails).toHaveBeenCalledWith('way', '27434185');
    expect(r.description).toMatchObject({ source: 'wikipedia', lang: 'es', license: 'CC BY-SA 4.0', sourceUrl: 'https://es.wikipedia.org/wiki/Alhambra' });
    expect(r.facts).toEqual([
      { kind: 'elevation', value: 740 },
      { kind: 'century', value: 13 },
      { kind: 'heritage', value: 'Patrimonio de la Humanidad' },
      { kind: 'website', value: 'https://www.alhambra-patronato.es/' },
      { kind: 'wikidata', value: 'https://www.wikidata.org/wiki/Q132629' },
    ]);
    // The Wikidata image first, then the category; the SVG plan is not a photograph.
    expect(r.photos.map(p => p.title)).toEqual(['Alhambra view.jpg', 'Patio de los Leones.jpg']);
    expect(r.photos[0]).toMatchObject({ author: 'Ana Pérez', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' });
    // Two curated pictures: no "nearby" search.
    expect(calls.some(c => c.includes('generator=geosearch'))).toBe(false);
  });

  it('ABOUT-002: Wikivoyage beats Wikipedia in the same language', async () => {
    overpass.fetchOverpassDetails.mockResolvedValue({ tags: { wikidata: 'Q8717' } });
    wikidataFor({ Q8717: { sitelinks: { eswiki: { title: 'Sevilla' }, eswikivoyage: { title: 'Sevilla' } }, claims: { P1082: [
      { mainsnak: { datavalue: { value: { amount: '+700000' } } }, qualifiers: { P585: [{ datavalue: { value: { time: '+2010-01-01T00:00:00Z' } } }] } },
      { mainsnak: { datavalue: { value: { amount: '+684234' } } }, qualifiers: { P585: [{ datavalue: { value: { time: '+2023-01-01T00:00:00Z' } } }] } },
    ] } } });
    summaries({
      'es.wikivoyage.org/Sevilla': { extract: 'Sevilla es la capital de Andalucía y una de las ciudades más visitadas de España.' },
      'es.wikipedia.org/Sevilla': { extract: 'Sevilla es un municipio y una ciudad de España, capital de la provincia homónima.' },
    });
    const r = await enrichPlace({ name: 'Sevilla', lat: 37.38, lng: -5.98, osmId: 'relation:342563', lang: 'es' });
    expect(r.description?.source).toBe('wikivoyage');
    // The latest-dated population, not the first listed.
    expect(r.facts.find(f => f.kind === 'population')).toEqual({ kind: 'population', value: 684234 });
  });

  it('ABOUT-003: without OSM tags, a nearby article is used only when its title names the place', async () => {
    respond(u => (u.searchParams.get('list') === 'geosearch'
      ? { query: { geosearch: [{ pageid: 1, title: 'Bar Las Columnas', dist: 5 }, { pageid: 2, title: 'Catedral de Sevilla', dist: 40 }] } } : undefined));
    respond(u => (u.searchParams.get('prop') === 'pageprops' && u.searchParams.get('pageids') === '2'
      ? { query: { pages: { 2: { pageprops: { wikibase_item: 'Q15' } } } } } : undefined));
    wikidataFor({ Q15: { sitelinks: { eswiki: { title: 'Catedral de Sevilla' } }, claims: {} } });
    summaries({ 'es.wikipedia.org/Catedral_de_Sevilla': { extract: 'La catedral de Santa María de la Sede de Sevilla es una catedral gótica cristiana.' } });

    const r = await enrichPlace({ name: 'Catedral de Sevilla', lat: 37.3858, lng: -5.9931, lang: 'es' });
    expect(r.description?.text).toContain('catedral gótica');
    expect(r.facts.find(f => f.kind === 'wikidata')).toEqual({ kind: 'wikidata', value: 'https://www.wikidata.org/wiki/Q15' });
  });

  it('ABOUT-004: a restaurant next to the cathedral is NOT described as the cathedral, and gets no "nearby" photos', async () => {
    respond(u => (u.searchParams.get('list') === 'geosearch'
      ? { query: { geosearch: [{ pageid: 2, title: 'Catedral de Sevilla', dist: 40 }] } } : undefined));
    const r = await enrichPlace({ name: 'Bodega Santa Cruz', lat: 37.3858, lng: -5.9931, lang: 'es', kind: 'Restaurante' });
    expect(r).toEqual({ description: null, facts: [], photos: [] });
    expect(calls.some(c => c.includes('generator=geosearch'))).toBe(false);
  });

  it('ABOUT-005: with nothing curated, a viewpoint gets photos taken nearby', async () => {
    respond(u => (u.searchParams.get('generator') === 'geosearch' ? { query: { pages: { 9: img('Vista.jpg') } } } : undefined));
    const r = await enrichPlace({ name: 'Mirador sin artículo', lat: 40, lng: -3, lang: 'es', kind: 'Mirador' });
    expect(r.photos.map(p => p.title)).toEqual(['Vista.jpg']);
  });

  it('ABOUT-006: an answer is cached for a week; the absence of one only ten minutes', async () => {
    overpass.fetchOverpassDetails.mockResolvedValue({ tags: { wikidata: 'Q132629' } });
    wikidataFor({ Q132629: ALHAMBRA });
    summaries({ 'es.wikipedia.org/Alhambra': { extract: 'La Alhambra es una ciudad palatina andalusí situada en Granada, España.' } });
    await enrichPlace({ name: 'Alhambra', lat: 37.176, lng: -3.588, osmId: 'way:1', lang: 'es' });
    const n = calls.length;
    vi.useFakeTimers({ now: Date.now() + 3 * 24 * 3600 * 1000, toFake: ['Date'] });
    await enrichPlace({ name: 'Alhambra', lat: 37.176, lng: -3.588, osmId: 'way:1', lang: 'es' });
    expect(calls.length).toBe(n);
    vi.useRealTimers();

    handlers = [];
    await enrichPlace({ name: 'Nada', lat: 1, lng: 1, lang: 'es' });
    const m = calls.length;
    await enrichPlace({ name: 'Nada', lat: 1, lng: 1, lang: 'es' });
    expect(calls.length).toBe(m);
    vi.useFakeTimers({ now: Date.now() + 11 * 60 * 1000, toFake: ['Date'] });
    await enrichPlace({ name: 'Nada', lat: 1, lng: 1, lang: 'es' });
    expect(calls.length).toBeGreaterThan(m);
  });

  it('ABOUT-007: a network failure is an empty answer, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    overpass.fetchOverpassDetails.mockResolvedValue(null);
    await expect(enrichPlace({ name: 'Toledo', lat: 39.86, lng: -4.02, osmId: 'node:5', lang: 'es' })).resolves.toEqual({ description: null, facts: [], photos: [] });
  });

  it('ABOUT-008: an OSM description is the last resort, credited to OpenStreetMap', async () => {
    overpass.fetchOverpassDetails.mockResolvedValue({ tags: { description: 'Fuente de agua potable junto al albergue de peregrinos.' } });
    const r = await enrichPlace({ name: 'Fuente', lat: 42, lng: -8, osmId: 'node:77', lang: 'es', kind: 'Agua' });
    expect(r.description).toEqual({ text: 'Fuente de agua potable junto al albergue de peregrinos.', source: 'osm', sourceUrl: null, license: 'ODbL 1.0', lang: null });
  });
});

describe('helpers', () => {
  it('ABOUT-009: titleMatches — accents, articles and disambiguation do not matter; other places do', () => {
    expect(titleMatches('Catedral de Sevilla', 'catedral de sevilla')).toBe(true);
    expect(titleMatches('Alhambra (Granada)', 'Alhambra')).toBe(true);
    expect(titleMatches('Puerta del Sol', 'La Puerta del Sol de Madrid')).toBe(true);
    expect(titleMatches('Mezquita-catedral de Córdoba', 'Mezquita de Cordoba')).toBe(true);
    expect(titleMatches('Catedral de Sevilla', 'Bodega Santa Cruz')).toBe(false);
    expect(titleMatches('Sol', 'Bar El Sol de Triana')).toBe(false);
  });

  it('ABOUT-010: language, HTML and URL hygiene', () => {
    expect(toWikiLang('es-ES')).toBe('es');
    expect(toWikiLang('br')).toBe('pt');
    expect(toWikiLang(null)).toBe('en');
    expect(stripHtml('<span>Foo &amp; <i>Bar</i></span>')).toBe('Foo & Bar');
    expect(parseWikipediaTag('es:Alhambra')).toEqual({ lang: 'es', title: 'Alhambra' });
    expect(parseWikipediaTag('Alhambra')).toBeNull();
    expect(toPhoto({ title: 'File:x.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'javascript:alert(1)', url: 'https://a/b', descriptionurl: 'https://a/c' }] })).toBeNull();
    expect(nearbyWouldMislead('Restaurante')).toBe(true);
    expect(nearbyWouldMislead('Mirador')).toBe(false);
    expect(nearbyWouldMislead(null)).toBe(false);
  });

  it('ABOUT-011: Wikidata facts — feet are not metres, deprecated claims are ignored, a website must be http(s)', async () => {
    const facts = await factsFromEntity({ claims: {
      P2044: [{ mainsnak: { datavalue: { value: { amount: '+2428', unit: 'http://www.wikidata.org/entity/Q3710' } } } }],
      P1082: [{ rank: 'deprecated', mainsnak: { datavalue: { value: { amount: '+999' } } } }],
      P856: [{ mainsnak: { datavalue: { value: 'javascript:alert(1)' } } }],
      P571: [{ mainsnak: { datavalue: { value: { time: '-0200-00-00T00:00:00Z', precision: 9 } } } }],
    } }, 'Q1', 'es');
    expect(facts).toEqual([{ kind: 'inception', value: -200 }, { kind: 'wikidata', value: 'https://www.wikidata.org/wiki/Q1' }]);
  });
});
