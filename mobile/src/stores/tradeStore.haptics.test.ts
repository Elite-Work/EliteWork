/**
 * Issue #124 — trade status transition haptics, wired through the trade store.
 *
 * The store is the single place that observes a status change while the app is
 * open (initial load, manual refresh, or a post-action refresh), so these tests
 * lock in the "transition only, never a first observation" behavior end to end:
 * store → haptics.service → expo-haptics.
 */

import { act } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { useTradeStore } from './tradeStore';
import { tradeApi } from '../api/trade';
import type { Trade } from '../types/trade';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('../api/trade', () => ({
  tradeApi: {
    listTrades: jest.fn(),
    getTrade: jest.fn(),
    createTrade: jest.fn(),
    confirmDelivery: jest.fn(),
    releaseFunds: jest.fn(),
    deposit: jest.fn(),
    initiateDispute: jest.fn(),
  },
}));

const mockGet = tradeApi.getTrade as jest.MockedFunction<typeof tradeApi.getTrade>;
const impactAsync = Haptics.impactAsync as jest.MockedFunction<typeof Haptics.impactAsync>;
const notificationAsync = Haptics.notificationAsync as jest.MockedFunction<
  typeof Haptics.notificationAsync
>;

function makeTrade(status: Trade['status'], tradeId = 'trade-1'): Trade {
  return {
    id: 1,
    tradeId,
    buyerAddress: 'gbuyer',
    sellerAddress: 'gseller',
    amountUsdc: '100',
    status,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  impactAsync.mockResolvedValue(undefined);
  notificationAsync.mockResolvedValue(undefined);
  act(() => {
    useTradeStore.setState({
      isLoading: false,
      trades: [],
      total: 0,
      currentTrade: null,
      errorView: null,
      lastActionErrorView: null,
    });
  });
});

describe('trade status transition haptics', () => {
  it('does not fire a haptic on the first observation of a trade', async () => {
    mockGet.mockResolvedValueOnce(makeTrade('PENDING'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-1');
    });
    await flush();

    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it('fires a light tap when a refreshed trade moves PENDING → FUNDED', async () => {
    act(() => {
      useTradeStore.setState({ currentTrade: makeTrade('PENDING') });
    });
    mockGet.mockResolvedValueOnce(makeTrade('FUNDED'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-1');
    });
    await flush();

    expect(impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('fires a success haptic when a refreshed trade completes', async () => {
    act(() => {
      useTradeStore.setState({ currentTrade: makeTrade('DELIVERED') });
    });
    mockGet.mockResolvedValueOnce(makeTrade('COMPLETED'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-1');
    });
    await flush();

    expect(notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  it('fires a warning haptic when a trade becomes disputed', async () => {
    act(() => {
      useTradeStore.setState({ currentTrade: makeTrade('FUNDED') });
    });
    mockGet.mockResolvedValueOnce(makeTrade('DISPUTED'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-1');
    });
    await flush();

    expect(notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
  });

  it('does not fire when the status is unchanged', async () => {
    act(() => {
      useTradeStore.setState({ currentTrade: makeTrade('FUNDED') });
    });
    mockGet.mockResolvedValueOnce(makeTrade('FUNDED'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-1');
    });
    await flush();

    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it('does not treat a different trade id as a transition', async () => {
    act(() => {
      useTradeStore.setState({ currentTrade: makeTrade('PENDING', 'trade-1') });
    });
    mockGet.mockResolvedValueOnce(makeTrade('FUNDED', 'trade-2'));

    await act(async () => {
      await useTradeStore.getState().fetchTrade('trade-2');
    });
    await flush();

    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });
});
