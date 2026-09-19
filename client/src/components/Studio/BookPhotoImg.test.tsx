// FE-COMP-BOOKPHOTO-001 to FE-COMP-BOOKPHOTO-005
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BookPhotoImg } from './BookPhotoImg';

// alt="" (decorative) gives the <img> an implicit presentation role, so
// getByRole('img') won't find it — query the DOM directly instead.
const img = (container: HTMLElement) => container.querySelector('img');

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BookPhotoImg — print mode (export)', () => {
  it('FE-COMP-BOOKPHOTO-001: renders a plain <img src> synchronously, with no network call', async () => {
    // This is the whole fix: StudioExport.tsx reads the off-screen render's
    // innerHTML in the same tick it mounts — a blob-fetch <img> (which only
    // appears once an async fetch resolves) simply isn't there yet, so every
    // export came out with empty photo frames. A plain src exists the
    // instant React renders the element.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<BookPhotoImg photoId={42} big print />);
    expect(img(container)).toHaveAttribute('src', '/api/photos/42/original');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('FE-COMP-BOOKPHOTO-002: uses the thumbnail variant when big is false', () => {
    const { container } = render(<BookPhotoImg photoId={7} big={false} print />);
    expect(img(container)).toHaveAttribute('src', '/api/photos/7/thumbnail');
  });

  it('FE-COMP-BOOKPHOTO-003: unmounting a print image never touches URL.revokeObjectURL', () => {
    // A plain src was never a blob URL — revoking it would be a no-op at
    // best, and revoking a *different* live blob URL that happened to share
    // the call at worst. It should simply never be called on this path.
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = render(<BookPhotoImg photoId={9} big print />);
    unmount();
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe('BookPhotoImg — editing mode (default)', () => {
  it('FE-COMP-BOOKPHOTO-004: renders nothing until the blob fetch resolves, then the blob <img>', async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new NodeBlob(['img'], { type: 'image/jpeg' }) as unknown as Blob),
    } as unknown as Response);

    const { container } = render(<BookPhotoImg photoId={42} big />);
    expect(img(container)).toBeNull();

    await waitFor(() => expect(img(container)).toHaveAttribute('src', expect.stringMatching(/^blob:/)));
  });

  it('FE-COMP-BOOKPHOTO-005: unmounting revokes the blob URL it created', async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new NodeBlob(['img'], { type: 'image/jpeg' }) as unknown as Blob),
    } as unknown as Response);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const { container, unmount } = render(<BookPhotoImg photoId={42} big />);
    await waitFor(() => expect(img(container)).toBeTruthy());

    unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
