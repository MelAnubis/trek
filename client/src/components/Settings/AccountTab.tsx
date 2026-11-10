import React, { useState, useEffect } from 'react'
import { User, Save, Lock, KeyRound, AlertTriangle, Shield, Camera, Trash2, Copy, Download, Printer } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from '../../i18n'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'
import { authApi, adminApi } from '../../api/client'
import { getApiErrorMessage } from '../../types'
import type { UserWithOidc } from '../../types'
import Section from './Section'
import PasskeysSection from './PasskeysSection'

const MFA_BACKUP_SESSION_KEY = 'trek_mfa_backup_codes_pending'

export default function AccountTab(): React.ReactElement {
  const { user, updateProfile, uploadAvatar, deleteAvatar, logout, loadUser, demoMode, appRequireMfa } = useAuthStore()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const toast = useToast()
  const avatarInputRef = React.useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean | 'blocked'>(false)

  // Profile
  const [username, setUsername] = useState<string>(user?.username || '')
  const [email, setEmail] = useState<string>(user?.email || '')

  useEffect(() => {
    setUsername(user?.username || '')
    setEmail(user?.email || '')
  }, [user])

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [oidcOnlyMode, setOidcOnlyMode] = useState(false)

  useEffect(() => {
    authApi.getAppConfig?.().then(config => {
      if (config?.oidc_only_mode) setOidcOnlyMode(true)
    }).catch(() => {})
  }, [])

  // MFA
  const [mfaQr, setMfaQr] = useState<string | null>(null)
  const [mfaSecret, setMfaSecret] = useState<string | null>(null)
  const [mfaSetupCode, setMfaSetupCode] = useState('')
  const [mfaDisablePwd, setMfaDisablePwd] = useState('')
  const [mfaDisableCode, setMfaDisableCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  const mfaRequiredByPolicy =
    !demoMode &&
    !user?.mfa_enabled &&
    (searchParams.get('mfa') === 'required' || appRequireMfa)

  const backupCodesText = backupCodes?.join('\n') || ''

  useEffect(() => {
    if (!user?.mfa_enabled || backupCodes) return
    try {
      const raw = sessionStorage.getItem(MFA_BACKUP_SESSION_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(x => typeof x === 'string')) {
        setBackupCodes(parsed)
      }
    } catch {
      sessionStorage.removeItem(MFA_BACKUP_SESSION_KEY)
    }
  }, [user?.mfa_enabled, backupCodes])

  const dismissBackupCodes = () => {
    sessionStorage.removeItem(MFA_BACKUP_SESSION_KEY)
    setBackupCodes(null)
  }

  const copyBackupCodes = async () => {
    if (!backupCodesText) return
    try {
      await navigator.clipboard.writeText(backupCodesText)
      toast.success(t('settings.mfa.backupCopied'))
    } catch {
      toast.error(t('common.error'))
    }
  }

  const downloadBackupCodes = () => {
    if (!backupCodesText) return
    const blob = new Blob([backupCodesText + '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'trek-mfa-backup-codes.txt'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const printBackupCodes = () => {
    if (!backupCodesText) return
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>TREK MFA Backup Codes</title>
      <style>body{font-family:Arial,sans-serif;padding:32px}h1{font-size:20px}pre{font-size:16px;line-height:1.6}</style>
      </head><body><h1>TREK MFA Backup Codes</h1><p>${new Date().toLocaleString()}</p><pre>${backupCodesText}</pre></body></html>`
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await uploadAvatar(file)
      toast.success(t('settings.avatarUploaded'))
    } catch {
      toast.error(t('settings.avatarError'))
    }
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  const handleAvatarRemove = async () => {
    try {
      await deleteAvatar()
      toast.success(t('settings.avatarRemoved'))
    } catch {
      toast.error(t('settings.avatarError'))
    }
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      await updateProfile({ username, email })
      toast.success(t('settings.toast.profileSaved'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Section title={t('settings.account')} icon={User}>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.username')}</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('settings.email')}</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
        </div>

        {/* Change Password */}
        {!oidcOnlyMode && (
          <div className="!pt-[16px] !mt-[16px] ![border-top:1px_solid_var(--border-secondary)]">
            <label className="block text-sm font-medium text-slate-700 mb-3">{t('settings.changePassword')}</label>
            <div className="space-y-3">
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder={t('settings.currentPassword')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
              />
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('settings.newPassword')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t('settings.confirmPassword')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent"
              />
              <button
                onClick={async () => {
                  if (!currentPassword) return toast.error(t('settings.currentPasswordRequired'))
                  if (!newPassword) return toast.error(t('settings.passwordRequired'))
                  if (newPassword.length < 8) return toast.error(t('settings.passwordTooShort'))
                  if (newPassword !== confirmPassword) return toast.error(t('settings.passwordMismatch'))
                  try {
                    await authApi.changePassword({ current_password: currentPassword, new_password: newPassword })
                    toast.success(t('settings.passwordChanged'))
                    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
                    await loadUser({ silent: true })
                  } catch (err: unknown) {
                    toast.error(getApiErrorMessage(err, t('common.error')))
                  }
                }}
                className="trek-hover flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-secondary)]" >
                <Lock size={14} />
                {t('settings.updatePassword')}
              </button>
            </div>
          </div>
        )}

        {/* MFA */}
        <div className="!pt-[16px] !mt-[16px] ![border-top:1px_solid_var(--border-secondary)]">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            <h3 className="font-semibold text-base m-0 ![color:var(--text-primary)]">{t('settings.mfa.title')}</h3>
          </div>
          <div className="space-y-3">
            {mfaRequiredByPolicy && (
              <div className="flex gap-3 p-3 rounded-lg border text-sm ![background:var(--bg-secondary)] ![border-color:var(--border-primary)] ![color:var(--text-primary)]">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600" />
                <p className="m-0 leading-relaxed">{t('settings.mfa.requiredByPolicy')}</p>
              </div>
            )}
            <p className="text-sm m-0 ![color:var(--text-muted)] !leading-[1.5]">{t('settings.mfa.description')}</p>
            {demoMode ? (
              <p className="text-sm text-amber-700 m-0">{t('settings.mfa.demoBlocked')}</p>
            ) : (
              <>
                <p className="text-sm font-medium m-0 ![color:var(--text-secondary)]">
                  {user?.mfa_enabled ? t('settings.mfa.enabled') : t('settings.mfa.disabled')}
                </p>

                {!user?.mfa_enabled && !mfaQr && (
                  <button
                    type="button"
                    disabled={mfaLoading}
                    onClick={async () => {
                      setMfaLoading(true)
                      try {
                        const data = await authApi.mfaSetup() as { qr_svg: string; secret: string }
                        setMfaQr(data.qr_svg)
                        setMfaSecret(data.secret)
                        setMfaSetupCode('')
                      } catch (err: unknown) {
                        toast.error(getApiErrorMessage(err, t('common.error')))
                      } finally {
                        setMfaLoading(false)
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)]"
                  >
                    {mfaLoading ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" /> : <KeyRound size={14} />}
                    {t('settings.mfa.setup')}
                  </button>
                )}

                {!user?.mfa_enabled && mfaQr && (
                  <div className="space-y-3">
                    <p className="text-sm ![color:var(--text-muted)]">{t('settings.mfa.scanQr')}</p>
                    <div className="rounded-lg border mx-auto block overflow-hidden" style={{ width: 'fit-content', borderColor: 'var(--border-primary)' }} dangerouslySetInnerHTML={{ __html: mfaQr! }} />
                    <div>
                      <label className="block text-xs font-medium mb-1 ![color:var(--text-secondary)]">{t('settings.mfa.secretLabel')}</label>
                      <code className="block text-xs p-2 rounded break-all ![background:var(--bg-hover)] ![color:var(--text-primary)]">{mfaSecret}</code>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={mfaSetupCode}
                      onChange={e => setMfaSetupCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder={t('settings.mfa.codePlaceholder')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mfaLoading || mfaSetupCode.length < 6}
                        onClick={async () => {
                          setMfaLoading(true)
                          try {
                            const resp = await authApi.mfaEnable({ code: mfaSetupCode }) as { backup_codes?: string[] }
                            toast.success(t('settings.mfa.toastEnabled'))
                            setMfaQr(null)
                            setMfaSecret(null)
                            setMfaSetupCode('')
                            const codes = resp.backup_codes || null
                            if (codes?.length) {
                              try { sessionStorage.setItem(MFA_BACKUP_SESSION_KEY, JSON.stringify(codes)) } catch { /* ignore */ }
                            }
                            setBackupCodes(codes)
                            await loadUser({ silent: true })
                          } catch (err: unknown) {
                            toast.error(getApiErrorMessage(err, t('common.error')))
                          } finally {
                            setMfaLoading(false)
                          }
                        }}
                        className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50"
                      >
                        {t('settings.mfa.enable')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMfaQr(null); setMfaSecret(null); setMfaSetupCode('') }}
                        className="px-4 py-2 rounded-lg text-sm border ![border-color:var(--border-primary)] ![color:var(--text-secondary)]"
                      >
                        {t('settings.mfa.cancelSetup')}
                      </button>
                    </div>
                  </div>
                )}

                {user?.mfa_enabled && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium ![color:var(--text-secondary)]">{t('settings.mfa.disableTitle')}</p>
                    <p className="text-xs ![color:var(--text-muted)]">{t('settings.mfa.disableHint')}</p>
                    <input
                      type="password"
                      value={mfaDisablePwd}
                      onChange={e => setMfaDisablePwd(e.target.value)}
                      placeholder={t('settings.currentPassword')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={mfaDisableCode}
                      onChange={e => setMfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder={t('settings.mfa.codePlaceholder')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      disabled={mfaLoading || !mfaDisablePwd || mfaDisableCode.length < 6}
                      onClick={async () => {
                        setMfaLoading(true)
                        try {
                          await authApi.mfaDisable({ password: mfaDisablePwd, code: mfaDisableCode })
                          toast.success(t('settings.mfa.toastDisabled'))
                          setMfaDisablePwd('')
                          setMfaDisableCode('')
                          sessionStorage.removeItem(MFA_BACKUP_SESSION_KEY)
                          setBackupCodes(null)
                          await loadUser({ silent: true })
                        } catch (err: unknown) {
                          toast.error(getApiErrorMessage(err, t('common.error')))
                        } finally {
                          setMfaLoading(false)
                        }
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                    >
                      {t('settings.mfa.disable')}
                    </button>
                  </div>
                )}

                {backupCodes && backupCodes.length > 0 && (
                  <div className="space-y-3 p-3 rounded-lg border ![border-color:var(--border-primary)] ![background:var(--bg-hover)]">
                    <p className="text-sm font-semibold m-0 ![color:var(--text-primary)]">{t('settings.mfa.backupTitle')}</p>
                    <p className="text-xs m-0 ![color:var(--text-muted)]">{t('settings.mfa.backupDescription')}</p>
                    <pre className="text-xs m-0 p-2 rounded border overflow-auto ![border-color:var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !max-h-[220px]">{backupCodesText}</pre>
                    <p className="text-xs m-0 ![color:#b45309]">{t('settings.mfa.backupWarning')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={copyBackupCodes} className="px-3 py-2 rounded-lg text-xs border flex items-center gap-1.5 ![border-color:var(--border-primary)] ![color:var(--text-secondary)]">
                        <Copy size={13} /> {t('settings.mfa.backupCopy')}
                      </button>
                      <button type="button" onClick={downloadBackupCodes} className="px-3 py-2 rounded-lg text-xs border flex items-center gap-1.5 ![border-color:var(--border-primary)] ![color:var(--text-secondary)]">
                        <Download size={13} /> {t('settings.mfa.backupDownload')}
                      </button>
                      <button type="button" onClick={printBackupCodes} className="px-3 py-2 rounded-lg text-xs border flex items-center gap-1.5 ![border-color:var(--border-primary)] ![color:var(--text-secondary)]">
                        <Printer size={13} /> {t('settings.mfa.backupPrint')}
                      </button>
                      <button type="button" onClick={dismissBackupCodes} className="px-3 py-2 rounded-lg text-xs border ![border-color:var(--border-primary)] ![color:var(--text-secondary)]">
                        {t('common.ok')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Passkeys */}
        <PasskeysSection demoMode={demoMode} />

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="!relative !shrink-[0]">
            {user?.avatar_url ? (
              <img className="!w-[64px] !h-[64px] !rounded-[50%] !object-cover" src={user.avatar_url} alt="" />
            ) : (
              <div className="!w-[64px] !h-[64px] !rounded-[50%] !flex !items-center !justify-center !text-[length:24px] !font-[700] ![background:var(--bg-hover)] ![color:var(--text-secondary)]">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            <button className="trek-h-transform-c590c0 trek-hover-o85 !absolute !bottom-[-3px] !right-[-3px] !w-[28px] !h-[28px] !rounded-[50%] ![background:var(--text-primary)] ![color:var(--bg-card)] ![border:2px_solid_var(--bg-card)] !flex !items-center !justify-center !cursor-pointer !p-[0] ![transition:transform_0.15s,_opacity_0.15s]"
              onClick={() => avatarInputRef.current?.click()} >
              <Camera size={14} />
            </button>
            {user?.avatar_url && (
              <button className="!absolute !top-[-2px] !right-[-2px] !w-[20px] !h-[20px] !rounded-[50%] ![background:#ef4444] ![color:white] ![border:2px_solid_var(--bg-card)] !flex !items-center !justify-center !cursor-pointer !p-[0]"
                onClick={handleAvatarRemove}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-sm ![color:var(--text-muted)]">
              <span className="font-medium !inline-flex !items-center !gap-[4px] ![color:var(--text-secondary)]">
                {user?.role === 'admin' ? <><Shield size={13} /> {t('settings.roleAdmin')}</> : t('settings.roleUser')}
              </span>
              {(user as UserWithOidc)?.oidc_issuer && (
                <span className="!inline-flex !items-center !gap-[4px] !text-[length:10px] !font-[500] !p-[1px_8px] !rounded-[99px] ![background:#dbeafe] ![color:#1d4ed8] !ml-[6px]">
                  SSO
                </span>
              )}
            </div>
            {(user as UserWithOidc)?.oidc_issuer && (
              <p className="!text-[length:11px] ![color:var(--text-faint)] !mt-[-2px]">
                {t('settings.oidcLinked')} {(user as UserWithOidc).oidc_issuer!.replace('https://', '').replace(/\/+$/, '')}
              </p>
            )}
          </div>
        </div>

        <div className="!flex !justify-between !items-center !mt-[12px]">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:bg-slate-400"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="hidden sm:inline">{t('settings.saveProfile')}</span>
            <span className="sm:hidden">{t('common.save')}</span>
          </button>
          <button
            onClick={async () => {
              if (user?.role === 'admin') {
                try {
                  await adminApi.stats()
                  const adminUsers = (await adminApi.users()).users.filter((u: { role: string }) => u.role === 'admin')
                  if (adminUsers.length <= 1) {
                    setShowDeleteConfirm('blocked')
                    return
                  }
                } catch {}
              }
              setShowDeleteConfirm(true)
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-red-500 hover:bg-red-50 ![border:1px_solid_#fecaca]"
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">{t('settings.deleteAccount')}</span>
            <span className="sm:hidden">{t('common.delete')}</span>
          </button>
        </div>
      </Section>

      {/* Delete Account Blocked */}
      {showDeleteConfirm === 'blocked' && (
        <div className="!fixed !inset-[0] !z-[9999] ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center !p-[24px]" onClick={() => setShowDeleteConfirm(false)}>
          <div className="![background:var(--bg-card)] !rounded-[16px] !p-[28px_24px] !max-w-[400px] !w-[100%] ![box-shadow:0_20px_60px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
            <div className="!flex !items-center !gap-[10px] !mb-[16px]">
              <div className="!w-[36px] !h-[36px] !rounded-[10px] ![background:#fef3c7] !flex !items-center !justify-center">
                <Shield size={18} style={{ color: '#d97706' }} />
              </div>
              <h3 className="!m-[0] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">{t('settings.deleteBlockedTitle')}</h3>
            </div>
            <p className="!text-[length:13px] ![color:var(--text-muted)] !leading-[1.6] !m-[0_0_20px]">
              {t('settings.deleteBlockedMessage')}
            </p>
            <div className="!flex !justify-end">
              <button className="!p-[8px_16px] !rounded-[8px] !text-[length:13px] !font-[500] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-secondary)] !cursor-pointer ![font-family:inherit]"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t('common.ok') || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirm */}
      {showDeleteConfirm === true && (
        <div className="!fixed !inset-[0] !z-[9999] ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center !p-[24px]" onClick={() => setShowDeleteConfirm(false)}>
          <div className="![background:var(--bg-card)] !rounded-[16px] !p-[28px_24px] !max-w-[400px] !w-[100%] ![box-shadow:0_20px_60px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
            <div className="!flex !items-center !gap-[10px] !mb-[16px]">
              <div className="!w-[36px] !h-[36px] !rounded-[10px] ![background:#fef2f2] !flex !items-center !justify-center">
                <Trash2 size={18} style={{ color: '#ef4444' }} />
              </div>
              <h3 className="!m-[0] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">{t('settings.deleteAccountTitle')}</h3>
            </div>
            <p className="!text-[length:13px] ![color:var(--text-muted)] !leading-[1.6] !m-[0_0_20px]">
              {t('settings.deleteAccountWarning')}
            </p>
            <div className="!flex !justify-end !gap-[8px]">
              <button className="!p-[8px_16px] !rounded-[8px] !text-[length:13px] !font-[500] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-secondary)] !cursor-pointer ![font-family:inherit]"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t('common.cancel')}
              </button>
              <button className="!p-[8px_16px] !rounded-[8px] !text-[length:13px] !font-[600] ![border:none] ![background:#ef4444] ![color:white] !cursor-pointer ![font-family:inherit]"
                onClick={async () => {
                  try {
                    await authApi.deleteOwnAccount()
                    logout()
                    navigate('/login', { state: { noRedirect: true } })
                  } catch (err: unknown) {
                    toast.error(getApiErrorMessage(err, t('common.error')))
                    setShowDeleteConfirm(false)
                  }
                }}
              >
                {t('settings.deleteAccountConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
