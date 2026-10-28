import { describe, it, expect } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { toBlockNote, fromBlockNote, blogIdAt, type MarkdownEditor, type BNBlock } from './blockNoteConvert'
import type { BlogBlock } from './types'

const editor = BlockNoteEditor.create() as unknown as MarkdownEditor & { replaceBlocks: (a: unknown, b: unknown) => void; document: BNBlock[] }

describe('BlockNote ⇄ BlogBlocks', () => {
  it('keeps paragraphs, headings, quotes, dividers and media through a round trip', () => {
    const blocks: BlogBlock[] = [
      { id: 'h', type: 'heading', level: 2, text: '¿Es necesario cambiar el casco?' },
      { id: 'p', type: 'paragraph', text: 'Prioriza la **homologación** y el sistema *MIPS*. Más en [la norma](https://example.com).' },
      { id: 'q', type: 'quote', text: 'Ante la duda, cámbialo', cite: 'Un mecánico' },
      { id: 'd', type: 'divider' },
      { id: 'm', type: 'map', source: 'journey', showTrack: true, showPhotos: false },
    ]
    const cites = new Map<string, string>()
    const bn = toBlockNote(editor, blocks, cites)
    expect(bn.map(b => b.type)).toEqual(['heading', 'paragraph', 'quote', 'divider', 'trek'])
    // the media block goes through BlockNote's document only as JSON; check the text ones there
    const back = fromBlockNote(editor, bn, cites)
    expect(back[0]).toEqual(blocks[0])
    expect(back[1]).toEqual(blocks[1])
    expect(back[2]).toEqual(blocks[2])
    expect(back[3]).toEqual(blocks[3])
    expect(back[4]).toEqual(blocks[4])
  })

  it('turns a run of list items into one Markdown paragraph, and reads it back as a list', () => {
    const md = '- Carretera y MTB XC: ligeros y ventilados\n- Urbano: con luces integradas'
    const bn = toBlockNote(editor, [{ id: 'l', type: 'paragraph', text: md }], new Map())
    expect(bn.map(b => b.type)).toEqual(['bulletListItem', 'bulletListItem'])
    expect(bn[0].id).toBe('l')
    const back = fromBlockNote(editor, bn, new Map())
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ id: 'l', type: 'paragraph' })
    expect((back[0] as { text: string }).text.split('\n').map(l => l.replace(/^[*-]\s+/, ''))).toEqual(['Carretera y MTB XC: ligeros y ventilados', 'Urbano: con luces integradas'])
  })

  it('drops empty paragraphs but never leaves the post without a block', () => {
    const back = fromBlockNote(editor, [{ id: 'a', type: 'paragraph', content: [] }], new Map())
    expect(back).toEqual([{ id: 'a', type: 'paragraph', text: '' }])
    const two = fromBlockNote(editor, [{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'Hola', styles: {} }] }, { id: 'b', type: 'paragraph', content: [] }], new Map())
    expect(two).toEqual([{ id: 'a', type: 'paragraph', text: 'Hola' }])
  })

  it('a cursor in a list item belongs to the paragraph of its run', () => {
    const doc: BNBlock[] = [{ id: 'p', type: 'paragraph' }, { id: 'l1', type: 'bulletListItem' }, { id: 'l2', type: 'bulletListItem' }, { id: 'h', type: 'heading' }]
    expect(blogIdAt(doc, 'l2')).toBe('l1')
    expect(blogIdAt(doc, 'h')).toBe('h')
  })
})
