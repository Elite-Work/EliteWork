import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AdminContractScreen from './AdminContractScreen';
import { useAuthStore } from '../stores/authStore';
import { adminApi } from '../api/admin';
import { AdminApiError } from '../api/errors';
import {
  signAndSubmitXdr,
  TransactionSigningError,
} from '../services/freighterSigner';

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

jest.mock('../services/freighterSigner', () => ({
  ...jest.requireActual('../services/freighterSigner'),
  signAndSubmitXdr: jest.fn(),
}));

const mockSignAndSubmit = signAndSubmitXdr as jest.MockedFunction<
  typeof signAndSubmitXdr
>;

const mockAddMediator = adminApi.addMediator as jest.MockedFunction<
  typeof adminApi.addMediator
>;
const mockUpdateFee = adminApi.updateContractFeeBps as jest.MockedFunction<
  typeof adminApi.updateContractFeeBps
>;

const STELLAR_PUBKEY = 'G'.padEnd(56, 'A');
const ADMIN_WALLET = 'G'.padEnd(56, 'B');

describe('AdminContractScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      role: 'admin',
      walletAddress: ADMIN_WALLET,
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
  describe('Freighter signing', () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };

    function renderScreen() {
      return render(
        <AdminContractScreen
          navigation={navigation as any}
          route={{} as any}
        />,
      );
    }

    async function buildAddMediatorTx(utils: ReturnType<typeof renderScreen>) {
      mockAddMediator.mockResolvedValue({ unsignedXdr: 'XDR_ADD_MEDIATOR' });
      fireEvent.changeText(
        utils.getByTestId('admin-contract-add-input'),
        STELLAR_PUBKEY,
      );
      await act(async () => {
        fireEvent.press(utils.getByTestId('admin-contract-add'));
      });
    }

    async function buildFeeTx(utils: ReturnType<typeof renderScreen>) {
      mockUpdateFee.mockResolvedValue({ unsignedXdr: 'XDR_UPDATE_FEE' });
      await act(async () => {
        fireEvent.press(utils.getByTestId('admin-contract-fee'));
      });
    }

    it('offers no signing action until an XDR has been built', () => {
      const { queryByTestId } = renderScreen();

      expect(queryByTestId('admin-contract-add-sign')).toBeNull();
      expect(queryByTestId('admin-contract-fee-sign')).toBeNull();
    });

    it('signs and submits the add-mediator XDR with the admin wallet', async () => {
      mockSignAndSubmit.mockResolvedValue({ hash: 'HASH_ADD' });
      const utils = renderScreen();
      await buildAddMediatorTx(utils);

      await act(async () => {
        fireEvent.press(await utils.findByTestId('admin-contract-add-sign'));
      });

      expect(mockSignAndSubmit).toHaveBeenCalledWith('XDR_ADD_MEDIATOR', {
        address: ADMIN_WALLET,
      });
      expect(utils.getByTestId('admin-contract-add-hash').props.children).toBe(
        'HASH_ADD',
      );
      // The XDR stays visible/copyable after signing.
      expect(utils.getByTestId('admin-contract-add-xdr')).toBeTruthy();
    });

    it('signs and submits the update-fee XDR with the admin wallet', async () => {
      mockSignAndSubmit.mockResolvedValue({ hash: 'HASH_FEE' });
      const utils = renderScreen();
      await buildFeeTx(utils);

      await act(async () => {
        fireEvent.press(await utils.findByTestId('admin-contract-fee-sign'));
      });

      expect(mockSignAndSubmit).toHaveBeenCalledWith('XDR_UPDATE_FEE', {
        address: ADMIN_WALLET,
      });
      expect(utils.getByTestId('admin-contract-fee-hash').props.children).toBe(
        'HASH_FEE',
      );
    });

    it('keeps the two sections independent', async () => {
      mockSignAndSubmit.mockResolvedValue({ hash: 'HASH_ADD' });
      const utils = renderScreen();
      await buildAddMediatorTx(utils);
      await buildFeeTx(utils);

      await act(async () => {
        fireEvent.press(await utils.findByTestId('admin-contract-add-sign'));
      });

      expect(mockSignAndSubmit).toHaveBeenCalledTimes(1);
      expect(utils.queryByTestId('admin-contract-fee-hash')).toBeNull();
      expect(utils.getByTestId('admin-contract-fee-sign')).toBeTruthy();
    });

    it('shows an inline error and keeps the copyable XDR when Freighter is unavailable', async () => {
      mockSignAndSubmit.mockRejectedValue(
        new TransactionSigningError(
          'WALLET_UNAVAILABLE',
          "Freighter isn't available on this device.",
        ),
      );
      const utils = renderScreen();
      await buildAddMediatorTx(utils);

      await act(async () => {
        fireEvent.press(await utils.findByTestId('admin-contract-add-sign'));
      });

      expect(utils.getByTestId('admin-contract-add-error')).toBeTruthy();
      expect(utils.getByText('Freighter unavailable')).toBeTruthy();
      expect(utils.getByTestId('admin-contract-add-xdr')).toBeTruthy();
      // Signing problems are not backend errors, so no banner is raised.
      expect(utils.queryByTestId('admin-error-banner')).toBeNull();
    });

    it('drops the previous signing result when a new XDR is built', async () => {
      mockSignAndSubmit.mockResolvedValue({ hash: 'HASH_FIRST' });
      const utils = renderScreen();
      await buildAddMediatorTx(utils);
      await act(async () => {
        fireEvent.press(await utils.findByTestId('admin-contract-add-sign'));
      });
      expect(utils.getByTestId('admin-contract-add-hash')).toBeTruthy();

      await buildAddMediatorTx(utils);

      expect(utils.queryByTestId('admin-contract-add-hash')).toBeNull();
      expect(utils.getByTestId('admin-contract-add-sign')).toBeTruthy();
    });
  });
});
