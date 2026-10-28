import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';

import { SignAndSubmitXdr } from './SignAndSubmitXdr';
import {
  signAndSubmitXdr,
  TransactionSigningError,
} from '../services/freighterSigner';

jest.mock('../services/freighterSigner', () => ({
  ...jest.requireActual('../services/freighterSigner'),
  signAndSubmitXdr: jest.fn(),
}));

const mockSignAndSubmit = signAndSubmitXdr as jest.Mock;

const XDR = 'AAAAunsigned';
const ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';

function renderControl(props: Partial<ComponentProps<typeof SignAndSubmitXdr>> = {}) {
  return render(
    <SignAndSubmitXdr
      unsignedXdr={XDR}
      address={ADDRESS}
      testIDPrefix="tx"
      {...props}
    />,
  );
}

describe('SignAndSubmitXdr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignAndSubmit.mockResolvedValue({ hash: 'hash-001' });
  });

  it('renders an idle "Sign & submit" button and nothing else', () => {
    const { getByTestId, getByText, queryByTestId } = renderControl();

    expect(getByTestId('tx-sign')).toBeTruthy();
    expect(getByText('Sign & submit with Freighter')).toBeTruthy();
    expect(queryByTestId('tx-error')).toBeNull();
    expect(queryByTestId('tx-submitted')).toBeNull();
    expect(mockSignAndSubmit).not.toHaveBeenCalled();
  });

  it('signs the XDR for the given address and shows the transaction hash', async () => {
    const onSubmitted = jest.fn();
    const { getByTestId, queryByTestId } = renderControl({ onSubmitted });

    await act(async () => {
      fireEvent.press(getByTestId('tx-sign'));
    });

    expect(mockSignAndSubmit).toHaveBeenCalledWith(XDR, { address: ADDRESS });
    expect(getByTestId('tx-hash').props.children).toBe('hash-001');
    expect(onSubmitted).toHaveBeenCalledWith('hash-001');
    // The button is replaced by the result so it cannot be double-submitted.
    expect(queryByTestId('tx-sign')).toBeNull();
  });

  it('works without a wallet address hint', async () => {
    const { getByTestId } = renderControl({ address: undefined });

    await act(async () => {
      fireEvent.press(getByTestId('tx-sign'));
    });

    expect(mockSignAndSubmit).toHaveBeenCalledWith(XDR, { address: undefined });
  });

  it('shows a spinner and blocks re-entry while signing', async () => {
    let finish: (v: { hash: string }) => void = () => undefined;
    mockSignAndSubmit.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { getByTestId, UNSAFE_getByType, queryByText } = renderControl();

    act(() => {
      fireEvent.press(getByTestId('tx-sign'));
    });

    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(queryByText('Sign & submit with Freighter')).toBeNull();
    expect(getByTestId('tx-sign').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    // A second press while busy is ignored.
    fireEvent.press(getByTestId('tx-sign'));
    expect(mockSignAndSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ hash: 'hash-002' });
    });
    expect(getByTestId('tx-hash').props.children).toBe('hash-002');
  });

  it.each([
    ['WALLET_UNAVAILABLE', 'Freighter unavailable'],
    ['USER_REJECTED', 'Signature declined'],
    ['SIGNING_FAILED', 'Signing failed'],
    ['SUBMISSION_FAILED', 'Submission failed'],
  ] as const)('shows a %s failure inline and lets the user retry', async (code, title) => {
    mockSignAndSubmit.mockRejectedValueOnce(
      new TransactionSigningError(code, `message for ${code}`),
    );
    const { getByTestId, getByText, queryByTestId } = renderControl();

    await act(async () => {
      fireEvent.press(getByTestId('tx-sign'));
    });

    expect(getByTestId('tx-error')).toBeTruthy();
    expect(getByText(title)).toBeTruthy();
    expect(getByText(`message for ${code}`)).toBeTruthy();
    expect(queryByTestId('tx-submitted')).toBeNull();

    // Retry succeeds and clears the error.
    expect(getByText('Try signing again')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('tx-sign'));
    });
    expect(queryByTestId('tx-error')).toBeNull();
    expect(getByTestId('tx-hash').props.children).toBe('hash-001');
    expect(mockSignAndSubmit).toHaveBeenCalledTimes(2);
  });

  it('wraps an unexpected non-signing error as a signing failure', async () => {
    mockSignAndSubmit.mockRejectedValueOnce(new Error('kaboom'));
    const { getByTestId, getByText } = renderControl();

    await act(async () => {
      fireEvent.press(getByTestId('tx-sign'));
    });

    expect(getByText('Signing failed')).toBeTruthy();
    expect(getByText('kaboom')).toBeTruthy();
  });
});
