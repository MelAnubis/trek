import React, { useState, useEffect } from 'react'
import { Info, Github, Shield, Key, Users, Database, Upload, Clock, Puzzle, CalendarDays, Globe, ArrowRightLeft, Map, Briefcase, ListChecks, Wallet, FileText, Plane } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface DemoTexts {
  titleBefore: string
  titleAfter: string
  title: string
  description: string
  resetIn: string
  minutes: string
  uploadNote: string
  fullVersionTitle: string
  features: string[]
  addonsTitle: string
  addons: [string, string][]
  whatIs: string
  whatIsDesc: string
  selfHost: string
  selfHostLink: string
  close: string
}

const texts: Record<string, DemoTexts> = {
  de: {
    titleBefore: 'Willkommen bei ',
    titleAfter: '',
    title: 'Willkommen zur Trek Wanderer Demo',
    description: 'Du kannst Reisen ansehen, bearbeiten und eigene erstellen. Alle Aenderungen werden jede Stunde automatisch zurueckgesetzt.',
    resetIn: 'Naechster Reset in',
    minutes: 'Minuten',
    uploadNote: 'Datei-Uploads (Fotos, Dokumente, Cover) sind in der Demo deaktiviert.',
    fullVersionTitle: 'In der Vollversion zusaetzlich:',
    features: [
      'Datei-Uploads (Fotos, Dokumente, Cover)',
      'API-Schluessel (Google Maps, Wetter)',
      'Benutzer- & Rechteverwaltung',
      'Automatische Backups',
      'Addon-Verwaltung (aktivieren/deaktivieren)',
      'OIDC / SSO Single Sign-On',
    ],
    addonsTitle: 'Modulare Addons (in der Vollversion deaktivierbar)',
    addons: [
      ['Vacay', 'Urlaubsplaner mit Kalender, Feiertagen & Fusion'],
      ['Atlas', 'Weltkarte mit besuchten Laendern & Reisestatistiken'],
      ['Packliste', 'Checklisten pro Reise'],
      ['Budget', 'Kostenplanung mit Splitting'],
      ['Dokumente', 'Dateien an Reisen anhaengen'],
      ['Widgets', 'Waehrungsrechner & Zeitzonen'],
    ],
    whatIs: 'Was ist Trek Wanderer?',
    whatIsDesc: 'Ein selbst-gehosteter Reiseplaner mit Echtzeit-Kollaboration, interaktiver Karte, OIDC Login und Dark Mode.',
    selfHost: 'Open Source — ',
    selfHostLink: 'selbst hosten',
    close: 'Verstanden',
  },
  en: {
    titleBefore: 'Welcome to ',
    titleAfter: '',
    title: 'Welcome to the Trek Wanderer Demo',
    description: 'You can view, edit and create trips. All changes are automatically reset every hour.',
    resetIn: 'Next reset in',
    minutes: 'minutes',
    uploadNote: 'File uploads (photos, documents, covers) are disabled in demo mode.',
    fullVersionTitle: 'Additionally in the full version:',
    features: [
      'File uploads (photos, documents, covers)',
      'API key management (Google Maps, Weather)',
      'User & permission management',
      'Automatic backups',
      'Addon management (enable/disable)',
      'OIDC / SSO single sign-on',
    ],
    addonsTitle: 'Modular Addons (can be deactivated in full version)',
    addons: [
      ['Vacay', 'Vacation planner with calendar, holidays & user fusion'],
      ['Atlas', 'World map with visited countries & travel stats'],
      ['Packing', 'Checklists per trip'],
      ['Budget', 'Expense tracking with splitting'],
      ['Documents', 'Attach files to trips'],
      ['Widgets', 'Currency converter & timezones'],
    ],
    whatIs: 'What is Trek Wanderer?',
    whatIsDesc: 'A self-hosted travel planner with real-time collaboration, interactive maps, OIDC login and dark mode.',
    selfHost: 'Open source — ',
    selfHostLink: 'self-host it',
    close: 'Got it',
  },
  es: {
    titleBefore: 'Bienvenido a ',
    titleAfter: '',
    title: 'Bienvenido a la demo de Trek Wanderer',
    description: 'Puedes ver, editar y crear viajes. Todos los cambios se restablecen automáticamente cada hora.',
    resetIn: 'Próximo reinicio en',
    minutes: 'minutos',
    uploadNote: 'Las subidas de archivos (fotos, documentos, portadas) están desactivadas en el modo demo.',
    fullVersionTitle: 'Además, en la versión completa:',
    features: [
      'Subida de archivos (fotos, documentos, portadas)',
      'Gestión de claves API (Google Maps, tiempo)',
      'Gestión de usuarios y permisos',
      'Copias de seguridad automáticas',
      'Gestión de addons (activar/desactivar)',
      'Inicio de sesión único OIDC / SSO',
    ],
    addonsTitle: 'Complementos modulares (se pueden desactivar en la versión completa)',
    addons: [
      ['Vacaciones', 'Planificador de vacaciones con calendario, festivos y fusión de usuarios'],
      ['Atlas', 'Mapa del mundo con países visitados y estadísticas de viaje'],
      ['Equipaje', 'Listas de comprobación para cada viaje'],
      ['Presupuesto', 'Control de gastos con reparto'],
      ['Documentos', 'Adjunta archivos a los viajes'],
      ['Widgets', 'Conversor de divisas y zonas horarias'],
    ],
    whatIs: '¿Qué es Trek Wanderer?',
    whatIsDesc: 'Un planificador de viajes autohospedado con colaboración en tiempo real, mapas interactivos, inicio de sesión OIDC y modo oscuro.',
    selfHost: 'Código abierto — ',
    selfHostLink: 'alójalo tú mismo',
    close: 'Entendido',
  },
  zh: {
    titleBefore: '欢迎来到 ',
    titleAfter: '',
    title: '欢迎来到 Trek Wanderer 演示版',
    description: '你可以查看、编辑和创建旅行。所有更改都会在每小时自动重置。',
    resetIn: '下次重置将在',
    minutes: '分钟后',
    uploadNote: '演示模式下已禁用文件上传（照片、文档、封面）。',
    fullVersionTitle: '完整版本还包括：',
    features: [
      '文件上传（照片、文档、封面）',
      'API 密钥管理（Google Maps、天气）',
      '用户和权限管理',
      '自动备份',
      '附加组件管理（启用/禁用）',
      'OIDC / SSO 单点登录',
    ],
    addonsTitle: '模块化附加组件（完整版本可禁用）',
    addons: [
      ['Vacay', '带日历、节假日和用户融合的假期规划器'],
      ['Atlas', '带已访问国家和旅行统计的世界地图'],
      ['Packing', '按旅行管理清单'],
      ['Budget', '支持分摊的费用追踪'],
      ['Documents', '将文件附加到旅行'],
      ['Widgets', '货币换算和时区工具'],
    ],
    whatIs: '什么是 Trek Wanderer？',
    whatIsDesc: '一个支持实时协作、交互式地图、OIDC 登录和深色模式的自托管旅行规划器。',
    selfHost: '开源项目 - ',
    selfHostLink: '自行部署',
    close: '知道了',
  },
  'zh-TW': {
    titleBefore: '歡迎來到 ',
    titleAfter: '',
    title: '歡迎來到 Trek Wanderer 展示版',
    description: '你可以檢視、編輯和建立行程。所有變更都會在每小時自動重設。',
    resetIn: '下次重設將在',
    minutes: '分鐘後',
    uploadNote: '展示模式下已停用檔案上傳（照片、文件、封面）。',
    fullVersionTitle: '完整版本還包含：',
    features: [
      '檔案上傳（照片、文件、封面）',
      'API 金鑰管理（Google Maps、天氣）',
      '使用者與權限管理',
      '自動備份',
      '附加元件管理（啟用/停用）',
      'OIDC / SSO 單一登入',
    ],
    addonsTitle: '模組化附加元件（完整版本可停用）',
    addons: [
      ['Vacay', '具備日曆、假日與使用者融合的假期規劃器'],
      ['Atlas', '顯示已造訪國家與旅行統計的世界地圖'],
      ['Packing', '依行程管理的檢查清單'],
      ['Budget', '支援分攤的費用追蹤'],
      ['Documents', '將檔案附加到行程'],
      ['Widgets', '貨幣換算與時區工具'],
    ],
    whatIs: 'Trek Wanderer 是什麼？',
    whatIsDesc: '一個支援即時協作、互動式地圖、OIDC 登入和深色模式的自架旅行規劃器。',
    selfHost: '開源專案 - ',
    selfHostLink: '自行架設',
    close: '知道了',
  },
  ar: {
    titleBefore: 'مرحبًا بك في ',
    titleAfter: '',
    title: 'مرحبًا بك في النسخة التجريبية من Trek Wanderer',
    description: 'يمكنك عرض الرحلات وتعديلها وإنشاء رحلات جديدة. تتم إعادة ضبط جميع التغييرات تلقائيًا كل ساعة.',
    resetIn: 'إعادة الضبط التالية خلال',
    minutes: 'دقيقة',
    uploadNote: 'رفع الملفات (الصور والمستندات وصور الغلاف) معطّل في وضع العرض التجريبي.',
    fullVersionTitle: 'وفي النسخة الكاملة أيضًا:',
    features: [
      'رفع الملفات (الصور والمستندات وصور الغلاف)',
      'إدارة مفاتيح API (خرائط Google والطقس)',
      'إدارة المستخدمين والصلاحيات',
      'نسخ احتياطية تلقائية',
      'إدارة الإضافات (تفعيل/تعطيل)',
      'تسجيل دخول موحد OIDC / SSO',
    ],
    addonsTitle: 'إضافات مرنة (يمكن تعطيلها في النسخة الكاملة)',
    addons: [
      ['Vacay', 'مخطط إجازات مع تقويم وعطل ودمج مستخدمين'],
      ['Atlas', 'خريطة عالمية مع الدول التي تمت زيارتها وإحصاءات السفر'],
      ['Packing', 'قوائم تجهيز لكل رحلة'],
      ['Budget', 'تتبع المصروفات مع التقسيم'],
      ['Documents', 'إرفاق الملفات بالرحلات'],
      ['Widgets', 'محول عملات ومناطق زمنية'],
    ],
    whatIs: 'ما هو Trek Wanderer؟',
    whatIsDesc: 'مخطط رحلات مستضاف ذاتيًا مع تعاون لحظي وخرائط تفاعلية وتسجيل دخول OIDC ووضع داكن.',
    selfHost: 'مفتوح المصدر — ',
    selfHostLink: 'استضفه بنفسك',
    close: 'فهمت',
  },
  id: {
    titleBefore: 'Selamat datang di ',
    titleAfter: '',
    title: 'Selamat datang di Demo Trek Wanderer',
    description: 'Anda dapat melihat, mengedit, dan membuat perjalanan. Semua perubahan akan diatur ulang secara otomatis setiap jam.',
    resetIn: 'Atur ulang berikutnya dalam',
    minutes: 'menit',
    uploadNote: 'Unggah file (foto, dokumen, sampul) dinonaktifkan dalam mode demo.',
    fullVersionTitle: 'Selain itu dalam versi lengkap:',
    features: [
      'Unggah file (foto, dokumen, sampul)',
      'Manajemen kunci API (Google Maps, Cuaca)',
      'Manajemen pengguna & izin',
      'Pencadangan otomatis',
      'Manajemen Addon (aktifkan/nonaktifkan)',
      'OIDC / SSO single sign-on',
    ],
    addonsTitle: 'Addon Modular (dapat dinonaktifkan di versi lengkap)',
    addons: [
      ['Vacay', 'Perencana liburan dengan kalender, hari libur & penggabungan pengguna'],
      ['Atlas', 'Peta dunia dengan negara yang dikunjungi & statistik perjalanan'],
      ['Pengepakan', 'Daftar periksa per perjalanan'],
      ['Anggaran', 'Pelacakan pengeluaran dengan pemisahan tagihan'],
      ['Dokumen', 'Lampirkan file ke perjalanan'],
      ['Widget', 'Konverter mata uang & zona waktu'],
    ],
    whatIs: 'Apa itu Trek Wanderer?',
    whatIsDesc: 'Perencana perjalanan yang di-host sendiri dengan kolaborasi real-time, peta interaktif, login OIDC, dan mode gelap.',
    selfHost: 'Buka sumber — ',
    selfHostLink: 'host mandiri',
    close: 'Mengerti',
  },
}

const featureIcons = [Upload, Key, Users, Database, Puzzle, Shield]
const addonIcons = [CalendarDays, Globe, ListChecks, Wallet, FileText, ArrowRightLeft]

export default function DemoBanner(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<boolean>(false)
  const [minutesLeft, setMinutesLeft] = useState<number>(59 - new Date().getMinutes())
  const { language } = useTranslation()
  const t = texts[language] || texts.en

  useEffect(() => {
    const interval = setInterval(() => setMinutesLeft(59 - new Date().getMinutes()), 10000)
    return () => clearInterval(interval)
  }, [])

  if (dismissed) return null

  return (
    <div className="!fixed !inset-[0] !z-[99999] ![background:var(--modal-backdrop)] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-center !justify-center !pt-[max(16px,_env(safe-area-inset-top))] !pb-[max(16px,_calc(env(safe-area-inset-bottom)_+_80px))] !pl-[16px] !pr-[16px] !overflow-auto" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }} onClick={() => setDismissed(true)}>
      <div className="![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] !rounded-[20px] !p-[28px_24px_0] !max-w-[480px] !w-[100%] ![box-shadow:var(--modal-shadow)] !max-h-[min(90vh,_calc(100dvh_-_96px))] !overflow-auto !flex !flex-col" onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>

        {/* Header */}
        <div className="!flex !items-center !gap-[10px] !mb-[14px]">
          <img className="!w-[36px] !h-[36px] !rounded-[10px]" src="/icons/icon-dark.svg" alt="" />
          <h2 className="!m-[0] !text-[length:17px] !font-[700] ![color:var(--text-primary)] !flex !items-center !gap-[5px]">
            {t.titleBefore}<img className="!h-[18px]" src="/text-dark.svg" alt="Trek Wanderer" />{t.titleAfter}
          </h2>
        </div>

        <p className="!text-[length:13px] ![color:var(--text-muted)] !leading-[1.6] !m-[0_0_12px]">
          {t.description}
        </p>

        {/* Timer + Upload note */}
        <div className="!flex !gap-[8px] !mb-[16px]">
          <div className="!flex-[1] !flex !items-center !gap-[6px] ![background:rgba(2,132,199,0.08)] ![border:1px_solid_rgba(2,132,199,0.20)] !rounded-[10px] !p-[8px_10px]">
            <Clock size={13} style={{ flexShrink: 0, color: '#0284c7' }} />
            <span className="!text-[length:11px] ![color:#0284c7] !font-[600]">
              {t.resetIn} {minutesLeft} {t.minutes}
            </span>
          </div>
          <div className="!flex-[1] !flex !items-center !gap-[6px] ![background:rgba(180,83,9,0.07)] ![border:1px_solid_rgba(180,83,9,0.18)] !rounded-[10px] !p-[8px_10px]">
            <Upload size={13} style={{ flexShrink: 0, color: '#b45309' }} />
            <span className="!text-[length:11px] ![color:#b45309]">{t.uploadNote}</span>
          </div>
        </div>

        {/* What is TREK */}
        <div className="![background:var(--glass-bg-subtle)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] ![border:1px_solid_var(--glass-border-inner)] !rounded-[12px] !p-[12px_14px] !mb-[16px]">
          <div className="!flex !items-center !gap-[8px] !mb-[6px]">
            <Map size={14} style={{ color: 'var(--text-primary)' }} />
            <span className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !flex !items-center !gap-[4px]">
              {t.whatIs}
            </span>
          </div>
          <p className="!text-[length:12px] ![color:var(--text-muted)] !leading-[1.5] !m-[0]">{t.whatIsDesc}</p>
        </div>

        {/* Addons */}
        <p className="!text-[length:10px] !font-[700] ![color:var(--text-secondary)] !m-[0_0_8px] !uppercase !tracking-[0.08em] !flex !items-center !gap-[6px]">
          <Puzzle size={12} />
          {t.addonsTitle}
        </p>
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mb-[16px]">
          {t.addons.map(([name, desc], i) => {
            const Icon = addonIcons[i]
            return (
              <div className="![background:var(--glass-bg-subtle)] ![border:1px_solid_var(--glass-border-inner)] !rounded-[10px] !p-[8px_10px]" key={name}>
                <div className="!flex !items-center !gap-[6px] !mb-[2px]">
                  <Icon size={12} style={{ flexShrink: 0, color: 'var(--text-primary)' }} />
                  <span className="!text-[length:11px] !font-[700] ![color:var(--text-primary)]">{name}</span>
                </div>
                <p className="!text-[length:10px] ![color:var(--text-faint)] !m-[0] !leading-[1.3] !pl-[18px]">{desc}</p>
              </div>
            )
          })}
        </div>

        {/* Full version features */}
        <p className="!text-[length:10px] !font-[700] ![color:var(--text-secondary)] !m-[0_0_8px] !uppercase !tracking-[0.08em] !flex !items-center !gap-[6px]">
          <Shield size={12} />
          {t.fullVersionTitle}
        </p>
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mb-[16px]">
          {t.features.map((text, i) => {
            const Icon = featureIcons[i]
            return (
              <div className="!flex !items-center !gap-[8px] !text-[length:11px] ![color:var(--text-secondary)] !p-[4px_0]" key={text}>
                <Icon size={13} style={{ flexShrink: 0, color: 'var(--text-faint)' }} />
                <span>{text}</span>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="!p-[14px_0_20px] ![border-top:1px_solid_var(--modal-border)] !flex !items-center !justify-between !sticky !bottom-[0] ![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !mt-[auto]">
          <div className="!flex !items-center !gap-[6px] !text-[length:11px] ![color:var(--text-faint)]">
            <Github size={13} />
            <span>{t.selfHost}</span>
            <a className="![color:var(--text-primary)] !font-[600] ![text-decoration:none]" href="https://github.com/MelAnubis/trek" target="_blank" rel="noopener noreferrer">
              {t.selfHostLink}
            </a>
          </div>
          <button className="![background:var(--text-primary)] ![color:var(--bg-primary)] ![border:none] !rounded-[10px] !p-[8px_20px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={() => setDismissed(true)}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  )
}
