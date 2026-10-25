/*
 * Paints the user's theme before the app loads — dark mode, colour scheme,
 * text size — from the snapshot src/theme/appearance.ts keeps in
 * localStorage, so a dark-mode user doesn't get a white flash on every
 * load. A separate file, not inline, because the CSP allows no inline
 * scripts. Keep in step with applyAppearance(); it is only a first guess,
 * the app re-applies the real settings as soon as they load.
 */
(function () {
  try {
    var root = document.documentElement;
    // The default look is black and white (data-scheme="mono"); only the
    // 'indigo' scheme paints without the attribute.
    root.setAttribute('data-scheme', 'mono');
    if (location.pathname.indexOf('/shared/') === 0 || location.pathname.indexOf('/public/') === 0) return;
    var raw = localStorage.getItem('trek_appearance');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (!s || s.v !== 1) return;
    var mode = s.darkMode;
    var dark = mode === 'auto'
      ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      : (mode === true || mode === 'dark');
    if (dark) root.classList.add('dark');
    var a = s.appearance || {};
    var schemes = ['teal', 'green', 'rose', 'amber', 'violet', 'highContrast', 'custom'];
    if (a.scheme === 'indigo') root.removeAttribute('data-scheme');
    else if (schemes.indexOf(a.scheme) !== -1) root.setAttribute('data-scheme', a.scheme);
    if (a.transparency === false) root.setAttribute('data-no-transparency', '');
    if (a.density === 'compact') root.setAttribute('data-density', 'compact');
    if (a.reduceMotion === true) root.setAttribute('data-reduce-motion', '');
    if (a.scheme === 'custom' && /^#[0-9a-f]{6}$/i.test(a.accent || '')) {
      root.style.setProperty('--accent-custom', a.accent);
      var c = a.accent.slice(1), lin = function (x) { return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      var l = 0.2126 * lin(parseInt(c.slice(0, 2), 16) / 255) + 0.7152 * lin(parseInt(c.slice(2, 4), 16) / 255) + 0.0722 * lin(parseInt(c.slice(4, 6), 16) / 255);
      root.style.setProperty('--accent-custom-text', l > 0.45 ? '#111827' : '#ffffff');
    }
    if (typeof a.fontScale === 'number' && a.fontScale >= 0.85 && a.fontScale <= 1.4 && a.fontScale !== 1) root.style.fontSize = (a.fontScale * 100) + '%';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090b' : '#ffffff');
  } catch (e) { /* first paint falls back to the light default */ }
})();
