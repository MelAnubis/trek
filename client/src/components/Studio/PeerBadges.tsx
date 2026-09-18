import type { BookPeer } from './useBookPresence'
import { peerColour } from './peerColour'

/**
 * Who else has the book open.
 *
 * In the header rather than in a panel, because it answers a question people
 * ask before they start moving things: am I the only one in here. A pointer
 * answers it too, but only once the other person moves — someone reading a
 * spread in silence is invisible without this.
 *
 * The same colour as their pointer, so the two read as one person.
 */
export function PeerBadges({ peers, t }: { peers: BookPeer[]; t: (k: string) => string }) {
  if (peers.length === 0) return null

  /*
   * By person, not by socket.
   *
   * The presence list is keyed by socket because two tabs are two pointers, and
   * that is right for pointers. It is wrong here: one person with the book open
   * twice is one person, and showing them as two says the room is busier than
   * it is.
   */
  const seen = new Map<number, BookPeer>()
  for (const p of peers) if (!seen.has(p.userId)) seen.set(p.userId, p)
  const people = [...seen.values()]

  const shown = people.slice(0, 4)
  const rest = people.length - shown.length

  return (
    <div
      title={people.map(p => p.username).join(', ')}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <div style={{ display: 'flex' }}>
        {shown.map((p, i) => (
          <span
            key={p.userId}
            aria-label={p.username}
            style={{
              width: 24, height: 24, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: peerColour(p.userId), color: '#fff',
              fontSize: 11, fontWeight: 700, overflow: 'hidden',
              border: '2px solid var(--bg-primary)',
              marginLeft: i === 0 ? 0 : -8,
            }}
          >
            {p.avatar
              ? <img src={p.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (p.username?.[0] ?? '?').toUpperCase()}
          </span>
        ))}
      </div>
      {rest > 0 && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>+{rest}</span>
      )}
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('journey.studio.peersHere')}</span>
    </div>
  )
}
