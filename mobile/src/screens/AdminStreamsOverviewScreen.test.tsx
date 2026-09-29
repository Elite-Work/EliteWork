/**
 * AdminStreamsOverviewScreen.test.tsx — #86 (accessibility) + #85 (navigation)
 *
 * Covers:
 *  - #85: Pressing an action button records the action and navigates to
 *         AdminActionSuccess with correct params.
 *  - #86: All interactive elements have accessible labels and hints.
 *         Stream metadata uses accessibilityRole="text".
 *         Non-admin view has accessible "Go back" button.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AdminStreamsOverviewScreen from './AdminStreamsOverviewScreen';
import { useAuthStore } from '../stores/authStore';
import { useAdminActionHistoryStore } from '../stores/adminActionHistoryStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { adminApi } from '../api/admin';
import { AdminApiError } from '../api/errors';

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('../stores/adminActionHistoryStore', () => ({
  useAdminActionHistoryStore: jest.fn(),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(),
}));

jest.mock('../api/admin', () => ({
  adminApi: { listStreams: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;
const mockUseAdminActionHistoryStore = useAdminActionHistoryStore as unknown as jest.Mock;
const mockUseNetworkStatus = useNetworkStatus as unknown as jest.Mock;
const mockListStreams = adminApi.listStreams as jest.MockedFunction<
  typeof adminApi.listStreams
>;

function buildNavigation(overrides?: Partial<{ navigate: jest.Mock; goBack: jest.Mock }>) {
  return { navigate: jest.fn(), goBack: jest.fn(), ...overrides };
}

function renderAdmin() {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  return {
    navigation,
    ...render(
      <AdminStreamsOverviewScreen navigation={navigation as any} route={{} as any} />
    ),
  };
}

describe('AdminStreamsOverviewScreen', () => {
  const mockAddAction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    mockUseAdminActionHistoryStore.mockReturnValue({ addAction: mockAddAction });
    mockUseNetworkStatus.mockReturnValue({ isOffline: false });
    mockListStreams.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('renders a stream list and action buttons for admin users when online', async () => {
    mockListStreams.mockResolvedValue({
      items: [
        {
          streamId: 'stream-100',
          recipient: '',
          status: 'ACTIVE',
          vestingState: 'vesting',
          totalVested: '0',
          claimed: '0',
          unclaimed: '0',
          pendingClawback: '0',
          adminTags: [],
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const { findByText, findAllByText } = renderAdmin();

    expect(await findByText('Admin stream overview')).toBeTruthy();
    await findByText('stream-100');
    expect((await findAllByText('Clawback')).length).toBe(1);
    expect((await findAllByText('Lock')).length).toBe(1);
    expect((await findAllByText('Terminate')).length).toBe(1);
  });

  it('renders SEED_STREAMS placeholder before the first API response resolves', () => {
    mockListStreams.mockReturnValue(new Promise(() => {}));

    const { getByText } = renderAdmin();

    expect(getByText('stream-001')).toBeTruthy();
    expect(getByText('stream-002')).toBeTruthy();
  });

  it('shows an access message for non-admin users', () => {
    mockUseAuthStore.mockReturnValue({ role: 'user' });

    const { getByText, queryByTestId } = renderAdmin();

    expect(getByText('Admin access required')).toBeTruthy();
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  describe('offline handling', () => {
    it('renders the offline banner when the device is offline', () => {
      mockUseAuthStore.mockReturnValue({ role: 'admin' });
      mockUseNetworkStatus.mockReturnValue({ isOffline: true });

      const { getByTestId, getByText } = renderAdmin();

      const banner = getByTestId('offline-banner');
      expect(banner).toBeTruthy();
      expect(getByText('No connection')).toBeTruthy();
      expect(getByText(/You're offline\. Admin actions can't be submitted/i)).toBeTruthy();
    });

    it('does not render the offline banner when online', () => {
      mockUseAuthStore.mockReturnValue({ role: 'admin' });
      mockUseNetworkStatus.mockReturnValue({ isOffline: false });

      const { queryByTestId } = renderAdmin();

      expect(queryByTestId('offline-banner')).toBeNull();
    });

    it.each(['clawback', 'lock', 'terminate'] as const)(
      'disables %s when offline and re-enables it when transitioning back online (same tree)',
      (actionKey) => {
        mockUseAuthStore.mockReturnValue({ role: 'admin' });
        mockUseNetworkStatus.mockReturnValue({ isOffline: true });

        const { rerender, getByTestId, queryByTestId } = renderAdmin();

        const offlineButton = getByTestId(`action-${actionKey}-stream-001`);
        expect(offlineButton.props.accessibilityState).toEqual({ disabled: true });
        expect(queryByTestId('offline-banner')).toBeTruthy();

        mockUseNetworkStatus.mockReturnValue({ isOffline: false });
        rerender(
          <AdminStreamsOverviewScreen
            navigation={{ goBack: jest.fn(), navigate: jest.fn() } as any}
            route={{} as any}
          />
        );

        const onlineButton = getByTestId(`action-${actionKey}-stream-001`);
        expect(onlineButton.props.accessibilityState).toEqual({ disabled: false });
        expect(queryByTestId('offline-banner')).toBeNull();
      }
    );
  });

  it('navigates to AdminActionSuccess with correct params when Clawback is pressed', async () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    // Keep SEED_STREAMS on screen: a resolved empty list replaces it and
    // removes the action buttons before the press.
    mockListStreams.mockReturnValue(new Promise(() => {}));
    const navigate = jest.fn();
    const { getByTestId } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation({ navigate }) as any} route={{} as any} />,
    );

    fireEvent.press(getByTestId('action-clawback-stream-001'));

    expect(navigate).toHaveBeenCalledWith(
      'AdminActionSuccess',
      expect.objectContaining({ actionType: 'Clawback', streamId: 'stream-001' }),
    );
  });

  it('records the action in the history store when an action button is pressed', async () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    mockListStreams.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation() as any} route={{} as any} />,
    );
    fireEvent.press(getByTestId('action-lock-stream-001'));
    expect(mockAddAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'Lock', streamId: 'stream-001' }),
    );
  });

  it('passes a timestamp in the navigation params', async () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    mockListStreams.mockReturnValue(new Promise(() => {}));
    const navigate = jest.fn();
    const { getByTestId } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation({ navigate }) as any} route={{} as any} />,
    );
    fireEvent.press(getByTestId('action-terminate-stream-001'));
    const params = navigate.mock.calls[0][1];
    expect(typeof params.timestamp).toBe('string');
    expect(new Date(params.timestamp).toISOString()).toBe(params.timestamp);
  });

  it('has an accessible "Back" button with correct label in the admin header', () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    const { UNSAFE_queryByProps } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation() as any} route={{} as any} />,
    );
    const btn = UNSAFE_queryByProps({ accessibilityLabel: 'Go back' });
    expect(btn).not.toBeNull();
  });

  it('stream-001 Clawback button has accessible label', () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    const { UNSAFE_queryByProps } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation() as any} route={{} as any} />,
    );
    const btn = UNSAFE_queryByProps({ accessibilityLabel: 'Clawback stream stream-001' });
    expect(btn).not.toBeNull();
  });

  it('pending clawback amount text has an accessible label on stream-002', async () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    // SEED_STREAMS has pendingClawback '0' (2500 is stream-002's unclaimed
    // figure), so drive the label from an explicit fixture instead.
    mockListStreams.mockResolvedValue({
      items: [
        {
          streamId: 'stream-002',
          recipient: '',
          status: 'SUSPENDED',
          vestingState: 'vesting',
          totalVested: '2500',
          claimed: '0',
          unclaimed: '2500',
          pendingClawback: '2500',
          adminTags: [],
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const { findByLabelText } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation() as any} route={{} as any} />,
    );
    expect(await findByLabelText('Pending clawback amount: 2500')).toBeTruthy();
  });

  it('non-admin "Go back" button calls navigation.goBack when pressed', () => {
    mockUseAuthStore.mockReturnValue({ role: 'user' });
    const goBack = jest.fn();
    const { getByText } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation({ goBack }) as any} route={{} as any} />,
    );
    fireEvent.press(getByText('Go back'));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('surfaces a NETWORK_ERROR banner when the API throws an offline error', async () => {
    mockUseAuthStore.mockReturnValue({ role: 'admin' });
    mockListStreams.mockRejectedValue(
      new AdminApiError({
        code: 'NETWORK_ERROR',
        message: "You appear to be offline. Check your connection and try again.",
        status: undefined,
      }),
    );

    const { findByTestId, getByText } = render(
      <AdminStreamsOverviewScreen navigation={buildNavigation() as any} route={{} as any} />,
    );

    const banner = await findByTestId('admin-error-banner');
    expect(banner).toBeTruthy();
    expect(getByText(/appear to be offline/i)).toBeTruthy();

    const retry = await findByTestId('admin-error-banner-primary-retry');
    await act(async () => {
      fireEvent.press(retry);
    });
    await waitFor(() => expect(mockListStreams).toHaveBeenCalledTimes(2));
  });
});
