import { act, fireEvent, render } from '@testing-library/react-native';

import { WalletPinUnlock } from '../WalletPinUnlock';

describe('WalletPinUnlock', () => {
  it('renders the reason for the PIN prompt', () => {
    const { getByText, getByLabelText } = render(
      <WalletPinUnlock
        onSubmit={jest.fn()}
        message="Face ID failed 3 times."
      />,
    );

    expect(getByText('Enter your wallet PIN')).toBeTruthy();
    expect(getByText('Face ID failed 3 times.')).toBeTruthy();
    expect(getByLabelText('Wallet PIN')).toBeTruthy();
  });

  it('keeps submit disabled until 4 digits are entered', () => {
    const { getByLabelText } = render(<WalletPinUnlock onSubmit={jest.fn()} />);

    expect(getByLabelText('Unlock with PIN').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.changeText(getByLabelText('Wallet PIN'), '123');
    expect(getByLabelText('Unlock with PIN').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.changeText(getByLabelText('Wallet PIN'), '1234');
    expect(getByLabelText('Unlock with PIN').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('submits the PIN on success without showing an error', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true);
    const { getByLabelText, queryByRole } = render(
      <WalletPinUnlock onSubmit={onSubmit} />,
    );

    fireEvent.changeText(getByLabelText('Wallet PIN'), '4321');
    await act(async () => {
      fireEvent.press(getByLabelText('Unlock with PIN'));
    });

    expect(onSubmit).toHaveBeenCalledWith('4321');
    expect(queryByRole('alert')).toBeNull();
  });

  it('shows an error and clears the input when the PIN is rejected', async () => {
    const onSubmit = jest.fn().mockResolvedValue(false);
    const { getByLabelText, getByText } = render(
      <WalletPinUnlock onSubmit={onSubmit} />,
    );

    fireEvent.changeText(getByLabelText('Wallet PIN'), '0000');
    await act(async () => {
      fireEvent.press(getByLabelText('Unlock with PIN'));
    });

    expect(getByText('Incorrect PIN. Try again.')).toBeTruthy();
    expect(getByLabelText('Wallet PIN').props.value).toBe('');
  });

  it('shows an error when verification throws', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('keystore down'));
    const { getByLabelText, getByText } = render(
      <WalletPinUnlock onSubmit={onSubmit} />,
    );

    fireEvent.changeText(getByLabelText('Wallet PIN'), '1234');
    await act(async () => {
      fireEvent.press(getByLabelText('Unlock with PIN'));
    });

    expect(getByText('Could not verify the PIN. Try again.')).toBeTruthy();
  });

  it('strips non-numeric characters and caps the length', () => {
    const { getByLabelText } = render(<WalletPinUnlock onSubmit={jest.fn()} />);
    const input = getByLabelText('Wallet PIN');

    fireEvent.changeText(input, '12ab34');
    expect(input.props.value).toBe('1234');

    fireEvent.changeText(input, '12345678');
    expect(input.props.value).toBe('123456');
  });

  it('offers a way out for a forgotten PIN', () => {
    const onUseDifferentWallet = jest.fn();
    const { getByLabelText } = render(
      <WalletPinUnlock
        onSubmit={jest.fn()}
        onUseDifferentWallet={onUseDifferentWallet}
      />,
    );

    fireEvent.press(getByLabelText('Use a different wallet'));
    expect(onUseDifferentWallet).toHaveBeenCalled();
  });
});
