import React from 'react'
import {
  ArrowUp, ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight,
  RotateCcw, Flag, AlertTriangle, Navigation,
} from 'lucide-react'
import { maneuverDirection, formatDistance, distanceToInstruction } from '../../services/turnByTurnService'
import type { TurnInstruction as Instr } from '../../services/turnByTurnService'

interface Props {
  instruction: Instr
  userLat: number
  userLng: number
  isDeviated: boolean
  onRecenter?: () => void
}

function ManeuverIcon({ direction, size = 28 }: { direction: string; size?: number }) {
  const props = { size, color: '#f1f5f9', strokeWidth: 2.5 }
  switch (direction) {
    case 'left':        return <ArrowLeft {...props} />
    case 'right':       return <ArrowRight {...props} />
    case 'slight-left': return <ArrowUpLeft {...props} />
    case 'slight-right':return <ArrowUpRight {...props} />
    case 'uturn':       return <RotateCcw {...props} />
    case 'roundabout':  return <RotateCcw {...props} />
    case 'arrive':      return <Flag {...props} color="#22d96e" />
    default:            return <ArrowUp {...props} />
  }
}

export default function TurnInstruction({ instruction, userLat, userLng, isDeviated, onRecenter }: Props) {
  const direction = maneuverDirection(instruction.type, instruction.modifier)
  const distM = distanceToInstruction(instruction, userLat, userLng)
  const distText = formatDistance(distM)

  if (isDeviated) {
    return (
      <div style={{
        background: 'rgba(239,68,68,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <AlertTriangle size={24} color="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Fuera de ruta</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>Recalculando camino de vuelta…</div>
        </div>
        {onRecenter && (
          <button
            onClick={onRecenter}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Centrar
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(10,10,20,0.92)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      borderTop: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Arrow icon */}
      <div style={{
        width: 48, height: 48,
        borderRadius: 12,
        background: 'rgba(59,130,246,0.2)',
        border: '1px solid rgba(59,130,246,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <ManeuverIcon direction={direction} size={26} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.1 }}>{distText}</div>
        {instruction.name && (
          <div style={{
            fontSize: 13, color: '#94a3b8', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {humanizeModifier(instruction.modifier)} · {instruction.name}
          </div>
        )}
        {!instruction.name && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{humanizeType(instruction.type, instruction.modifier)}</div>
        )}
      </div>

      {/* Next turn preview (bearing arrow) */}
      <Navigation
        size={20}
        color="#3b82f6"
        style={{ transform: `rotate(${instruction.bearingAfter}deg)`, flexShrink: 0 }}
      />
    </div>
  )
}

function humanizeModifier(modifier?: string): string {
  switch (modifier) {
    case 'left':        return 'Gira a la izquierda'
    case 'right':       return 'Gira a la derecha'
    case 'slight left': return 'Leve izquierda'
    case 'slight right':return 'Leve derecha'
    case 'uturn':       return 'Media vuelta'
    case 'straight':    return 'Todo recto'
    default:            return 'Continúa'
  }
}

function humanizeType(type: string, modifier?: string): string {
  if (type === 'arrive') return 'Has llegado a tu destino'
  if (type === 'depart') return 'Inicia ruta'
  if (type === 'roundabout' || type === 'rotary') return 'En la rotonda'
  return humanizeModifier(modifier)
}
