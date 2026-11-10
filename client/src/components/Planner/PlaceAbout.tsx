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
    return <div className="!h-[14px] !w-[40%] !rounded-[6px] ![background:var(--bg-hover)]" data-testid="place-about-loading" style={{ opacity: 0.7 }} />
  }
  if (!data || data.disabled) return null

  const facts = data.facts.map(f => ({ f, label: factLabel(f, t, locale) })).filter(x => x.label)
  const website = data.facts.find(f => f.kind === 'website')?.value as string | undefined
  const wikidata = data.facts.find(f => f.kind === 'wikidata')?.value as string | undefined
  if (!data.description && !facts.length && !data.photos.length) return null

  const d = data.description
  const long = !!d && d.text.length > 280

  return (
    <section className="!flex !flex-col !gap-[8px] ![background:var(--bg-hover)] !rounded-[10px] !p-[8px_12px]" aria-label={t('place.about.title')}>
      <div className="!flex !items-center !gap-[6px] !text-[length:11px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)]">
        <BookOpen size={12} /> {t('place.about.title')}
      </div>

      {d && (
        <div>
          <p style={{
            margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)',
            ...(long && !expanded ? { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
          }}>{d.text}</p>
          <div className="!flex !items-center !gap-[8px] !mt-[4px] !flex-wrap">
            {long && (
              <button className="!inline-flex !items-center !gap-[2px] ![background:none] ![border:none] !p-[0] !text-[length:11px] ![color:var(--text-primary)] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => setExpanded(v => !v)}>
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {expanded ? t('place.about.less') : t('place.about.more')}
              </button>
            )}
            <span className="!text-[length:10px] ![color:var(--text-faint)]">
              {d.sourceUrl
                ? <a className="![color:inherit]" href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{SOURCE_LABEL[d.source]}</a>
                : SOURCE_LABEL[d.source]}
              {' · '}{d.license}
            </span>
          </div>
        </div>
      )}

      {(facts.length > 0 || website || wikidata) && (
        <div className="!flex !flex-wrap !gap-[4px]">
          {facts.map(({ f, label }) => (
            <span className="!text-[length:11px] !p-[2px_8px] !rounded-[99px] ![background:var(--bg-card)] ![color:var(--text-secondary,_var(--text-muted))] ![border:1px_solid_var(--border-faint)]" key={`${f.kind}-${label}`} data-fact={f.kind}>{label}</span>
          ))}
          {website && (
            <a className="!inline-flex !items-center !gap-[3px] !text-[length:11px] !p-[2px_8px] !rounded-[99px] ![background:var(--bg-card)] ![color:var(--text-primary)] ![border:1px_solid_var(--border-faint)] ![text-decoration:none]" href={website} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={10} /> {t('place.about.website')}
            </a>
          )}
          {wikidata && (
            <a className="!text-[length:11px] !p-[2px_8px] !rounded-[99px] ![color:var(--text-faint)] ![border:1px_solid_var(--border-faint)] ![text-decoration:none]" href={wikidata} target="_blank" rel="noopener noreferrer">Wikidata</a>
          )}
        </div>
      )}

      {data.photos.length > 0 && (
        <div className="!flex !gap-[6px] !overflow-x-auto !pb-[2px]">
          {data.photos.map(p => {
            const credit = [p.author, p.license].filter(Boolean).join(' · ')
            return (
              <a className="!flex-[0_0_auto] !w-[112px] ![text-decoration:none] ![color:var(--text-faint)]" key={p.sourceUrl} href={p.sourceUrl} target="_blank" rel="noopener noreferrer" title={credit ? `${p.title} — ${credit}` : p.title}>
                <img className="!w-[112px] !h-[80px] !object-cover !rounded-[6px] !block ![background:var(--bg-card)]" src={p.thumbUrl} alt={p.title} loading="lazy" referrerPolicy="no-referrer" />
                <span className="!block !text-[length:9px] !leading-[1.3] !mt-[2px] !whitespace-nowrap !overflow-hidden !text-ellipsis">
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
