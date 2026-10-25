/**
 * Gathers what a magazine is made of — each journey's entries, photos and
 * route; each public story's blocks — and turns it into the plain input
 * buildMagazine (Studio/magazineLayout.ts) lays out. All the fetching lives
 * here so the layout stays pure.
 */
import { apiClient, journeyApi } from '../../api/client'
import type { BlogBlock, EntryCard, ServerPost, ServerPostSummary } from '../../blog/types'
import { markdownToPlainText } from '../Journey/stripMarkdown'
import { fetchJourneyGpxTracks } from '../Journey/journeyGpx'
import { DEFAULT_TILE_URL, computeRouteStats } from '../PDF/gpxDrawing'
import { buildOverviewRouteImages } from '../Studio/buildRouteImages'
import type { AutoEntry } from '../Studio/autoLayout'
import type { MagazineJourney, MagazineStory, StoryPiece } from '../Studio/magazineLayout'

export interface MagazineSourceJourney {
  id: number; title: string; subtitle: string | null; cover_image: string | null
  entry_count: number; photo_count: number; date_min: string | null; date_max: string | null
}
export interface MagazineSources { journeys: MagazineSourceJourney[]; stories: ServerPostSummary[] }

export const magazineApi = {
  sources: () => apiClient.get('/magazines/sources').then(r => r.data as MagazineSources),
  create: (data: { title: string; subtitle?: string | null; journey_ids: number[]; story_ids: string[] }) =>
    apiClient.post('/magazines', data).then(r => r.data as { journey_id: number; volume: number }),
}

interface JourneyFull {
  id: number; title: string; subtitle?: string | null
  trips?: { trip_id: number }[]
  entries?: {
    id: number; type?: string; title?: string | null; story?: string | null; location_name?: string | null; entry_date?: string | null
    location_lat?: number | null; location_lng?: number | null; country_code?: string | null
    pros_cons?: { pros: string[]; cons: string[] } | null
    photos?: { photo_id: number; width?: number | null; height?: number | null }[]
    author?: { username?: string } | null
  }[]
  contributors?: { username?: string; role?: string }[]
}

export async function loadJourneyFeature(id: number, opts: { tileUrl?: string; author?: string | null } = {}): Promise<MagazineJourney> {
  const j = (await journeyApi.get(id)) as JourneyFull
  const entries: AutoEntry[] = (j.entries || []).filter(e => e.type !== 'skeleton').map(e => ({
    id: e.id,
    title: e.title ?? null,
    story: markdownToPlainText(e.story),
    location: e.location_name ?? null,
    date: e.entry_date ?? null,
    photos: (e.photos || []).map(p => ({ photoId: p.photo_id, width: p.width ?? null, height: p.height ?? null })),
    prosCons: e.pros_cons ?? null,
    lat: e.location_lat ?? null,
    lng: e.location_lng ?? null,
    country: e.country_code ?? null,
  }))
  // The cover: the widest photo the journey has, falling back to its first.
  const all = entries.flatMap(e => e.photos)
  const wide = all.find(p => (p.width ?? 0) > (p.height ?? 0) * 1.2) || all[0]
  const days = new Set(entries.filter(e => e.photos.length || e.story?.trim()).map(e => e.date).filter(Boolean)).size
  let route = null
  let distanceKm: number | undefined
  let gainM: number | undefined
  if (j.trips?.length) {
    try {
      const tracks = await fetchJourneyGpxTracks(j.trips)
      if (tracks.length) {
        const s = computeRouteStats(tracks)
        distanceKm = s.totalDist || undefined
        gainM = s.gain || undefined
        route = await buildOverviewRouteImages(tracks, opts.tileUrl || DEFAULT_TILE_URL).catch(() => null)
      }
    } catch { /* a magazine without the route page is still a magazine */ }
  }
  const owner = j.contributors?.find(c => c.role === 'owner')?.username ?? null
  return {
    kind: 'journey', title: j.title, subtitle: j.subtitle ?? null, author: opts.author ?? owner,
    coverPhotoId: wide?.photoId ?? null, entries, days, distanceKm, gainM, route,
  }
}

const plain = (s: string | null | undefined) => (markdownToPlainText(s) || '').trim()

export function storyPieces(blocks: BlogBlock[], entries: EntryCard[] = []): StoryPiece[] {
  const out: StoryPiece[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph': { const t = plain(b.text); if (t) t.split(/\n{2,}/).forEach(p => out.push({ type: 'p', text: p.replace(/\n/g, ' ') })); break }
      case 'heading': if (b.text.trim()) out.push({ type: 'h', text: b.text.trim() }); break
      case 'quote': if (b.text.trim()) out.push({ type: 'q', text: plain(b.text), cite: b.cite || null }); break
      case 'photo': if (b.photo.photoId) out.push({ type: 'photo', photo: { photoId: b.photo.photoId }, caption: b.caption || null }); break
      case 'gallery': b.photos.forEach((p, i) => { if (p.photoId) out.push({ type: 'photo', photo: { photoId: p.photoId }, caption: i === 0 ? b.caption || null : null }) }); break
      case 'sketch':
      case 'map': if (b.image?.photoId) out.push({ type: 'photo', photo: { photoId: b.image.photoId }, caption: b.caption || null, contain: true }); break
      case 'entry': {
        const e = entries.find(x => x.id === b.entryId)
        if (e?.title) out.push({ type: 'h', text: e.title })
        if (e?.story) plain(e.story).split(/\n{2,}/).filter(Boolean).forEach(p => out.push({ type: 'p', text: p.replace(/\n/g, ' ') }))
        break
      }
      default: break
    }
  }
  return out
}

export async function loadStoryFeature(s: ServerPostSummary): Promise<MagazineStory> {
  const r = await fetch(`/api/site/stories/${encodeURIComponent(s.slug)}`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`story ${s.slug}: ${r.status}`)
  const { post } = (await r.json()) as { post: ServerPost }
  return {
    kind: 'story', title: post.title, standfirst: post.excerpt ?? null, author: post.author?.username ?? null,
    date: post.post_date ?? null, coverPhotoId: post.cover_photo_id ?? null, pieces: storyPieces(post.blocks, post.entries || []),
  }
}
