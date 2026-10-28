// BlockNote como editor del blog, sin cambiar lo que se guarda: the post stays a list of BlogBlocks
// whose text is Markdown (what the public blog, the magazine and offline sync already read).
// Text blocks map onto BlockNote's own; photo, gallery, map, sketch and entry ride in one custom
// block «trek» that carries the BlogBlock as JSON.
import type { BlogBlock } from './types'

/** The bits of a BlockNote editor the conversion needs (keeps this file free of the UI). */
export interface MarkdownEditor {
  tryParseMarkdownToBlocks(markdown: string): BNBlock[]
  blocksToMarkdownLossy(blocks: BNBlock[]): string
}

export interface BNBlock {
  id?: string
  type: string
  props?: Record<string, unknown>
  content?: unknown
  children?: BNBlock[]
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

/** The inline content of a bit of Markdown (bold, italics, links…), for a heading or a quote. */
function inlineOf(editor: MarkdownEditor, text: string): unknown {
  if (!text.trim()) return []
  const [first] = editor.tryParseMarkdownToBlocks(text.replace(/\n+/g, ' '))
  return first?.content ?? text
}

/** Cites of quotes, which BlockNote's quote has no field for, kept beside the editor by block id. */
export type CiteMap = Map<string, string>

export function toBlockNote(editor: MarkdownEditor, blocks: BlogBlock[], cites: CiteMap): BNBlock[] {
  const out: BNBlock[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph': {
        const parsed = b.text.trim() ? editor.tryParseMarkdownToBlocks(b.text) : []
        if (!parsed.length) { out.push({ id: b.id, type: 'paragraph', content: [] }); break }
        parsed.forEach((p, i) => out.push(i === 0 ? { ...p, id: b.id } : stripId(p)))
        break
      }
      case 'heading':
        out.push({ id: b.id, type: 'heading', props: { level: b.level }, content: inlineOf(editor, b.text) })
        break
      case 'quote':
        if (b.cite) cites.set(b.id, b.cite)
        out.push({ id: b.id, type: 'quote', content: inlineOf(editor, b.text) })
        break
      case 'divider':
        out.push({ id: b.id, type: 'divider' })
        break
      default:
        out.push({ id: b.id, type: 'trek', props: { data: JSON.stringify(b) } })
    }
  }
  if (!out.length) out.push({ type: 'paragraph', content: [] })
  return out
}

function stripId(b: BNBlock): BNBlock {
  const { id: _id, children, ...rest } = b
  return { ...rest, children: (children || []).map(stripId) }
}

function md(editor: MarkdownEditor, blocks: BNBlock[]): string {
  return editor.blocksToMarkdownLossy(blocks).replace(/\n{3,}/g, '\n\n').trim()
}

function isEmptyParagraph(b: BNBlock): boolean {
  const c = b.content
  return b.type === 'paragraph' && (!c || (Array.isArray(c) && c.length === 0)) && !(b.children && b.children.length)
}

/**
 * Back to BlogBlocks. A run of list items becomes one paragraph of Markdown («- a\n- b»), with the
 * id of its first item. Empty paragraphs are dropped (BlockNote always keeps one at the end).
 */
export function fromBlockNote(editor: MarkdownEditor, doc: BNBlock[], cites: CiteMap): BlogBlock[] {
  const out: BlogBlock[] = []
  for (let i = 0; i < doc.length; i++) {
    const b = doc[i]
    const id = b.id || `bn-${i}`
    if (LIST_TYPES.has(b.type)) {
      const run: BNBlock[] = [b]
      while (i + 1 < doc.length && LIST_TYPES.has(doc[i + 1].type)) run.push(doc[++i])
      out.push({ id, type: 'paragraph', text: md(editor, run) })
      continue
    }
    switch (b.type) {
      case 'paragraph':
        if (!isEmptyParagraph(b)) out.push({ id, type: 'paragraph', text: md(editor, [b]) })
        break
      case 'heading': {
        const level = Number(b.props?.level) >= 3 ? 3 : 2
        out.push({ id, type: 'heading', level, text: md(editor, [{ type: 'paragraph', content: b.content }]).replace(/\n+/g, ' ') })
        break
      }
      case 'quote': {
        const cite = cites.get(id)
        out.push({ id, type: 'quote', text: md(editor, [{ type: 'paragraph', content: b.content }]), ...(cite ? { cite } : {}) })
        break
      }
      case 'divider':
        out.push({ id, type: 'divider' })
        break
      case 'trek': {
        try {
          const data = JSON.parse(String(b.props?.data || '{}')) as BlogBlock
          if (data && data.type) out.push({ ...data, id })
        } catch { /* a broken block is left out rather than saved broken */ }
        break
      }
      default: {
        // anything else pasted in (code, tables…) is kept as its Markdown
        const text = md(editor, [b])
        if (text) out.push({ id, type: 'paragraph', text })
      }
    }
  }
  return out.length ? out : [{ id: doc[0]?.id || 'bn-0', type: 'paragraph', text: '' }]
}

/** The BlogBlock id a cursor in BlockNote block `bnId` belongs to (a list item → its run's first item). */
export function blogIdAt(doc: BNBlock[], bnId: string): string | null {
  for (let i = 0; i < doc.length; i++) {
    if (LIST_TYPES.has(doc[i].type)) {
      const first = doc[i].id ?? null
      let j = i
      while (j < doc.length && LIST_TYPES.has(doc[j].type)) { if (doc[j].id === bnId || containsId(doc[j], bnId)) return first; j++ }
      i = j - 1
      continue
    }
    if (doc[i].id === bnId || containsId(doc[i], bnId)) return doc[i].id ?? null
  }
  return null
}

function containsId(b: BNBlock, id: string): boolean {
  return (b.children || []).some(c => c.id === id || containsId(c, id))
}
