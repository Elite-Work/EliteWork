/**
 * TradeDetailScreen.test.tsx
 *
 * Covers the primary render states of TradeDetailScreen (loading, not
 * found, loaded for every trade status, load/action error banners) and its
 * key interactions (confirmation alerts for deposit / confirm / release,
 * the dispute modal, evidence upload and navigation).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Alert, Linking } from 'react-native';
import type { AlertButton } from 'react-native';

import TradeDetailScreen from './TradeDetailScreen';
import { useTradeStore } from '../stores/tradeStore';
import { useAuthStore } from '../stores/authStore';
import type { AdminErrorView } from '../api/errors';
import type { Trade, TradeStatus } from '../types/trade';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/tradeStore', () => ({
  useTradeStore: jest.fn(),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const TRADE_ID = '4294967297123456';
const BUYER = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const SELLER = 'GBQ5NYMF2UBXZPH7PCPCUNTONIIIVRRQ24ZDUVAOD4GXLMI5SAQUJDFK';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    tradeId: TRADE_ID,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    amountUsdc: '250.00',
    status: 'FUNDED',
    ...overrides,
  };
}

function makeView(overrides: Partial<AdminErrorView> = {}): AdminErrorView {
  return {
    title: 'Something went wrong',
    message: 'The request failed.',
    action: 'retry',
    code: 'INTERNAL_ERROR',
    requestId: 'req-42',
    ...overrides,
  };
}

describe('TradeDetailScreen', () => {
  const fetchTrade = jest.fn();
  const confirmDelivery = jest.fn();
  const initiateDispute = jest.fn();
  const releaseFunds = jest.fn();
  const deposit = jest.fn();
  const clearErrorView = jest.fn();
  const clearAuth = jest.fn();
  const navigation = {
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let alertSpy: jest.SpyInstance;
  let openURL: jest.SpyInstance;

  function mockStore(overrides: Record<string, unknown> = {}) {
    (useTradeStore as unknown as jest.Mock).mockReturnValue({
      currentTrade: makeTrade(),
      isLoading: false,
      errorView: null,
      lastActionErrorView: null,
      fetchTrade,
      confirmDelivery,
      initiateDispute,
      releaseFunds,
      deposit,
      clearErrorView,
      ...overrides,
    });
  }

  function renderScreen() {
    return render(
      <TradeDetailScreen
        navigation={navigation as never}
        route={{ params: { tradeId: TRADE_ID } } as never}
      />,
    );
  }

  /** Returns the buttons of the most recent `Alert.alert` call. */
  function lastAlertButtons(): AlertButton[] {
    const calls = alertSpy.mock.calls;
    return calls[calls.length - 1][2] as AlertButton[];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fetchTrade.mockResolvedValue(undefined);
    confirmDelivery.mockResolvedValue(undefined);
    initiateDispute.mockResolvedValue(undefined);
    releaseFunds.mockResolvedValue(undefined);
    deposit.mockResolvedValue(undefined);
    clearAuth.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ clearAuth });
    mockStore();
  });

  afterEach(() => {
    alertSpy.mockRestore();
    openURL.mockRestore();
  });

  describe('loading and not-found states', () => {
    it('fetches the trade for the route param on mount', () => {
      renderScreen();

      expect(fetchTrade).toHaveBeenCalledWith(TRADE_ID);
    });

    it('shows a spinner and no content while the first load is in flight', () => {
      mockStore({ currentTrade: null, isLoading: true });
      const { UNSAFE_getByType, queryByText } = renderScreen();

      expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
      expect(queryByText('Trade Detail')).toBeNull();
    });

    it('keeps rendering the trade (no spinner) when a refresh is in flight', () => {
      mockStore({ isLoading: true });
      const { getByText } = renderScreen();

      expect(getByText('Trade Detail')).toBeTruthy();
      expect(getByText('Trade Info')).toBeTruthy();
    });

    it('shows a synthetic "Trade not found" banner when there is no trade and no error', () => {
      mockStore({ currentTrade: null });
      const { getByText, getByTestId } = renderScreen();

      expect(getByText('Trade not found')).toBeTruthy();
      fireEvent.press(getByTestId('admin-error-banner-primary-go_back'));
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('shows the store error and offers a retry when the load failed', () => {
      mockStore({
        currentTrade: null,
        errorView: makeView({ action: 'retry' }),
      });
      const { getByText, getByTestId } = renderScreen();
      expect(getByText('Something went wrong')).toBeTruthy();
      expect(fetchTrade).toHaveBeenCalledTimes(1);

      fireEvent.press(getByTestId('admin-error-banner-primary-retry'));

      expect(fetchTrade).toHaveBeenCalledTimes(2);
      expect(fetchTrade).toHaveBeenLastCalledWith(TRADE_ID);
    });

    it('signs out from the not-found banner when the session expired', async () => {
      mockStore({
        currentTrade: null,
        errorView: makeView({
          action: 'sign_out_required',
          code: 'AUTH_ERROR',
        }),
      });
      const { getByTestId } = renderScreen();

      await act(async () => {
        fireEvent.press(
          getByTestId('admin-error-banner-primary-sign_out_required'),
        );
      });

      expect(clearAuth).toHaveBeenCalledTimes(1);
    });

    it('navigates back from the header on the not-found screen', () => {
      mockStore({ currentTrade: null });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('← Back'));

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('loaded trade', () => {
    it('renders the status card, trade info and contract defaults', () => {
      mockStore({
        currentTrade: makeTrade({
          status: 'FUNDED',
          commodity: 'Cocoa',
          quantity: '12',
          unit: 'tons',
          createdAt: '2026-01-02T10:00:00.000Z',
          updatedAt: '2026-01-03T10:00:00.000Z',
        }),
      });
      const { getByText, getAllByText } = renderScreen();

      expect(getByText('#429496729712…')).toBeTruthy();
      expect(getByText('250.00 USDC')).toBeTruthy();
      expect(getByText('Cocoa — 12 tons')).toBeTruthy();

      expect(getByText(TRADE_ID)).toBeTruthy();
      expect(getByText(BUYER)).toBeTruthy();
      expect(getByText(SELLER)).toBeTruthy();
      expect(
        getByText(new Date('2026-01-03T10:00:00.000Z').toLocaleDateString()),
      ).toBeTruthy();
      // "Created" is both a trade-info label and a timeline step.
      expect(getAllByText('Created')).toHaveLength(2);

      expect(getByText('Buyer 5000 / Seller 5000 bps')).toBeTruthy();
      expect(getByText('1% (seller)')).toBeTruthy();
      expect(getByText('cNGN')).toBeTruthy();
      expect(getByText('Commodity')).toBeTruthy();
      expect(getByText('12 tons')).toBeTruthy();
    });

    it('uses the trade loss ratio and omits commodity details when absent', () => {
      mockStore({
        currentTrade: makeTrade({ buyerLossBps: 3000, sellerLossBps: 7000 }),
      });
      const { getByText, queryByText } = renderScreen();

      expect(getByText('Buyer 3000 / Seller 7000 bps')).toBeTruthy();
      expect(queryByText('Commodity')).toBeNull();
      expect(queryByText('Quantity')).toBeNull();
      expect(queryByText('Updated')).toBeNull();
    });

    it.each<[TradeStatus, string]>([
      ['PENDING', 'Pending'],
      ['FUNDED', 'Funded'],
      ['IN_TRANSIT', 'In Transit'],
      ['DELIVERED', 'Delivered'],
      ['DISPUTED', 'Disputed'],
      ['COMPLETED', 'Completed'],
      ['REFUNDED', 'Refunded'],
    ])('labels a %s trade "%s"', (status, label) => {
      mockStore({ currentTrade: makeTrade({ status }) });
      const { getAllByText } = renderScreen();

      // The status badge, plus a timeline step for the lifecycle statuses.
      expect(getAllByText(label).length).toBeGreaterThanOrEqual(1);
    });

    it('appends terminal steps to the timeline for disputed and refunded trades', () => {
      mockStore({ currentTrade: makeTrade({ status: 'PENDING' }) });
      const pending = renderScreen();
      expect(pending.getAllByText('Pending')).toHaveLength(1);
      pending.unmount();

      mockStore({ currentTrade: makeTrade({ status: 'DISPUTED' }) });
      const disputed = renderScreen();
      // badge + timeline step
      expect(disputed.getAllByText('Disputed')).toHaveLength(2);
      disputed.unmount();

      mockStore({ currentTrade: makeTrade({ status: 'REFUNDED' }) });
      const refunded = renderScreen();
      expect(refunded.getAllByText('Refunded')).toHaveLength(2);
    });
  });

  describe('available actions per status', () => {
    const DEPOSIT = '💰 Deposit Funds';
    const CONFIRM = '✅ Confirm Delivery';
    const RELEASE = '💸 Release Funds';
    const DISPUTE = '⚠️ Initiate Dispute';
    const EVIDENCE = '📹 Upload Evidence';
    const NONE = 'No actions available for this trade status.';
    const ALL = [DEPOSIT, CONFIRM, RELEASE, DISPUTE, EVIDENCE, NONE];

    it.each<[TradeStatus, string[]]>([
      ['PENDING', [DEPOSIT]],
      ['FUNDED', [CONFIRM, DISPUTE]],
      ['IN_TRANSIT', [CONFIRM, DISPUTE]],
      ['DELIVERED', [RELEASE, DISPUTE]],
      ['DISPUTED', [EVIDENCE]],
      ['COMPLETED', [NONE]],
      ['REFUNDED', [NONE]],
    ])('%s shows exactly the right actions', (status, visible) => {
      mockStore({ currentTrade: makeTrade({ status }) });
      const { queryByText } = renderScreen();

      for (const label of ALL) {
        if (visible.includes(label)) {
          expect(queryByText(label)).toBeTruthy();
        } else {
          expect(queryByText(label)).toBeNull();
        }
      }
    });
  });

  describe('action interactions', () => {
    it('deposits only after the confirmation alert is accepted', async () => {
      mockStore({ currentTrade: makeTrade({ status: 'PENDING' }) });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('💰 Deposit Funds'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Deposit Funds',
        'Send the trade amount to the escrow contract?',
        expect.any(Array),
      );
      expect(deposit).not.toHaveBeenCalled();

      const [cancel, accept] = lastAlertButtons();
      expect(cancel.style).toBe('cancel');
      expect(cancel.onPress).toBeUndefined();
      await act(async () => {
        await accept.onPress?.();
      });

      expect(deposit).toHaveBeenCalledWith(TRADE_ID);
    });

    it('confirms delivery only after the confirmation alert is accepted', async () => {
      mockStore({ currentTrade: makeTrade({ status: 'IN_TRANSIT' }) });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('✅ Confirm Delivery'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Confirm Delivery',
        expect.stringContaining('received the goods'),
        expect.any(Array),
      );
      expect(confirmDelivery).not.toHaveBeenCalled();

      await act(async () => {
        await lastAlertButtons()[1].onPress?.();
      });

      expect(confirmDelivery).toHaveBeenCalledWith(TRADE_ID);
    });

    it('releases funds through a destructive confirmation alert', async () => {
      mockStore({ currentTrade: makeTrade({ status: 'DELIVERED' }) });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('💸 Release Funds'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Release Funds',
        expect.stringContaining('cannot be undone'),
        expect.any(Array),
      );
      const release = lastAlertButtons()[1];
      expect(release.style).toBe('destructive');
      expect(releaseFunds).not.toHaveBeenCalled();

      await act(async () => {
        await release.onPress?.();
      });

      expect(releaseFunds).toHaveBeenCalledWith(TRADE_ID);
    });

    it('swaps the action label for a spinner while the action is running', async () => {
      mockStore({ currentTrade: makeTrade({ status: 'PENDING' }) });
      let finish: () => void = () => undefined;
      deposit.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const { getByText, queryByText, UNSAFE_getAllByType } = renderScreen();
      fireEvent.press(getByText('💰 Deposit Funds'));

      let pending!: Promise<void>;
      act(() => {
        pending = Promise.resolve(lastAlertButtons()[1].onPress?.());
      });

      expect(queryByText('💰 Deposit Funds')).toBeNull();
      expect(UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(0);

      await act(async () => {
        finish();
        await pending;
      });

      await waitFor(() => expect(getByText('💰 Deposit Funds')).toBeTruthy());
    });

    it('navigates to evidence capture for a disputed trade', () => {
      mockStore({ currentTrade: makeTrade({ status: 'DISPUTED' }) });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('📹 Upload Evidence'));

      expect(navigation.navigate).toHaveBeenCalledWith('EvidenceCapture', {
        tradeId: TRADE_ID,
      });
    });

    it('navigates back from the header', () => {
      const { getByText } = renderScreen();

      fireEvent.press(getByText('← Back'));

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispute modal', () => {
    function openModal() {
      const utils = renderScreen();
      fireEvent.press(utils.getByText('⚠️ Initiate Dispute'));
      return utils;
    }

    it('is hidden until "Initiate Dispute" is pressed', () => {
      const { queryByText, getByText } = renderScreen();
      expect(queryByText('Describe the issue with this trade:')).toBeNull();

      fireEvent.press(getByText('⚠️ Initiate Dispute'));

      expect(getByText('Describe the issue with this trade:')).toBeTruthy();
    });

    it('rejects a blank reason without calling the store', async () => {
      const { getByText, getByPlaceholderText } = openModal();
      fireEvent.changeText(
        getByPlaceholderText(/Goods arrived damaged/),
        '   ',
      );

      await act(async () => {
        fireEvent.press(getByText('Submit'));
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Reason required',
        'Please describe the issue before submitting a dispute.',
      );
      expect(initiateDispute).not.toHaveBeenCalled();
      // Modal stays open so the user can fix the input.
      expect(getByText('Describe the issue with this trade:')).toBeTruthy();
    });

    it('submits the trimmed reason, then closes and resets the modal', async () => {
      const { getByText, queryByText, getByPlaceholderText } = openModal();
      fireEvent.changeText(
        getByPlaceholderText(/Goods arrived damaged/),
        '  Goods arrived damaged  ',
      );

      await act(async () => {
        fireEvent.press(getByText('Submit'));
      });

      expect(initiateDispute).toHaveBeenCalledWith(
        TRADE_ID,
        'Goods arrived damaged',
      );
      await waitFor(() =>
        expect(queryByText('Describe the issue with this trade:')).toBeNull(),
      );

      // Reopening shows an empty field again.
      fireEvent.press(getByText('⚠️ Initiate Dispute'));
      expect(getByPlaceholderText(/Goods arrived damaged/).props.value).toBe('');
    });

    it('cancel closes the modal and discards the draft without submitting', () => {
      const { getByText, queryByText, getByPlaceholderText } = openModal();
      fireEvent.changeText(getByPlaceholderText(/Goods arrived damaged/), 'draft');

      fireEvent.press(getByText('Cancel'));

      expect(queryByText('Describe the issue with this trade:')).toBeNull();
      expect(initiateDispute).not.toHaveBeenCalled();

      fireEvent.press(getByText('⚠️ Initiate Dispute'));
      expect(getByPlaceholderText(/Goods arrived damaged/).props.value).toBe('');
    });
  });

  describe('error banner', () => {
    it('shows a load error above the content and offers a retry', () => {
      mockStore({ errorView: makeView({ action: 'retry' }) });
      const { getByTestId, getByText } = renderScreen();
      expect(getByTestId('admin-error-banner')).toBeTruthy();
      // The trade itself is still rendered beneath the banner.
      expect(getByText('Trade Info')).toBeTruthy();

      fireEvent.press(getByTestId('admin-error-banner-primary-retry'));

      expect(fetchTrade).toHaveBeenCalledTimes(2);
    });

    it('prefers a mutation error over a stale load error', () => {
      mockStore({
        errorView: makeView({ title: 'Load failed' }),
        lastActionErrorView: makeView({ title: 'Deposit failed' }),
      });
      const { getByText, queryByText } = renderScreen();

      expect(getByText('Deposit failed')).toBeTruthy();
      expect(queryByText('Load failed')).toBeNull();
    });

    it('does not offer "Try again" for an action error', () => {
      mockStore({
        lastActionErrorView: makeView({
          title: 'Deposit failed',
          action: 'retry',
        }),
      });
      const { queryByText, getByLabelText } = renderScreen();

      // Action errors must be re-fired from the action buttons themselves,
      // so the banner falls back to its "Contact support" escape hatch.
      expect(queryByText('Try again')).toBeNull();
      fireEvent.press(getByLabelText('Contact support'));
      expect(fetchTrade).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledTimes(1);
    });

    it('clears the error from the banner "Go back" button', () => {
      mockStore({ errorView: makeView({ action: 'go_back' }) });
      const { getByTestId } = renderScreen();

      fireEvent.press(getByTestId('admin-error-banner-primary-go_back'));

      expect(clearErrorView).toHaveBeenCalledTimes(1);
    });

    it('signs out from the banner when the session expired', async () => {
      mockStore({
        errorView: makeView({
          action: 'sign_out_required',
          code: 'AUTH_ERROR',
        }),
      });
      const { getByTestId } = renderScreen();

      await act(async () => {
        fireEvent.press(
          getByTestId('admin-error-banner-primary-sign_out_required'),
        );
      });

      expect(clearAuth).toHaveBeenCalledTimes(1);
    });

    it('opens a support mailto carrying the error code and request id', () => {
      mockStore({
        errorView: makeView({ code: 'INTERNAL_ERROR', requestId: 'req-77' }),
      });
      const { getByTestId } = renderScreen();

      fireEvent.press(getByTestId('admin-error-banner-secondary'));

      expect(openURL).toHaveBeenCalledTimes(1);
      const url = decodeURIComponent(openURL.mock.calls[0][0] as string);
      expect(url).toMatch(/^mailto:/);
      expect(url).toContain('trade detail');
      expect(url).toContain('Error code: INTERNAL_ERROR');
      expect(url).toContain('Request id: req-77');
    });
  });
});
