import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Newspaper } from 'lucide-react'
import { useTranslation } from '../i18n'
import BlogPostView, { READING_FONT } from '../components/Blog/BlogPostView'
import type { ServerPost, ServerPostSummary } from '../blog/types'

interface BlogIndex { journey: { title: string; subtitle: string | null; cover_image: string | null }; posts: ServerPostSummary[] }
interface PostPage { post: ServerPost; prev: { slug: string; title: string } | null; next: { slug: string; title: string } | null }

const photo = (token: string, id: number, kind: 'thumbnail' | 'original') => `/api/public/journey/${token}/photos/${id}/${kind}`

function useJson<T>(url: string | null): { data: T | null; error: boolean } {
  const [state, setState] = useState<{ data: T | null; error: boolean }>({ data: null, error: false })
  useEffect(() => {
    if (!url) return
    let alive = true
    setState({ data: null, error: false })
    fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(d => { if (alive) setState({ data: d, error: false }) }).catch(() => { if (alive) setState({ data: null, error: true }) })
    return () => { alive = false }
  }, [url])
  return state
}

function Shell({ children }: { children: React.ReactNode }) {
  // Página pública: siempre clara, legible, sin la interfaz de la app.
  return <div className="min-h-screen bg-white text-zinc-900" style={{ ['--blog-accent' as string]: '#111111' }}>{children}</div>
}

function NotFound() {
  const { t } = useTranslation()
  return <Shell><div className="max-w-[520px] mx-auto px-6 py-32 text-center"><Newspaper className="mx-auto text-zinc-300 mb-4" size={36} /><p className="text-zinc-500">{t('blog.public.notFound')}</p></div></Shell>
}

export default function BlogPublicPage() {
  const { token, slug } = useParams()
  return slug ? <PublicPost token={token!} slug={slug} /> : <PublicIndex token={token!} />
}

function PublicIndex({ token }: { token: string }) {
  const { t, locale } = useTranslation()
  const { data, error } = useJson<BlogIndex>(`/api/public/journey/${token}/blog`)
  useEffect(() => { if (data) document.title = `${data.journey.title} · ${t('blog.title')}` }, [data, t])
  if (error) return <NotFound />
  if (!data) return <Shell><div className="h-screen" /></Shell>
  const [first, ...rest] = data.posts
  const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '')
  return (
    <Shell>
      <header className="relative">
        {data.journey.cover_image ? (
          <div className="h-[42vh] min-h-[260px] relative">
            <img src={data.journey.cover_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 max-w-[1080px] mx-auto px-6 pb-8 text-white">
              <div className="text-[12px] uppercase tracking-[0.14em] opacity-80">{t('blog.public.kicker')}</div>
              <h1 className="text-[36px] sm:text-[54px] font-bold tracking-[-0.03em] leading-[1.02]">{data.journey.title}</h1>
              {data.journey.subtitle && <p className="text-[17px] opacity-90 mt-2" style={{ fontFamily: READING_FONT }}>{data.journey.subtitle}</p>}
            </div>
          </div>
        ) : (
          <div className="max-w-[1080px] mx-auto px-6 pt-16 pb-6">
            <div className="text-[12px] uppercase tracking-[0.14em] text-zinc-500">{t('blog.public.kicker')}</div>
            <h1 className="text-[36px] sm:text-[54px] font-bold tracking-[-0.03em] leading-[1.02]">{data.journey.title}</h1>
            {data.journey.subtitle && <p className="text-[18px] text-zinc-600 mt-2" style={{ fontFamily: READING_FONT }}>{data.journey.subtitle}</p>}
          </div>
        )}
      </header>
      <main className="max-w-[1080px] mx-auto px-6 py-10">
        {!first && <p className="text-zinc-500 text-center py-16">{t('blog.public.empty')}</p>}
        {first && (
          <Link to={`/public/journey/${token}/blog/${first.slug}`} className="group grid md:grid-cols-[1.25fr_1fr] gap-6 md:gap-10 items-center mb-14">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-zinc-200">
              {first.cover_photo_id && <img src={photo(token, first.cover_photo_id, 'original')} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />}
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] text-zinc-500 mb-2">{t('blog.public.latest')} · {fmt(first.post_date)}</div>
              <h2 className="text-[28px] sm:text-[36px] font-bold tracking-[-0.02em] leading-[1.1] group-hover:underline decoration-2 underline-offset-4">{first.title || t('blog.post.untitled')}</h2>
              {first.excerpt && <p className="text-[17px] text-zinc-600 mt-3 leading-relaxed" style={{ fontFamily: READING_FONT }}>{first.excerpt}</p>}
              <span className="inline-flex items-center gap-1.5 text-[14px] font-medium mt-4">{t('blog.public.read')} <ArrowRight size={15} /></span>
            </div>
          </Link>
        )}
        {rest.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10 border-t border-zinc-200 pt-10">
            {rest.map(p => (
              <Link key={p.id} to={`/public/journey/${token}/blog/${p.slug}`} className="group">
                <div className="aspect-[3/2] rounded-xl overflow-hidden bg-zinc-200 mb-3">
                  {p.cover_photo_id && <img src={photo(token, p.cover_photo_id, 'thumbnail')} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />}
                </div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{fmt(p.post_date)}</div>
                <h3 className="text-[20px] font-bold tracking-[-0.01em] leading-snug mt-1 group-hover:underline underline-offset-4">{p.title || t('blog.post.untitled')}</h3>
                {p.excerpt && <p className="text-[15px] text-zinc-600 mt-1.5 line-clamp-3" style={{ fontFamily: READING_FONT }}>{p.excerpt}</p>}
              </Link>
            ))}
          </div>
        )}
      </main>
      <footer className="flex flex-col items-center gap-2 pb-10">
        <img src="/sticker-dark.svg" alt="#ESTODOBAJADA" style={{ height: 22 }} />
        <span className="text-[12px] text-zinc-500">{t('blog.public.footer')}</span>
      </footer>
    </Shell>
  )
}

function PublicPost({ token, slug }: { token: string; slug: string }) {
  const { t, locale } = useTranslation()
  const { data, error } = useJson<PostPage>(`/api/public/journey/${token}/blog/${encodeURIComponent(slug)}`)
  useEffect(() => { if (data) { document.title = data.post.title || t('blog.title'); window.scrollTo(0, 0) } }, [data, t])
  if (error) return <NotFound />
  if (!data) return <Shell><div className="h-screen" /></Shell>
  const { post, prev, next } = data
  const date = post.post_date ? new Date(`${post.post_date}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
  return (
    <Shell>
      <nav className="max-w-[720px] mx-auto px-5 pt-6">
        <Link to={`/public/journey/${token}/blog`} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} />{t('blog.public.allPosts')}</Link>
      </nav>
      <article className="max-w-[720px] mx-auto px-5 pt-8 pb-16">
        <div className="text-[12px] uppercase tracking-[0.12em] text-zinc-500 mb-3">{date}</div>
        <h1 className="text-[34px] sm:text-[46px] font-bold tracking-[-0.03em] leading-[1.05]">{post.title || t('blog.post.untitled')}</h1>
        {post.author && <div className="text-[13px] text-zinc-500 mt-3">{t('blog.public.by', { name: post.author.username })}</div>}
        {post.cover_photo_id && !post.blocks.some(b => (b.type === 'photo' && b.photo.photoId === post.cover_photo_id)) && (
          <img src={photo(token, post.cover_photo_id, 'original')} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl mt-8" />
        )}
        <div className="mt-10">
          <BlogPostView blocks={post.blocks} ctx={{ publicToken: token, maps: post.maps, entries: post.entries }} isPublic />
        </div>
      </article>
      {(prev || next) && (
        <div className="max-w-[720px] mx-auto px-5 pb-16 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-8">
          <div>{prev && <Link to={`/public/journey/${token}/blog/${prev.slug}`} className="group block"><span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 flex items-center gap-1"><ArrowLeft size={12} />{t('blog.public.previous')}</span><span className="font-semibold group-hover:underline">{prev.title}</span></Link>}</div>
          <div className="text-right">{next && <Link to={`/public/journey/${token}/blog/${next.slug}`} className="group block"><span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 flex items-center gap-1 justify-end">{t('blog.public.next')}<ArrowRight size={12} /></span><span className="font-semibold group-hover:underline">{next.title}</span></Link>}</div>
        </div>
      )}
    </Shell>
  )
}
