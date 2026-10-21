// FE-TRIPGPX-001 to FE-TRIPGPX-003
import { exportTripGpx, gpxFilenameFrom } from './tripGpx'
import { saveTextFile } from './saveFile'

vi.mock('./saveFile', () => ({ saveTextFile: vi.fn(async () => {}) }))

afterEach(() => { vi.unstubAllGlobals(); vi.mocked(saveTextFile).mockClear() })

describe('tripGpx', () => {
  it('FE-TRIPGPX-001: fetches the trip export with the session cookie and saves it under the server\'s filename', async () => {
    const fetchMock = vi.fn(async () => new Response('<gpx/>', { status: 200, headers: { 'content-disposition': 'attachment; filename="Via_de_la_Plata.gpx"' } }))
    vi.stubGlobal('fetch', fetchMock)
    await exportTripGpx(12, 'Vía de la Plata')
    expect(fetchMock).toHaveBeenCalledWith('/api/trips/12/gpx/export', { credentials: 'include' })
    expect(saveTextFile).toHaveBeenCalledWith('Via_de_la_Plata.gpx', '<gpx/>', 'application/gpx+xml')
  })

  it('FE-TRIPGPX-002: a failed request throws and saves nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })))
    await expect(exportTripGpx(1, 'x')).rejects.toThrow('HTTP 404')
    expect(saveTextFile).not.toHaveBeenCalled()
  })

  it('FE-TRIPGPX-003: without a Content-Disposition the name comes from the title, ASCII-only', () => {
    expect(gpxFilenameFrom(null, 'Año en Perú')).toBe('Ano_en_Peru.gpx')
    expect(gpxFilenameFrom(null, '東京')).toBe('trip.gpx')
  })
})
