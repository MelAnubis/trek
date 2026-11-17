// Tipografías del mapa (todas con licencia SIL OFL, servidas desde app/fonts).
// Cada papel del texto tiene varias opciones; la primera es la de siempre.
export const FONT_ROLES = {
  rotulos: {
    label: 'Títulos y poblaciones',
    options: {
      fell: { label: 'IM Fell (grabado antiguo)', family: 'EtbFell SC', files: [['fonts/fell-sc.woff2', 'normal', 400]] },
      cinzel: { label: 'Cinzel (capitales romanas)', family: 'EtbCinzel', files: [['fonts/cinzel.woff2', 'normal', 400]] },
      cormorant: { label: 'Cormorant SC (clásica fina)', family: 'EtbCormorantSC', files: [['fonts/cormorant-sc.woff2', 'normal', 400]] },
    },
  },
  mano: {
    label: 'Letra manuscrita (monumentos, cimas)',
    options: {
      caveat: { label: 'Caveat', family: 'EtbCaveat', files: [['fonts/caveat-400.woff2', 'normal', 400], ['fonts/caveat-700.woff2', 'normal', 700]] },
      kalam: { label: 'Kalam (rotulador)', family: 'EtbKalam', files: [['fonts/kalam-400.woff2', 'normal', 400], ['fonts/kalam-700.woff2', 'normal', 700]] },
      dancing: { label: 'Dancing Script (caligráfica)', family: 'EtbDancing', files: [['fonts/dancing-400.woff2', 'normal', 400], ['fonts/dancing-700.woff2', 'normal', 700]] },
    },
  },
  texto: {
    label: 'Texto (ríos, perfil, kilómetros)',
    options: {
      fell: { label: 'IM Fell', family: 'EtbFell', files: [['fonts/fell.woff2', 'normal', 400], ['fonts/fell.woff2', 'italic', 400]] },
      garamond: { label: 'EB Garamond', family: 'EtbGaramond', files: [['fonts/garamond.woff2', 'normal', 400], ['fonts/garamond-italic.woff2', 'italic', 400]] },
      cormorant: { label: 'Cormorant Garamond', family: 'EtbCormorant', files: [['fonts/cormorant.woff2', 'normal', 400], ['fonts/cormorant-italic.woff2', 'italic', 400]] },
    },
  },
};

// Tamaños de letra ajustables (multiplicadores sobre el tamaño automático).
export const FONT_SIZES = {
  sizeTitle: 'Título',
  sizeTowns: 'Poblaciones',
  sizeHand: 'Monumentos y cimas',
  sizeRivers: 'Ríos y embalses',
};

/** Fuente elegida para un papel (rotulos | mano | texto), con la de siempre si no hay elección. */
export function fontFor(role, opts = {}) {
  const r = FONT_ROLES[role];
  return r.options[opts['font_' + role]] || Object.values(r.options)[0];
}

/** Ficheros de fuente que usa un mapa con estas opciones. */
export function fontFilesFor(opts = {}) {
  const out = [];
  for (const role of Object.keys(FONT_ROLES)) {
    const f = fontFor(role, opts);
    for (const [url, style, weight] of f.files) out.push([f.family, url, style, weight]);
  }
  // la rosa de los vientos usa siempre IM Fell SC
  if (!out.some(([fam]) => fam === 'EtbFell SC')) out.push(['EtbFell SC', 'fonts/fell-sc.woff2', 'normal', 400]);
  return out;
}

/** Todas las fuentes (para la interfaz de la app). */
export function allFontFiles() {
  const out = [];
  for (const r of Object.values(FONT_ROLES)) for (const f of Object.values(r.options)) for (const [url, style, weight] of f.files) out.push([f.family, url, style, weight]);
  return out;
}
