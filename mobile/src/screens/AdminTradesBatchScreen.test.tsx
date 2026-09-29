import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AdminTradesBatchScreen from './AdminTradesBatchScreen';
import { useAuthStore } from '../stores/authStore';
import { adminApi } from '../api/admin';
import { AdminApiError } from '../api/errors';

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

jest.mock('../api/admin', () => {
  // Partial mock — only stub the network method we observe. The re-exported
  // `TRADE_STATUSES` / `TradeStatus` flow through transparently from
  // '../constants/admin' so the test no longer has to mirror the array
  // here (which used to drift whenever statuses were added/removed).
  const actual = jest.requireActual('../api/admin');
  return {
    ...actual,
    adminApi: {
      updateTradeStatusesBatch: jest.fn(),
    },
  };
});

const mockUpdate = adminApi.updateTradeStatusesBatch as jest.MockedFunction<
  typeof adminApi.updateTradeStatusesBatch
>;

describe('AdminTradesBatchScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      role: 'admin',
      clearAuth: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('shows an access message for non-admin users', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ role: 'user' });
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByText } = render(
      <AdminTradesBatchScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );
    expect(getByText('Admin access required')).toBeTruthy();
  });

  it('submits a batch update and renders succeeded/failed rows', async () => {
    mockUpdate.mockResolvedValue({
      succeeded: ['trade-001'],
      failed: [{ tradeId: 'trade-002', reason: 'Invalid transition' }],
    });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminTradesBatchScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(
      getByTestId('admin-trades-batch-input'),
      'trade-001\ntrade-002',
    );
    fireEvent.press(getByTestId('admin-trades-batch-status-CANCELLED'));
    await act(async () => {
      fireEvent.press(getByTestId('admin-trades-batch-run'));
    });

    expect(mockUpdate).toHaveBeenCalledWith([
      { tradeId: 'trade-001', status: 'CANCELLED' },
      { tradeId: 'trade-002', status: 'CANCELLED' },
    ]);
    const result = await findByTestId('admin-trades-batch-result');
    expect(result).toBeTruthy();
  });

  it('surfaces a NETWORK_ERROR banner and retries on press', async () => {
    mockUpdate
      .mockRejectedValueOnce(
        new AdminApiError({
          code: 'NETWORK_ERROR',
          message: 'You appear to be offline.',
        }),
      )
      .mockResolvedValueOnce({
        succeeded: ['trade-001'],
        failed: [],
      });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminTradesBatchScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(
      getByTestId('admin-trades-batch-input'),
      'trade-001',
    );
    await act(async () => {
      fireEvent.press(getByTestId('admin-trades-batch-run'));
    });

    await findByTestId('admin-error-banner');
    await act(async () => {
      fireEvent.press(
        await findByTestId('admin-error-banner-primary-retry'),
      );
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
  });
});
