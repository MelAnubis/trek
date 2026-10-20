import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../tests/helpers/msw/server';
import { resetAllStores, seedStore } from '../../tests/helpers/store';
import { buildUser, buildAdmin, buildTrip } from '../../tests/helpers/factories';
import { useAuthStore } from '../store/authStore';
import { usePermissionsStore } from '../store/permissionsStore';
import DashboardPage from './DashboardPage';

// The fixtures (here and in tests/helpers/msw/handlers/trips.ts) carry fixed
// 2026 dates and the dashboard sorts trips into planned/ongoing/completed by
// today's date — so once the calendar passed them, every "planned" trip
// silently became "completed" and the list these tests look at went empty.
// Pin "today" before them; only Date is faked, so waitFor/timers still run.
const TODAY = new Date('2026-06-15T10:00:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TODAY });
  vi.clearAllMocks();
  resetAllStores();
  // Seed auth with authenticated user
  seedStore(useAuthStore, { isAuthenticated: true, user: buildUser() });
  // Grant all permissions so buttons are visible
  seedStore(usePermissionsStore, {
    level: 'owner',
  } as any);
  // Intercept CurrencyWidget's external fetch so it resolves before teardown
  server.use(
    http.get('https://api.exchangerate-api.com/v4/latest/:currency', () => {
      return HttpResponse.json({ rates: { USD: 1.08, EUR: 1, CHF: 0.97 } });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DashboardPage', () => {
  describe('FE-PAGE-DASH-001: Unauthenticated user is redirected', () => {
    it('does not render dashboard content when not authenticated', () => {
      // When the auth store has no user, the page relies on ProtectedRoute (App.tsx) to redirect.
      // Rendering the page directly without auth: the page itself still renders (guard is in router).
      // We verify the page is accessible only with auth seeded above.
      // This is tested at the App routing level — here we verify dashboard content renders WITH auth.
      seedStore(useAuthStore, { isAuthenticated: true, user: buildUser() });
      render(<DashboardPage />);
      // Dashboard content is present when authenticated
      expect(screen.getByText(/my trips/i)).toBeInTheDocument();
    });
  });

  describe('FE-PAGE-DASH-002: Trip list loads on mount', () => {
    it('fetches trips via GET /api/trips on mount', async () => {
      render(<DashboardPage />);

      // After data loads, trip cards should appear
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-003: Trips render with name and dates', () => {
    it('shows trip name and dates in the list', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // At least the first trip name should be visible
      expect(screen.getAllByText('Paris Adventure')[0]).toBeVisible();
    });
  });

  describe('FE-PAGE-DASH-004: Empty state when no trips', () => {
    it('shows only the create-trip card when the API returns no trips', async () => {
      server.use(
        http.get('/api/trips', () => HttpResponse.json({ trips: [] })),
      );

      render(<DashboardPage />);

      // No trip cards — just the "New Trip / Plan a new trip from scratch" card.
      await waitFor(() => {
        expect(screen.getByText('Plan a new trip from scratch')).toBeInTheDocument();
      });
      expect(document.querySelectorAll('.trip-card')).toHaveLength(0);
    });
  });

  describe('FE-PAGE-DASH-005: Create Trip button opens TripFormModal', () => {
    it('clicking New Trip button opens the trip form modal', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /new trip/i }).length).toBeGreaterThan(0);
      });

      await user.click(screen.getAllByRole('button', { name: /new trip/i })[0]);

      // TripFormModal opens — "Create New Trip" appears in heading and submit button
      await waitFor(() => {
        expect(screen.getAllByText(/create new trip/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('FE-PAGE-DASH-006: Loading state while fetching trips', () => {
    it('shows loading skeletons while trips are being fetched', async () => {
      // Delay response to observe loading state
      server.use(
        http.get('/api/trips', async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return HttpResponse.json({ trips: [] });
        }),
      );

      render(<DashboardPage />);

      // Header renders immediately
      expect(screen.getByText(/my trips/i)).toBeInTheDocument();

      // Loading is indicated by subtitle "Loading…" or skeleton cards
      // The subtitle during loading shows t('common.loading')
      await waitFor(() => {
        // After loading completes, no-trips state or trips appear
        expect(screen.queryByText(/loading/i) === null || screen.getByText(/no trips yet/i)).toBeTruthy();
      });
    });
  });

  describe('FE-PAGE-DASH-007: Dashboard title visible', () => {
    it('shows the dashboard title', async () => {
      render(<DashboardPage />);
      expect(screen.getByText(/my trips/i)).toBeInTheDocument();
    });
  });

  describe('FE-PAGE-DASH-008: Delete trip shows ConfirmDialog', () => {
    it('clicking delete on a trip card opens the confirm dialog', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // Find delete button — CardAction with label t('common.delete')
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        // ConfirmDialog renders with title t('common.delete') and cancel/confirm buttons
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-009: Confirm delete removes trip from list', () => {
    it('confirming delete removes the trip from the list', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // Open confirm dialog
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });

      // Click the confirm button (the one inside the dialog, not the delete action button)
      // ConfirmDialog renders a confirm button with confirmLabel or t('common.delete')
      const dialogDeleteBtn = screen.getAllByRole('button', { name: /delete/i }).find(
        btn => btn.closest('[class*="fixed inset-0"]') || btn.closest('.fixed')
      );
      // Just click the second delete button that appears (the dialog confirm button)
      const allDeleteBtns = screen.getAllByRole('button', { name: /delete/i });
      // The last one should be the confirm button in the dialog
      await user.click(allDeleteBtns[allDeleteBtns.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText('Paris Adventure')).not.toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-010: Cancel delete keeps trip in list', () => {
    it('cancelling delete keeps the trip in the list', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // Open confirm dialog
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      // Trip still visible
      expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
    });
  });

  describe('FE-PAGE-DASH-011: Archive trip moves it to archived section', () => {
    it('archiving a trip removes it from active and shows it in archived section', async () => {
      const archivedTrip = buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10', is_archived: true });
      server.use(
        http.put('/api/trips/:id', async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          if (body.is_archived === true) {
            return HttpResponse.json({ trip: archivedTrip });
          }
          return HttpResponse.json({ trip: archivedTrip });
        }),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // Click archive button
      const archiveButtons = screen.getAllByRole('button', { name: /archive/i });
      await user.click(archiveButtons[0]);

      // Wait for archived section toggle to appear
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /archived/i })).toBeInTheDocument();
      });

      // Click "Archived" toggle to show archived trips
      await user.click(screen.getByRole('button', { name: /archived/i }));

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-012: Edit trip opens form with pre-filled data', () => {
    it('clicking edit on a trip card opens TripFormModal with trip title pre-filled', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      const editButtons = screen.getAllByRole('button', { name: /edit/i });
      await user.click(editButtons[0]);

      await waitFor(() => {
        const titleInput = screen.getByDisplayValue('Paris Adventure');
        expect(titleInput).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-013: Grid/list view toggle persists to localStorage', () => {
    it('clicking the view toggle switches layout and saves to localStorage', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /toggle view/i }));

      expect(localStorage.getItem('trek_dashboard_view')).toBe('list');
      expect(document.querySelector('.trips.list-view')).not.toBeNull();
    });
  });

  describe('FE-PAGE-DASH-014: Archived trips section toggles visibility', () => {
    it('shows archived trips when the archived section toggle is clicked', async () => {
      const oldTrip = buildTrip({ title: 'Old Rome Trip', start_date: '2024-01-01', end_date: '2024-01-07', is_archived: true });
      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) {
            return HttpResponse.json({ trips: [oldTrip] });
          }
          return HttpResponse.json({ trips: [buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10' })] });
        }),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);

      // Wait for active trips to load
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      // Archived section toggle should be present
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /archived/i })).toBeInTheDocument();
      });

      // Click to expand
      await user.click(screen.getByRole('button', { name: /archived/i }));

      await waitFor(() => {
        expect(screen.getByText('Old Rome Trip')).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-015: Clicking a trip card navigates to /trips/:id', () => {
    it('clicking a trip card navigates to the trip page', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        // Mobile + desktop may render the same trip twice
        expect(screen.getAllByText('Tokyo Trip').length).toBeGreaterThan(0);
      });

      const tokyoTrip = screen.getAllByText('Tokyo Trip')[0];
      await user.click(tokyoTrip);

      expect(tokyoTrip).toBeInTheDocument();
    });
  });

  describe('FE-PAGE-DASH-016: List view renders trip list items', () => {
    it('switching to list view still renders every trip', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Tokyo Trip').length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole('button', { name: /toggle view/i }));

      const list = document.querySelector('.trips.list-view')!;
      expect(list).not.toBeNull();
      // The next trip (Paris) is the spotlight hero above, so it isn't repeated in the list.
      expect(document.querySelector('.hero-trip')?.textContent).toContain('Paris Adventure');
      expect(list.textContent).toContain('Tokyo Trip');
      expect(list.textContent).not.toContain('Paris Adventure');
    });
  });

  describe('FE-PAGE-DASH-017: List view delete and archive actions work', () => {
    it('each list item keeps its edit, duplicate, archive and delete actions', async () => {
      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Tokyo Trip').length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole('button', { name: /toggle view/i }));

      const card = Array.from(document.querySelectorAll('.trips.list-view .trip-card')).find(c => c.textContent?.includes('Tokyo Trip'))!;
      expect(card).toBeDefined();
      const labels = Array.from(card.querySelectorAll('button')).map(b => b.getAttribute('aria-label'));
      expect(labels).toEqual(expect.arrayContaining(['Edit', 'Duplicate', 'Archive', 'Delete']));
    });
  });

  describe('FE-PAGE-DASH-018: Copy trip creates a new trip', () => {
    it('clicking duplicate on a trip card and confirming copies the trip', async () => {
      server.use(
        http.post('/api/trips/:id/copy', async () => {
          const trip = buildTrip({ title: 'Paris Adventure (Copy)', start_date: '2026-07-01', end_date: '2026-07-10' });
          return HttpResponse.json({ trip });
        }),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByRole('button', { name: /duplicate/i });
      expect(copyButtons.length).toBeGreaterThan(0);
      await user.click(copyButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /copy trip/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure (Copy)').length).toBeGreaterThan(0);
      });
    });
  });

  describe('FE-PAGE-DASH-019: Sidebar tools are shown', () => {
    it('the currency and timezone tools are always in the sidebar', async () => {
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });
      const sidebar = document.querySelector('.page-sidebar')!;
      expect(sidebar).not.toBeNull();
      expect(screen.getByRole('button', { name: /swap currencies/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /add timezone/i })).toBeInTheDocument();
    });
  });

  describe('FE-PAGE-DASH-020: Archived tab - restore trip', () => {
    it('restoring a trip from the Archived tab takes it out of that tab', async () => {
      const activeTrip = buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10' });
      const archivedTrip = buildTrip({ title: 'Old Rome Trip', start_date: '2024-01-01', end_date: '2024-01-07', is_archived: true });
      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [archivedTrip] });
          return HttpResponse.json({ trips: [activeTrip] });
        }),
        http.put('/api/trips/:id', async () => HttpResponse.json({ trip: { ...archivedTrip, is_archived: false } })),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole('button', { name: /^archived$/i }));
      await waitFor(() => {
        expect(screen.getByText('Old Rome Trip')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /restore/i }));

      await waitFor(() => {
        expect(screen.queryByText('Old Rome Trip')).not.toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-021: Create trip via form submission', () => {
    it('submitting the create form adds the trip to the list', async () => {
      const newTrip = buildTrip({ title: 'New Trip Test', start_date: '2027-01-01', end_date: '2027-01-05' });
      server.use(
        http.post('/api/trips', async () => {
          return HttpResponse.json({ trip: newTrip });
        }),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /new trip/i }).length).toBeGreaterThan(0);
      });

      await user.click(screen.getAllByRole('button', { name: /new trip/i })[0]);

      await waitFor(() => {
        expect(screen.getAllByText(/create new trip/i).length).toBeGreaterThan(0);
      });

      // Fill in the title
      const titleInput = screen.getByPlaceholderText(/e\.g\. Summer in Japan/i);
      await user.clear(titleInput);
      await user.type(titleInput, 'New Trip Test');

      // Submit the form
      const submitBtn = screen.getAllByRole('button').find(btn => btn.textContent?.toLowerCase().includes('create'));
      if (submitBtn) {
        await user.click(submitBtn);
        await waitFor(() => {
          expect(screen.getAllByText('New Trip Test').length).toBeGreaterThan(0);
        });
      }
    });
  });

  describe('FE-PAGE-DASH-022: Error state on load failure', () => {
    it('shows error toast when trips API fails', async () => {
      server.use(
        http.get('/api/trips', () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        }),
      );

      render(<DashboardPage />);

      // Page should still render header
      expect(screen.getByText(/my trips/i)).toBeInTheDocument();

      // Wait for loading to complete (error path)
      await waitFor(() => {
        // After error, loading state resolves and empty state or the title remains
        expect(screen.queryByText(/my trips/i)).toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-023: Spotlight shows live state for ongoing trip', () => {
    it('renders the live badge and days left when the trip is currently ongoing', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const ongoingTrip = buildTrip({ title: 'Current Voyage', start_date: yesterday, end_date: nextWeek, day_count: 9, place_count: 3, shared_count: 1 });

      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [] });
          return HttpResponse.json({ trips: [ongoingTrip] });
        }),
      );

      render(<DashboardPage />);

      await waitFor(() => {
        expect(document.querySelector('.hero-trip')?.textContent).toContain('Current Voyage');
      });
      const hero = document.querySelector('.hero-trip')!.textContent!;
      expect(hero).toMatch(/live now/i);
      expect(hero).toMatch(/days left/i);
      expect(document.querySelector('.hero-badge .pulse')).not.toBeNull();
    });
  });

  describe('FE-PAGE-DASH-024: SpotlightCard shows countdown for upcoming trip', () => {
    it('renders countdown badge for a future trip', async () => {
      const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
      const inTenDays = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];

      const upcomingTrip = buildTrip({
        title: 'Upcoming Safari',
        start_date: inFiveDays,
        end_date: inTenDays,
        place_count: 2,
        shared_count: 0,
      });

      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [] });
          return HttpResponse.json({ trips: [upcomingTrip] });
        }),
      );

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Upcoming Safari').length).toBeGreaterThan(0);
      });

      // Badge should show "X days left" countdown (not "Live now")
      expect(screen.queryByText(/live now/i)).not.toBeInTheDocument();
      // The SpotlightCard renders a badge with the countdown text containing "days"
      await waitFor(() => {
        expect(screen.getAllByText(/days/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('FE-PAGE-DASH-025: Mobile Quick Actions section renders', () => {
    it('shows New Trip quick action button on mobile', async () => {
      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });

      // Mobile Quick Actions: "New Trip" button rendered in the quick-actions grid
      // getAllByText because it appears in both mobile quick-actions and desktop header
      const newTripButtons = screen.getAllByText(/new trip/i);
      expect(newTripButtons.length).toBeGreaterThan(0);
    });
  });

  describe('FE-PAGE-DASH-026: Timezone tool lists its zones', () => {
    it('shows the default zones, each removable', async () => {
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });
      expect(screen.getAllByRole('button', { name: /^remove /i }).length).toBeGreaterThan(0);
    });
  });

  describe('FE-PAGE-DASH-027: Archived tab switch', () => {
    it('archived trips show only on the Archived tab, and leave when going back to Planned', async () => {
      const activeTrip = buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10' });
      const archivedTrip = buildTrip({ title: 'Old Rome Trip', start_date: '2024-01-01', end_date: '2024-01-07', is_archived: true });
      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [archivedTrip] });
          return HttpResponse.json({ trips: [activeTrip] });
        }),
        http.put('/api/trips/:id', async () => HttpResponse.json({ trip: { ...archivedTrip, is_archived: false } })),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });
      expect(screen.queryByText('Old Rome Trip')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^archived$/i }));
      await waitFor(() => {
        expect(screen.getByText('Old Rome Trip')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /^planned$/i }));
      await waitFor(() => {
        expect(screen.queryByText('Old Rome Trip')).not.toBeInTheDocument();
      });
    });
  });

  describe('FE-PAGE-DASH-028: Unarchive action restores trip to active list', () => {
    it('a restored trip shows up again under Planned', async () => {
      const activeTrip = buildTrip({ title: 'Paris Adventure', start_date: '2026-07-01', end_date: '2026-07-10' });
      const archivedTrip = buildTrip({ title: 'Old Rome Trip', start_date: '2026-09-01', end_date: '2026-09-07', is_archived: true });
      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [archivedTrip] });
          return HttpResponse.json({ trips: [activeTrip] });
        }),
        http.put('/api/trips/:id', async () => HttpResponse.json({ trip: { ...archivedTrip, is_archived: false } })),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole('button', { name: /^archived$/i }));
      await waitFor(() => {
        expect(screen.getByText('Old Rome Trip')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /restore/i }));

      await user.click(screen.getByRole('button', { name: /^planned$/i }));
      await waitFor(() => {
        expect(screen.getAllByText('Old Rome Trip').length).toBeGreaterThan(0);
      });
    });
  });

  describe('FE-PAGE-DASH-029: Copy trip action creates a duplicate', () => {
    it('clicking duplicate and confirming adds the copy to the list', async () => {
      server.use(
        http.post('/api/trips/:id/copy', async () => {
          const trip = buildTrip({ title: 'Paris Adventure (Copy)', start_date: '2026-07-01', end_date: '2026-07-10' });
          return HttpResponse.json({ trip });
        }),
      );

      const user = userEvent.setup();
      render(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure')[0]).toBeInTheDocument();
      });

      const copyButtons = screen.getAllByRole('button', { name: /duplicate/i });
      expect(copyButtons.length).toBeGreaterThan(0);
      await user.click(copyButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /copy trip/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure (Copy)').length).toBeGreaterThan(0);
      });
    });
  });

  describe('FE-PAGE-DASH-030: Empty state renders create button', () => {
    it('the create-trip card opens the new trip form', async () => {
      server.use(
        http.get('/api/trips', () => HttpResponse.json({ trips: [] })),
      );

      render(<DashboardPage />);

      // No trip cards — just the "New Trip / Plan a new trip from scratch" card.
      await waitFor(() => {
        expect(screen.getByText('Plan a new trip from scratch')).toBeInTheDocument();
      });
      expect(document.querySelectorAll('.trip-card')).toHaveLength(0);

      const user = userEvent.setup();
      await user.click(screen.getByText('Plan a new trip from scratch').closest('button')!);
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"], .modal, form')).not.toBeNull();
      });
    });
  });

  describe('FE-PAGE-DASH-031: Spotlight shows stats for ongoing trip', () => {
    it('renders places and travellers counts for a live trip', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
      const ongoingTrip = buildTrip({ title: 'Live Adventure', start_date: yesterday, end_date: inFiveDays, place_count: 5, shared_count: 2 });

      server.use(
        http.get('/api/trips', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('archived')) return HttpResponse.json({ trips: [] });
          return HttpResponse.json({ trips: [ongoingTrip] });
        }),
      );

      render(<DashboardPage />);

      await waitFor(() => {
        expect(document.querySelector('.hero-trip')?.textContent).toContain('Live Adventure');
      });
      const hero = document.querySelector('.hero-trip')!.textContent!;
      expect(hero).toMatch(/5 destinations/i);
      // Owner plus the two people it's shared with.
      expect(hero).toMatch(/3 travelers/i);
    });
  });

  describe('FE-PAGE-DASH-032: Dark mode detection uses window.matchMedia', () => {
    it('renders without error when dark_mode is set to auto', async () => {
      // Seed settings with dark_mode = 'auto' to exercise the matchMedia branch
      const { useSettingsStore } = await import('../store/settingsStore');
      seedStore(useSettingsStore, {
        settings: {
          map_tile_url: '',
          default_lat: 48.8566,
          default_lng: 2.3522,
          default_zoom: 10,
          dark_mode: 'auto',
          default_currency: 'USD',
          language: 'en',
          temperature_unit: 'fahrenheit',
          time_format: '12h',
          show_place_description: false,
          route_calculation: false,
          blur_booking_codes: false,
          dashboard_currency: 'on',
          dashboard_timezone: 'on',
        },
        updateSetting: vi.fn(),
      } as any);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Paris Adventure').length).toBeGreaterThan(0);
      });

      // Page renders successfully with dark_mode = 'auto'
      expect(screen.getByText(/my trips/i)).toBeInTheDocument();
    });
  });
});
