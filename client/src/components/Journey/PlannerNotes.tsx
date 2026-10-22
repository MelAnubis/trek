import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { StickyNote } from 'lucide-react'
import { noteSurface } from '../Planner/noteColors'

/**
 * The planner's day notes ("notas del día") shown on the journey day they
 * belong to — read live from the linked trip (journeyService's
 * plannerNotesByDate), so an edit in the planner shows here at once.
 *
 * Read-only here: they belong to the trip. To make one part of the story,
 * the entry editor copies them in (notesToStory) — from then on it's the
 * journal's own text, and travels into the Studio book with the story.
 */

export interface PlannerNote {
  id: number
  trip_id: number
  day_number: number
  day_title: string | null
  text: string
  description: string | null
  icon: string | null
  color: string | null
}

type T = (key: string, params?: Record<string, string | number>) => string

/** The notes as Markdown for the story: one bullet each, the title in bold, the description after it. */
export function notesToStory(notes: PlannerNote[]): string {
  return notes.map(n => {
    const desc = (n.description || '').replace(/\s*\n+\s*/g, ' ').trim()
    return `- **${n.text.trim()}**${desc ? ` — ${desc}` : ''}`
  }).join('\n')
}

/** Appends to a story with one blank line in between, never doubling up a block already in it. */
export function appendToStory(story: string, block: string): string {
  if (!block.trim() || story.includes(block)) return story
  const base = story.replace(/\s+$/, '')
  return base ? `${base}\n\n${block}` : block
}

export function PlannerNotesCard({ notes, t }: { notes: PlannerNote[]; t: T }) {
  if (!notes.length) return null
  return (
    <div data-testid="planner-notes" className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/60 px-3.5 py-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
        <StickyNote size={12} /> {t('journey.plannerNotes.title')}
      </div>
      <div className="flex flex-col gap-1.5">
        {notes.map(n => {
          const skin = noteSurface(n.color)
          return (
            <div key={n.id} data-note-id={n.id} className="rounded-lg px-2.5 py-1.5" style={{ background: skin.background, border: `1px solid ${skin.border}` }}>
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: n.color || 'var(--text-faint)' }} />
                <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{n.text}</span>
              </div>
              {n.description && (
                <div className="collab-note-md text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 pl-3">
                  <Markdown remarkPlugins={[remarkGfm]}>{n.description}</Markdown>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
