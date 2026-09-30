import { render, fireEvent } from '@testing-library/react-native';
import { ClawbackHelpBanner } from '../ClawbackHelpBanner';

describe('ClawbackHelpBanner', () => {
  it('renders the toggle button', () => {
    const { getByTestId } = render(<ClawbackHelpBanner />);
    expect(getByTestId('clawback-help-toggle')).toBeTruthy();
  });

  it('does NOT show help text by default (collapsed)', () => {
    const { queryByTestId } = render(<ClawbackHelpBanner />);
    expect(queryByTestId('clawback-help-content')).toBeNull();
  });

  it('shows help text after pressing the toggle button', () => {
    const { getByTestId } = render(<ClawbackHelpBanner />);

    fireEvent.press(getByTestId('clawback-help-toggle'));

    expect(getByTestId('clawback-help-content')).toBeTruthy();
  });

  it('hides help text again after pressing toggle a second time', () => {
    const { getByTestId, queryByTestId } = render(<ClawbackHelpBanner />);

    // Expand
    fireEvent.press(getByTestId('clawback-help-toggle'));
    expect(getByTestId('clawback-help-content')).toBeTruthy();

    // Collapse
    fireEvent.press(getByTestId('clawback-help-toggle'));
    expect(queryByTestId('clawback-help-content')).toBeNull();
  });

  it('renders all three clawback help text bullets when expanded', () => {
    const { getByTestId, getByText } = render(<ClawbackHelpBanner />);

    fireEvent.press(getByTestId('clawback-help-toggle'));

    expect(
      getByText(/Clawback allows an admin to reclaim unvested tokens from a stream\./)
    ).toBeTruthy();
    expect(
      getByText(/This action reduces the stream balance immediately and is recorded on-chain\./)
    ).toBeTruthy();
    expect(
      getByText(/Use with caution: clawbacks cannot be undone once confirmed\./)
    ).toBeTruthy();
  });

  it('toggle button has correct accessibility attributes when collapsed', () => {
    const { getByTestId } = render(<ClawbackHelpBanner />);
    const toggle = getByTestId('clawback-help-toggle');

    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('Show clawback help');
  });

  it('toggle button has correct accessibility label when expanded', () => {
    const { getByTestId } = render(<ClawbackHelpBanner />);
    const toggle = getByTestId('clawback-help-toggle');

    fireEvent.press(toggle);

    expect(toggle.props.accessibilityLabel).toBe('Hide clawback help');
  });
});
