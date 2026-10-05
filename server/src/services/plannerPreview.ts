/**
 * Miniatura de una ruta guardada: unos 100 puntos [lat, lng] para dibujarla como
 * silueta en las tarjetas de la biblioteca y en el mapa general, sin cargar el
 * track completo (que puede tener 20 000 puntos).
 */
export const PREVIEW_POINTS = 100;

export function makePreview(points: unknown, max = PREVIEW_POINTS): [number, number][] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const n = points.length;
  const take = Math.min(max, n);
  const out: [number, number][] = [];
  for (let k = 0; k < take; k++) {
    const idx = take === 1 ? 0 : Math.round((k * (n - 1)) / (take - 1));
    const p = points[idx] as [number, number];
    const lat = Number(p?.[0]), lng = Number(p?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4]);
  }
  return out;
}
