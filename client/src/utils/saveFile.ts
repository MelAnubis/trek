/**
 * Guarda un fichero de texto generado en el cliente.
 *
 * En navegador usa un <a download>. En la app Android (Capacitor) las descargas
 * por blob suelen no funcionar en el WebView, así que primero se intenta el
 * selector nativo de compartir (Web Share API con ficheros) y, si no está
 * disponible, se cae al <a download>.
 */
export async function saveTextFile(filename: string, text: string, mime = 'application/gpx+xml'): Promise<void> {
  const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.()

  if (isNative && typeof navigator.share === 'function' && typeof File !== 'undefined') {
    try {
      const file = new File([text], filename, { type: mime })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    } catch (err) {
      // El usuario cerró el selector: no es un error, y no hay que descargar además.
      if ((err as { name?: string })?.name === 'AbortError') return
    }
  }

  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 100)
}
