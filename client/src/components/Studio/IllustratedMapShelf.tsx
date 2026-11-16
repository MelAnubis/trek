import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Palette } from 'lucide-react'
import { arteApi, type ArteComposition } from '../../api/client'
import { encodeImageForPaste } from './pastedImage'

/**
 * The user's illustrated maps (the Arte module's saved compositions), to drop
 * onto the page as an image. Each composition keeps its map already painted
 * as a JPEG on the server (see arte_compositions.image); here it only gets
 * re-encoded to the size a book image element may hold, exactly as a pasted
 * image would be. Only rendered for users who may open the module.
 */

type T = (key: string, params?: Record<string, string | number>) => string

export interface IllustratedMapImage {
  src: string
  naturalWidth: number
  naturalHeight: number
}

export function IllustratedMapShelf({ t, onAdd, onError }: {
  t: T
  onAdd: (image: IllustratedMapImage) => void
  onError: (message: string) => void
}): React.ReactElement {
  const [list, setList] = useState<ArteComposition[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    arteApi.compositions()
      .then(l => { if (alive) setList(l) })
      .catch(() => { if (alive) { setList([]); setFailed(true) } })
    return () => { alive = false }
  }, [])

  const add = async (c: ArteComposition) => {
    if (busyId) return
    setBusyId(c.id)
    try {
      const encoded = await encodeImageForPaste(await arteApi.compositionImage(c.id))
      if (!encoded) throw new Error('encode')
      onAdd(encoded)
    } catch {
      onError(t('arte.studio.addError'))
    } finally {
      setBusyId(null)
    }
  }

  const hint: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.4 }

  return (
    <div style={{ marginTop: 10 }} data-testid="illustrated-maps">
      <div className="!flex !items-center !gap-[6px]" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        <Palette size={12} /> {t('arte.nav')}
      </div>
      {list === null && <Loader2 size={14} className="animate-spin" color="var(--text-faint)" />}
      {list !== null && list.length === 0 && (
        <p style={{ ...hint, marginTop: 0 }}>
          {failed ? t('arte.studio.loadError') : t('arte.studio.empty')}{' '}
          {!failed && <Link to="/arte" style={{ color: 'var(--accent)' }}>{t('arte.studio.open')}</Link>}
        </p>
      )}
      {list !== null && list.length > 0 && (
        <>
          <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px]">
            {list.map(c => (
              <button key={c.id} type="button" onClick={() => void add(c)} disabled={!c.conImagen || busyId !== null}
                title={c.conImagen ? c.nombre : t('arte.studio.noImage')}
                style={{
                  position: 'relative', padding: 0, border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden',
                  background: 'var(--bg-card)', cursor: c.conImagen ? 'pointer' : 'not-allowed', opacity: c.conImagen ? 1 : 0.5, textAlign: 'left',
                }}>
                <span style={{ display: 'block', aspectRatio: '4 / 3', background: '#f3ead6' }}>
                  {c.miniatura && <img src={c.miniatura} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </span>
                <span style={{ display: 'block', padding: '4px 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombre}</span>
                {busyId === c.id && (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
                    <Loader2 size={18} className="animate-spin" color="#fff" />
                  </span>
                )}
              </button>
            ))}
          </div>
          {list.some(c => !c.conImagen) && <p style={hint}>{t('arte.studio.noImage')}</p>}
        </>
      )}
    </div>
  )
}
