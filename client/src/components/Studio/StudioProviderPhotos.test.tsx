// FE-STUDIO-PROVIDERS-001 to 002 — Immich/Synology straight from the Studio (5.7.2).
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { StudioProviderPhotos } from './StudioProviderPhotos'
import { addProviderGroups } from '../Journey/usePhotoProviders'
import { journeyApi } from '../../api/client'

vi.mock('../shared/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

function stubFetch(statuses: Record<string, boolean>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/addons') {
      return new Response(JSON.stringify({ addons: [
        { id: 'immich', name: 'Immich', type: 'photo_provider', enabled: true },
        { id: 'synologyphotos', name: 'Synology Photos', type: 'photo_provider', enabled: true },
        { id: 'packing', name: 'Packing', type: 'feature', enabled: true },
      ] }))
    }
    const m = /memories\/(\w+)\/status/.exec(url)
    return new Response(JSON.stringify({ connected: !!(m && statuses[m[1]]) }))
  }))
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('StudioProviderPhotos', () => {
  it('FE-STUDIO-PROVIDERS-001: a button per connected provider, none when nothing is connected', async () => {
    stubFetch({ immich: true, synologyphotos: true })
    render(<StudioProviderPhotos journeyId={1} onAdded={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('studio-provider-immich')).toBeTruthy())
    expect(screen.getByTestId('studio-provider-synologyphotos')).toBeTruthy()
    expect(screen.queryByTestId('studio-provider-onedrive')).toBeNull()
  })

  it('FE-STUDIO-PROVIDERS-002: adds each group to the gallery and hands back the new photo ids', async () => {
    const spy = vi.spyOn(journeyApi, 'addProviderPhotosToGallery')
      .mockResolvedValueOnce({ photos: [{ photo_id: 11 }, { photo_id: 12 }], added: 2 })
      .mockRejectedValueOnce(new Error('expired'))
    const out = await addProviderGroups(5, 'immich', [{ assetIds: ['a', 'b'] }, { assetIds: ['c'], passphrase: 'x' }], null)
    expect(out).toEqual({ added: 2, photoIds: [11, 12] })
    expect(spy).toHaveBeenNthCalledWith(2, 5, 'immich', ['c'], 'x')
  })
})
