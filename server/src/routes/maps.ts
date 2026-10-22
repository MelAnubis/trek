import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { searchTilePoisAlongRoute, tileCategoryFor } from '../services/lodgingTileService'
import { findLodgingOptions } from '../services/lodgingOptionsService'
import {
  searchPlaces,
  getPlaceDetails,
  getPlaceDetailsExpanded,
  getPlacePhoto,
  reverseGeocode,
  resolveGoogleMapsUrl,
  autocompletePlaces,
  searchOverpassPois,
  searchOverpassPoisAlongRoute,
  POI_CATEGORY_KEYS,
} from '../services/mapsService';
import { db } from '../db/database';
import { serveFilePath } from '../services/placePhotoCache';
import { enrichPlace } from '../services/placeAbout';

const router = express.Router();

// POST /search
router.post('/search', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { query } = req.body;

  if (!query) return res.status(400).json({ error: 'Search query is required' });

  try {
    const result = await searchPlaces(authReq.user.id, query, req.query.lang as string);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Search error';
    console.error('Maps search error:', err);
    res.status(status).json({ error: message });
  }
});

// POST /autocomplete
router.post('/autocomplete', authenticate, async (req: Request, res: Response) => {
  const autocompleteEnabledRow = db.prepare("SELECT value FROM app_settings WHERE key = 'places_autocomplete_enabled'").get() as { value: string } | undefined;
  if (autocompleteEnabledRow?.value === 'false') return res.status(200).json({ suggestions: [], source: 'disabled' });

  const authReq = req as AuthRequest;
  const { input, lang, locationBias } = req.body;

  if (!input || typeof input !== 'string') {
    return res.status(400).json({ error: 'Input is required' });
  }

  if (input.length > 200) {
    return res.status(400).json({ error: 'Input too long (max 200 chars)' });
  }

  if (locationBias) {
    const { low, high } = locationBias;
    if (!low || !high
      || !Number.isFinite(low.lat) || !Number.isFinite(low.lng)
      || !Number.isFinite(high.lat) || !Number.isFinite(high.lng)) {
      return res.status(400).json({ error: 'Invalid locationBias: low and high must have finite lat and lng' });
    }
  }

  try {
    const result = await autocompletePlaces(
      authReq.user.id,
      input,
      lang as string,
      locationBias as { low: { lat: number; lng: number }; high: { lat: number; lng: number } } | undefined,
    );
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Autocomplete error';
    console.error('Maps autocomplete error:', err);
    res.status(status).json({ error: message });
  }
});

// GET /details/:placeId
router.get('/details/:placeId', authenticate, async (req: Request, res: Response) => {
  const detailsEnabledRow = db.prepare("SELECT value FROM app_settings WHERE key = 'places_details_enabled'").get() as { value: string } | undefined;
  if (detailsEnabledRow?.value === 'false') return res.status(200).json({ place: null, disabled: true });

  const authReq = req as AuthRequest;
  const { placeId } = req.params;
  const expand = req.query.expand as string | undefined;

  try {
    const refresh = req.query.refresh === '1';
    const result = expand
      ? await getPlaceDetailsExpanded(authReq.user.id, placeId, req.query.lang as string, refresh)
      : await getPlaceDetails(authReq.user.id, placeId, req.query.lang as string);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Error fetching place details';
    console.error('Maps details error:', err);
    res.status(status).json({ error: message });
  }
});

// GET /enrich — "about this place": Wikivoyage/Wikipedia text, Wikidata
// facts and Commons photos (see services/placeAbout.ts). Fail-open
// admin switch: only an explicit places_enrich_enabled = 'false' turns it off.
router.get('/enrich', authenticate, async (req: Request, res: Response) => {
  const off = db.prepare("SELECT value FROM app_settings WHERE key = 'places_enrich_enabled'").get() as { value: string } | undefined;
  if (off?.value === 'false') return res.json({ description: null, facts: [], photos: [], disabled: true });

  const q = req.query as Record<string, string | undefined>;
  const name = (q.name || '').trim().slice(0, 200);
  const lat = q.lat != null && q.lat !== '' ? Number(q.lat) : null;
  const lng = q.lng != null && q.lng !== '' ? Number(q.lng) : null;
  const osmId = q.osm_id && /^(node|way|relation):\d{1,15}$/.test(q.osm_id) ? q.osm_id : null;
  if ((lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng != null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
    return res.status(400).json({ error: 'invalid coordinates' });
  }
  if (!osmId && (lat == null || lng == null || !name)) return res.status(400).json({ error: 'name and coordinates, or osm_id, required' });
  try {
    const result = await enrichPlace({ name, lat, lng, osmId, lang: q.lang || null, kind: (q.kind || '').slice(0, 80) || null });
    res.json(result);
  } catch (err: unknown) {
    console.error('[Maps] enrich error:', err);
    res.status(500).json({ error: 'Error enriching place' });
  }
});

// GET /place-photo/:placeId
router.get('/place-photo/:placeId', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { placeId } = req.params;

  // Kill-switch only applies to Google Places API fetches — Wikimedia (coords: prefix) is always allowed
  if (!placeId.startsWith('coords:')) {
    const photosEnabledRow = db.prepare("SELECT value FROM app_settings WHERE key = 'places_photos_enabled'").get() as { value: string } | undefined;
    if (photosEnabledRow?.value === 'false') return res.status(200).json({ photoUrl: null });
  }
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);

  try {
    const result = await getPlacePhoto(authReq.user.id, placeId, lat, lng, req.query.name as string);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Error fetching photo';
    if (status >= 500) console.error('Place photo error:', err);
    res.status(status).json({ error: message });
  }
});

// GET /place-photo/:placeId/bytes — serve cached photo bytes from disk
router.get('/place-photo/:placeId/bytes', authenticate, (req: Request, res: Response) => {
  const { placeId } = req.params;
  const fp = serveFilePath(placeId);
  if (!fp) return res.status(404).json({ error: 'Photo not cached' });
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.sendFile(fp);
});

// GET /reverse
router.get('/reverse', authenticate, async (req: Request, res: Response) => {
  const { lat, lng, lang } = req.query as { lat: string; lng: string; lang?: string };
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  try {
    const result = await reverseGeocode(lat, lng, lang);
    res.json(result);
  } catch {
    res.json({ name: null, address: null });
  }
});

// GET /pois — OSM POI explore: places of a category within a viewport bbox
router.get('/pois', authenticate, async (req: Request, res: Response) => {
  const { category, south, west, north, east } = req.query as Record<string, string>
  if (!category) return res.status(400).json({ error: 'category required' })
  if (!POI_CATEGORY_KEYS.includes(category)) return res.status(400).json({ error: 'Unknown category' })
  const bbox = {
    south: parseFloat(south), west: parseFloat(west),
    north: parseFloat(north), east: parseFloat(east),
  }
  if ([bbox.south, bbox.west, bbox.north, bbox.east].some(isNaN)) {
    return res.status(400).json({ error: 'south, west, north, east required' })
  }
  try {
    const result = await searchOverpassPois(category, bbox)
    res.json(result)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    const message = err instanceof Error ? err.message : 'POI search error'
    if (status >= 500) console.error('[Maps] POI search error:', err)
    res.status(status).json({ error: message })
  }
})

// POST /lodging-near — alojamientos de una localidad para elegir uno (OpenStreetMap + Google si hay clave). Sin precios.
const LODGING_NEAR_LIMIT = 40
const lodgingNearCalls = new Map<number, number[]>()
router.post('/lodging-near', authenticate, async (req: Request, res: Response) => {
  const { lat, lng, radius } = req.body || {}
  const la = Number(lat), lo = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    return res.status(400).json({ error: 'lat and lng required' })
  }
  const r = radius === undefined ? 2500 : Number(radius)
  if (!Number.isFinite(r) || r < 200 || r > 5000) return res.status(400).json({ error: 'radius must be 200-5000 m' })

  // Cada llamada puede gastar cuota de Google: límite por usuario y hora.
  const userId = (req as AuthRequest).user.id
  const now = Date.now()
  const recent = (lodgingNearCalls.get(userId) || []).filter(t => now - t < 3600_000)
  if (recent.length >= LODGING_NEAR_LIMIT) { lodgingNearCalls.set(userId, recent); return res.status(429).json({ error: 'Too many requests, try again later' }) }
  recent.push(now); lodgingNearCalls.set(userId, recent)

  try {
    res.json(await findLodgingOptions(userId, la, lo, r))
  } catch (err) {
    console.error('[Maps] lodging-near error:', err)
    res.status(500).json({ error: 'Failed to search accommodation' })
  }
})

/** Solo para tests. */
export function resetLodgingNearLimiter(): void { lodgingNearCalls.clear() }

// POST /pois/along-route — OSM POIs of a category within `radius` metres of a polyline
router.post('/pois/along-route', authenticate, async (req: Request, res: Response) => {
  const { category, line, radius } = req.body || {}
  if (!category || typeof category !== 'string') return res.status(400).json({ error: 'category required' })
  if (!POI_CATEGORY_KEYS.includes(category)) return res.status(400).json({ error: 'Unknown category' })
  if (!Array.isArray(line) || line.length < 2 || line.length > 400) {
    return res.status(400).json({ error: 'line must have 2-400 points' })
  }
  const pts: [number, number][] = []
  for (const p of line) {
    const la = Number(p?.[0]), lo = Number(p?.[1])
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      return res.status(400).json({ error: 'Invalid line point' })
    }
    pts.push([la, lo])
  }
  try {
    // Las categorías poco densas (alojamiento, camping, estaciones, tiendas de bici, supermercados, agua) se sirven
    // por teselas con caché: sobreviven a las caídas de Overpass. Las densas (restaurantes, cafés…) van por corredor.
    const result = tileCategoryFor(category)
      ? await searchTilePoisAlongRoute(category, pts, Number(radius) || 1000)
      : await searchOverpassPoisAlongRoute(category, pts, Number(radius) || 1000)
    res.json(result)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    const message = err instanceof Error ? err.message : 'POI search error'
    if (status >= 500) console.error('[Maps] along-route POI error:', err)
    const detail = (err as { detail?: string[] }).detail
    res.status(status).json({ error: message, ...(detail?.length ? { detail: detail.slice(0, 3) } : {}) })
  }
})

// POST /resolve-url
router.post('/resolve-url', authenticate, async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  try {
    const result = await resolveGoogleMapsUrl(url);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 400;
    const message = err instanceof Error ? err.message : 'Failed to resolve URL';
    console.error('[Maps] URL resolve error:', message);
    res.status(status).json({ error: message });
  }
});

export default router;
