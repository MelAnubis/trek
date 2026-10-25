/**
 * Zona pública #ESTODOBAJADA — lo que se ve sin cuenta (y una pestaña más
 * para quien la tiene). Rutas (viajes marcados como públicos), Relatos (posts
 * de los diarios del sitio) y un sitio para apuntarse. Siempre en claro, en
 * blanco y negro: las fotos y los mapas ponen el color.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Download, Lock, MapPin } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useAuthStore } from '../store/authStore'
import BlogPostView, { READING_FONT } from '../components/Blog/BlogPostView'
import JourneyMap from '../components/Journey/JourneyMap'
import type { ServerPost, ServerPostSummary } from '../blog/types'
import ProfileArt from './ProfileArt'
import { fmtKm, fmtM, type Profile } from './profile'

// ── Data ────────────────────────────────────────────────────────────────────

export interface SiteRoute {
  id: number; title: string; description: string | null; start_date: string | null; end_date: string | null
  cover_image: string | null; cycling: boolean; author: string; days: number
  distance_km: number; gain_m: number; loss_m: number; max_ele_m: number | null
  profile: Profile; lines: [number, number][][]
}
export interface SiteStage {
  day_number: number; date: string | null; title: string | null
  distance_km: number; gain_m: number; loss_m: number; max_ele_m: number | null
  lines: [number, number][][]; profile: Profile
  places: { name: string; lat: number; lng: number; category: string | null }[]
}
export interface SiteRouteDetail extends SiteRoute { stages: SiteStage[]; extra_lines: [number, number][][]; gpx: boolean }
export interface SiteHome { routes: SiteRoute[]; stories: ServerPostSummary[]; registration: boolean }
interface StoryPage { post: ServerPost; prev: { slug: string; title: string } | null; next: { slug: string; title: string } | null }

const PHOTO_BASE = '/api/site/photos'
const sitePhoto = (id: number, kind: 'thumbnail' | 'original') => `${PHOTO_BASE}/${id}/${kind}`

function useJson<T>(url: string | null): { data: T | null; error: boolean } {
  const [state, setState] = useState<{ data: T | null; error: boolean }>({ data: null, error: false })
  useEffect(() => {
    if (!url) return
    let alive = true
    setState({ data: null, error: false })
    fetch(url, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { if (alive) setState({ data: d, error: false }) })
      .catch(() => { if (alive) setState({ data: null, error: true }) })
    return () => { alive = false }
  }, [url])
  return state
}

/** Where the public home lives: "/" for visitors, "/explora" inside the app. */
export function useSiteHome(): string {
  const authed = useAuthStore(s => s.isAuthenticated)
  return authed ? '/explora' : '/'
}

const JOST = "Jost, Futura, 'Century Gothic', sans-serif"

function Sticker({ size = 13 }: { size?: number }) {
  return <span className="inline-block bg-[#111111] text-white leading-none whitespace-nowrap" style={{ fontFamily: JOST, fontWeight: 300, letterSpacing: '0.1em', fontSize: size, padding: `${size * 0.55}px ${size * 0.7}px` }}>#ESTODOBAJADA</span>
}

// ── Layout ──────────────────────────────────────────────────────────────────

function SiteShell({ children, registration }: { children: React.ReactNode; registration?: boolean }) {
  const { t } = useTranslation()
  const authed = useAuthStore(s => s.isAuthenticated)
  const home = useSiteHome()
  return (
    <div className="min-h-screen bg-white text-[#111111]" style={{ fontFamily: 'Inter, system-ui, sans-serif', ['--blog-accent' as string]: '#111111' }} data-site>
      <header className="sticky top-0 z-[500] bg-white/95 backdrop-blur border-b border-zinc-200" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <Link to={home} className="flex items-center gap-3 shrink-0" aria-label="#ESTODOBAJADA · Trek Wanderer">
            <Sticker size={12} />
            <span className="hidden md:inline text-[9px] tracking-[0.42em]" style={{ fontFamily: JOST }}>TREK WANDERER</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-[13px] font-medium text-zinc-600" aria-label={t('site.nav')}>
            <Link to={`${home}#rutas`} className="px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-[#111111]">{t('site.routes')}</Link>
            <Link to={`${home}#relatos`} className="px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 hover:text-[#111111]">{t('site.stories')}</Link>
          </nav>
          <div className="flex-1" />
          {authed ? (
            <Link to="/dashboard" className="h-9 px-3.5 rounded-lg bg-[#111111] text-white text-[13px] font-semibold inline-flex items-center gap-1.5">{t('site.openApp')}<ArrowRight size={14} /></Link>
          ) : (
            <div className="flex items-center gap-1">
              <Link to="/login" className="h-9 px-3 rounded-lg text-[13px] font-medium text-zinc-600 hover:text-[#111111] inline-flex items-center">{t('site.signIn')}</Link>
              {registration !== false && <Link to="/login?mode=register" className="h-9 px-3.5 rounded-lg bg-[#111111] text-white text-[13px] font-semibold inline-flex items-center">{t('site.join')}</Link>}
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-zinc-200 mt-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-3"><Sticker size={12} /><span className="text-[12px] text-zinc-500">{t('blog.public.footer')}</span></div>
          <span className="text-[12px] text-zinc-400">{t('site.footerNote')}</span>
        </div>
      </footer>
    </div>
  )
}

function Stat({ value, label, light }: { value: string; label: string; light?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[22px] sm:text-[28px] font-bold tracking-[-0.02em] leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className={`text-[10px] font-semibold tracking-[0.12em] uppercase mt-1.5 ${light ? 'text-white/60' : 'text-zinc-500'}`}>{label}</div>
    </div>
  )
}

function useFmtDate() {
  const { locale } = useTranslation()
  return (d: string | null, long = false) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(locale, long ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' }) : '')
}

// ── Home ────────────────────────────────────────────────────────────────────

export function SiteHomePage() {
  const { t } = useTranslation()
  const { data, error } = useJson<SiteHome>('/api/site')
  useEffect(() => { document.title = '#ESTODOBAJADA · Trek Wanderer' }, [])
  useEffect(() => {
    if (!data || !location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [data])
  if (error) return <SiteShell><Empty text={t('site.unavailable')} /></SiteShell>
  if (!data) return <SiteShell><div className="h-[80vh]" /></SiteShell>
  return (
    <SiteShell registration={data.registration}>
      <Hero data={data} />
      <RoutesSection routes={data.routes} />
      <StoriesSection stories={data.stories} />
      <JoinBand registration={data.registration} />
    </SiteShell>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="max-w-[640px] mx-auto px-6 py-28 text-center text-zinc-500">{text}</div>
}

function Hero({ data }: { data: SiteHome }) {
  const { t, locale } = useTranslation()
  const fmt = useFmtDate()
  const story = data.stories.find(s => s.cover_photo_id) || null
  const route = data.routes[0] || null
  // A story with a photo goes on the cover; without one, the latest route's profile does.
  if (story) {
    return (
      <Link to={`/relatos/${story.slug}`} className="block relative h-[72vh] min-h-[440px] max-h-[820px] overflow-hidden bg-[#111111] group">
        <img src={sitePhoto(story.cover_photo_id!, 'original')} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.02]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 max-w-[1200px] mx-auto px-4 sm:px-6 pb-10 sm:pb-14 text-white">
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/75">{t('site.story')} · {fmt(story.post_date, true)}</div>
          <h1 className="mt-3 text-[40px] sm:text-[72px] font-extrabold tracking-[-0.035em] leading-[0.95] max-w-[16ch]">{story.title}</h1>
          {story.excerpt && <p className="mt-4 text-[17px] sm:text-[19px] text-white/85 max-w-[52ch]" style={{ fontFamily: READING_FONT }}>{story.excerpt}</p>}
          <span className="mt-6 inline-flex items-center gap-2 text-[14px] font-semibold border-b border-white/60 pb-0.5">{t('site.read')}<ArrowRight size={15} /></span>
        </div>
      </Link>
    )
  }
  if (route) {
    return (
      <Link to={`/rutas/${route.id}`} className="block bg-[#111111] text-white group">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-8">
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/60">{t('site.route')} · {t('site.daysCount', { count: route.days })}</div>
          <h1 className="mt-3 text-[40px] sm:text-[72px] font-extrabold tracking-[-0.035em] leading-[0.95] max-w-[16ch]">{route.title}</h1>
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Stat light value={fmtKm(route.distance_km, locale)} label={t('site.distance')} />
            <Stat light value={`+${fmtM(route.gain_m, locale)}`} label={t('site.gain')} />
            {route.max_ele_m != null && <Stat light value={fmtM(route.max_ele_m, locale)} label={t('site.maxEle')} />}
          </div>
        </div>
        <ProfileArt profile={route.profile} height={220} dark label={t('site.profileOf', { title: route.title })} />
      </Link>
    )
  }
  return (
    <section className="bg-[#111111] text-white">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-24">
        <Sticker size={22} />
        <h1 className="mt-6 text-[40px] sm:text-[64px] font-extrabold tracking-[-0.035em] leading-[0.95] max-w-[14ch]">{t('site.emptyHero')}</h1>
      </div>
    </section>
  )
}

function SectionHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div id={id} className="scroll-mt-20 flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[#111111] pb-4 mb-8">
      <h2 className="text-[34px] sm:text-[44px] font-extrabold tracking-[-0.03em] leading-none">{title}</h2>
      <p className="text-[14px] text-zinc-500" style={{ fontFamily: READING_FONT }}>{sub}</p>
    </div>
  )
}

function RoutesSection({ routes }: { routes: SiteRoute[] }) {
  const { t } = useTranslation()
  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-16">
      <SectionHead id="rutas" title={t('site.routes')} sub={t('site.routesSub')} />
      {routes.length === 0 ? <p className="text-zinc-500">{t('site.noRoutes')}</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-12">
          {routes.map(r => <RouteCard key={r.id} r={r} />)}
        </div>
      )}
    </section>
  )
}

function RouteCard({ r }: { r: SiteRoute }) {
  const { t, locale } = useTranslation()
  const fmt = useFmtDate()
  return (
    <Link to={`/rutas/${r.id}`} className="group block" data-testid="site-route-card">
      {/* Same frame for every card: the cover photo, or — without one — the profile on black. */}
      <div className="aspect-[16/7] overflow-hidden bg-[#111111] mb-4 relative">
        {r.cover_image
          ? <img src={r.cover_image} alt="" loading="lazy" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-[filter,transform] duration-700 group-hover:scale-[1.02]" />
          : <div className="absolute inset-x-0 bottom-0"><ProfileArt profile={r.profile} height={110} sticker={false} dark /></div>}
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{t('site.daysCount', { count: r.days })}{r.start_date ? ` · ${fmt(r.start_date)}` : ''}</div>
        {r.cycling && <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{t('site.bike')}</div>}
      </div>
      <h3 className="mt-1.5 text-[26px] font-bold tracking-[-0.02em] leading-tight group-hover:underline underline-offset-4 decoration-2">{r.title}</h3>
      <div className="mt-4">
        <ProfileArt profile={r.profile} height={130} label={t('site.profileOf', { title: r.title })} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat value={fmtKm(r.distance_km, locale)} label={t('site.distance')} />
        <Stat value={`+${fmtM(r.gain_m, locale)}`} label={t('site.gain')} />
        <Stat value={r.max_ele_m != null ? fmtM(r.max_ele_m, locale) : '—'} label={t('site.maxEle')} />
      </div>
    </Link>
  )
}

function StoriesSection({ stories }: { stories: ServerPostSummary[] }) {
  const { t } = useTranslation()
  const fmt = useFmtDate()
  if (!stories.length) return null
  const [first, ...rest] = stories
  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-20">
      <SectionHead id="relatos" title={t('site.stories')} sub={t('site.storiesSub')} />
      <Link to={`/relatos/${first.slug}`} className="group grid md:grid-cols-[1.4fr_1fr] gap-6 md:gap-10 items-center">
        <div className="aspect-[4/3] bg-zinc-100 overflow-hidden">
          {first.cover_photo_id && <img src={sitePhoto(first.cover_photo_id, 'original')} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]" />}
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{fmt(first.post_date, true)}</div>
          <h3 className="mt-2 text-[30px] sm:text-[40px] font-extrabold tracking-[-0.03em] leading-[1.02] group-hover:underline underline-offset-4 decoration-2">{first.title}</h3>
          {first.excerpt && <p className="mt-4 text-[17px] text-zinc-600 leading-relaxed line-clamp-4" style={{ fontFamily: READING_FONT }}>{first.excerpt}</p>}
          {first.author && <div className="mt-4 text-[13px] text-zinc-500">{t('blog.public.by', { name: first.author.username })}</div>}
        </div>
      </Link>
      {rest.length > 0 && (
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
          {rest.map(s => (
            <Link key={s.id} to={`/relatos/${s.slug}`} className="group block">
              <div className="aspect-[4/3] bg-zinc-100 overflow-hidden">
                {s.cover_photo_id && <img src={sitePhoto(s.cover_photo_id, 'thumbnail')} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />}
              </div>
              <div className="mt-3 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{fmt(s.post_date, true)}</div>
              <h3 className="mt-1 text-[21px] font-bold tracking-[-0.02em] leading-snug group-hover:underline underline-offset-4">{s.title}</h3>
              {s.excerpt && <p className="mt-2 text-[15px] text-zinc-600 line-clamp-3" style={{ fontFamily: READING_FONT }}>{s.excerpt}</p>}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function JoinBand({ registration }: { registration: boolean }) {
  const { t } = useTranslation()
  const authed = useAuthStore(s => s.isAuthenticated)
  if (authed) return null
  return (
    <section id="unete" className="mt-24 bg-[#111111] text-white">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 sm:py-20 grid md:grid-cols-[1.3fr_1fr] gap-10 items-end">
        <div>
          <span className="inline-block border border-white text-white leading-none" style={{ fontFamily: JOST, fontWeight: 300, letterSpacing: '0.1em', fontSize: 14, padding: '8px 10px' }}>#ESTODOBAJADA</span>
          <h2 className="mt-6 text-[34px] sm:text-[52px] font-extrabold tracking-[-0.035em] leading-[0.98]">{t('site.joinTitle')}</h2>
          <p className="mt-4 text-[16px] text-white/70 max-w-[46ch]" style={{ fontFamily: READING_FONT }}>{t('site.joinText')}</p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          {registration && <Link to="/login?mode=register" className="h-12 px-6 rounded-xl bg-white text-[#111111] text-[15px] font-semibold inline-flex items-center gap-2">{t('site.createAccount')}<ArrowRight size={16} /></Link>}
          <Link to="/login" className="h-12 px-6 rounded-xl border border-white/30 text-white text-[15px] font-semibold inline-flex items-center">{t('site.signIn')}</Link>
        </div>
      </div>
    </section>
  )
}

// ── Route ───────────────────────────────────────────────────────────────────

export function SiteRoutePage() {
  const { id } = useParams()
  const { t, locale } = useTranslation()
  const fmt = useFmtDate()
  const home = useSiteHome()
  const authed = useAuthStore(s => s.isAuthenticated)
  const { data, error } = useJson<SiteRouteDetail>(`/api/site/routes/${encodeURIComponent(id || '')}`)
  const { data: homeData } = useJson<SiteHome>(authed ? null : '/api/site')
  useEffect(() => { if (data) { document.title = `${data.title} · #ESTODOBAJADA`; window.scrollTo(0, 0) } }, [data])

  const map = useMemo(() => {
    if (!data) return null
    const stageLines = data.stages.flatMap(s => s.lines)
    const trail = [...stageLines, ...data.extra_lines].map(l => ({ points: l.map(([lat, lng]) => ({ lat, lng })), color: '#111111' }))
    const entries = data.stages.flatMap(s => s.places.map((p, i) => ({
      id: `${s.day_number}-${i}`, lat: p.lat, lng: p.lng, title: p.name, entry_date: s.date || `d${String(s.day_number).padStart(3, '0')}`, dayColor: '#111111', dayLabel: s.day_number,
    })))
    return { trail, entries, empty: !trail.length && !entries.length }
  }, [data])

  if (error) return <SiteShell><Empty text={t('site.routeNotFound')} /></SiteShell>
  if (!data || !map) return <SiteShell><div className="h-[80vh]" /></SiteShell>
  const registration = homeData?.registration ?? true
  const back = <Link to={`${home}#rutas`} className="inline-flex items-center gap-1.5 text-[13px] hover:underline"><ArrowLeft size={14} />{t('site.allRoutes')}</Link>

  return (
    <SiteShell registration={registration}>
      {data.cover_image ? (
        <header className="relative h-[60vh] min-h-[380px] max-h-[720px] bg-[#111111] overflow-hidden">
          <img src={data.cover_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/20" />
          <div className="absolute inset-x-0 top-0 max-w-[1200px] mx-auto px-4 sm:px-6 pt-5 text-white/90">{back}</div>
          <div className="absolute inset-x-0 bottom-0 max-w-[1200px] mx-auto px-4 sm:px-6 pb-10 text-white">
            <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/70">{t('site.route')} · {t('site.daysCount', { count: data.days })}{data.start_date ? ` · ${fmt(data.start_date)}` : ''}</div>
            <h1 className="mt-3 text-[40px] sm:text-[76px] font-extrabold tracking-[-0.035em] leading-[0.95] max-w-[16ch]">{data.title}</h1>
          </div>
        </header>
      ) : (
        <header className="bg-[#111111] text-white">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-5 pb-14 text-white/90">
            {back}
            <div className="mt-12 text-[11px] font-semibold tracking-[0.16em] uppercase text-white/60">{t('site.route')} · {t('site.daysCount', { count: data.days })}{data.start_date ? ` · ${fmt(data.start_date)}` : ''}</div>
            <h1 className="mt-3 text-[40px] sm:text-[76px] font-extrabold tracking-[-0.035em] leading-[0.95] max-w-[16ch] text-white">{data.title}</h1>
          </div>
        </header>
      )}

      <section className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 py-8 border-b border-zinc-200">
          <Stat value={fmtKm(data.distance_km, locale)} label={t('site.distance')} />
          <Stat value={`+${fmtM(data.gain_m, locale)}`} label={t('site.gain')} />
          <Stat value={`−${fmtM(data.loss_m, locale)}`} label={t('site.loss')} />
          <Stat value={data.max_ele_m != null ? fmtM(data.max_ele_m, locale) : '—'} label={t('site.maxEle')} />
          <Stat value={String(data.days)} label={t('site.days')} />
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-10 pt-10">
          <div className="min-w-0">
            {data.description && <p className="text-[19px] sm:text-[21px] leading-[1.6] text-zinc-800 whitespace-pre-line" style={{ fontFamily: READING_FONT }}>{data.description}</p>}
            {data.profile.length > 1 && (
              <div className="mt-10">
                <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500 mb-3">{t('site.profile')}</div>
                <ProfileArt profile={data.profile} height={220} label={t('site.profileOf', { title: data.title })} />
                <div className="flex justify-between text-[11px] text-zinc-500 mt-2" style={{ fontVariantNumeric: 'tabular-nums' }}><span>0 km</span><span>{fmtKm(data.distance_km, locale)}</span></div>
              </div>
            )}
          </div>
          <GpxBox id={data.id} available={data.gpx} authed={authed} registration={registration} />
        </div>

        {!map.empty && (
          <div className="mt-12 border border-zinc-200 overflow-hidden isolate" data-testid="site-route-map">
            <JourneyMap entries={map.entries} trail={map.trail} height={480} />
          </div>
        )}

        {data.stages.some(s => s.distance_km > 0 || s.places.length) && (
          <div className="mt-16">
            <h2 className="text-[30px] sm:text-[38px] font-extrabold tracking-[-0.03em] border-b border-[#111111] pb-3">{t('site.stages')}</h2>
            <ol className="divide-y divide-zinc-200">
              {data.stages.map(s => (
                <li key={s.day_number} className="py-7 grid md:grid-cols-[1fr_1.2fr] gap-6 items-start">
                  <div className="flex gap-4">
                    <span className="w-10 h-10 shrink-0 bg-[#111111] text-white font-bold text-[15px] inline-flex items-center justify-center">{s.day_number}</span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{s.date ? fmt(s.date, true) : t('site.dayN', { n: s.day_number })}</div>
                      <h3 className="text-[20px] font-bold tracking-[-0.01em] leading-snug">{s.title || t('site.dayN', { n: s.day_number })}</h3>
                      {s.distance_km > 0 && <div className="mt-1 text-[14px] text-zinc-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(s.distance_km, locale)} · +{fmtM(s.gain_m, locale)} · −{fmtM(s.loss_m, locale)}</div>}
                      {s.places.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {s.places.map((p, i) => <span key={i} className="inline-flex items-center gap-1 text-[12px] px-2 py-1 bg-zinc-100 text-zinc-700"><MapPin size={11} />{p.name}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                  {s.profile.length > 1 && <ProfileArt profile={s.profile} height={90} sticker={false} label={t('site.profileOf', { title: s.title || t('site.dayN', { n: s.day_number }) })} />}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="mt-10 text-[13px] text-zinc-500">{t('blog.public.by', { name: data.author })}</div>
      </section>
    </SiteShell>
  )
}

function GpxBox({ id, available, authed, registration }: { id: number; available: boolean; authed: boolean; registration: boolean }) {
  const { t } = useTranslation()
  if (!available) return <div />
  const back = encodeURIComponent(`/rutas/${id}`)
  return (
    <aside className="self-start border border-[#111111] p-6" data-testid="site-gpx">
      <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">GPX</div>
      {authed ? (
        <>
          <p className="mt-2 text-[15px] text-zinc-700" style={{ fontFamily: READING_FONT }}>{t('site.gpxReady')}</p>
          <a href={`/api/site/routes/${id}/gpx`} download className="mt-5 h-11 px-5 bg-[#111111] text-white text-[14px] font-semibold inline-flex items-center gap-2"><Download size={16} />{t('site.downloadGpx')}</a>
        </>
      ) : (
        <>
          <p className="mt-2 text-[17px] font-bold tracking-[-0.01em] leading-snug flex gap-2"><Lock size={16} className="mt-1 shrink-0" />{t('site.gpxLocked')}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {registration && <Link to={`/login?mode=register&redirect=${back}`} className="h-11 px-5 bg-[#111111] text-white text-[14px] font-semibold inline-flex items-center">{t('site.createAccount')}</Link>}
            <Link to={`/login?redirect=${back}`} className="h-11 px-5 border border-zinc-300 text-[14px] font-semibold inline-flex items-center">{t('site.signIn')}</Link>
          </div>
        </>
      )}
    </aside>
  )
}

// ── Story ───────────────────────────────────────────────────────────────────

export function SiteStoryPage() {
  const { slug } = useParams()
  const { t } = useTranslation()
  const fmt = useFmtDate()
  const home = useSiteHome()
  const { data, error } = useJson<StoryPage>(`/api/site/stories/${encodeURIComponent(slug || '')}`)
  useEffect(() => { if (data) { document.title = `${data.post.title} · #ESTODOBAJADA`; window.scrollTo(0, 0) } }, [data])
  if (error) return <SiteShell><Empty text={t('site.storyNotFound')} /></SiteShell>
  if (!data) return <SiteShell><div className="h-[80vh]" /></SiteShell>
  const { post, prev, next } = data
  const coverInline = post.blocks.some(b => b.type === 'photo' && b.photo.photoId === post.cover_photo_id)
  return (
    <SiteShell>
      {post.cover_photo_id && !coverInline && (
        <div className="h-[56vh] min-h-[320px] max-h-[680px] bg-[#111111] overflow-hidden">
          <img src={sitePhoto(post.cover_photo_id, 'original')} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <article className="max-w-[720px] mx-auto px-5 pt-10 pb-10">
        <Link to={`${home}#relatos`} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-[#111111]"><ArrowLeft size={14} />{t('site.allStories')}</Link>
        <div className="mt-8 text-[11px] font-semibold tracking-[0.16em] uppercase text-zinc-500">{t('site.story')} · {fmt(post.post_date, true)}</div>
        <h1 className="mt-3 text-[38px] sm:text-[56px] font-extrabold tracking-[-0.035em] leading-[0.98]">{post.title}</h1>
        {post.author && <div className="text-[13px] text-zinc-500 mt-4">{t('blog.public.by', { name: post.author.username })}</div>}
        <div className="mt-10">
          <BlogPostView blocks={post.blocks} ctx={{ photoBase: PHOTO_BASE, maps: post.maps, entries: post.entries }} isPublic />
        </div>
      </article>
      {(prev || next) && (
        <div className="max-w-[720px] mx-auto px-5 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-8">
          <div>{prev && <Link to={`/relatos/${prev.slug}`} className="group block"><span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 flex items-center gap-1"><ArrowLeft size={12} />{t('blog.public.previous')}</span><span className="font-semibold group-hover:underline">{prev.title}</span></Link>}</div>
          <div className="text-right">{next && <Link to={`/relatos/${next.slug}`} className="group block"><span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 flex items-center gap-1 justify-end">{t('blog.public.next')}<ArrowRight size={12} /></span><span className="font-semibold group-hover:underline">{next.title}</span></Link>}</div>
        </div>
      )}
    </SiteShell>
  )
}
