/**
 * WalletConnectScreen.test.tsx
 *
 * Covers the primary render states of WalletConnectScreen (first-time
 * connect vs. returning user with biometric unlock) and its key
 * interactions: the manual "paste your address" prompt, address
 * validation, the challenge/verify exchange, biometric unlock, busy
 * state handling and failure alerts.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Alert } from 'react-native';

import WalletConnectScreen from './WalletConnectScreen';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import {
  authenticateWithBiometrics,
  isBiometricUnlockAvailable,
} from '../utils/biometrics';

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('../api/auth', () => ({
  authApi: {
    generateChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
  },
}));

jest.mock('../utils/biometrics', () => ({
  authenticateWithBiometrics: jest.fn(),
  isBiometricUnlockAvailable: jest.fn(),
}));

const mockGenerateChallenge = authApi.generateChallenge as jest.Mock;
const mockVerifyChallenge = authApi.verifyChallenge as jest.Mock;
const mockAuthenticate = authenticateWithBiometrics as jest.Mock;
const mockBiometricsAvailable = isBiometricUnlockAvailable as jest.Mock;

const WALLET = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const UNLOCK_LABEL =
  'Unlock with Face ID or fingerprint as GDNM…SXMU';

type PromptCallback = (value?: string) => void | Promise<void>;

describe('WalletConnectScreen', () => {
  const setWalletAddress = jest.fn();
  const setToken = jest.fn();
  const getRememberedWalletAddress = jest.fn();
  const navigation = { replace: jest.fn(), navigate: jest.fn() };
  let alertSpy: jest.SpyInstance;
  let promptSpy: jest.SpyInstance;

  function renderScreen() {
    return render(
      <WalletConnectScreen
        navigation={navigation as never}
        route={{} as never}
      />,
    );
  }

  /** Presses "Connect Wallet" and returns the callback handed to Alert.prompt. */
  function pressConnect(utils: ReturnType<typeof renderScreen>): PromptCallback {
    fireEvent.press(utils.getByLabelText('Connect wallet'));
    expect(promptSpy).toHaveBeenCalledTimes(1);
    return promptSpy.mock.calls[0][2] as PromptCallback;
  }

  /** Renders as a returning user and waits for the biometric button. */
  async function renderReturningUser() {
    getRememberedWalletAddress.mockResolvedValue(WALLET);
    mockBiometricsAvailable.mockResolvedValue(true);
    const utils = renderScreen();
    await utils.findByLabelText(UNLOCK_LABEL);
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getRememberedWalletAddress.mockResolvedValue(null);
    mockBiometricsAvailable.mockResolvedValue(false);
    mockGenerateChallenge.mockResolvedValue({ challenge: 'challenge-xyz' });
    mockVerifyChallenge.mockResolvedValue({ token: 'jwt-token' });
    setToken.mockResolvedValue(undefined);
    mockAuthenticate.mockResolvedValue({ success: true });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      setWalletAddress,
      setToken,
      getRememberedWalletAddress,
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    promptSpy = jest.spyOn(Alert, 'prompt').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    promptSpy.mockRestore();
  });

  describe('render states', () => {
    it('renders the hero and the connect card for a first-time user', async () => {
      const { getByText, getByLabelText, queryByLabelText } = renderScreen();

      expect(getByText('Amana')).toBeTruthy();
      expect(getByText(/Trust as a Service/)).toBeTruthy();
      expect(getByText('Connect your Stellar Wallet')).toBeTruthy();
      expect(getByText('Connect Wallet')).toBeTruthy();
      expect(getByLabelText('Connect wallet')).toBeTruthy();
      await waitFor(() => expect(getRememberedWalletAddress).toHaveBeenCalled());
      expect(queryByLabelText(UNLOCK_LABEL)).toBeNull();
    });

    it('offers biometric unlock for a returning user on capable hardware', async () => {
      const { getByText, getByLabelText } = await renderReturningUser();

      expect(getByLabelText(UNLOCK_LABEL)).toBeTruthy();
      expect(getByText('🔐 Unlock as GDNM…SXMU')).toBeTruthy();
      // The manual path is demoted to a secondary label.
      expect(getByText('Use a different wallet')).toBeTruthy();
    });

    it('hides biometric unlock when the device has no usable biometrics', async () => {
      getRememberedWalletAddress.mockResolvedValue(WALLET);
      mockBiometricsAvailable.mockResolvedValue(false);
      const { queryByLabelText, getByText } = renderScreen();

      await waitFor(() => expect(mockBiometricsAvailable).toHaveBeenCalled());
      await act(async () => undefined);

      expect(queryByLabelText(UNLOCK_LABEL)).toBeNull();
      expect(getByText('Connect Wallet')).toBeTruthy();
    });

    it('hides biometric unlock when there is no remembered wallet', async () => {
      getRememberedWalletAddress.mockResolvedValue(null);
      mockBiometricsAvailable.mockResolvedValue(true);
      const { queryByText, getByText } = renderScreen();

      await waitFor(() => expect(mockBiometricsAvailable).toHaveBeenCalled());
      await act(async () => undefined);

      expect(queryByText(/Unlock as/)).toBeNull();
      expect(getByText('Connect Wallet')).toBeTruthy();
    });

    it('does not update state after unmounting mid-lookup', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      let resolveAddress: (v: string | null) => void = () => undefined;
      getRememberedWalletAddress.mockReturnValue(
        new Promise<string | null>((resolve) => {
          resolveAddress = resolve;
        }),
      );
      mockBiometricsAvailable.mockResolvedValue(true);
      const { unmount } = renderScreen();

      unmount();
      await act(async () => {
        resolveAddress(WALLET);
      });

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('manual connect', () => {
    it('prompts for the wallet address', () => {
      const utils = renderScreen();

      pressConnect(utils);

      expect(promptSpy).toHaveBeenCalledWith(
        'Enter Wallet Address',
        expect.stringContaining('Stellar wallet public key'),
        expect.any(Function),
        'plain-text',
      );
    });

    it('authenticates a valid address and replaces the route with TradeList', async () => {
      const utils = renderScreen();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(WALLET);
      });

      expect(mockGenerateChallenge).toHaveBeenCalledWith(WALLET);
      expect(mockVerifyChallenge).toHaveBeenCalledWith(WALLET, 'challenge-xyz');
      expect(setToken).toHaveBeenCalledWith('jwt-token');
      expect(setWalletAddress).toHaveBeenCalledWith(WALLET);
      expect(navigation.replace).toHaveBeenCalledWith('TradeList');
      expect(alertSpy).not.toHaveBeenCalled();
      // Token is persisted before the wallet is marked connected.
      expect(setToken.mock.invocationCallOrder[0]).toBeLessThan(
        setWalletAddress.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['an address that does not start with G', `X${WALLET.slice(1)}`],
      ['an address shorter than 56 characters', WALLET.slice(0, 55)],
      ['an empty address', ''],
      ['a cancelled prompt', undefined],
    ])('rejects %s without calling the API', async (_label, input) => {
      const utils = renderScreen();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(input);
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Invalid address',
        'Please enter a valid Stellar public key.',
      );
      expect(mockGenerateChallenge).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
      // The button is usable again.
      expect(
        utils.getByLabelText('Connect wallet').props.accessibilityState,
      ).toMatchObject({ disabled: false, busy: false });
    });

    it('shows the failure message and stays on screen when the challenge request fails', async () => {
      mockGenerateChallenge.mockRejectedValueOnce(new Error('Network down'));
      const utils = renderScreen();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(WALLET);
      });

      expect(alertSpy).toHaveBeenCalledWith('Connection failed', 'Network down');
      expect(setToken).not.toHaveBeenCalled();
      expect(setWalletAddress).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(
        utils.getByLabelText('Connect wallet').props.accessibilityState,
      ).toMatchObject({ disabled: false, busy: false });
    });

    it('shows the failure message when verification is rejected', async () => {
      mockVerifyChallenge.mockRejectedValueOnce(new Error('Bad signature'));
      const utils = renderScreen();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(WALLET);
      });

      expect(alertSpy).toHaveBeenCalledWith('Connection failed', 'Bad signature');
      expect(setToken).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('falls back to "Unknown error" when the failure carries no message', async () => {
      mockGenerateChallenge.mockRejectedValueOnce(undefined);
      const utils = renderScreen();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(WALLET);
      });

      expect(alertSpy).toHaveBeenCalledWith('Connection failed', 'Unknown error');
    });

    it('shows a busy, disabled button while the prompt is open', () => {
      const utils = renderScreen();

      pressConnect(utils);

      expect(
        utils.getByLabelText('Connect wallet').props.accessibilityState,
      ).toMatchObject({ disabled: true, busy: true });
      expect(utils.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    });

    it('recovers if opening the prompt throws', () => {
      promptSpy.mockImplementationOnce(() => {
        throw new Error('prompt unsupported');
      });
      const utils = renderScreen();

      fireEvent.press(utils.getByLabelText('Connect wallet'));

      expect(
        utils.getByLabelText('Connect wallet').props.accessibilityState,
      ).toMatchObject({ disabled: false, busy: false });
    });
  });

  describe('biometric unlock', () => {
    it('re-authenticates the remembered wallet after a successful biometric check', async () => {
      const { getByLabelText } = await renderReturningUser();

      await act(async () => {
        fireEvent.press(getByLabelText(UNLOCK_LABEL));
      });

      expect(mockAuthenticate).toHaveBeenCalledWith(
        'Unlock Amana to continue trading',
      );
      expect(mockGenerateChallenge).toHaveBeenCalledWith(WALLET);
      expect(mockVerifyChallenge).toHaveBeenCalledWith(WALLET, 'challenge-xyz');
      expect(setToken).toHaveBeenCalledWith('jwt-token');
      expect(setWalletAddress).toHaveBeenCalledWith(WALLET);
      expect(navigation.replace).toHaveBeenCalledWith('TradeList');
    });

    it('stays silent when the user cancels the biometric prompt', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        success: false,
        error: 'user_cancel',
      });
      const { getByLabelText } = await renderReturningUser();

      await act(async () => {
        fireEvent.press(getByLabelText(UNLOCK_LABEL));
      });

      expect(alertSpy).not.toHaveBeenCalled();
      expect(mockGenerateChallenge).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('tells the user to retry on a non-cancel biometric failure', async () => {
      mockAuthenticate.mockResolvedValueOnce({
        success: false,
        error: 'lockout',
      });
      const { getByLabelText } = await renderReturningUser();

      await act(async () => {
        fireEvent.press(getByLabelText(UNLOCK_LABEL));
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Unlock failed',
        'Please try again or connect your wallet manually.',
      );
      expect(mockGenerateChallenge).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('surfaces an API failure after a successful biometric check and re-enables the button', async () => {
      mockGenerateChallenge.mockRejectedValueOnce(new Error('Server error'));
      const { getByLabelText } = await renderReturningUser();

      await act(async () => {
        fireEvent.press(getByLabelText(UNLOCK_LABEL));
      });

      expect(alertSpy).toHaveBeenCalledWith('Connection failed', 'Server error');
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(getByLabelText(UNLOCK_LABEL).props.accessibilityState).not.toMatchObject(
        { disabled: true },
      );
    });

    it('disables both buttons while a biometric unlock is in progress', async () => {
      let finish: (v: { success: boolean }) => void = () => undefined;
      mockAuthenticate.mockReturnValueOnce(
        new Promise<{ success: boolean }>((resolve) => {
          finish = resolve;
        }),
      );
      const { getByLabelText } = await renderReturningUser();

      act(() => {
        fireEvent.press(getByLabelText(UNLOCK_LABEL));
      });

      expect(
        getByLabelText('Connect wallet').props.accessibilityState,
      ).toMatchObject({ disabled: true });

      await act(async () => {
        finish({ success: true });
      });
      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith('TradeList'),
      );
    });

    it('still lets a returning user connect a different wallet manually', async () => {
      const utils = await renderReturningUser();
      const onSubmit = pressConnect(utils);

      await act(async () => {
        await onSubmit(WALLET);
      });

      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(navigation.replace).toHaveBeenCalledWith('TradeList');
    });
  });
});
