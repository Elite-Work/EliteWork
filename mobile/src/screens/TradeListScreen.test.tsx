/**
 * TradeListScreen.test.tsx — #53
 *
 * Verifies the pull-to-refresh behaviour on TradeListScreen: a RefreshControl
 * is wired to the trade store's fetchTrades, and pulling to refresh re-fetches
 * while toggling the `refreshing` state back to false when done.
 */
import { render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import TradeListScreen from './TradeListScreen';
import { useTradeStore } from '../stores/tradeStore';
import { useAuthStore } from '../stores/authStore';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/tradeStore', () => ({
  useTradeStore: jest.fn(),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('../components/AdminErrorBanner', () => ({
  AdminErrorBanner: () => null,
}));

jest.mock('../constants/support', () => ({
  buildSupportMailto: jest.fn(() => 'mailto:support'),
}));

type ScreenProps = StackScreenProps<RootStackParamList, 'TradeList'>;

describe('TradeListScreen pull-to-refresh (#53)', () => {
  const mockFetchTrades = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTradeStore as unknown as jest.Mock).mockReturnValue({
      trades: [],
      isLoading: false,
      errorView: null,
      fetchTrades: mockFetchTrades,
      clearErrorView: jest.fn(),
    });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ clearAuth: jest.fn() });
  });

  function renderScreen() {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    } as unknown as ScreenProps['navigation'];
    const route = { params: undefined } as unknown as ScreenProps['route'];
    return render(<TradeListScreen navigation={navigation} route={route} />);
  }

  it('mounts a RefreshControl wired to fetchTrades', () => {
    mockFetchTrades.mockResolvedValue(undefined);
    const { UNSAFE_getByType } = renderScreen();
    const refreshControl = UNSAFE_getByType(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(false);
    // Initial load on mount.
    expect(mockFetchTrades).toHaveBeenCalledTimes(1);
  });

  it('re-fetches trades and resets refreshing when pulled to refresh', async () => {
    mockFetchTrades.mockResolvedValue(undefined);
    const { UNSAFE_getByType } = renderScreen();
    const refreshControl = UNSAFE_getByType(RefreshControl);

    await refreshControl.props.onRefresh();

    await waitFor(() => expect(mockFetchTrades).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refreshControl.props.refreshing).toBe(false));
  });

  it('still resets refreshing when the fetch fails', async () => {
    mockFetchTrades.mockResolvedValue(undefined);
    const { UNSAFE_getByType } = renderScreen();
    const refreshControl = UNSAFE_getByType(RefreshControl);

    // Make the refresh attempt reject; the spinner must still clear
    // (onRefresh lets the rejection propagate, but the finally block
    // guarantees refreshing is reset first).
    mockFetchTrades.mockRejectedValueOnce(new Error('network'));
    await refreshControl.props.onRefresh().catch(() => undefined);

    await waitFor(() => expect(refreshControl.props.refreshing).toBe(false));
  });
});
