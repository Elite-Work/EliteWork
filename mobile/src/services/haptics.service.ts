/**
 * Trade status haptics (Issue #124).
 *
 * Mobile UX convention: a state change gets a subtle physical confirmation
 * alongside the visual toast/notification. This module maps a trade status
 * transition to the right (and deliberately gentle) haptic:
 *
 *   - terminal / settled outcomes → a success notification tap
 *   - disputes / refunds         → a warning notification tap
 *   - every other transition     → a light impact tap
 *
 * Haptics are best-effort: they are available only on physical devices, so the
 * helpers never throw and resolve to `false` when the platform cannot vibrate
 * (web, simulators, unsupported hardware, missing permissions).
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { TradeStatus } from '../types/trade';

export type NotificationKind = 'trade' | 'dispute' | 'general';

/** Haptic treatment for each trade status. */
export type HapticKind = 'success' | 'warning' | 'light';

const HAPTIC_BY_STATUS: Record<TradeStatus, HapticKind> = {
  PENDING: 'light',
  FUNDED: 'light',
  IN_TRANSIT: 'light',
  DELIVERED: 'light',
  DISPUTED: 'warning',
  COMPLETED: 'success',
  REFUNDED: 'warning',
};

/** Haptic treatment for a foreground trade notification. */
const HAPTIC_BY_NOTIFICATION: Record<NotificationKind, HapticKind | null> = {
  trade: 'light',
  dispute: 'warning',
  general: null,
};

/**
 * True when `next` represents an actual status change from a known previous
 * status. A first observation (no previous status) is not a transition, so a
 * cold open never fires a spurious tap.
 */
export function isTradeStatusTransition(
  previous: TradeStatus | null | undefined,
  next: TradeStatus | null | undefined,
): boolean {
  return Boolean(previous && next && previous !== next);
}

export function hapticKindForStatus(status: TradeStatus): HapticKind {
  return HAPTIC_BY_STATUS[status] ?? 'light';
}

export function hapticKindForNotification(
  type: NotificationKind | undefined,
): HapticKind | null {
  if (!type) return null;
  return HAPTIC_BY_NOTIFICATION[type] ?? null;
}

async function fire(kind: HapticKind): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    switch (kind) {
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return true;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return true;
      case 'light':
      default:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return true;
    }
  } catch {
    // Haptics are decorative — never let an unsupported device break a status
    // update or the notification handler.
    return false;
  }
}

/**
 * Fire the haptic that matches a trade status transition.
 * Safe to `void` from any status-update path.
 */
export function triggerTradeStatusHaptic(status: TradeStatus): Promise<boolean> {
  return fire(hapticKindForStatus(status));
}

/**
 * Fire the haptic that matches a trade notification received while the app is
 * in the foreground (alongside the visible notification).
 */
export function triggerNotificationHaptic(
  type: NotificationKind | undefined,
): Promise<boolean> {
  const kind = hapticKindForNotification(type);
  return kind ? fire(kind) : Promise.resolve(false);
}
