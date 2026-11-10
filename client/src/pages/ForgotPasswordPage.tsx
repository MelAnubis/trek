import React, { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle2, Terminal } from 'lucide-react'
import { useTranslation } from '../i18n'
import { authApi } from '../api/client'

const inputBase: React.CSSProperties = {
  width: '100%', padding: '11px 12px 11px 38px', borderRadius: 12,
  border: '1px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit',
  outline: 'none', transition: 'border-color 120ms',
  background: 'white', color: '#111827',
}

const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    // Probe whether SMTP is configured so we can warn the user up-front
    // that the link will land in the server console instead of their
    // inbox. Null while pending — hint is hidden until we know.
    authApi.getAppConfig?.()
      .then((cfg: any) => {
        const hasEmail = !!cfg?.available_channels?.email
        setSmtpConfigured(hasEmail)
      })
      .catch(() => setSmtpConfigured(null))
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setIsLoading(true)
    try {
      await authApi.forgotPassword({ email: email.trim() })
    } catch {
      // Enumeration-safe: success UX regardless of server outcome.
    }
    setSubmitted(true)
    setIsLoading(false)
  }

  return (
    <div className="!min-h-[100vh] !flex !items-center !justify-center ![background:linear-gradient(180deg,_#f9fafb,_#ffffff)] !p-[24px] ![font-family:inherit]">
      <div className="!w-[100%] !max-w-[420px] ![background:white] !rounded-[20px] ![box-shadow:0_12px_40px_rgba(0,0,0,0.06),_0_2px_8px_rgba(0,0,0,0.04)] !p-[32px_28px]">
        <button className="!flex !items-center !gap-[6px] ![background:none] !cursor-pointer !p-[0] ![color:#6b7280] !text-[length:13px] ![font-family:inherit] !mb-[22px]" type="button" onClick={() => navigate('/login')} style={{ border: 'none' }}>
          <ArrowLeft size={14} />{t('login.backToLogin')}
        </button>

        {submitted ? (
          <div className="!text-center !p-[12px_0]">
            <div className="!w-[56px] !h-[56px] !rounded-[50%] ![background:#ecfdf5] !inline-flex !items-center !justify-center ![color:#059669] !mb-[16px]">
              <CheckCircle2 size={28} />
            </div>
            <h1 className="!text-[length:22px] !font-[700] ![color:#111827] !m-[0_0_10px_0]">
              {t('login.forgotPasswordSentTitle')}
            </h1>
            <p className="!text-[length:14px] ![color:#4b5563] !leading-[1.55] !m-[0]">
              {t('login.forgotPasswordSentBody')}
            </p>
            {smtpConfigured === false && (
              <div className="!mt-[18px] !p-[12px_14px] ![background:#fffbeb] !rounded-[10px] !text-left !flex !items-start !gap-[10px]" style={{ border: '1px solid #fde68a' }}>
                <Terminal size={16} style={{ color: '#92400e', marginTop: 1, flexShrink: 0 }} />
                <p className="!text-[length:12.5px] ![color:#92400e] !leading-[1.55] !m-[0]">
                  {t('login.forgotPasswordSmtpHintOff')}
                </p>
              </div>
            )}
            <button className="!mt-[24px] !p-[11px_22px] ![background:#111827] ![color:white] !rounded-[12px] !text-[length:14px] !font-[700] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => navigate('/login')} style={{ border: 'none' }}>{t('login.backToLogin')}</button>
          </div>
        ) : (
          <>
            <h1 className="!text-[length:22px] !font-[700] ![color:#111827] !m-[0_0_8px_0]">
              {t('login.forgotPasswordTitle')}
            </h1>
            <p className="!text-[length:13.5px] ![color:#6b7280] !leading-[1.55] !m-[0_0_16px_0]">
              {t('login.forgotPasswordBody')}
            </p>
            {smtpConfigured === false && (
              <div className="!p-[10px_12px] !mb-[18px] ![background:#fffbeb] !rounded-[10px] !flex !items-start !gap-[10px]" style={{ border: '1px solid #fde68a' }}>
                <Terminal size={15} style={{ color: '#92400e', marginTop: 1, flexShrink: 0 }} />
                <p className="!text-[length:12.5px] ![color:#92400e] !leading-[1.5] !m-[0]">
                  {t('login.forgotPasswordSmtpHintOff')}
                </p>
              </div>
            )}
            <form className="!flex !flex-col !gap-[16px]" onSubmit={handleSubmit}>
              <div>
                <label className="!block !text-[length:12.5px] !font-[600] ![color:#374151] !mb-[6px]">
                  {t('common.email')}
                </label>
                <div className="!relative">
                  <Mail size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                  <input
                    type="email" value={email}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    required placeholder={t('login.emailPlaceholder')} style={inputBase}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#111827' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                  />
                </div>
              </div>
              <button className="!w-[100%] !p-[12px] ![background:#111827] ![color:white] !rounded-[12px] !text-[length:14px] !font-[700] ![font-family:inherit] ![transition:opacity_0.15s]" type="submit" disabled={isLoading} style={{ border: 'none', cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.7 : 1 }}>
                {isLoading ? t('login.signingIn') : t('login.forgotPasswordSubmit')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default ForgotPasswordPage
