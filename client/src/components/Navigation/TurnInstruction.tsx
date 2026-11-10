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
      <div className="![background:rgba(239,68,68,0.92)] ![backdrop-filter:blur(12px)] ![-webkit-backdrop-filter:blur(12px)] !p-[12px_16px] !flex !items-center !gap-[12px] ![border-top:1px_solid_rgba(255,255,255,0.1)]">
        <AlertTriangle size={24} color="#fff" />
        <div className="!flex-[1]">
          <div className="!text-[length:14px] !font-[700] ![color:#fff]">Fuera de ruta</div>
          <div className="!text-[length:12px] ![color:rgba(255,255,255,0.8)]">Recalculando camino de vuelta…</div>
        </div>
        {onRecenter && (
          <button className="![background:rgba(255,255,255,0.2)] ![border:none] !rounded-[8px] !p-[6px_12px] ![color:#fff] !text-[length:12px] !font-[600] !cursor-pointer"
            onClick={onRecenter}
          >
            Centrar
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="![background:rgba(10,10,20,0.92)] ![backdrop-filter:blur(16px)] ![-webkit-backdrop-filter:blur(16px)] !p-[12px_16px] !flex !items-center !gap-[14px] ![border-top:1px_solid_rgba(255,255,255,0.08)]">
      {/* Arrow icon */}
      <div className="!w-[48px] !h-[48px] !rounded-[12px] ![background:rgba(59,130,246,0.2)] ![border:1px_solid_rgba(59,130,246,0.3)] !flex !items-center !justify-center !shrink-[0]">
        <ManeuverIcon direction={direction} size={26} />
      </div>

      {/* Text */}
      <div className="!flex-[1] !min-w-[0]">
        <div className="!text-[length:18px] !font-[800] ![color:#f1f5f9] !leading-[1.1]">{distText}</div>
        {instruction.name && (
          <div className="!text-[length:13px] ![color:#94a3b8] !mt-[2px] !overflow-hidden !text-ellipsis !whitespace-nowrap">
            {humanizeModifier(instruction.modifier)} · {instruction.name}
          </div>
        )}
        {!instruction.name && (
          <div className="!text-[length:12px] ![color:#64748b] !mt-[2px]">{humanizeType(instruction.type, instruction.modifier)}</div>
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
