import * as FileSystem from 'expo-file-system';

const OSM_URL = 'https://tile.openstreetmap.org';

export function getTilesDir(): string {
  return `${FileSystem.documentDirectory}tiles/`;
}

export function tilePath(z: number, x: number, y: number): string {
  return `${getTilesDir()}${z}/${x}/${y}.png`;
}

function latLngToTileXY(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
  return { x, y };
}

export function tilesForBbox(
  minLat: number, minLng: number,
  maxLat: number, maxLng: number,
  zooms = [10, 12, 13, 14]
): Array<{ z: number; x: number; y: number }> {
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  for (const z of zooms) {
    const tl = latLngToTileXY(maxLat, minLng, z);
    const br = latLngToTileXY(minLat, maxLng, z);
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

export async function hasCachedTiles(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(getTilesDir());
    return info.exists;
  } catch {
    return false;
  }
}

export async function downloadTiles(
  tiles: Array<{ z: number; x: number; y: number }>,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const dir = getTilesDir();
  let done = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < tiles.length; i += CONCURRENCY) {
    const batch = tiles.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const tileDir = `${dir}${z}/${x}/`;
        const dest = `${tileDir}${y}.png`;
        try {
          const info = await FileSystem.getInfoAsync(dest);
          if (!info.exists) {
            await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true }).catch(() => {});
            await FileSystem.downloadAsync(`${OSM_URL}/${z}/${x}/${y}.png`, dest);
          }
        } catch {}
        done++;
        onProgress?.(done, tiles.length);
      })
    );
  }
}
