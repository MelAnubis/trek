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
    <div className="!flex !items-center !gap-[6px]"
      title={people.map(p => p.username).join(', ')}
    >
      <div className="!flex">
        {shown.map((p, i) => (
          <span className="!w-[24px] !h-[24px] !rounded-[50%] !flex !items-center !justify-center ![color:#fff] !text-[length:11px] !font-[700] !overflow-hidden ![border:2px_solid_var(--bg-primary)]"
            key={p.userId}
            aria-label={p.username}
            style={{ background: peerColour(p.userId), marginLeft: i === 0 ? 0 : -8 }}
          >
            {p.avatar
              ? <img className="!w-[100%] !h-[100%] !object-cover" src={p.avatar} alt="" />
              : (p.username?.[0] ?? '?').toUpperCase()}
          </span>
        ))}
      </div>
      {rest > 0 && (
        <span className="!text-[length:11px] !font-[600] ![color:var(--text-muted)]">+{rest}</span>
      )}
      <span className="!text-[length:11px] ![color:var(--text-faint)]">{t('journey.studio.peersHere')}</span>
    </div>
  )
}
