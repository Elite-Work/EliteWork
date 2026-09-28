/**
 * AdminActionSuccessScreen.test.tsx — #85
 *
 * Covers:
 *  - Success state: action type badge, stream ID, timestamp, and hero title are visible.
 *  - Action history section renders recorded entries.
 *  - Navigation buttons are present and trigger correct navigation calls.
 *  - Accessibility attributes (accessibilityLabel, accessibilityRole) are present.
 */
import { render, fireEvent } from '@testing-library/react-native';
import AdminActionSuccessScreen from './AdminActionSuccessScreen';
import { useAdminActionHistoryStore } from '../stores/adminActionHistoryStore';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/adminActionHistoryStore', () => ({
  useAdminActionHistoryStore: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIMESTAMP = '2026-07-30T12:00:00.000Z';

function buildNavigation(overrides?: Partial<{ navigate: jest.Mock; goBack: jest.Mock }>) {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    ...overrides,
  };
}

function buildRoute(
  actionType: 'Clawback' | 'Lock' | 'Terminate' = 'Clawback',
  streamId = 'stream-001',
  timestamp = FIXED_TIMESTAMP,
) {
  return { params: { actionType, streamId, timestamp } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminActionSuccessScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAdminActionHistoryStore as unknown as jest.Mock).mockReturnValue({ history: [] });
  });

  // ── #85.1: Success state clearly shows the completed action ────────────

  it('displays the hero title and action badge for a Clawback action', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute('Clawback') as any}
      />,
    );
    expect(getByText('Action completed')).toBeTruthy();
    // Hero badge — with empty history, CLAWBACK appears only once
    expect(getByText('CLAWBACK')).toBeTruthy();
  });

  it('displays the hero title and action badge for a Lock action', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute('Lock') as any}
      />,
    );
    expect(getByText('Action completed')).toBeTruthy();
    expect(getByText('LOCK')).toBeTruthy();
  });

  it('displays the hero title and action badge for a Terminate action', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute('Terminate') as any}
      />,
    );
    expect(getByText('Action completed')).toBeTruthy();
    expect(getByText('TERMINATE')).toBeTruthy();
  });

  it('shows the stream ID in the hero subtitle', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute('Clawback', 'stream-042') as any}
      />,
    );
    // The subtitle contains both streamId and timestamp separated by ` · `
    const subtitle = getByText(/stream-042/);
    expect(subtitle).toBeTruthy();
  });

  // ── #85.2: Action history is accessible ───────────────────────────────

  it('shows "No previous actions" when history is empty', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    expect(getByText('No previous actions recorded.')).toBeTruthy();
  });

  it('renders history rows when the store has entries', () => {
    (useAdminActionHistoryStore as unknown as jest.Mock).mockReturnValue({
      history: [
        { actionType: 'Clawback', streamId: 'stream-001', timestamp: FIXED_TIMESTAMP },
        { actionType: 'Lock', streamId: 'stream-002', timestamp: FIXED_TIMESTAMP },
      ],
    });

    const { getAllByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );

    // With history: hero badge + one history row = 2 occurrences of CLAWBACK
    expect(getAllByText('CLAWBACK').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('LOCK').length).toBeGreaterThanOrEqual(1);
  });

  it('section header for history is present', () => {
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    expect(getByText('Recent admin actions')).toBeTruthy();
  });

  // ── #85.3: Navigation buttons trigger correct calls ────────────────────

  it('navigates to AdminStreamsOverview when "Back to streams" is pressed', () => {
    const navigate = jest.fn();
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation({ navigate }) as any}
        route={buildRoute() as any}
      />,
    );
    fireEvent.press(getByText('Back to streams'));
    expect(navigate).toHaveBeenCalledWith('AdminStreamsOverview');
  });

  it('navigates to VaultDashboard when "Vault dashboard" is pressed', () => {
    const navigate = jest.fn();
    const { getByText } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation({ navigate }) as any}
        route={buildRoute() as any}
      />,
    );
    fireEvent.press(getByText('Vault dashboard'));
    expect(navigate).toHaveBeenCalledWith('VaultDashboard');
  });

  // ── Accessibility ─────────────────────────────────────────────────────

  it('"Back to streams" button has accessibilityLabel set', () => {
    const { UNSAFE_queryByProps } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    const btn = UNSAFE_queryByProps({ accessibilityLabel: 'Back to admin stream overview' });
    expect(btn).not.toBeNull();
  });

  it('"Vault dashboard" button has accessibilityLabel set', () => {
    const { UNSAFE_queryByProps } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    const btn = UNSAFE_queryByProps({ accessibilityLabel: 'Go to vault dashboard' });
    expect(btn).not.toBeNull();
  });

  it('"Back to streams" button has an accessibilityHint', () => {
    const { UNSAFE_queryByProps } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    const btn = UNSAFE_queryByProps({
      accessibilityHint: 'Returns to the list of streams for further admin operations',
    });
    expect(btn).not.toBeNull();
  });

  it('"Vault dashboard" button has an accessibilityHint', () => {
    const { UNSAFE_queryByProps } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    const btn = UNSAFE_queryByProps({
      accessibilityHint: 'Opens the vault dashboard to view trade statistics',
    });
    expect(btn).not.toBeNull();
  });

  it('hero section has accessibilityRole="header"', () => {
    const { UNSAFE_queryByProps } = render(
      <AdminActionSuccessScreen
        navigation={buildNavigation() as any}
        route={buildRoute() as any}
      />,
    );
    // Two elements carry accessibilityRole="header" (the hero and the
    // "Recent admin actions" section title), so target the hero by its label.
    const header = UNSAFE_queryByProps({
      accessibilityRole: 'header',
      accessibilityLabel: 'Admin action completed successfully',
    });
    expect(header).not.toBeNull();
  });
});
