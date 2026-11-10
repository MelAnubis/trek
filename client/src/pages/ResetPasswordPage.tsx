import React, { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, KeyRound, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '../i18n'
import { authApi } from '../api/client'
import { getApiErrorMessage } from '../types'

const inputBase: React.CSSProperties = {
  width: '100%', padding: '11px 44px 11px 38px', borderRadius: 12,
  border: '1px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit',
  outline: 'none', transition: 'border-color 120ms',
  background: 'white', color: '#111827',
}

const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!token) setError(t('login.resetPasswordInvalidLink'))
  }, [token, t])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setError('')
    if (!token) return
    if (pw.length < 8) { setError(t('login.passwordMinLength')); return }
    if (pw !== pw2) { setError(t('login.passwordsDontMatch')); return }
    setIsLoading(true)
    try {
      const res = await authApi.resetPassword({
        token,
        new_password: pw,
        ...(mfaRequired && mfaCode ? { mfa_code: mfaCode.trim() } : {}),
      })
      if (res.mfa_required) {
        setMfaRequired(true)
        setIsLoading(false)
        return
      }
      if (res.success) {
        setSuccess(true)
      }
    } catch (err) {
      setError(getApiErrorMessage(err, t('login.resetPasswordFailed')))
    }
    setIsLoading(false)
  }

  const shell = (inner: React.ReactNode) => (
    <div className="!min-h-[100vh] !flex !items-center !justify-center ![background:linear-gradient(180deg,_#f9fafb,_#ffffff)] !p-[24px] ![font-family:inherit]">
      <div className="!w-[100%] !max-w-[440px] ![background:white] !rounded-[20px] ![box-shadow:0_12px_40px_rgba(0,0,0,0.06),_0_2px_8px_rgba(0,0,0,0.04)] !p-[32px_28px]">{inner}</div>
    </div>
  )

  if (success) {
    return shell(
      <div className="!text-center !p-[12px_0]">
        <div className="!w-[56px] !h-[56px] !rounded-[50%] ![background:#ecfdf5] !inline-flex !items-center !justify-center ![color:#059669] !mb-[16px]"><CheckCircle2 size={28} /></div>
        <h1 className="!text-[length:22px] !font-[700] ![color:#111827] !m-[0_0_10px_0]">
          {t('login.resetPasswordSuccessTitle')}
        </h1>
        <p className="!text-[length:14px] ![color:#4b5563] !leading-[1.55] !m-[0]">
          {t('login.resetPasswordSuccessBody')}
        </p>
        <button className="!mt-[24px] !p-[11px_22px] ![background:#111827] ![color:white] !rounded-[12px] !text-[length:14px] !font-[700] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => navigate('/login')} style={{ border: 'none' }}>{t('login.signIn')}</button>
      </div>
    )
  }

  if (!token) {
    return shell(
      <div className="!text-center !p-[12px_0]">
        <div className="!w-[56px] !h-[56px] !rounded-[50%] ![background:#fef2f2] !inline-flex !items-center !justify-center ![color:#dc2626] !mb-[16px]"><AlertTriangle size={28} /></div>
        <h1 className="!text-[length:22px] !font-[700] ![color:#111827] !m-[0_0_10px_0]">
          {t('login.resetPasswordInvalidLink')}
        </h1>
        <p className="!text-[length:14px] ![color:#4b5563] !leading-[1.55] !m-[0]">
          {t('login.resetPasswordInvalidLinkBody')}
        </p>
        <button className="!mt-[24px] !p-[11px_22px] ![background:#111827] ![color:white] !rounded-[12px] !text-[length:14px] !font-[700] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => navigate('/forgot-password')} style={{ border: 'none' }}>{t('login.forgotPasswordSubmit')}</button>
      </div>
    )
  }

  return shell(
    <>
      <h1 className="!text-[length:22px] !font-[700] ![color:#111827] !m-[0_0_8px_0]">
        {t('login.resetPasswordTitle')}
      </h1>
      <p className="!text-[length:13.5px] ![color:#6b7280] !leading-[1.55] !m-[0_0_22px_0]">
        {mfaRequired ? t('login.resetPasswordMfaBody') : t('login.resetPasswordBody')}
      </p>
      {error && (
        <div className="!p-[10px_12px] ![background:#fef2f2] !rounded-[10px] ![color:#991b1b] !text-[length:13px] !mb-[14px]" style={{ border: '1px solid #fecaca' }}>{error}</div>
      )}
      <form className="!flex !flex-col !gap-[16px]" onSubmit={handleSubmit}>
        {!mfaRequired && (
          <>
            <div>
              <label className="!block !text-[length:12.5px] !font-[600] ![color:#374151] !mb-[6px]">
                {t('login.newPassword')}
              </label>
              <div className="!relative">
                <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                <input
                  type={showPw ? 'text' : 'password'} value={pw}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPw(e.target.value)}
                  required placeholder="••••••••" style={inputBase}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#111827' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                />
                <button className="!absolute !right-[12px] !top-[50%] ![background:none] !cursor-pointer !p-[2px] ![color:#9ca3af]" type="button" onClick={() => setShowPw(v => !v)} style={{ transform: 'translateY(-50%)', border: 'none' }}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            <div>
              <label className="!block !text-[length:12.5px] !font-[600] ![color:#374151] !mb-[6px]">
                {t('login.confirmPassword')}
              </label>
              <div className="!relative">
                <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                <input
                  type={showPw ? 'text' : 'password'} value={pw2}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPw2(e.target.value)}
                  required placeholder="••••••••" style={inputBase}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#111827' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                />
              </div>
            </div>
          </>
        )}
        {mfaRequired && (
          <div>
            <label className="!block !text-[length:12.5px] !font-[600] ![color:#374151] !mb-[6px]">
              {t('login.mfaCode')}
            </label>
            <div className="!relative">
              <KeyRound size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
              <input className="!pr-[12px]"
                type="text" inputMode="numeric" value={mfaCode}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMfaCode(e.target.value)}
                required placeholder="123456 or backup-code" style={{ ...inputBase }}
                autoFocus
                onFocus={(e) => { e.currentTarget.style.borderColor = '#111827' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
              />
            </div>
          </div>
        )}
        <button className="!w-[100%] !p-[12px] ![background:#111827] ![color:white] !rounded-[12px] !text-[length:14px] !font-[700] ![font-family:inherit]" type="submit" disabled={isLoading} style={{ border: 'none', cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.7 : 1 }}>
          {isLoading ? '…' : (mfaRequired ? t('login.resetPasswordVerify') : t('login.resetPasswordSubmit'))}
        </button>
      </form>
    </>
  )
}

export default ResetPasswordPage
