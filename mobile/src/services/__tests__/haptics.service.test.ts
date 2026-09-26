import * as Haptics from 'expo-haptics';

import {
  hapticKindForNotification,
  hapticKindForStatus,
  isTradeStatusTransition,
  triggerNotificationHaptic,
  triggerTradeStatusHaptic,
} from '../haptics.service';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

const notificationAsync = Haptics.notificationAsync as jest.MockedFunction<
  typeof Haptics.notificationAsync
>;
const impactAsync = Haptics.impactAsync as jest.MockedFunction<typeof Haptics.impactAsync>;

beforeEach(() => {
  jest.clearAllMocks();
  notificationAsync.mockResolvedValue(undefined);
  impactAsync.mockResolvedValue(undefined);
});

describe('isTradeStatusTransition', () => {
  it('is true only when the status actually changes', () => {
    expect(isTradeStatusTransition('PENDING', 'FUNDED')).toBe(true);
    expect(isTradeStatusTransition('FUNDED', 'FUNDED')).toBe(false);
    expect(isTradeStatusTransition(null, 'FUNDED')).toBe(false);
    expect(isTradeStatusTransition(undefined, 'FUNDED')).toBe(false);
    expect(isTradeStatusTransition('FUNDED', undefined)).toBe(false);
  });
});

describe('hapticKindForStatus', () => {
  it('uses success for settled/completed outcomes', () => {
    expect(hapticKindForStatus('COMPLETED')).toBe('success');
  });

  it('uses warning for dispute/refund outcomes', () => {
    expect(hapticKindForStatus('DISPUTED')).toBe('warning');
    expect(hapticKindForStatus('REFUNDED')).toBe('warning');
  });

  it('uses a light tap for ordinary progress transitions', () => {
    expect(hapticKindForStatus('FUNDED')).toBe('light');
    expect(hapticKindForStatus('DELIVERED')).toBe('light');
    expect(hapticKindForStatus('IN_TRANSIT')).toBe('light');
  });
});

describe('triggerTradeStatusHaptic', () => {
  it('fires a success notification haptic when a trade completes', async () => {
    await expect(triggerTradeStatusHaptic('COMPLETED')).resolves.toBe(true);
    expect(notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('fires a warning notification haptic for a dispute', async () => {
    await expect(triggerTradeStatusHaptic('DISPUTED')).resolves.toBe(true);
    expect(notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
  });

  it('fires a light impact tap for a funded/delivered transition', async () => {
    await expect(triggerTradeStatusHaptic('FUNDED')).resolves.toBe(true);
    await expect(triggerTradeStatusHaptic('DELIVERED')).resolves.toBe(true);
    expect(impactAsync).toHaveBeenCalledTimes(2);
    expect(impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it('never throws when the platform cannot vibrate', async () => {
    impactAsync.mockRejectedValueOnce(new Error('haptics unavailable'));
    await expect(triggerTradeStatusHaptic('FUNDED')).resolves.toBe(false);
  });
});

describe('hapticKindForNotification / triggerNotificationHaptic', () => {
  it('maps trade notifications to a light tap and disputes to a warning', () => {
    expect(hapticKindForNotification('trade')).toBe('light');
    expect(hapticKindForNotification('dispute')).toBe('warning');
    expect(hapticKindForNotification('general')).toBeNull();
    expect(hapticKindForNotification(undefined)).toBeNull();
  });

  it('fires the matching haptic for a foreground trade notification', async () => {
    await expect(triggerNotificationHaptic('trade')).resolves.toBe(true);
    expect(impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);

    await expect(triggerNotificationHaptic('dispute')).resolves.toBe(true);
    expect(notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
  });

  it('does nothing for general/unknown notifications', async () => {
    await expect(triggerNotificationHaptic('general')).resolves.toBe(false);
    await expect(triggerNotificationHaptic(undefined)).resolves.toBe(false);
    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });
});
