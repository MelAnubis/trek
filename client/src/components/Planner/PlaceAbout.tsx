import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { mapsApi } from '../../api/client'

/**
 * "About this place" in the place inspector: a Wikivoyage/Wikipedia
 * summary, a few Wikidata facts and a strip of Wikimedia Commons photos,
 * each with its author and licence (see server services/placeAbout.ts).
 *
 * Nothing shows until there is something to show — a café with no article
 * simply has no section, rather than an empty box saying so.
 */

export interface PlaceAboutData {
  description: { text: string; source: 'wikivoyage' | 'wikipedia' | 'osm'; sourceUrl: string | null; license: string; lang: string | null } | null
  facts: { kind: 'population' | 'elevation' | 'inception' | 'century' | 'heritage' | 'website' | 'wikidata'; value: number | string }[]
  photos: { thumbUrl: string; fullUrl: string; sourceUrl: string; title: string; author: string | null; license: string | null; licenseUrl: string | null }[]
  disabled?: boolean
}

type T = (key: string, params?: Record<string, string | number>) => string

interface Props {
  place: { id: number; name: string; lat: number | null; lng: number | null; osm_id?: string | null }
  categoryName?: string | null
  language: string
  locale: string
  t: T
}

// Per session: flipping between places in the planner shouldn't refetch.
const memo = new Map<string, PlaceAboutData>()

const SOURCE_LABEL: Record<string, string> = { wikivoyage: 'Wikivoyage', wikipedia: 'Wikipedia', osm: 'OpenStreetMap' }

function roman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  let v = Math.abs(n)
  for (const [k, s] of map) while (v >= k) { out += s; v -= k }
  return out
}

/** One fact as a short, localised line. Null for the kinds shown as links instead. */
export function factLabel(f: PlaceAboutData['facts'][number], t: T, locale: string): string | null {
  const num = (n: number) => new Intl.NumberFormat(locale).format(n)
  switch (f.kind) {
    case 'population': return t('place.about.population', { value: num(Number(f.value)) })
    case 'elevation': return t('place.about.elevation', { value: num(Number(f.value)) })
    case 'inception': {
      const y = Number(f.value)
      return y < 0 ? t('place.about.foundedBC', { value: -y }) : t('place.about.founded', { value: y })
    }
    case 'century': {
      const c = Number(f.value)
      return c < 0 ? t('place.about.centuryBC', { value: roman(c) }) : t('place.about.century', { value: roman(c) })
    }
    case 'heritage': return String(f.value)
    default: return null
  }
}

export default function PlaceAbout({ place, categoryName, language, locale, t }: Props) {
  const key = `${place.id}|${place.osm_id || ''}|${place.lat}|${place.lng}|${place.name}|${language}`
  const [data, setData] = useState<PlaceAboutData | null>(() => memo.get(key) ?? null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const canAsk = !!place.osm_id || (place.lat != null && place.lng != null && !!place.name?.trim())

  useEffect(() => {
    setExpanded(false)
    if (!canAsk) { setData(null); return }
    const hit = memo.get(key)
    if (hit) { setData(hit); return }
    setData(null)
    let cancelled = false
    setLoading(true)
    // A short delay: arrowing through places shouldn't fire a lookup for each.
    const timer = setTimeout(() => {
      // Inside a promise chain so even a synchronous throw ends in .catch.
      Promise.resolve()
        .then(() => mapsApi.enrich({ name: place.name, lat: place.lat, lng: place.lng, osm_id: place.osm_id || undefined, lang: language, kind: categoryName || undefined }))
        .then((d: PlaceAboutData) => { memo.set(key, d); if (!cancelled) setData(d) })
        .catch(() => { /* the section just doesn't appear */ })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer); setLoading(false) }
  }, [key, canAsk]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!canAsk) return null
  if (loading && !data) {
    return <div data-testid="place-about-loading" style={{ height: 14, width: '40%', borderRadius: 6, background: 'var(--bg-hover)', opacity: 0.7 }} />
  }
  if (!data || data.disabled) return null

  const facts = data.facts.map(f => ({ f, label: factLabel(f, t, locale) })).filter(x => x.label)
  const website = data.facts.find(f => f.kind === 'website')?.value as string | undefined
  const wikidata = data.facts.find(f => f.kind === 'wikidata')?.value as string | undefined
  if (!data.description && !facts.length && !data.photos.length) return null

  const d = data.description
  const long = !!d && d.text.length > 280

  return (
    <section aria-label={t('place.about.title')} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-hover)', borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>
        <BookOpen size={12} /> {t('place.about.title')}
      </div>

      {d && (
        <div>
          <p style={{
            margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
            ...(long && !expanded ? { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
          }}>{d.text}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {long && (
              <button type="button" onClick={() => setExpanded(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {expanded ? t('place.about.less') : t('place.about.more')}
              </button>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {d.sourceUrl
                ? <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{SOURCE_LABEL[d.source]}</a>
                : SOURCE_LABEL[d.source]}
              {' · '}{d.license}
            </span>
          </div>
        </div>
      )}

      {(facts.length > 0 || website || wikidata) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {facts.map(({ f, label }) => (
            <span key={`${f.kind}-${label}`} data-fact={f.kind} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-card)', color: 'var(--text-secondary, var(--text-muted))', border: '1px solid var(--border-faint)' }}>{label}</span>
          ))}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-faint)', textDecoration: 'none' }}>
              <ExternalLink size={10} /> {t('place.about.website')}
            </a>
          )}
          {wikidata && (
            <a href={wikidata} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, color: 'var(--text-faint)', border: '1px solid var(--border-faint)', textDecoration: 'none' }}>Wikidata</a>
          )}
        </div>
      )}

      {data.photos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {data.photos.map(p => {
            const credit = [p.author, p.license].filter(Boolean).join(' · ')
            return (
              <a key={p.sourceUrl} href={p.sourceUrl} target="_blank" rel="noopener noreferrer" title={credit ? `${p.title} — ${credit}` : p.title}
                style={{ flex: '0 0 auto', width: 112, textDecoration: 'none', color: 'var(--text-faint)' }}>
                <img src={p.thumbUrl} alt={p.title} loading="lazy" referrerPolicy="no-referrer"
                  style={{ width: 112, height: 80, objectFit: 'cover', borderRadius: 6, display: 'block', background: 'var(--bg-card)' }} />
                <span style={{ display: 'block', fontSize: 9, lineHeight: 1.3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {credit || 'Wikimedia Commons'}
                </span>
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}
