import { db } from '../db/database';
import { fetchOverpassDetails } from './mapsService';

/**
 * "About this place": a description, a few facts and some photographs for a
 * saved place, from the free encyclopaedias — Wikivoyage/Wikipedia for the
 * text, Wikidata for the facts, Wikimedia Commons for the pictures.
 *
 * A trimmed port of liketrek/TREK's place-enrichment service (same AGPLv3
 * license). The rules kept from it, because each one fixes a real failure:
 *
 * - Identity first. The article has to be about THIS place: the OSM object's
 *   own `wikidata`/`wikipedia` tags when the place came from OpenStreetMap,
 *   else a Wikipedia geosearch around its coordinates whose title matches its
 *   name. A nearby article with another name is never used — a café next to a
 *   cathedral must not be described as the cathedral.
 * - The reader's language through Wikidata sitelinks, Wikivoyage before
 *   Wikipedia (it describes a place for someone about to go there).
 * - Pictures ladder: the Wikidata image, then the Commons category, and only
 *   when those gave fewer than two, pictures taken nearby — and never nearby
 *   for a restaurant, a café or a shop, where "nearby" is someone else's
 *   building.
 * - Every picture carries its author and licence (CC BY / BY-SA require it).
 * - An answer is cached a week, the absence of one ten minutes (a timeout is
 *   not proof a place has no article).
 *
 * Fork differences: no Google, no TREK Places API, no byte caching — the
 * thumbnails are Commons' own (upload.wikimedia.org), shown in the inspector.
 */

const UA = 'Trek Wanderer (https://github.com/MelAnubis/trek)';
const TIMEOUT_MS = 8000;
const CACHE_KIND = 2;
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 10 * 60 * 1000;
const PHOTO_CAP = 6;
const THUMB_WIDTH = 640;

export interface EnrichmentRequest {
  name: string;
  lat: number | null;
  lng: number | null;
  /** "node:123", "way:45", "relation:6" — the place's OSM object, when it has one. */
  osmId?: string | null;
  lang?: string | null;
  /** The place's category name, only to decide whether nearby photos would mislead. */
  kind?: string | null;
}

export interface PlaceDescription {
  text: string;
  source: 'wikivoyage' | 'wikipedia' | 'osm';
  sourceUrl: string | null;
  license: string;
  lang: string | null;
}

export type PlaceFact =
  | { kind: 'population'; value: number }
  | { kind: 'elevation'; value: number }
  | { kind: 'inception'; value: number }
  | { kind: 'century'; value: number }
  | { kind: 'heritage'; value: string }
  | { kind: 'website'; value: string }
  | { kind: 'wikidata'; value: string };

export interface PlacePhoto {
  thumbUrl: string;
  fullUrl: string;
  sourceUrl: string;
  title: string;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
}

export interface Enrichment {
  description: PlaceDescription | null;
  facts: PlaceFact[];
  photos: PlacePhoto[];
}

// ── small helpers ──────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

/** Wikipedia language code from an app locale ("es-ES" → "es", "zhTw" → "zh"). */
export function toWikiLang(lang: string | null | undefined): string {
  const l = (lang || 'en').toLowerCase().replace(/[^a-z-]/g, '');
  const base = l.split('-')[0].slice(0, 3);
  if (base === 'br') return 'pt';
  return base || 'en';
}

/** Lower-case, no accents, letters and digits only — for comparing names. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'the', 'of', 'y', 'and', 'le', 'les', 'des', 'du', 'di', 'da', 'do', 'der', 'die', 'das', 'san', 'santa', 'saint', 'st']);

/**
 * Whether an article title names this place. Disambiguation in parentheses
 * ("Alhambra (Granada)") is ignored; then either one contains the other, or
 * most of the place's significant words are in the title.
 */
export function titleMatches(title: string, name: string): boolean {
  const t = fold(title.replace(/\s*\([^)]*\)\s*$/, '').replace(/,.*$/, ''));
  const n = fold(name);
  if (!t || !n) return false;
  if (t === n || t.includes(n) || (n.includes(t) && t.length >= 4)) return true;
  const words = n.split(' ').filter(w => w.length > 2 && !STOP.has(w));
  if (!words.length) return false;
  const hit = words.filter(w => t.split(' ').includes(w)).length;
  return hit / words.length >= 0.6;
}

/** Plain text out of the HTML Commons puts in its Artist field. */
export function stripHtml(html: string | undefined | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
}

const httpUrl = (s: unknown): string | null => (typeof s === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(s.trim()) ? s.trim() : null);

/** The place kinds for which a picture "taken nearby" is someone else's building. */
const NEARBY_MISLEADS = ['restaurant', 'café', 'cafe', 'bar', 'pub', 'hotel', 'hostel', 'shop', 'tienda', 'super', 'bakery', 'panader',
  'pharmacy', 'farmacia', 'bank', 'banco', 'fast', 'comida', 'alojamiento', 'lodging', 'apartment', 'apartamento', 'restaurante', 'cafetería'];

export function nearbyWouldMislead(kind: string | null | undefined): boolean {
  const k = (kind || '').toLowerCase();
  return !!k && NEARBY_MISLEADS.some(w => k.includes(w));
}

// ── identity ───────────────────────────────────────────────────────────────

interface Identity {
  wikidata: string | null;
  /** "es:Alhambra" as OSM writes it. */
  wikipedia: string | null;
  commonsCategory: string | null;
  osmDescription: string | null;
}

/** "es:Alhambra" → { lang: 'es', title: 'Alhambra' }. */
export function parseWikipediaTag(tag: string | null): { lang: string; title: string } | null {
  if (!tag) return null;
  const m = tag.match(/^([a-z-]{2,12}):(.+)$/i);
  return m ? { lang: m[1].toLowerCase(), title: m[2].trim() } : null;
}

async function identityFromOsm(osmId: string): Promise<Identity | null> {
  const [type, id] = osmId.split(':');
  if (!type || !/^\d+$/.test(id || '')) return null;
  const el = await fetchOverpassDetails(type, id);
  const tags = el?.tags;
  if (!tags) return null;
  const wd = tags.wikidata && /^Q\d+$/.test(tags.wikidata) ? tags.wikidata : null;
  const commons = tags.wikimedia_commons?.startsWith('Category:') ? tags.wikimedia_commons.slice(9) : null;
  return { wikidata: wd, wikipedia: tags.wikipedia || null, commonsCategory: commons, osmDescription: tags.description || null };
}

/** A Wikipedia article within 500 m whose title names the place, with its Wikidata id. */
async function identityFromGeosearch(name: string, lat: number, lng: number, lang: string): Promise<Identity | null> {
  for (const wl of [...new Set([lang, 'en'])]) {
    const geo = await getJson<{ query?: { geosearch?: { pageid: number; title: string; dist: number }[] } }>(
      `https://${wl}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=500&gslimit=20&format=json&origin=*`,
    );
    const hit = (geo?.query?.geosearch || []).filter(p => titleMatches(p.title, name)).sort((a, b) => a.dist - b.dist)[0];
    if (!hit) continue;
    const props = await getJson<{ query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } }>(
      `https://${wl}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&pageids=${hit.pageid}&format=json&origin=*`,
    );
    const wd = props?.query?.pages?.[String(hit.pageid)]?.pageprops?.wikibase_item ?? null;
    return { wikidata: wd && /^Q\d+$/.test(wd) ? wd : null, wikipedia: `${wl}:${hit.title}`, commonsCategory: null, osmDescription: null };
  }
  return null;
}

// ── Wikidata ───────────────────────────────────────────────────────────────

interface Snak { datavalue?: { value: unknown } }
interface Claim { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }
interface Entity { sitelinks?: Record<string, { title: string }>; claims?: Record<string, Claim[]> }

/** The claim to read: a preferred one, else the latest-dated (P585), else the last listed. */
function pickClaim(claims: Claim[] | undefined): Claim | null {
  const usable = (claims || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
  if (!usable.length) return null;
  const preferred = usable.find(c => c.rank === 'preferred');
  if (preferred) return preferred;
  const dated = usable.map(c => ({ c, t: String((c.qualifiers?.P585?.[0]?.datavalue?.value as { time?: string } | undefined)?.time || '') })).filter(x => x.t);
  if (dated.length) return dated.sort((a, b) => a.t.localeCompare(b.t))[dated.length - 1].c;
  return usable[usable.length - 1];
}

async function fetchEntity(qid: string): Promise<Entity | null> {
  const data = await getJson<{ entities?: Record<string, Entity> }>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  return data?.entities?.[qid] ?? null;
}

async function entityLabels(ids: string[], lang: string): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const data = await getJson<{ entities?: Record<string, { labels?: Record<string, { value: string }> }> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('%7C')}&props=labels&languages=${lang}%7Cen&format=json&origin=*`,
  );
  const out: Record<string, string> = {};
  for (const id of ids) {
    const labels = data?.entities?.[id]?.labels;
    const label = labels?.[lang]?.value || labels?.en?.value;
    if (label) out[id] = label;
  }
  return out;
}

export async function factsFromEntity(entity: Entity, qid: string, lang: string): Promise<PlaceFact[]> {
  const c = entity.claims || {};
  const facts: PlaceFact[] = [];
  const quantity = (claim: Claim | null) => {
    const v = claim?.mainsnak?.datavalue?.value as { amount?: string; unit?: string } | undefined;
    const n = v?.amount ? Number(v.amount) : NaN;
    return Number.isFinite(n) ? { n, unit: v?.unit || '' } : null;
  };

  const pop = quantity(pickClaim(c.P1082));
  if (pop && pop.n > 0) facts.push({ kind: 'population', value: Math.round(pop.n) });

  const ele = quantity(pickClaim(c.P2044));
  // Metres only (Q11573); a value in feet would be a wrong number with the right unit printed.
  if (ele && ele.unit.endsWith('/Q11573')) facts.push({ kind: 'elevation', value: Math.round(ele.n) });

  const inc = pickClaim(c.P571)?.mainsnak?.datavalue?.value as { time?: string; precision?: number } | undefined;
  const m = inc?.time?.match(/^([+-])(\d+)-/);
  if (m && inc?.precision != null) {
    const year = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    if (inc.precision >= 9) facts.push({ kind: 'inception', value: year });
    else if (inc.precision === 7) facts.push({ kind: 'century', value: Math.ceil(Math.abs(year) / 100) * Math.sign(year || 1) });
  }

  const heritageIds = (c.P1435 || []).filter(x => x.rank !== 'deprecated')
    .map(x => (x.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => !!x && /^Q\d+$/.test(x)).slice(0, 2);
  if (heritageIds.length) {
    const labels = await entityLabels(heritageIds, lang);
    for (const id of heritageIds) if (labels[id]) facts.push({ kind: 'heritage', value: labels[id] });
  }

  const site = httpUrl(pickClaim(c.P856)?.mainsnak?.datavalue?.value);
  if (site) facts.push({ kind: 'website', value: site });

  facts.push({ kind: 'wikidata', value: `https://www.wikidata.org/wiki/${qid}` });
  return facts;
}

// ── description ────────────────────────────────────────────────────────────

interface Summary { type?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }

async function summary(host: 'wikipedia' | 'wikivoyage', lang: string, title: string): Promise<PlaceDescription | null> {
  const s = await getJson<Summary>(`https://${lang}.${host}.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  const text = s?.extract?.trim();
  if (!text || s?.type === 'disambiguation' || text.length < 40) return null;
  return { text, source: host, sourceUrl: httpUrl(s?.content_urls?.desktop?.page) ?? null, license: 'CC BY-SA 4.0', lang };
}

async function describe(identity: Identity, entity: Entity | null, lang: string): Promise<PlaceDescription | null> {
  const tag = parseWikipediaTag(identity.wikipedia);
  if (entity?.sitelinks) {
    const wanted: { site: string; host: 'wikivoyage' | 'wikipedia'; lang: string }[] = [
      { site: `${lang}wikivoyage`, host: 'wikivoyage', lang },
      { site: `${lang}wiki`, host: 'wikipedia', lang },
      ...(tag && tag.lang !== lang ? [{ site: `${tag.lang}wiki`, host: 'wikipedia' as const, lang: tag.lang }] : []),
      ...(lang !== 'en' ? [{ site: 'enwikivoyage', host: 'wikivoyage' as const, lang: 'en' }, { site: 'enwiki', host: 'wikipedia' as const, lang: 'en' }] : []),
    ];
    for (const w of wanted) {
      const title = entity.sitelinks[w.site]?.title;
      if (!title) continue;
      const hit = await summary(w.host, w.lang, title);
      if (hit) return hit;
    }
  }
  if (tag) {
    const hit = await summary('wikipedia', tag.lang, tag.title);
    if (hit) return hit;
  }
  // Something a mapper wrote about the place beats nothing.
  if (identity.osmDescription && identity.osmDescription.trim().length >= 20) {
    return { text: identity.osmDescription.trim(), source: 'osm', sourceUrl: null, license: 'ODbL 1.0', lang: null };
  }
  return null;
}

// ── photos ─────────────────────────────────────────────────────────────────

interface ImageInfo {
  thumburl?: string; url?: string; descriptionurl?: string; mime?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
}
interface CommonsPage { title?: string; imageinfo?: ImageInfo[] }

const IMAGE_PROPS = `prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiextmetadatafilter=Artist%7CLicenseShortName%7CLicenseUrl&iiurlwidth=${THUMB_WIDTH}&format=json&origin=*`;

export function toPhoto(page: CommonsPage): PlacePhoto | null {
  const ii = page.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) return null;
  const thumbUrl = httpUrl(ii.thumburl);
  const fullUrl = httpUrl(ii.url);
  const sourceUrl = httpUrl(ii.descriptionurl);
  if (!thumbUrl || !fullUrl || !sourceUrl) return null;
  return {
    thumbUrl, fullUrl, sourceUrl,
    title: (page.title || '').replace(/^File:/, ''),
    author: stripHtml(ii.extmetadata?.Artist?.value),
    license: ii.extmetadata?.LicenseShortName?.value?.trim() || null,
    licenseUrl: httpUrl(ii.extmetadata?.LicenseUrl?.value),
  };
}

async function commonsQuery(params: string): Promise<PlacePhoto[]> {
  const data = await getJson<{ query?: { pages?: Record<string, CommonsPage & { index?: number }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&${params}&${IMAGE_PROPS}`,
  );
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map(toPhoto).filter((p): p is PlacePhoto => !!p);
}

async function collectPhotos(identity: Identity, entity: Entity | null, req: EnrichmentRequest): Promise<PlacePhoto[]> {
  const out: PlacePhoto[] = [];
  const seen = new Set<string>();
  const add = (list: PlacePhoto[]) => { for (const p of list) if (!seen.has(p.title) && out.length < PHOTO_CAP) { seen.add(p.title); out.push(p); } };

  const image = (pickClaim(entity?.claims?.P18)?.mainsnak?.datavalue?.value as string | undefined) || null;
  if (image) add(await commonsQuery(`titles=${encodeURIComponent(`File:${image}`)}`));

  const category = identity.commonsCategory || (pickClaim(entity?.claims?.P373)?.mainsnak?.datavalue?.value as string | undefined) || null;
  if (category && out.length < PHOTO_CAP) {
    add(await commonsQuery(`generator=categorymembers&gcmtitle=${encodeURIComponent(`Category:${category}`)}&gcmtype=file&gcmlimit=15`));
  }

  // Nearby is the fallback with no claim on the subject at all.
  if (out.length < 2 && req.lat != null && req.lng != null && !nearbyWouldMislead(req.kind)) {
    add(await commonsQuery(`generator=geosearch&ggscoord=${req.lat}%7C${req.lng}&ggsradius=300&ggsnamespace=6&ggslimit=10`));
  }
  return out;
}

// ── cache + entry point ────────────────────────────────────────────────────

export function cacheKey(req: EnrichmentRequest): string {
  if (req.osmId) return `enrich:${req.osmId}`;
  return `enrich:${(req.lat ?? 0).toFixed(4)},${(req.lng ?? 0).toFixed(4)}:${fold(req.name).slice(0, 60)}`;
}

const isEmpty = (e: Enrichment) => !e.description && !e.photos.length && !e.facts.some(f => f.kind !== 'wikidata');

function readCache(key: string, lang: string): Enrichment | null {
  try {
    const row = db.prepare('SELECT payload_json, fetched_at FROM place_details_cache WHERE place_id = ? AND lang = ? AND expanded = ?')
      .get(key, lang, CACHE_KIND) as { payload_json: string; fetched_at: number } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as Enrichment & { v?: number };
    if (parsed.v !== CACHE_VERSION) return null;
    const value: Enrichment = { description: parsed.description ?? null, facts: parsed.facts ?? [], photos: parsed.photos ?? [] };
    const ttl = isEmpty(value) ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
    return Date.now() - row.fetched_at < ttl ? value : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, lang: string, value: Enrichment): void {
  try {
    db.prepare('INSERT OR REPLACE INTO place_details_cache (place_id, lang, expanded, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .run(key, lang, CACHE_KIND, JSON.stringify({ ...value, v: CACHE_VERSION }), Date.now());
  } catch (err) {
    console.error('[enrich] cache write failed:', err);
  }
}

export async function enrichPlace(req: EnrichmentRequest): Promise<Enrichment> {
  const lang = toWikiLang(req.lang);
  const key = cacheKey(req);
  const cached = readCache(key, lang);
  if (cached) return cached;

  let identity: Identity | null = req.osmId ? await identityFromOsm(req.osmId) : null;
  // An OSM object without wiki tags still gets the geosearch — most small places have none.
  if ((!identity || (!identity.wikidata && !identity.wikipedia)) && req.lat != null && req.lng != null && req.name.trim()) {
    const geo = await identityFromGeosearch(req.name, req.lat, req.lng, lang);
    if (geo) identity = { ...geo, commonsCategory: identity?.commonsCategory ?? null, osmDescription: identity?.osmDescription ?? null };
  }
  identity ??= { wikidata: null, wikipedia: null, commonsCategory: null, osmDescription: null };

  const entity = identity.wikidata ? await fetchEntity(identity.wikidata) : null;
  const [description, facts, photos] = await Promise.all([
    describe(identity, entity, lang),
    entity && identity.wikidata ? factsFromEntity(entity, identity.wikidata, lang) : Promise.resolve([] as PlaceFact[]),
    collectPhotos(identity, entity, req),
  ]);
  const result: Enrichment = { description, facts, photos };
  writeCache(key, lang, result);
  return result;
}
