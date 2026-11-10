import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useSettingsStore } from '../store/settingsStore'
import { SUPPORTED_LANGUAGES, useTranslation, detectBrowserLanguage } from '../i18n'
import { authApi, configApi } from '../api/client'
import { hasStoredLanguage } from '../store/settingsStore'
import { getApiErrorMessage } from '../types'
import { Plane, Eye, EyeOff, Mail, Lock, MapPin, Calendar, Package, User, Globe, Zap, Users, Wallet, Map, CheckSquare, BookMarked, FolderOpen, Route, Shield, KeyRound, ChevronDown, Fingerprint } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'

interface AppConfig {
  has_users: boolean
  allow_registration: boolean
  setup_complete: boolean
  demo_mode: boolean
  oidc_configured: boolean
  oidc_display_name?: string
  oidc_only_mode: boolean
  password_login: boolean
  password_registration: boolean
  oidc_login: boolean
  oidc_registration: boolean
  env_override_oidc_only: boolean
  passkey_login?: boolean
  passkey_configured?: boolean
}

export default function LoginPage(): React.ReactElement {
  const { t, language } = useTranslation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [inviteToken, setInviteToken] = useState<string>('')
  const [inviteValid, setInviteValid] = useState<boolean>(false)
  const exchangeInitiated = useRef(false)

  const [langDropdownOpen, setLangDropdownOpen] = useState<boolean>(false)

  const { login, register, demoLogin, completeMfaLogin, loadUser, appVersion } = useAuthStore()
  const { setLanguageLocal, setLanguageTransient } = useSettingsStore()
  const navigate = useNavigate()
  const location = useLocation()
  const noRedirect = !!(location.state as { noRedirect?: boolean } | null)?.noRedirect

  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirect')
    // Only allow relative paths starting with / to prevent open redirect attacks
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/\\')) {
      return redirect
    }
    return '/dashboard'
  }, [])

  useEffect(() => {
    if (redirectTarget !== '/dashboard') {
      sessionStorage.setItem('oidc_redirect', redirectTarget)
    }
  }, [redirectTarget])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const invite = params.get('invite')
    // Desde la zona pública: «Únete» abre directamente el registro.
    if (params.get('mode') === 'register') setMode('register')
    const oidcCode = params.get('oidc_code')
    const oidcError = params.get('oidc_error')

    if (invite) {
      setInviteToken(invite)
      setMode('register')
      authApi.validateInvite(invite).then(() => {
        setInviteValid(true)
      }).catch(() => {
        setError(t('login.invalidInviteLink'))
      })
      window.history.replaceState({}, '', window.location.pathname)
    }

    if (oidcCode) {
      if (exchangeInitiated.current) return
      exchangeInitiated.current = true
      setIsLoading(true)
      fetch('/api/auth/oidc/exchange?code=' + encodeURIComponent(oidcCode), { credentials: 'include' })
        .then(r => r.json())
        .then(async data => {
          window.history.replaceState({}, '', '/login')
          if (data.token) {
            await loadUser()
            const savedRedirect = sessionStorage.getItem('oidc_redirect') || '/dashboard'
            sessionStorage.removeItem('oidc_redirect')
            navigate(savedRedirect, { replace: true })
          } else {
            setError(data.error || t('login.oidcFailed'))
          }
        })
        .catch(() => {
          window.history.replaceState({}, '', '/login')
          setError(t('login.oidcFailed'))
        })
        .finally(() => setIsLoading(false))
      return
    }

    if (oidcError) {
      const errorMessages: Record<string, string> = {
        registration_disabled: t('login.oidc.registrationDisabled'),
        no_email: t('login.oidc.noEmail'),
        email_not_verified: t('login.oidc.emailNotVerified'),
        token_failed: t('login.oidc.tokenFailed'),
        invalid_state: t('login.oidc.invalidState'),
      }
      setError(errorMessages[oidcError] || oidcError)
      sessionStorage.removeItem('oidc_redirect')
      window.history.replaceState({}, '', '/login')
      return
    }

    const CONFIG_CACHE_KEY = 'trek_app_config_cache'
    authApi.getAppConfig?.()
      .then((config: AppConfig) => {
        try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config)) } catch { /* ignore quota errors */ }
        return { config, fromCache: false }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(CONFIG_CACHE_KEY)
          return raw ? { config: JSON.parse(raw) as AppConfig, fromCache: true } : { config: null as AppConfig | null, fromCache: false }
        } catch { return { config: null as AppConfig | null, fromCache: false } }
      })
      .then(({ config, fromCache }) => {
        if (config) {
          setAppConfig(config)
          if (!config.has_users) setMode('register')
          // Skip auto-redirect when config is from cache — network is unreliable
          // and auto-redirecting to the IdP could loop if the proxy changed.
          if (!fromCache && !config.password_login && config.oidc_login && config.oidc_configured && config.has_users && !invite && !noRedirect) {
            window.location.href = '/api/auth/oidc/login'
          }
        }
      })
  }, [navigate, t, noRedirect])

  // Language detection chain (runs once on mount, only if user has no saved preference):
  // 1. localStorage → already in store initial state, skip
  // 2. Browser/OS language (navigator.languages)
  // 3. Server default (DEFAULT_LANGUAGE env var)
  // 4. 'en' → hardcoded fallback already in store
  useEffect(() => {
    if (hasStoredLanguage()) return

    const detected = detectBrowserLanguage()
    if (detected) {
      setLanguageTransient(detected)
      return
    }

    configApi.getPublicConfig()
      .then(({ defaultLanguage }) => { if (defaultLanguage) setLanguageTransient(defaultLanguage) })
      .catch((err) => console.warn('Failed to fetch default language config:', err))
  }, [setLanguageTransient])

  useEffect(() => {
    if (!langDropdownOpen) return
    const close = () => setLangDropdownOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [langDropdownOpen])

  const handleDemoLogin = async (): Promise<void> => {
    setError('')
    setIsLoading(true)
    try {
      await demoLogin()
      setShowTakeoff(true)
      setTimeout(() => navigate(redirectTarget), 2600)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('login.demoFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasskeyLogin = async (): Promise<void> => {
    setError('')
    setIsLoading(true)
    try {
      const options = await authApi.passkey.loginOptions()
      const assertion = await startAuthentication({ optionsJSON: options })
      await authApi.passkey.loginVerify(assertion)
      await loadUser({ silent: true })
      setShowTakeoff(true)
      setTimeout(() => navigate(redirectTarget), 2600)
    } catch (err: unknown) {
      // The user dismissing the native prompt isn't an error worth surfacing.
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'AbortError') {
        setIsLoading(false)
        return
      }
      setError(getApiErrorMessage(err, t('login.passkey.failed')))
      setIsLoading(false)
    }
  }

  const [showTakeoff, setShowTakeoff] = useState<boolean>(false)
  const [mfaStep, setMfaStep] = useState(false)
  const [mfaToken, setMfaToken] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [passwordChangeStep, setPasswordChangeStep] = useState(false)
  const [savedLoginPassword, setSavedLoginPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      if (passwordChangeStep) {
        if (!newPassword) { setError(t('settings.passwordRequired')); setIsLoading(false); return }
        if (newPassword.length < 8) { setError(t('settings.passwordTooShort')); setIsLoading(false); return }
        if (newPassword !== confirmPassword) { setError(t('settings.passwordMismatch')); setIsLoading(false); return }
        await authApi.changePassword({ current_password: savedLoginPassword, new_password: newPassword })
        await loadUser({ silent: true })
        setShowTakeoff(true)
        setTimeout(() => navigate(redirectTarget), 2600)
        return
      }
      if (mode === 'login' && mfaStep) {
        if (!mfaCode.trim()) {
          setError(t('login.mfaCodeRequired'))
          setIsLoading(false)
          return
        }
        const mfaResult = await completeMfaLogin(mfaToken, mfaCode)
        if ('user' in mfaResult && mfaResult.user?.must_change_password) {
          setSavedLoginPassword(password)
          setPasswordChangeStep(true)
          setIsLoading(false)
          return
        }
        setShowTakeoff(true)
        setTimeout(() => navigate(redirectTarget), 2600)
        return
      }
      if (mode === 'register') {
        if (!username.trim()) { setError(t('login.usernameRequired')); setIsLoading(false); return }
        if (password.length < 8) { setError(t('login.passwordMinLength')); setIsLoading(false); return }
        await register(username, email, password, inviteToken || undefined)
      } else {
        const result = await login(email, password)
        if ('mfa_required' in result && result.mfa_required && 'mfa_token' in result) {
          setMfaToken(result.mfa_token)
          setMfaStep(true)
          setMfaCode('')
          setIsLoading(false)
          return
        }
        if ('user' in result && result.user?.must_change_password) {
          setSavedLoginPassword(password)
          setPasswordChangeStep(true)
          setIsLoading(false)
          return
        }
      }
      setShowTakeoff(true)
      setTimeout(() => navigate(redirectTarget), 2600)
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('login.error')))
      setIsLoading(false)
    }
  }

  const showRegisterOption = (appConfig?.password_registration || !appConfig?.has_users || inviteValid) && (appConfig?.setup_complete !== false || !appConfig?.has_users)

  // In OIDC-only mode, show a minimal page that redirects directly to the IdP
  const oidcOnly = !appConfig?.password_login && appConfig?.oidc_login && appConfig?.oidc_configured

  const inputBase: React.CSSProperties = {
    width: '100%', padding: '11px 12px 11px 40px', border: '1px solid #e5e7eb',
    borderRadius: 12, fontSize: 14, fontFamily: 'inherit', outline: 'none',
    color: '#111111', background: 'white', boxSizing: 'border-box', transition: 'border-color 0.15s',
  }

  if (showTakeoff) {
    return (
      <div className="takeoff-overlay !fixed !inset-[0] !z-[99999] !overflow-hidden">
        {/* Sky gradient */}
        <div className="takeoff-sky !absolute !inset-[0]" />

        {/* Stars */}
        {Array.from({ length: 60 }, (_, i) => (
          <div key={i} className="takeoff-star !absolute !rounded-[50%]" style={{ width: Math.random() > 0.7 ? 3 : 1.5, height: Math.random() > 0.7 ? 3 : 1.5, background: 'white', top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`, animationDelay: `${0.3 + Math.random() * 0.5}s, ${Math.random() * 1}s` }} />
        ))}

        {/* Clouds rushing past */}
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="takeoff-cloud !absolute !rounded-[50%] ![filter:blur(8px)]" style={{ width: 120 + i * 40, height: 40 + i * 10, background: 'rgba(255,255,255,0.15)', right: -200, top: `${25 + i * 12}%`, animationDelay: `${0.3 + i * 0.25}s` }} />
        ))}

        {/* Speed lines */}
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="takeoff-speedline !absolute !h-[1.5px]" style={{ width: 80 + Math.random() * 120, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)', top: `${10 + Math.random() * 80}%`, right: -200, animationDelay: `${0.5 + i * 0.12}s` }} />
        ))}

        {/* Plane */}
        <div className="takeoff-plane !absolute !left-[50%] !bottom-[10%]" style={{ transform: 'translate(-50%, 0)' }}>
          <svg className="!w-[200px] ![filter:drop-shadow(0_0_20px_rgba(255,255,255,0.3))]" viewBox="0 0 480 120">
            <g fill="white" transform="translate(240,60) rotate(-12)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <path d="M-100,-5 L-120,-30 L-108,-30 L-90,-8 Z" />
              <path d="M-100,5 L-120,30 L-108,30 L-90,8 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>
        </div>

        {/* Contrail */}
        <div className="takeoff-trail !absolute !left-[50%] !bottom-[8%] !w-[3px] !h-[0]" style={{ background: 'linear-gradient(to top, transparent, rgba(255,255,255,0.5))', transformOrigin: 'bottom center' }} />

        {/* Logo fade in + burst */}
        <div className="takeoff-logo !absolute !top-[50%] !left-[50%] !flex !flex-col !items-center !gap-[8px]" style={{ transform: 'translate(-50%, -50%)' }}>
          <img className="!h-[72px]" src="/logo-light.svg" alt="Trek Wanderer" />
          <p className="!m-[0] !tracking-[0.02em] !whitespace-pre-line !text-center" style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)', fontFamily: "'Jost', 'Futura', sans-serif", fontWeight: 300 }}>{t('login.tagline')}</p>
        </div>


        <style>{`
          .takeoff-sky {
            background: linear-gradient(to top, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #0a0a23 100%);
            animation: skyShift 2.6s ease-in-out forwards;
          }
          @keyframes skyShift {
            0%   { background: linear-gradient(to top, #0a0a23 0%, #0f172a 40%, #111827 100%); }
            100% { background: linear-gradient(to top, #000011 0%, #000016 50%, #000011 100%); }
          }

          .takeoff-star {
            opacity: 0;
            animation: starAppear 0.5s ease-out forwards, starTwinkle 2s ease-in-out infinite alternate;
          }
          @keyframes starAppear {
            0%   { opacity: 0; transform: scale(0); }
            100% { opacity: 0.7; transform: scale(1); }
          }
          @keyframes starTwinkle {
            0%   { opacity: 0.3; }
            100% { opacity: 0.9; }
          }

          .takeoff-cloud {
            animation: cloudRush 0.6s ease-in forwards;
          }
          @keyframes cloudRush {
            0%   { right: -200px; opacity: 0; }
            20%  { opacity: 0.4; }
            100% { right: 120%; opacity: 0; }
          }

          .takeoff-speedline {
            animation: speedRush 0.4s ease-in forwards;
          }
          @keyframes speedRush {
            0%   { right: -200px; opacity: 0; }
            30%  { opacity: 0.6; }
            100% { right: 120%; opacity: 0; }
          }

          .takeoff-plane {
            animation: planeUp 1s ease-in forwards;
          }
          @keyframes planeUp {
            0%   { transform: translate(-50%, 0) rotate(0deg) scale(1); bottom: 8%; left: 50%; opacity: 1; }
            100% { transform: translate(-50%, 0) rotate(-22deg) scale(0.15); bottom: 120%; left: 58%; opacity: 0; }
          }

          .takeoff-trail {
            animation: trailGrow 0.9s ease-out 0.15s forwards;
          }
          @keyframes trailGrow {
            0%   { height: 0; opacity: 0; transform: translateX(-50%) rotate(-5deg); }
            30%  { height: 150px; opacity: 0.6; }
            60%  { height: 350px; opacity: 0.4; }
            100% { height: 600px; opacity: 0; transform: translateX(-50%) rotate(-8deg); }
          }

          .takeoff-logo {
            opacity: 0;
            animation: logoReveal 0.5s ease-out 0.9s forwards;
          }
          @keyframes logoReveal {
            0%   { opacity: 0; transform: translate(-50%, -40%) scale(0.9); }
            100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="!min-h-[100vh] !flex !relative" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>

      {/* Language dropdown */}
      <div className="!absolute !top-[16px] !right-[16px] !z-[10]">
        <button
          onClick={(e) => { e.stopPropagation(); setLangDropdownOpen(o => !o) }}
          aria-haspopup="listbox"
          aria-expanded={langDropdownOpen}
          aria-label="Change language"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 99,
            background: 'rgba(0,0,0,0.06)', border: 'none',
            fontSize: 13, fontWeight: 500, color: '#374151',
            cursor: 'pointer', fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = 'rgba(0,0,0,0.1)'}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = 'rgba(0,0,0,0.06)'}
        >
          <Globe size={14} />
          {SUPPORTED_LANGUAGES.find(l => l.value === language)?.label ?? language.toUpperCase()}
          <ChevronDown size={12} style={{ transition: 'transform 0.15s', transform: langDropdownOpen ? 'rotate(180deg)' : 'none' }} />
        </button>

        {langDropdownOpen && (
          <div className="!absolute !top-[100%] !right-[0] !mt-[4px] ![backdrop-filter:blur(24px)_saturate(180%)] ![-webkit-backdrop-filter:blur(24px)_saturate(180%)] !rounded-[12px] !min-w-[190px] !max-h-[320px] !overflow-y-auto"
            role="listbox"
            aria-label="Select language"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'rgba(255,255,255,0.90)', boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 1px 0 rgba(255,255,255,0.8) inset', border: '1px solid rgba(255,255,255,0.60)' }}
          >
            {SUPPORTED_LANGUAGES.map(({ value, label }) => (
              <button
                key={value}
                role="option"
                aria-selected={value === language}
                onClick={() => { setLanguageLocal(value); setLangDropdownOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 16px', border: 'none',
                  background: value === language ? 'rgba(0,0,0,0.06)' : 'transparent',
                  color: value === language ? '#111111' : '#374151',
                  fontWeight: value === language ? 600 : 400,
                  fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (value !== language) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (value !== language) e.currentTarget.style.background = 'transparent' }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Left — branding */}
      <div style={{ background: 'linear-gradient(135deg, #09090b 0%, #18181b 50%, #09090b 100%)' }}
        className="lg-panel !hidden !w-[55%] !flex-col !justify-center !items-center !p-[60px_48px] !relative !overflow-hidden">
        <style>{`@media(min-width:1024px){.lg-panel{display:flex!important}}`}</style>

        {/* Stars */}
        <div className="!absolute !inset-[0] !overflow-hidden">
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} className="login-star !absolute !rounded-[50%]" style={{ width: Math.random() > 0.7 ? 2 : 1, height: Math.random() > 0.7 ? 2 : 1, background: 'white', opacity: 0.15 + Math.random() * 0.25, top: `${Math.random() * 70}%`, left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 4}s` }} />
          ))}
        </div>

        {/* Animated glow orbs */}
        <div className="login-orb1 !absolute !w-[500px] !h-[500px] !rounded-[50%] ![filter:blur(80px)]" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)' }} />
        <div className="login-orb2 !absolute !w-[350px] !h-[350px] !rounded-[50%] ![filter:blur(60px)]" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)' }} />

        {/* Animated planes — realistic silhouettes at different sizes/speeds */}
        <div className="!absolute !inset-[0] !overflow-hidden !pointer-events-none">
          {/* Plane 1 — large, slow, foreground */}
          <svg className="login-plane1 !absolute !w-[48px]" viewBox="0 0 480 120" style={{ opacity: 0.12 }}>
            <g fill="white" transform="translate(240,60) rotate(-12)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <path d="M-100,-5 L-120,-30 L-108,-30 L-90,-8 Z" />
              <path d="M-100,5 L-120,30 L-108,30 L-90,8 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>

          {/* Plane 2 — small, faster, higher */}
          <svg className="login-plane2 !absolute !w-[24px]" viewBox="0 0 480 120" style={{ opacity: 0.08 }}>
            <g fill="white" transform="translate(240,60) rotate(-12)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>

          {/* Plane 3 — medium, mid-speed */}
          <svg className="login-plane3 !absolute !w-[32px]" viewBox="0 0 480 120" style={{ opacity: 0.06 }}>
            <g fill="white" transform="translate(240,60) rotate(-5)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <path d="M-100,-5 L-120,-30 L-108,-30 L-90,-8 Z" />
              <path d="M-100,5 L-120,30 L-108,30 L-90,8 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>

          {/* Plane 4 — tiny, fast, high */}
          <svg className="login-plane4 !absolute !w-[16px]" viewBox="0 0 480 120" style={{ opacity: 0.07 }}>
            <g fill="white" transform="translate(240,60) rotate(-10)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>

          {/* Plane 5 — medium, right to left, lower */}
          <svg className="login-plane5 !absolute !w-[28px]" viewBox="0 0 480 120" style={{ opacity: 0.05 }}>
            <g fill="white" transform="translate(240,60) rotate(8) scale(-1,1)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <path d="M-100,-5 L-120,-30 L-108,-30 L-90,-8 Z" />
              <path d="M-100,5 L-120,30 L-108,30 L-90,8 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>

          {/* Plane 6 — tiny distant */}
          <svg className="login-plane6 !absolute !w-[12px]" viewBox="0 0 480 120" style={{ opacity: 0.04 }}>
            <g fill="white" transform="translate(240,60) rotate(-15)">
              <ellipse cx="0" cy="0" rx="120" ry="12" />
              <path d="M-20,-10 L-60,-55 L-40,-55 L0,-15 Z" />
              <path d="M-20,10 L-60,55 L-40,55 L0,15 Z" />
              <ellipse cx="60" cy="0" rx="18" ry="8" />
            </g>
          </svg>
        </div>


        <div className="!relative !z-[1] !max-w-[560px] !text-center">
          {/* Logo */}
          <div className="!flex !items-center !justify-center !mb-[48px]">
            <img className="!h-[64px]" src="/logo-light.svg" alt="Trek Wanderer" />
          </div>

          <h2 className="!m-[0_0_12px] !leading-[1.15] !tracking-[0.02em] !whitespace-pre-line" style={{ fontSize: 36, color: 'white', fontFamily: "'Jost', 'Futura', sans-serif", fontWeight: 300 }}>
            {t('login.tagline')}
          </h2>
          <p className="!m-[0_0_44px] !text-[length:15px] !leading-[1.7]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {t('login.description')}
          </p>

          <div className="!grid ![grid-template-columns:repeat(4,_1fr)] !gap-[8px]">
            {[
              { Icon: Map, label: t('login.features.maps'), desc: t('login.features.mapsDesc') },
              { Icon: Zap, label: t('login.features.realtime'), desc: t('login.features.realtimeDesc') },
              { Icon: Wallet, label: t('login.features.budget'), desc: t('login.features.budgetDesc') },
              { Icon: Users, label: t('login.features.collab'), desc: t('login.features.collabDesc') },
              { Icon: CheckSquare, label: t('login.features.packing'), desc: t('login.features.packingDesc') },
              { Icon: BookMarked, label: t('login.features.bookings'), desc: t('login.features.bookingsDesc') },
              { Icon: FolderOpen, label: t('login.features.files'), desc: t('login.features.filesDesc') },
              { Icon: Route, label: t('login.features.routes'), desc: t('login.features.routesDesc') },
            ].map(({ Icon, label, desc }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left', transition: 'background 200ms cubic-bezier(0.23,1,0.32,1), border-color 200ms cubic-bezier(0.23,1,0.32,1)' }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}>
                <Icon size={17} style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 7 }} />
                <div className="!text-[length:12.5px] !font-[600] !mb-[2px]" style={{ color: 'white' }}>{label}</div>
                <div className="!text-[length:11px] !leading-[1.4]" style={{ color: 'rgba(255,255,255,0.35)' }}>{desc}</div>
              </div>
            ))}
          </div>

          <p className="!mt-[36px] !text-[length:11.5px] !tracking-[0.03em]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {t('login.selfHosted')}{appVersion && <> &middot; v{appVersion}</>}
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div
        className="page-bg !flex-[1] !flex !items-center !justify-center !p-[32px_24px]"
        style={{ background: '#f9fafb' }}
      >
        <div className="!w-[100%] !max-w-[400px]">

          {/* Mobile logo */}
          <div
            className="mobile-logo !flex !flex-col !items-center !gap-[6px] !mb-[36px]">
            <style>{`@media(min-width:1024px){.mobile-logo{display:none!important}}`}</style>
            <img className="!h-[48px]" src="/logo-dark.svg" alt="Trek Wanderer" />
            <p className="!m-[0] !tracking-[0.02em] !whitespace-pre-line !text-center" style={{ fontSize: 16, color: '#71717a', fontFamily: "'Jost', 'Futura', sans-serif", fontWeight: 300 }}>{t('login.tagline')}</p>
          </div>

          <div className="![backdrop-filter:blur(40px)_saturate(200%)] ![-webkit-backdrop-filter:blur(40px)_saturate(200%)] !rounded-[20px] !p-[36px_32px]" style={{ background: 'rgba(255,255,255,0.90)', border: '1px solid rgba(255,255,255,0.70)', boxShadow: '0 24px 80px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.80) inset' }}>
            {oidcOnly ? (
              <>
                <h2 className="!m-[0_0_4px] !text-[length:22px] !font-[800]" style={{ color: '#111111' }}>{t('login.title')}</h2>
                <p className="!m-[0_0_24px] !text-[length:13.5px]" style={{ color: '#9ca3af' }}>{noRedirect ? t('login.oidcLoggedOut') : t('login.oidcOnly')}</p>
                {error && (
                  <div className="!p-[10px_14px] !rounded-[10px] !text-[length:13px] !mb-[16px]" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                    {error}
                  </div>
                )}
                <a href={`/api/auth/oidc/login${inviteToken ? '?invite=' + encodeURIComponent(inviteToken) : ''}`}
                  style={{
                    width: '100%', padding: '12px',
                    background: '#111111', color: 'white',
                    border: 'none', borderRadius: 12,
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    textDecoration: 'none', transition: 'background 180ms cubic-bezier(0.23,1,0.32,1)',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background = '#1f2937' }}
                  onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background = '#111111' }}
                >
                  <Shield size={16} />
                  {t('login.oidcSignIn', { name: appConfig?.oidc_display_name || 'SSO' })}
                </a>
              </>
            ) : (
            <>
            <h2 className="!m-[0_0_4px] !text-[length:22px] !font-[800]" style={{ color: '#111111' }}>
              {passwordChangeStep
                ? t('login.setNewPassword')
                : mode === 'login' && mfaStep
                  ? t('login.mfaTitle')
                  : mode === 'register'
                    ? (!appConfig?.has_users ? t('login.createAdmin') : t('login.createAccount'))
                    : t('login.title')}
            </h2>
            <p className="!m-[0_0_28px] !text-[length:13.5px]" style={{ color: '#9ca3af' }}>
              {passwordChangeStep
                ? t('login.setNewPasswordHint')
                : mode === 'login' && mfaStep
                  ? t('login.mfaSubtitle')
                  : mode === 'register'
                    ? (!appConfig?.has_users ? t('login.createAdminHint') : t('login.createAccountHint'))
                    : t('login.subtitle')}
            </p>

            <form className="!flex !flex-col !gap-[16px]" onSubmit={handleSubmit}>
              {error && (
                <div className="!p-[10px_14px] !rounded-[10px] !text-[length:13px]" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                  {error}
                </div>
              )}

              {passwordChangeStep && (
                <>
                  <div className="!p-[10px_14px] !rounded-[10px] !text-[length:13px]" style={{ background: '#fefce8', border: '1px solid #fde68a', color: '#92400e' }}>
                    {t('settings.mustChangePassword')}
                  </div>
                  <div>
                    <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('settings.newPassword')}</label>
                    <div className="!relative">
                      <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                      <input
                        type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)} required
                        placeholder={t('settings.newPassword')} style={inputBase}
                        onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('settings.confirmPassword')}</label>
                    <div className="!relative">
                      <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                      <input
                        type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)} required
                        placeholder={t('settings.confirmPassword')} style={inputBase}
                        onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                      />
                    </div>
                  </div>
                </>
              )}

              {mode === 'login' && mfaStep && !passwordChangeStep && (
                <div>
                  <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('login.mfaCodeLabel')}</label>
                  <div className="!relative">
                    <KeyRound size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMfaCode(e.target.value.toUpperCase().slice(0, 24))}
                      placeholder={t('login.mfaCodePlaceholder')}
                      required
                      style={inputBase}
                      onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                      onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                    />
                  </div>
                  <p className="!text-[length:12px] !mt-[8px]" style={{ color: '#9ca3af' }}>{t('login.mfaHint')}</p>
                  <button className="!mt-[8px] !text-[length:13px] !cursor-pointer !p-[0] ![font-family:inherit]"
                    type="button"
                    onClick={() => { setMfaStep(false); setMfaToken(''); setMfaCode(''); setError('') }}
                    style={{ background: 'none', border: 'none', color: '#6b7280' }}
                  >
                    {t('login.mfaBack')}
                  </button>
                </div>
              )}

              {/* Username (register only) */}
              {mode === 'register' && !passwordChangeStep && (
                <div>
                  <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('login.username')}</label>
                  <div className="!relative">
                    <User size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                    <input
                      type="text" value={username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)} required
                      placeholder="admin" style={inputBase}
                      onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                      onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                    />
                  </div>
                </div>
              )}

              {/* Email */}
              {!(mode === 'login' && mfaStep) && !passwordChangeStep && (
              <div>
                <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('common.email')}</label>
                <div className="!relative">
                  <Mail size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                  <input
                    type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required
                    placeholder={t('login.emailPlaceholder')} style={inputBase}
                    onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                    onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                  />
                </div>
              </div>
              )}

              {/* Password */}
              {!(mode === 'login' && mfaStep) && !passwordChangeStep && (
              <div>
                <label className="!block !text-[length:12.5px] !font-[600] !mb-[6px]" style={{ color: '#374151' }}>{t('common.password')}</label>
                <div className="!relative">
                  <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                  <input className="!pr-[44px]"
                    type={showPassword ? 'text' : 'password'} value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required
                    placeholder="••••••••" style={{ ...inputBase }}
                    onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#111111'}
                    onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#e5e7eb'}
                  />
                  <button className="!absolute !right-[12px] !top-[50%] !cursor-pointer !p-[2px] !w-[22px] !h-[22px]" type="button" onClick={() => setShowPassword(v => !v)} style={{ transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9ca3af' }}>
                    <Eye size={16} style={{
                      position: 'absolute', inset: 3,
                      opacity: showPassword ? 0 : 1,
                      transform: showPassword ? 'scale(0.7) rotate(-20deg)' : 'scale(1) rotate(0)',
                      transition: 'opacity 180ms cubic-bezier(0.23,1,0.32,1), transform 180ms cubic-bezier(0.23,1,0.32,1)',
                    }} />
                    <EyeOff size={16} style={{
                      position: 'absolute', inset: 3,
                      opacity: showPassword ? 1 : 0,
                      transform: showPassword ? 'scale(1) rotate(0)' : 'scale(0.7) rotate(20deg)',
                      transition: 'opacity 180ms cubic-bezier(0.23,1,0.32,1), transform 180ms cubic-bezier(0.23,1,0.32,1)',
                    }} />
                  </button>
                </div>
                {mode === 'login' && (
                  <div className="!text-right !mt-[6px]">
                    <button type="button" onClick={() => navigate('/forgot-password')} style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      color: '#6b7280', fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
                    }}
                      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = '#111111' }}
                      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = '#6b7280' }}
                    >{t('login.forgotPassword')}</button>
                  </div>
                )}
              </div>
              )}

              <button type="submit" disabled={isLoading} style={{
                marginTop: 4, width: '100%', padding: '12px', background: '#111111', color: 'white',
                border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: isLoading ? 'default' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isLoading ? 0.7 : 1, transition: 'opacity 0.15s',
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isLoading) e.currentTarget.style.background = '#1f2937' }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = '#111111'}
              >
                {isLoading
                  ? <><div className="!w-[15px] !h-[15px] !rounded-[50%]" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', animation: 'spin 0.7s linear infinite' }} />{passwordChangeStep ? t('settings.updatePassword') : mode === 'register' ? t('login.creating') : (mode === 'login' && mfaStep ? t('login.mfaVerify') : t('login.signingIn'))}</>
                  : <><Plane size={16} />{passwordChangeStep ? t('settings.updatePassword') : mode === 'register' ? t('login.createAccount') : (mode === 'login' && mfaStep ? t('login.mfaVerify') : t('login.signIn'))}</>
                }
              </button>
            </form>

            {/* Toggle login/register */}
            {showRegisterOption && appConfig?.has_users && !appConfig?.demo_mode && !passwordChangeStep && (
              <p className="!text-center !mt-[16px] !text-[length:13px]" style={{ color: '#9ca3af' }}>
                {mode === 'login' ? t('login.noAccount') + ' ' : t('login.hasAccount') + ' '}
                <button className="!font-[600] !cursor-pointer ![font-family:inherit] !text-[length:13px]" onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); setMfaStep(false); setMfaToken(''); setMfaCode('') }}
                  style={{ background: 'none', border: 'none', color: '#111111' }}>
                  {mode === 'login' ? t('login.register') : t('login.signIn')}
                </button>
              </p>
            )}
            </>)}
          </div>

          {/* OIDC / SSO login button (only when OIDC is configured, oidc_login enabled, not in oidc-only mode) */}
          {appConfig?.oidc_configured && appConfig?.oidc_login && !oidcOnly && (
            <>
              <div className="!flex !items-center !gap-[12px] !mt-[16px]">
                <div className="!flex-[1] !h-[1px]" style={{ background: '#e5e7eb' }} />
                <span className="!text-[length:12px]" style={{ color: '#9ca3af' }}>{t('common.or')}</span>
                <div className="!flex-[1] !h-[1px]" style={{ background: '#e5e7eb' }} />
              </div>
              <a href={`/api/auth/oidc/login${inviteToken ? '?invite=' + encodeURIComponent(inviteToken) : ''}`}
                style={{
                  marginTop: 12, width: '100%', padding: '12px',
                  background: 'white', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 12,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  textDecoration: 'none', transition: 'background 180ms cubic-bezier(0.23,1,0.32,1), border-color 180ms cubic-bezier(0.23,1,0.32,1)',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#9ca3af' }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#d1d5db' }}
              >
                <Shield size={16} />
                {t('login.oidcSignIn', { name: appConfig.oidc_display_name })}
              </a>
            </>
          )}

          {/* Passkey login button (instance toggle on + a usable RP ID resolves) */}
          {appConfig?.passkey_login && appConfig?.passkey_configured && !oidcOnly && mode === 'login' && !mfaStep && !passwordChangeStep && (
            <>
              {!(appConfig?.oidc_configured && appConfig?.oidc_login) && (
                <div className="!flex !items-center !gap-[12px] !mt-[16px]">
                  <div className="!flex-[1] !h-[1px]" style={{ background: '#e5e7eb' }} />
                  <span className="!text-[length:12px]" style={{ color: '#9ca3af' }}>{t('common.or')}</span>
                  <div className="!flex-[1] !h-[1px]" style={{ background: '#e5e7eb' }} />
                </div>
              )}
              <button type="button" onClick={handlePasskeyLogin} disabled={isLoading}
                style={{
                  marginTop: 12, width: '100%', padding: '12px',
                  background: 'white', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 12,
                  fontSize: 14, fontWeight: 600, cursor: isLoading ? 'default' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: isLoading ? 0.7 : 1,
                  transition: 'background 180ms cubic-bezier(0.23,1,0.32,1), border-color 180ms cubic-bezier(0.23,1,0.32,1)',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isLoading) { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#9ca3af' } }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#d1d5db' }}
              >
                <Fingerprint size={16} />
                {t('login.passkey.signIn')}
              </button>
            </>
          )}

          {/* Demo login button */}
          {appConfig?.demo_mode && (
            <button onClick={handleDemoLogin} disabled={isLoading}
              style={{
                marginTop: 16, width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#451a03', border: 'none', borderRadius: 14,
                fontSize: 15, fontWeight: 700, cursor: isLoading ? 'default' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                opacity: isLoading ? 0.7 : 1, transition: 'transform 200ms cubic-bezier(0.23,1,0.32,1), box-shadow 200ms cubic-bezier(0.23,1,0.32,1), opacity 200ms cubic-bezier(0.23,1,0.32,1)',
                boxShadow: '0 2px 12px rgba(245, 158, 11, 0.3)',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(245, 158, 11, 0.4)' }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(245, 158, 11, 0.3)' }}
            >
              <Plane size={18} />
              {t('login.demoHint')}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes orbFloat1 {
          0%, 100% { top: 15%; left: 30%; }
          25% { top: 25%; left: 55%; }
          50% { top: 45%; left: 40%; }
          75% { top: 20%; left: 20%; }
        }
        @keyframes orbFloat2 {
          0%, 100% { bottom: 20%; right: 15%; }
          25% { bottom: 35%; right: 35%; }
          50% { bottom: 15%; right: 45%; }
          75% { bottom: 40%; right: 20%; }
        }
        .login-orb1 { animation: orbFloat1 20s ease-in-out infinite; }
        .login-orb2 { animation: orbFloat2 25s ease-in-out infinite; }

        @keyframes twinkle {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.5; }
        }
        .login-star { animation: twinkle 3s ease-in-out infinite; }

        @keyframes plane1Move {
          0%   { left: -8%; top: 30%; transform: rotate(-8deg); }
          100% { left: 108%; top: 10%; transform: rotate(-12deg); }
        }
        @keyframes plane2Move {
          0%   { right: -5%; top: 18%; transform: rotate(5deg); }
          100% { right: 110%; top: 8%; transform: rotate(3deg); }
        }
        @keyframes plane3Move {
          0%   { left: -6%; top: 55%; transform: rotate(-10deg); }
          100% { left: 110%; top: 35%; transform: rotate(-6deg); }
        }
        @keyframes plane4Move {
          0%   { left: -4%; top: 8%; transform: rotate(-3deg); }
          100% { left: 110%; top: 5%; transform: rotate(-5deg); }
        }
        @keyframes plane5Move {
          0%   { right: -6%; top: 65%; transform: rotate(3deg); }
          100% { right: 110%; top: 50%; transform: rotate(-2deg); }
        }
        @keyframes plane6Move {
          0%   { left: -3%; top: 75%; transform: rotate(-7deg); }
          100% { left: 110%; top: 58%; transform: rotate(-5deg); }
        }
        .login-plane1 { animation: plane1Move 24s ease-in-out infinite; }
        .login-plane2 { animation: plane2Move 18s ease-in-out infinite; animation-delay: 6s; }
        .login-plane3 { animation: plane3Move 30s ease-in-out infinite; animation-delay: 12s; }
        .login-plane4 { animation: plane4Move 14s ease-in-out infinite; animation-delay: 3s; }
        .login-plane5 { animation: plane5Move 22s ease-in-out infinite; animation-delay: 9s; }
        .login-plane6 { animation: plane6Move 32s ease-in-out infinite; animation-delay: 16s; }

      `}</style>
    </div>
  )
}
