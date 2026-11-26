import * as LocalAuthentication from 'expo-local-authentication';

/**
 * True when the device has usable biometric hardware (Face ID /
 * fingerprint) with at least one enrollment. Used to decide whether to
 * offer the biometric-unlock shortcut on WalletConnectScreen (#57).
 */
export async function isBiometricUnlockAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch (error) {
    console.error('Failed to check biometric availability:', error);
    return false;
  }
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
}

/** Prompts Face ID / fingerprint and resolves once the OS prompt is dismissed. */
export async function authenticateWithBiometrics(reason: string): Promise<BiometricAuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Use wallet address instead',
      disableDeviceFallback: false,
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Consecutive biometric failures tolerated before the wallet falls back to PIN
 * entry (#511). After this many failures the biometric button is replaced by
 * the PIN prompt so a user who cannot authenticate is never locked out.
 */
export const BIOMETRIC_ATTEMPTS_BEFORE_PIN = 3;

/** OS errors that mean "stop asking, use the PIN instead". */
const TERMINAL_BIOMETRIC_ERRORS = new Set([
  'lockout',
  'biometric_lockout',
  'not_enrolled',
  'not_available',
  'passcode_not_set',
]);

/**
 * Errors that are not the user failing to authenticate (they cancelled or the
 * prompt was dismissed) and therefore must not count towards the fallback.
 */
const NON_FAILURE_ERRORS = new Set(['user_cancel', 'system_cancel', 'app_cancel']);

export type BiometricFailureDisposition = 'count' | 'fallback' | 'ignore';

/**
 * Classifies a failed biometric result for the unlock screen:
 *  - `count`    — a genuine failed attempt; increment the failure counter.
 *  - `fallback` — the OS refused to prompt (lockout/not enrolled); go straight
 *                 to the PIN fallback rather than retrying.
 *  - `ignore`   — the user dismissed the prompt; do not count it.
 */
export function classifyBiometricFailure(error?: string): BiometricFailureDisposition {
  if (!error) return 'count';
  if (TERMINAL_BIOMETRIC_ERRORS.has(error)) return 'fallback';
  if (NON_FAILURE_ERRORS.has(error)) return 'ignore';
  return 'count';
}

/** True once the screen must switch from the biometric prompt to PIN entry. */
export function shouldFallBackToPin(failureCount: number): boolean {
  return failureCount >= BIOMETRIC_ATTEMPTS_BEFORE_PIN;
}
