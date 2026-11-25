// Tipografías del mapa (todas con licencia SIL OFL, servidas desde app/fonts).
// Cada papel del texto tiene varias opciones; la primera es la de siempre.
// «w» es el ancho medio de la letra, para que la maquetación sepa cuánto ocupa un texto:
// en rótulos, en em por carácter; en manuscrita y texto, relativo a Caveat.
export const FONT_ROLES = {
  rotulos: {
    label: 'Títulos y poblaciones',
    options: {
      fell: { w: 0.51, label: 'IM Fell (grabado antiguo)', family: 'EtbFell SC', files: [['fonts/fell-sc.woff2', 'normal', 400]] },
      cinzel: { w: 0.66, label: 'Cinzel (capitales romanas)', family: 'EtbCinzel', files: [['fonts/cinzel.woff2', 'normal', 400]] },
      cormorant: { w: 0.5, label: 'Cormorant SC (clásica fina)', family: 'EtbCormorantSC', files: [['fonts/cormorant-sc.woff2', 'normal', 400]] },
      grotesk: { w: 0.6, label: 'Space Grotesk (moderna)', family: 'EtbGrotesk', files: [['fonts/grotesk-500.woff2', 'normal', 400], ['fonts/grotesk-700.woff2', 'normal', 700]] },
      syne: { w: 0.7, label: 'Syne (display contemporánea)', family: 'EtbSyne', files: [['fonts/syne-700.woff2', 'normal', 400]] },
      dmserif: { w: 0.52, label: 'DM Serif Display (editorial)', family: 'EtbDMSerif', files: [['fonts/dmserif.woff2', 'normal', 400]] },
    },
  },
  mano: {
    label: 'Letra manuscrita (monumentos, cimas)',
    options: {
      caveat: { w: 1, label: 'Caveat', family: 'EtbCaveat', files: [['fonts/caveat-400.woff2', 'normal', 400], ['fonts/caveat-700.woff2', 'normal', 700]] },
      kalam: { w: 1.2, label: 'Kalam (rotulador)', family: 'EtbKalam', files: [['fonts/kalam-400.woff2', 'normal', 400], ['fonts/kalam-700.woff2', 'normal', 700]] },
      dancing: { w: 1.05, label: 'Dancing Script (caligráfica)', family: 'EtbDancing', files: [['fonts/dancing-400.woff2', 'normal', 400], ['fonts/dancing-700.woff2', 'normal', 700]] },
      inter: { w: 1.22, label: 'Inter (sin manuscrita, moderna)', family: 'EtbInter', files: [['fonts/inter-400-normal.woff2', 'normal', 400], ['fonts/inter-700-normal.woff2', 'normal', 700]] },
      mono: { w: 1.4, label: 'IBM Plex Mono (técnica)', family: 'EtbMono', files: [['fonts/mono-400-normal.woff2', 'normal', 400], ['fonts/mono-700-normal.woff2', 'normal', 700]] },
    },
  },
  texto: {
    label: 'Texto (ríos, perfil, kilómetros)',
    options: {
      fell: { w: 1.05, label: 'IM Fell', family: 'EtbFell', files: [['fonts/fell.woff2', 'normal', 400], ['fonts/fell.woff2', 'italic', 400]] },
      garamond: { w: 1.05, label: 'EB Garamond', family: 'EtbGaramond', files: [['fonts/garamond.woff2', 'normal', 400], ['fonts/garamond-italic.woff2', 'italic', 400]] },
      cormorant: { w: 1, label: 'Cormorant Garamond', family: 'EtbCormorant', files: [['fonts/cormorant.woff2', 'normal', 400], ['fonts/cormorant-italic.woff2', 'italic', 400]] },
      inter: { w: 1.22, label: 'Inter (moderna)', family: 'EtbInter', files: [['fonts/inter-400-normal.woff2', 'normal', 400], ['fonts/inter-400-italic.woff2', 'italic', 400]] },
      mono: { w: 1.4, label: 'IBM Plex Mono (técnica)', family: 'EtbMono', files: [['fonts/mono-400-normal.woff2', 'normal', 400], ['fonts/mono-400-italic.woff2', 'italic', 400]] },
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
