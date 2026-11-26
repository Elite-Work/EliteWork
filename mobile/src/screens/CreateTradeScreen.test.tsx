/**
 * CreateTradeScreen.test.tsx — #277
 *
 * Covers the primary render states (Step 1 Details, Step 2 Negotiation,
 * Step 3 Review & Submit, draft restoration, submitting indicator) and
 * key interactions (form validation, total calculation, loss-ratio controls,
 * step navigation, draft persistence, and trade creation success/error flows).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Alert } from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import CreateTradeScreen from './CreateTradeScreen';
import { useTradeStore } from '../stores/tradeStore';
import {
  clearTradeDraft,
  loadTradeDraft,
  saveTradeDraft,
} from '../utils/tradeDraft';
import type { RootStackParamList } from '../types/navigation';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/tradeStore', () => ({
  useTradeStore: jest.fn(),
}));

jest.mock('../utils/tradeDraft', () => ({
  loadTradeDraft: jest.fn(),
  saveTradeDraft: jest.fn(),
  clearTradeDraft: jest.fn(),
}));

type ScreenProps = StackScreenProps<RootStackParamList, 'CreateTrade'>;

const VALID_SELLER = 'G'.padEnd(56, 'A');

describe('CreateTradeScreen (#277)', () => {
  const mockCreateTrade = jest.fn();
  const mockGoBack = jest.fn();
  const mockReplace = jest.fn();
  let alertSpy: jest.SpyInstance;

  function renderScreen() {
    const navigation = {
      goBack: mockGoBack,
      replace: mockReplace,
      navigate: jest.fn(),
    } as unknown as ScreenProps['navigation'];
    const route = {
      key: 'CreateTrade-1',
      name: 'CreateTrade',
      params: undefined,
    } as ScreenProps['route'];

    return render(<CreateTradeScreen navigation={navigation} route={route} />);
  }

  async function fillStep1AndContinue(
    utils: ReturnType<typeof renderScreen>,
    overrides: {
      commodityTestId?: string;
      quantity?: string;
      price?: string;
      seller?: string;
    } = {},
  ) {
    await waitFor(() => expect(loadTradeDraft).toHaveBeenCalledTimes(1));

    fireEvent.press(
      utils.getByTestId(overrides.commodityTestId ?? 'trade-commodity-maize'),
    );
    fireEvent.changeText(
      utils.getByTestId('trade-quantity-input'),
      overrides.quantity ?? '500',
    );
    fireEvent.changeText(
      utils.getByTestId('trade-price-input'),
      overrides.price ?? '450',
    );
    fireEvent.changeText(
      utils.getByTestId('trade-seller-input'),
      overrides.seller ?? VALID_SELLER,
    );
    fireEvent.press(utils.getByTestId('trade-continue-button'));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (loadTradeDraft as jest.Mock).mockResolvedValue(null);
    (saveTradeDraft as jest.Mock).mockResolvedValue(undefined);
    (clearTradeDraft as jest.Mock).mockResolvedValue(undefined);
    (useTradeStore as unknown as jest.Mock).mockReturnValue({
      createTrade: mockCreateTrade,
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  describe('Step 1: Details render and validation', () => {
    it('renders Step 1 with commodities, unit chips, empty total, and disabled Continue', async () => {
      const { getByText, getByTestId } = renderScreen();
      await waitFor(() => expect(loadTradeDraft).toHaveBeenCalledTimes(1));

      expect(getByText('Create Trade')).toBeTruthy();
      expect(getByText('Step 1: Details')).toBeTruthy();
      expect(getByText('Maize')).toBeTruthy();
      expect(getByText('Soybean')).toBeTruthy();
      expect(getByText('kg')).toBeTruthy();
      expect(getByText('tonnes')).toBeTruthy();
      expect(getByText('—')).toBeTruthy();
      expect(getByTestId('trade-continue-button').props.accessibilityState?.disabled ?? getByTestId('trade-continue-button').props.disabled).toBeTruthy();
    });

    it('calculates Estimated Total and enables Continue only when all fields are valid', async () => {
      const { getByText, getByTestId } = renderScreen();
      await waitFor(() => expect(loadTradeDraft).toHaveBeenCalledTimes(1));

      fireEvent.press(getByTestId('trade-commodity-rice'));
      fireEvent.changeText(getByTestId('trade-quantity-input'), '100');
      fireEvent.changeText(getByTestId('trade-price-input'), '250');

      expect(getByText(`NGN ${(25000).toLocaleString()}`)).toBeTruthy();

      // Invalid Stellar address keeps Continue disabled.
      fireEvent.changeText(getByTestId('trade-seller-input'), 'GSHORT');
      expect(getByTestId('trade-continue-button').props.disabled).toBe(true);

      // Valid 56-char G... address enables Continue.
      fireEvent.changeText(getByTestId('trade-seller-input'), VALID_SELLER);
      expect(getByTestId('trade-continue-button').props.disabled).toBe(false);
    });

    it('navigates back when header Back is pressed on Step 1', async () => {
      const { getByText } = renderScreen();
      await waitFor(() => expect(loadTradeDraft).toHaveBeenCalledTimes(1));

      fireEvent.press(getByText('← Back'));
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Step 2: Negotiation & Step 3: Review interactions', () => {
    it('adjusts buyer/seller loss ratio within 0..100 bounds and advances to Step 3', async () => {
      const utils = renderScreen();
      await fillStep1AndContinue(utils);

      expect(utils.getByText('Step 2: Negotiation')).toBeTruthy();
      expect(utils.getByText('50 / 50')).toBeTruthy();

      fireEvent.press(utils.getByText('+10%'));
      expect(utils.getByText('60 / 40')).toBeTruthy();

      fireEvent.press(utils.getByText('−10%'));
      fireEvent.press(utils.getByText('−10%'));
      expect(utils.getByText('40 / 60')).toBeTruthy();

      // Clamp at 0 / 100
      for (let i = 0; i < 6; i++) {
        fireEvent.press(utils.getByText('−10%'));
      }
      expect(utils.getByText('0 / 100')).toBeTruthy();

      // Clamp at 100 / 0
      for (let i = 0; i < 12; i++) {
        fireEvent.press(utils.getByText('+10%'));
      }
      expect(utils.getByText('100 / 0')).toBeTruthy();

      fireEvent.changeText(utils.getByTestId('trade-delivery-days-input'), '14');
      fireEvent.press(utils.getByText('Review'));

      expect(utils.getByText('Step 3: Review & Submit')).toBeTruthy();
      expect(utils.getByText('Maize')).toBeTruthy();
      expect(utils.getByText('500 kg')).toBeTruthy();
      expect(utils.getByText(`NGN ${(225000).toLocaleString()}`)).toBeTruthy();
      expect(utils.getByText(VALID_SELLER)).toBeTruthy();
      expect(utils.getByText('Buyer 100% / Seller 0%')).toBeTruthy();
      expect(utils.getByText('14 days')).toBeTruthy();
    });

    it('allows returning to previous steps via step Back and header Back buttons', async () => {
      const utils = renderScreen();
      await fillStep1AndContinue(utils);

      expect(utils.getByText('Step 2: Negotiation')).toBeTruthy();
      fireEvent.press(utils.getByText('Back'));
      expect(utils.getByText('Step 1: Details')).toBeTruthy();

      fireEvent.press(utils.getByTestId('trade-continue-button'));
      fireEvent.press(utils.getByText('Review'));
      expect(utils.getByText('Step 3: Review & Submit')).toBeTruthy();

      fireEvent.press(utils.getByText('← Back'));
      expect(utils.getByText('Step 2: Negotiation')).toBeTruthy();
    });
  });

  describe('Draft restoration and persistence', () => {
    it('restores a saved draft and step on mount and persists updates', async () => {
      (loadTradeDraft as jest.Mock).mockResolvedValue({
        step: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        data: {
          commodity: 'Cassava',
          quantity: '200',
          unit: 'tonnes',
          pricePerUnit: '300',
          sellerAddress: VALID_SELLER,
          buyerRatio: 70,
          sellerRatio: 30,
          deliveryDays: '10',
        },
      });

      const { getByText } = renderScreen();

      await waitFor(() => expect(getByText('Step 2: Negotiation')).toBeTruthy());
      expect(getByText('70 / 30')).toBeTruthy();

      fireEvent.press(getByText('+10%'));
      await waitFor(() =>
        expect(saveTradeDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            commodity: 'Cassava',
            buyerRatio: 80,
            sellerRatio: 20,
          }),
          1,
        ),
      );
    });
  });

  describe('Trade submission', () => {
    it('creates trade, clears draft, alerts, and navigates to TradeDetail on success', async () => {
      mockCreateTrade.mockResolvedValue({ tradeId: 'trade-999' });
      const utils = renderScreen();

      await fillStep1AndContinue(utils);
      fireEvent.press(utils.getByText('Review'));

      await act(async () => {
        fireEvent.press(utils.getByText('Create Trade'));
      });

      expect(mockCreateTrade).toHaveBeenCalledWith({
        sellerAddress: VALID_SELLER,
        amountUsdc: '225000',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
        commodity: 'Maize',
        quantity: '500',
        unit: 'kg',
      });
      expect(clearTradeDraft).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        'Trade Created',
        'Trade trade-999 has been created. Sign the transaction with your wallet to deposit funds.',
      );
      expect(mockReplace).toHaveBeenCalledWith('TradeDetail', {
        tradeId: 'trade-999',
      });
    });

    it('shows loading spinner while submitting and prevents duplicate navigation on null result', async () => {
      let resolveSubmit!: (val: null) => void;
      mockCreateTrade.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSubmit = resolve;
          }),
      );

      const utils = renderScreen();
      await fillStep1AndContinue(utils);
      fireEvent.press(utils.getByText('Review'));

      fireEvent.press(utils.getByText('Create Trade'));
      expect(utils.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

      await act(async () => {
        resolveSubmit(null);
      });

      expect(clearTradeDraft).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Failed to create trade. Please try again.',
      );
    });

    it('shows error alert when createTrade throws an error', async () => {
      mockCreateTrade.mockRejectedValue(new Error('Insufficient cNGN balance'));
      const utils = renderScreen();

      await fillStep1AndContinue(utils);
      fireEvent.press(utils.getByText('Review'));

      await act(async () => {
        fireEvent.press(utils.getByText('Create Trade'));
      });

      expect(clearTradeDraft).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'Insufficient cNGN balance',
      );
    });
  });
});
