/**
 * routeGeometry.ts — Geometría determinista para el asistente de rutas.
 *
 * Un LLM no sabe geografía de forma fiable: ordena mal los lugares, repite
 * municipios y a veces coloca uno en otra provincia. Todo lo que se puede decidir
 * con números se decide aquí, no en el modelo: orden de las paradas, limpieza de
 * duplicados y valores atípicos, comprobación del trazado y puntos de corte de las
 * etapas.
 */

export interface GeoPoint { lat: number; lng: number }
export type TrackPoint = [number, number, number | null];

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Limpieza de lugares ──────────────────────────────────────────────────────

/** Conserva el primero de cada grupo de lugares a menos de `minKm` entre sí (varios monumentos del mismo pueblo = una parada). */
export function dedupeNearby<T extends GeoPoint>(items: T[], minKm = 1.5): { kept: T[]; merged: T[] } {
  const kept: T[] = [], merged: T[] = [];
  for (const it of items) {
    if (kept.some(k => haversineKm(k, it) < minKm)) merged.push(it);
    else kept.push(it);
  }
  return { kept, merged };
}

/**
 * Descarta lugares aislados: aquellos cuyo vecino más cercano está mucho más lejos
 * de lo habitual en el conjunto (típico de un homónimo geocodificado en otra provincia
 * o país). Se mide contra el vecino más cercano, no contra el centro, para no eliminar
 * el final de una ruta larga y lineal. Necesita ≥ 4 lugares y nunca deja menos de 2.
 */
export function dropOutliers<T extends GeoPoint>(items: T[]): { kept: T[]; dropped: T[] } {
  if (items.length < 4) return { kept: items.slice(), dropped: [] };
  const nn = items.map((a, i) => Math.min(...items.map((b, j) => (i === j ? Infinity : haversineKm(a, b)))));
  const sorted = nn.slice().sort((x, y) => x - y);
  const m = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  const limit = Math.max(50, 4 * median + 30);
  const kept: T[] = [], dropped: T[] = [];
  items.forEach((it, i) => (nn[i] > limit ? dropped : kept).push(it));
  return kept.length >= 2 ? { kept, dropped } : { kept: items.slice(), dropped: [] };
}

// ── Orden de las paradas ─────────────────────────────────────────────────────

const HELD_KARP_MAX = 14;

/**
 * Recorrido abierto de longitud mínima por todos los puntos (Held–Karp, exacto hasta 14).
 * `startFixed` / `endFixed` fijan el primer / último elemento de la entrada (cuando el
 * usuario nombró origen o destino). Con extremos libres se devuelve la dirección que
 * respeta mejor el orden original. Por encima de 14 puntos se devuelve la entrada tal cual.
 * `closed` busca el circuito más corto que vuelve al primer elemento (que queda fijo y no se repite
 * al final: quien llama añade el regreso).
 */
export function orderByShortestPath<T extends GeoPoint>(items: T[], opts: { startFixed?: boolean; endFixed?: boolean; closed?: boolean } = {}): T[] {
  const n = items.length;
  if (n <= 2 || n > HELD_KARP_MAX) return items.slice();
  const closed = !!opts.closed;
  const sf = closed || !!opts.startFixed, ef = !closed && !!opts.endFixed;
  const dist: number[][] = items.map(a => items.map(b => haversineKm(a, b)));

  // Con extremo final fijo, ese nodo queda fuera de la DP y se añade al final.
  const m = ef ? n - 1 : n;            // nodos que entran en la DP
  const FULL = (1 << m) - 1;
  const INF = 1e18;
  const dp = new Float64Array((1 << m) * m).fill(INF);
  const par = new Int8Array((1 << m) * m).fill(-1);
  if (sf) dp[(1 << 0) * m + 0] = 0;
  else for (let i = 0; i < m; i++) dp[(1 << i) * m + i] = 0;

  for (let mask = 1; mask <= FULL; mask++) {
    for (let j = 0; j < m; j++) {
      const cur = dp[mask * m + j];
      if (cur >= INF || !(mask & (1 << j))) continue;
      for (let k = 0; k < m; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k), c = cur + dist[j][k];
        if (c < dp[nm * m + k]) { dp[nm * m + k] = c; par[nm * m + k] = j; }
      }
    }
  }

  let best = INF, last = -1;
  for (let j = 0; j < m; j++) {
    const c = dp[FULL * m + j] + (ef ? dist[j][n - 1] : 0) + (closed ? dist[j][0] : 0);
    if (c < best) { best = c; last = j; }
  }
  const idx: number[] = [];
  for (let mask = FULL, j = last; j >= 0;) { idx.push(j); const p = par[mask * m + j]; mask ^= (1 << j); j = p; }
  idx.reverse();
  if (ef) idx.push(n - 1);
  if (!sf && !ef && !closed && idx[0] > idx[idx.length - 1]) idx.reverse();   // mismo coste en ambos sentidos: respeta el orden pedido
  return idx.map(i => items[i]);
}

// ── Trazado ──────────────────────────────────────────────────────────────────

function distToSegmentKm(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const kx = Math.cos(p.lat * Math.PI / 180) * 111.32, ky = 110.54;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export interface TrackQuality {
  lengthKm: number;
  /** Mayor distancia entre dos puntos consecutivos del track: un salto grande = trazado partido. */
  maxGapKm: number;
  /** Longitud del track / suma de las rectas entre paradas consecutivas. */
  detourRatio: number;
  /** Distancia (m) de cada parada al track, en el orden de entrada. */
  waypointOffM: number[];
}

export function trackQuality(track: TrackPoint[], waypoints: GeoPoint[]): TrackQuality {
  let lengthKm = 0, maxGapKm = 0;
  const pts: GeoPoint[] = track.map(p => ({ lat: p[0], lng: p[1] }));
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1], pts[i]);
    lengthKm += d;
    if (d > maxGapKm) maxGapKm = d;
  }
  let straight = 0;
  for (let i = 1; i < waypoints.length; i++) straight += haversineKm(waypoints[i - 1], waypoints[i]);
  const waypointOffM = waypoints.map(w => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      // descarte rápido: si ambos extremos del segmento están lejos, no puede ganar
      const d = distToSegmentKm(w, pts[i - 1], pts[i]);
      if (d < best) best = d;
    }
    return Math.round(best * 1000);
  });
  return { lengthKm, maxGapKm, detourRatio: straight > 0 ? lengthKm / straight : 1, waypointOffM };
}

export function cumulativeKm(track: TrackPoint[]): number[] {
  const cum = new Array<number>(track.length);
  if (track.length) cum[0] = 0;
  for (let i = 1; i < track.length; i++) {
    cum[i] = cum[i - 1] + haversineKm({ lat: track[i - 1][0], lng: track[i - 1][1] }, { lat: track[i][0], lng: track[i][1] });
  }
  return cum;
}

/** km de recorrido del punto del track más cercano a `p`, y distancia lateral en metros. */
export function nearestOnTrack(track: TrackPoint[], cum: number[], p: GeoPoint): { km: number; offM: number } {
  const kx = Math.cos(p.lat * Math.PI / 180);
  let best = 0, bd = Infinity;
  for (let i = 0; i < track.length; i++) {
    const dy = track[i][0] - p.lat, dx = (track[i][1] - p.lng) * kx;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return { km: cum[best], offM: Math.round(haversineKm(p, { lat: track[best][0], lng: track[best][1] }) * 1000) };
}

/** Índice del punto con distancia acumulada más cercana a `km`. */
export function indexAtKm(cum: number[], km: number): number {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < km) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(cum[lo - 1] - km) <= Math.abs(cum[lo] - km)) return lo - 1;
  return lo;
}

/**
 * Reduce una polilínea a ≤ maxPts puntos conservando su forma (se subdivide siempre
 * el tramo con mayor desviación). Para consultar servicios a lo largo de un tramo.
 */
export function simplifyLine(track: TrackPoint[], maxPts = 300): [number, number][] {
  const n = track.length;
  if (n <= maxPts) return track.map(p => [p[0], p[1]] as [number, number]);
  const lat0 = track.reduce((s, p) => s + p[0], 0) / n;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const X = track.map(p => p[1] * kx), Y = track.map(p => p[0] * ky);
  const dseg = (i: number, a: number, b: number) => {
    const dx = X[b] - X[a], dy = Y[b] - Y[a], l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(X[i] - X[a], Y[i] - Y[a]);
    const t = Math.max(0, Math.min(1, ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / l2));
    return Math.hypot(X[i] - (X[a] + t * dx), Y[i] - (Y[a] + t * dy));
  };
  type Seg = { a: number; b: number; far: number; d: number };
  const farthest = (a: number, b: number): Seg => { let far = -1, d = -1; for (let i = a + 1; i < b; i++) { const di = dseg(i, a, b); if (di > d) { d = di; far = i; } } return { a, b, far, d }; };
  const keep = new Set<number>([0, n - 1]);
  const segs: Seg[] = [farthest(0, n - 1)];
  while (keep.size < maxPts) {
    let bi = -1, bd = 0;
    for (let k = 0; k < segs.length; k++) if (segs[k].far >= 0 && segs[k].d > bd) { bd = segs[k].d; bi = k; }
    if (bi < 0) break;
    const s = segs.splice(bi, 1)[0];
    keep.add(s.far);
    segs.push(farthest(s.a, s.far), farthest(s.far, s.b));
  }
  return [...keep].sort((a, b) => a - b).map(i => [track[i][0], track[i][1]] as [number, number]);
}

// ── Etapas que terminan donde se puede dormir ────────────────────────────────

export interface StageCut { km: number; lodged: boolean }

/**
 * Cortes de etapa. Parte de cortes equiespaciados (total / nº de etapas) y, para cada
 * uno, busca el alojamiento más cercano a ±30 % de la longitud de etapa. Si no hay
 * ninguno, mantiene el corte ideal y lo marca como `lodged: false`.
 */
export function chooseStageCuts(totalKm: number, stageCount: number, lodgingKm: number[]): StageCut[] {
  if (!(stageCount >= 2) || !(totalKm > 0)) return [];
  const L = totalKm / stageCount, window = 0.3 * L;
  const sorted = lodgingKm.filter(Number.isFinite).sort((a, b) => a - b);
  const cuts: StageCut[] = [];
  let prev = 0;
  for (let k = 1; k < stageCount; k++) {
    const mark = k * L;
    let pick: number | null = null, bd = Infinity;
    for (const x of sorted) {
      if (Math.abs(x - mark) <= window && x > prev + 0.4 * L && x < totalKm - 0.4 * L && Math.abs(x - mark) < bd) { bd = Math.abs(x - mark); pick = x; }
    }
    const km = pick ?? mark;
    cuts.push({ km, lodged: pick != null });
    prev = km;
  }
  return cuts;
}

// ── Desvíos y tramos repetidos ───────────────────────────────────────────────

/** Kilómetros (en línea recta) que añade visitar `stop` entre sus dos vecinos en `path`. */
export function detourCostKm(path: GeoPoint[], index: number): number {
  const prev = path[index - 1], cur = path[index], next = path[index + 1];
  if (!prev || !next) return 0;
  return haversineKm(prev, cur) + haversineKm(cur, next) - haversineKm(prev, next);
}

/**
 * Con origen y destino fijados, quita las paradas intermedias que obligan a un desvío
 * grande: las que añaden más de `maxRatio` × la distancia directa entre origen y destino.
 * Se quita de una en una la peor y se recalcula. Devuelve las paradas en orden de recorrido.
 */
export function dropDetourStops<T extends GeoPoint>(ordered: T[], maxRatio = 0.3): { kept: T[]; dropped: T[] } {
  const kept = ordered.slice(), dropped: T[] = [];
  if (kept.length < 3) return { kept, dropped };
  const direct = haversineKm(kept[0], kept[kept.length - 1]);
  if (direct <= 0) return { kept, dropped };
  for (;;) {
    let worst = -1, worstCost = 0;
    for (let i = 1; i < kept.length - 1; i++) {
      const c = detourCostKm(kept, i);
      if (c > worstCost) { worstCost = c; worst = i; }
    }
    if (worst < 0 || worstCost <= maxRatio * direct || kept.length <= 2) break;
    dropped.push(kept.splice(worst, 1)[0]);
  }
  return { kept, dropped };
}

/**
 * Km del track que repasan por donde ya se pasó mucho antes (un ramal de ida y vuelta,
 * volver sobre los propios pasos). Dos pasadas cercanas en el espacio pero separadas por
 * más de `minGapKm` de recorrido cuentan como repetidas; un simple cruce apenas suma.
 */
export function retraceKm(track: TrackPoint[], minGapKm = 3, cellM = 150): number {
  const n = track.length;
  if (n < 3) return 0;
  const cum = cumulativeKm(track);
  const lat0 = track.reduce((s, p) => s + p[0], 0) / n;
  const dLat = cellM / 111320, dLng = cellM / (111320 * Math.cos(lat0 * Math.PI / 180));
  const cells = new Map<string, number[]>();
  const rep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(track[i][0] / dLat), cy = Math.floor(track[i][1] / dLng);
    outer: for (let ax = -1; ax <= 1; ax++) {
      for (let ay = -1; ay <= 1; ay++) {
        const list = cells.get(`${cx + ax}:${cy + ay}`);
        if (!list) continue;
        for (const j of list) if (cum[i] - cum[j] > minGapKm) { rep[i] = 1; break outer; }
      }
    }
    const key = `${cx}:${cy}`;
    const l = cells.get(key);
    if (l) l.push(i); else cells.set(key, [i]);
  }
  let km = 0;
  for (let i = 1; i < n; i++) if (rep[i] && rep[i - 1]) km += cum[i] - cum[i - 1];
  return km;
}
