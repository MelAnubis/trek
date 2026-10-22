// FE-PLANNERNOTES-001 to FE-PLANNERNOTES-004
import { render, screen } from '@testing-library/react'
import { PlannerNotesCard, appendToStory, notesToStory, type PlannerNote } from './PlannerNotes'

const t = (k: string) => k
const note = (o: Partial<PlannerNote> = {}): PlannerNote => ({ id: 1, trip_id: 1, day_number: 1, day_title: null, text: 'Reservar albergue', description: null, icon: null, color: null, ...o })

describe('PlannerNotes', () => {
  it('FE-PLANNERNOTES-001: each note shows its title, its formatted description and its colour', () => {
    render(<PlannerNotesCard t={t} notes={[note({ id: 1, description: 'Llamar **antes** de las 20h', color: '#dc2626' }), note({ id: 2, text: 'Agua en Guillena' })]} />)
    expect(screen.getByText('journey.plannerNotes.title')).toBeTruthy()
    expect(screen.getByText('Reservar albergue')).toBeTruthy()
    expect(screen.getByText('antes').tagName).toBe('STRONG')
    const first = document.querySelector('[data-note-id="1"]') as HTMLElement
    expect(first.style.background).toContain('color-mix')
  })

  it('FE-PLANNERNOTES-002: no notes, no card', () => {
    const { container } = render(<PlannerNotesCard t={t} notes={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('FE-PLANNERNOTES-003: notesToStory — one bullet per note, title in bold, description on one line', () => {
    expect(notesToStory([note({ description: 'Llamar\n\nantes de las 20h' }), note({ text: 'Agua' })]))
      .toBe('- **Reservar albergue** — Llamar antes de las 20h\n- **Agua**')
  })

  it('FE-PLANNERNOTES-004: appendToStory adds after a blank line and never twice', () => {
    expect(appendToStory('', '- **A**')).toBe('- **A**')
    expect(appendToStory('Día largo.\n', '- **A**')).toBe('Día largo.\n\n- **A**')
    expect(appendToStory('Día largo.\n\n- **A**', '- **A**')).toBe('Día largo.\n\n- **A**')
  })
})
