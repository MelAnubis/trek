import { useState, useEffect } from 'react'
import { Tag, Calendar, ExternalLink, ChevronDown, ChevronUp, Loader2, Heart, Coffee, Bug, Lightbulb, BookOpen } from 'lucide-react'
import { getLocaleForLanguage, useTranslation } from '../../i18n'
import apiClient from '../../api/client'

const REPO = 'MelAnubis/trek'
const PER_PAGE = 10

interface GithubRelease {
  id: number
  prerelease: boolean
  [key: string]: unknown
}

export default function GitHubPanel({ isPrerelease = false }: { isPrerelease?: boolean }) {
  const { t, language } = useTranslation()
  const [releases, setReleases] = useState<GithubRelease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const fetchReleases = async (pageNum = 1, append = false) => {
    try {
      const res = await apiClient.get(`/admin/github-releases`, { params: { per_page: PER_PAGE, page: pageNum } })
      const data = Array.isArray(res.data) ? res.data : []
      setReleases(prev => append ? [...prev, ...data] : data)
      setHasMore(data.length === PER_PAGE)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchReleases(1).finally(() => setLoading(false))
  }, [])

  const handleLoadMore = async () => {
    const next = page + 1
    setLoadingMore(true)
    await fetchReleases(next, true)
    setPage(next)
    setLoadingMore(false)
  }

  const toggleExpand = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString(getLocaleForLanguage(language), { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // Simple markdown-to-html for release notes (handles headers, bold, lists, links)
  const renderBody = (body) => {
    if (!body) return null
    const lines = body.split('\n')
    const elements = []
    let listItems = []

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`ul-${elements.length}`} className="space-y-1 my-2">
            {listItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--text-faint)' }} />
                <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
              </li>
            ))}
          </ul>
        )
        listItems = []
      }
    }

    const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const inlineFormat = (text) => {
      return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code style="font-size:11px;padding:1px 4px;border-radius:4px;background:var(--bg-secondary)">$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
          const safeUrl = url.startsWith('http://') || url.startsWith('https://') ? url : '#'
          return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;text-decoration:underline">${label}</a>`
        })
    }

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) { flushList(); continue }

      if (trimmed.startsWith('### ')) {
        flushList()
        elements.push(
          <h4 key={elements.length} className="text-xs font-semibold mt-3 mb-1" style={{ color: 'var(--text-primary)' }}>
            {trimmed.slice(4)}
          </h4>
        )
      } else if (trimmed.startsWith('## ')) {
        flushList()
        elements.push(
          <h3 key={elements.length} className="text-sm font-semibold mt-3 mb-1" style={{ color: 'var(--text-primary)' }}>
            {trimmed.slice(3)}
          </h3>
        )
      } else if (/^[-*] /.test(trimmed)) {
        listItems.push(trimmed.slice(2))
      } else {
        flushList()
        elements.push(
          <p key={elements.length} className="text-xs my-1" style={{ color: 'var(--text-muted)' }}
            dangerouslySetInnerHTML={{ __html: inlineFormat(trimmed) }}
          />
        )
      }
    }
    flushList()
    return elements
  }

  return (
    <div className="space-y-3">
      {/* Support card — fork repo */}
      <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
        <a
          href="https://github.com/MelAnubis/trek"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border overflow-hidden flex items-center gap-4 px-5 py-4 transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', textDecoration: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 1px #6366f122' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#6366f115', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#6366f1' }}><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Trek Wanderer</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>github.com/MelAnubis/trek</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <a
          href="https://github.com/MelAnubis/trek/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border overflow-hidden flex items-center gap-4 px-5 py-4 transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', textDecoration: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.boxShadow = '0 0 0 1px #ef444422' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#ef444415', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Bug size={20} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('settings.about.reportBug')}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{t('settings.about.reportBugHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </a>
        <a
          href="https://github.com/MelAnubis/trek/discussions"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border overflow-hidden flex items-center gap-4 px-5 py-4 transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', textDecoration: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f59e0b'; e.currentTarget.style.boxShadow = '0 0 0 1px #f59e0b22' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f59e0b15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Lightbulb size={20} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('settings.about.featureRequest')}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{t('settings.about.featureRequestHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </a>
        <a
          href="https://github.com/MelAnubis/trek/wiki"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border overflow-hidden flex items-center gap-4 px-5 py-4 transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', textDecoration: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 1px #6366f122' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#6366f115', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BookOpen size={20} style={{ color: '#6366f1' }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Wiki</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{t('settings.about.wikiHint')}</div>
          </div>
          <ExternalLink size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </a>
      </div>

      {/* Loading / Error / Releases */}
      {loading ? (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <div className="p-6 text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('admin.github.error')}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{error}</p>
          </div>
        </div>
      ) : (
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-secondary)' }}>
          <div>
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('admin.github.title')}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{t('admin.github.subtitle').replace('{repo}', REPO)}</p>
          </div>
          <a
            href={`https://github.com/${REPO}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
          >
            <ExternalLink size={12} />
            GitHub
          </a>
        </div>

        {/* Timeline */}
        <div className="px-5 py-4">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px" style={{ background: 'var(--border-primary)' }} />

            <div className="space-y-0">
              {(isPrerelease ? releases : releases.filter(r => !r.prerelease)).map((release, idx) => {
                const isLatest = idx === 0
                const isExpanded = expanded[release.id]

                return (
                  <div key={release.id} className="relative pl-8 pb-5">
                    {/* Timeline dot */}
                    <div
                      className="absolute left-0 top-1 w-[23px] h-[23px] rounded-full flex items-center justify-center border-2"
                      style={{
                        background: isLatest ? 'var(--text-primary)' : 'var(--bg-card)',
                        borderColor: isLatest ? 'var(--text-primary)' : 'var(--border-primary)',
                      }}
                    >
                      <Tag size={10} style={{ color: isLatest ? 'var(--bg-card)' : 'var(--text-faint)' }} />
                    </div>

                    {/* Release content */}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {release.tag_name}
                        </span>
                        {isLatest && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}>
                            {t('admin.github.latest')}
                          </span>
                        )}
                        {release.prerelease && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(245,158,11,0.12)', color: '#d97706' }}>
                            {t('admin.github.prerelease')}
                          </span>
                        )}
                      </div>

                      {release.name && release.name !== release.tag_name && (
                        <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {release.name}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          <Calendar size={10} />
                          {formatDate(release.published_at || release.created_at)}
                        </span>
                        {release.author && (
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {t('admin.github.by')} {release.author.login}
                          </span>
                        )}
                      </div>

                      {/* Expandable body */}
                      {release.body && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleExpand(release.id)}
                            className="flex items-center gap-1 text-[11px] font-medium transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {isExpanded ? t('admin.github.hideDetails') : t('admin.github.showDetails')}
                          </button>

                          {isExpanded && (
                            <div className="mt-2 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                              {renderBody(release.body)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="text-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                {loadingMore ? t('admin.github.loading') : t('admin.github.loadMore')}
              </button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
