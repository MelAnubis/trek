/**
 * Camera abstraction for navigation photos.
 *
 * - Capacitor (native): uses @capacitor/camera which handles Android lifecycle
 *   correctly without destroying the WebView.
 * - Browser (PWA): returns null — caller falls back to <input type="file">.
 */

function isCapacitor(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
}

export interface CapturedPhoto {
  blob: Blob
  filename: string
}

export async function capturePhotoNative(): Promise<CapturedPhoto | null> {
  if (!isCapacitor()) return null

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      saveToGallery: false,
    })

    if (!photo.base64String) return null

    const byteChars = atob(photo.base64String)
    const byteNums = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i)
    const blob = new Blob([byteNums], { type: `image/${photo.format}` })

    return { blob, filename: `nav-${Date.now()}.${photo.format}` }
  } catch {
    return null
  }
}

export { isCapacitor as isNativeCapacitor }
