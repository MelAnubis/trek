import React, { useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'
import '../../styles/chrome.css'
import { useTranslation } from '../../i18n'

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-5xl',
  '4xl': 'max-w-7xl',
}

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children?: React.ReactNode
  size?: string
  footer?: React.ReactNode
  hideCloseButton?: boolean
  /** The title is a whole header (a form's name field, its pickers): it takes the width, on a tinted band. */
  wideTitle?: boolean
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  hideCloseButton = false,
  wideTitle = false,
}: ModalProps) {
  const { t } = useTranslation()
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleEsc])

  const mouseDownTarget = useRef<EventTarget | null>(null)

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div
      className="trek-modal-backdrop fixed inset-0 z-[200] flex items-start sm:items-center justify-center px-4 modal-backdrop trek-backdrop-enter"
      onMouseDown={e => { mouseDownTarget.current = e.target }}
      onClick={e => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) onClose()
        mouseDownTarget.current = null
      }}
    >
      <div
        className={`
          trek-modal-enter modal-glass
          rounded-2xl overflow-hidden w-full ${sizeClasses[size] || sizeClasses.md}
          flex flex-col
          max-h-[calc(100dvh-var(--bottom-nav-h)-90px)] sm:max-h-[calc(100dvh-90px)]
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`trek-modal-head${wideTitle ? ' is-wide items-start gap-4' : ' items-center'} flex justify-between px-6 py-4 flex-shrink-0`}
        >
          {wideTitle
            ? <div className="trek-text-primary flex-1 min-w-0">{title}</div>
            : <h2 className="trek-text-primary text-base font-semibold">{title}</h2>}
          {!hideCloseButton && (
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="trek-modal-close trek-hover trek-hover-text w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="trek-modal-foot px-6 py-4 flex-shrink-0"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
