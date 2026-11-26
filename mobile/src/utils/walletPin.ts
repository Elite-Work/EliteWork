import * as SecureStore from 'expo-secure-store';

/**
 * Wallet PIN used as the fallback unlock path when biometrics fail (#511).
 *
 * The PIN never leaves the device: it is written to SecureStore, which is
 * backed by the iOS Keychain / Android Keystore, and compared in-process. It
 * is deliberately a local convenience gate for the *remembered* wallet
 * address, not a secret that authorises on-chain actions (signing always
 * happens in the wallet app), so the keystore copy is the source of truth.
 */

const WALLET_PIN_KEY = 'amana_wallet_pin';

export const WALLET_PIN_MIN_LENGTH = 4;
export const WALLET_PIN_MAX_LENGTH = 6;

/** A wallet PIN is 4–6 digits. */
export function isValidWalletPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${WALLET_PIN_MIN_LENGTH},${WALLET_PIN_MAX_LENGTH}}$`).test(pin);
}

/** True when this device already has a PIN that can unlock the wallet. */
export async function hasWalletPin(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(WALLET_PIN_KEY)) !== null;
  } catch (error) {
    console.error('Failed to read wallet PIN state:', error);
    return false;
  }
}

/** Stores a new PIN. Throws when the value is not 4–6 digits. */
export async function setWalletPin(pin: string): Promise<void> {
  if (!isValidWalletPinFormat(pin)) {
    throw new Error(
      `Wallet PIN must be ${WALLET_PIN_MIN_LENGTH}–${WALLET_PIN_MAX_LENGTH} digits`,
    );
  }
  await SecureStore.setItemAsync(WALLET_PIN_KEY, pin);
}

/** Removes the stored PIN (e.g. when the user forgets it). */
export async function clearWalletPin(): Promise<void> {
  await SecureStore.deleteItemAsync(WALLET_PIN_KEY);
}

/**
 * Compares `pin` against the stored value in constant time relative to the
 * stored length, so a wrong PIN does not leak its prefix through timing.
 * Returns false when no PIN is configured or the store is unreadable.
 */
export async function verifyWalletPin(pin: string): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(WALLET_PIN_KEY);
    if (stored === null) return false;
    return constantTimeEqual(stored, pin);
  } catch (error) {
    console.error('Failed to verify wallet PIN:', error);
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
