// Exportación: SVG autónomo (con tipografías embebidas), PNG, GPX original e informe.

import { fontFilesFor, allFontFiles } from './fonts.js';

export function screenFontCss() {
  return allFontFiles().map(([fam, url, style, w]) => `@font-face{font-family:'${fam}';src:url('${url}') format('woff2');font-style:${style};font-weight:${w};font-display:block}`).join('');
}

// Solo se incrustan las fuentes que usa el mapa con las opciones elegidas (cada fichero, una vez).
const embeddedFiles = new Map();
export async function embeddedFontCss(opts = {}) {
  const parts = [];
  for (const [fam, url, style, w] of fontFilesFor(opts)) {
    if (!embeddedFiles.has(url)) {
      const buf = await (await fetch(url)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      embeddedFiles.set(url, btoa(bin));
    }
    parts.push(`@font-face{font-family:'${fam}';src:url(data:font/woff2;base64,${embeddedFiles.get(url)}) format('woff2');font-style:${style};font-weight:${w}}`);
  }
  return parts.join('');
}

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function slug(s) {
  return (s || 'mapa').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mapa';
}

export async function svgToPng(svgString, width, height, scale = 2) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo rasterizar el SVG')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
