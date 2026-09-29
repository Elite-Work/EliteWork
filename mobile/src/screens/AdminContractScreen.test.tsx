import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AdminContractScreen from './AdminContractScreen';
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
    addMediator: jest.fn(),
    removeMediator: jest.fn(),
    updateContractFeeBps: jest.fn(),
  },
}));

const mockAddMediator = adminApi.addMediator as jest.MockedFunction<
  typeof adminApi.addMediator
>;
const mockUpdateFee = adminApi.updateContractFeeBps as jest.MockedFunction<
  typeof adminApi.updateContractFeeBps
>;

const STELLAR_PUBKEY = 'G'.padEnd(56, 'A');

describe('AdminContractScreen', () => {
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
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );
    expect(getByText('Admin access required')).toBeTruthy();
  });

  it('surfaces the add-mediator unsignedXdr after a successful call', async () => {
    mockAddMediator.mockResolvedValue({
      unsignedXdr: 'XDR_ADD_MEDIATOR',
    });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(
      getByTestId('admin-contract-add-input'),
      STELLAR_PUBKEY,
    );
    await act(async () => {
      fireEvent.press(getByTestId('admin-contract-add'));
    });

    expect(mockAddMediator).toHaveBeenCalledWith(STELLAR_PUBKEY);
    expect(await findByTestId('admin-contract-add-xdr')).toBeTruthy();
  });

  it('shows a banner and recovers when the fee update throws VALIDATION_ERROR', async () => {
    mockUpdateFee.mockRejectedValueOnce(
      new AdminApiError({
        code: 'VALIDATION_ERROR',
        message: 'feeBps out of range',
        status: 400,
      }),
    );

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(getByTestId('admin-contract-fee-input'), '500');
    await act(async () => {
      fireEvent.press(getByTestId('admin-contract-fee'));
    });

    expect(await findByTestId('admin-error-banner')).toBeTruthy();
    await waitFor(() => expect(mockUpdateFee).toHaveBeenCalledWith(500));
  });
});
