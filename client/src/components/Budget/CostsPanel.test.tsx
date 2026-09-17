// FE-COMP-COSTSPANEL-001+
import { render, screen, waitFor } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { useSettingsStore } from '../../store/settingsStore';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser, buildTrip, buildSettings } from '../../../tests/helpers/factories';
import CostsPanel from './CostsPanel';

const members = [
  { id: 1, username: 'Alice' },
  { id: 2, username: 'Bob' },
  { id: 3, username: 'Carol' },
];

beforeEach(() => {
  resetAllStores();
  server.use(
    http.get('/api/trips/:id/budget/settlement', () => HttpResponse.json({ balances: [], flows: [] })),
    http.get('/api/trips/:id/budget/summary/per-person', () => HttpResponse.json({ summary: [] })),
    http.get('/api/trips/1/budget', () => HttpResponse.json({ items: [] })),
  );
  seedStore(useAuthStore, { user: buildUser({ id: 1, username: 'Alice' }), isAuthenticated: true });
  seedStore(useTripStore, { trip: buildTrip({ id: 1, currency: 'EUR' }) });
  seedStore(useSettingsStore, { settings: buildSettings({ default_currency: 'EUR' }) });
});

async function openExpenseModal(user: ReturnType<typeof userEvent.setup>) {
  render(<CostsPanel tripId={1} tripMembers={members} />);
  const addBtn = await screen.findByRole('button', { name: /add expense/i });
  await user.click(addBtn);
  await screen.findByText('What was it for?');
}

describe('CostsPanel — shared payment', () => {
  it('FE-COMP-COSTSPANEL-001: "Paid from a shared kitty" toggle is visible in the expense modal', async () => {
    const user = userEvent.setup();
    await openExpenseModal(user);
    expect(screen.getByRole('button', { name: /paid from a shared kitty/i })).toBeInTheDocument();
  });

  it('FE-COMP-COSTSPANEL-002: toggling shared payment hides per-person payer inputs and shows a single total input', async () => {
    const user = userEvent.setup();
    await openExpenseModal(user);

    // Manual mode: one amount input per traveler
    expect(screen.getByText('Who paid?')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('0.00').length).toBeGreaterThanOrEqual(members.length);

    await user.click(screen.getByRole('button', { name: /paid from a shared kitty/i }));

    expect(screen.getByText(/split evenly across everyone below/i)).toBeInTheDocument();
    // Only the total-amount input should remain with that placeholder now
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(1);
  });

  it('FE-COMP-COSTSPANEL-003: saving a shared-payment expense splits the total equally among all selected people', async () => {
    const user = userEvent.setup();
    let posted: any = null;
    server.use(
      http.post('/api/trips/1/budget', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ item: { id: 99, trip_id: 1, name: posted.name, ...posted } });
      }),
    );

    await openExpenseModal(user);

    await user.type(screen.getByPlaceholderText('e.g. Dinner, souvenirs, gas…'), 'Groceries');
    await user.click(screen.getByRole('button', { name: /paid from a shared kitty/i }));
    await user.type(screen.getByPlaceholderText('0.00'), '10');

    const addExpenseButtons = screen.getAllByRole('button', { name: 'Add expense' });
    await user.click(addExpenseButtons[addExpenseButtons.length - 1]);

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted.member_ids.sort()).toEqual([1, 2, 3]);
    // 10 / 3 split down to the cent, still summing back to exactly 10
    const amounts = posted.payers.map((p: any) => p.amount).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([3.33, 3.33, 3.34]);
    expect(amounts.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(10, 2);
    // Every participant is both a payer and a split member — no one owes anyone
    expect(posted.payers.map((p: any) => p.user_id).sort()).toEqual([1, 2, 3]);
  });
});
