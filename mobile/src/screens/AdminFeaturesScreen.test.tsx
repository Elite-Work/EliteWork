import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AdminFeaturesScreen from './AdminFeaturesScreen';
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

jest.mock('../api/admin', () => ({
  adminApi: {
    listFeatureFlags: jest.fn(),
    setFeatureFlag: jest.fn(),
  },
}));

const mockList = adminApi.listFeatureFlags as jest.MockedFunction<
  typeof adminApi.listFeatureFlags
>;
const mockSet = adminApi.setFeatureFlag as jest.MockedFunction<
  typeof adminApi.setFeatureFlag
>;

describe('AdminFeaturesScreen', () => {
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
      <AdminFeaturesScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );
    expect(getByText('Admin access required')).toBeTruthy();
  });

  it('lists feature flags from GET /admin/features', async () => {
    mockList.mockResolvedValue({
      flags: {
        beta_trades: { enabled: false },
        new_dispute_flow: { enabled: true, rolloutPercentage: 50 },
      },
    });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { findByTestId } = render(
      <AdminFeaturesScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    expect(await findByTestId('admin-features-row-beta_trades')).toBeTruthy();
    expect(
      await findByTestId('admin-features-row-new_dispute_flow'),
    ).toBeTruthy();
    expect(mockList).toHaveBeenCalled();
  });

  it('optimistically toggles a flag and rolls back when PATCH fails', async () => {
    mockList.mockResolvedValue({
      flags: { beta_trades: { enabled: false } },
    });
    mockSet.mockRejectedValueOnce(
      new AdminApiError({
        code: 'INTERNAL_ERROR',
        message: 'rpc boom',
        status: 500,
      }),
    );

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { findByTestId } = render(
      <AdminFeaturesScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    await findByTestId('admin-features-row-beta_trades');
    await act(async () => {
      fireEvent(
        await findByTestId('admin-features-toggle-beta_trades'),
        'onValueChange',
        true,
      );
    });

    expect(mockSet).toHaveBeenCalledWith('beta_trades', { enabled: true });
    await waitFor(async () =>
      expect((await findByTestId('admin-features-toggle-beta_trades')).props.value).toBe(false),
    );
    expect(await findByTestId('admin-error-banner')).toBeTruthy();
  });
});
