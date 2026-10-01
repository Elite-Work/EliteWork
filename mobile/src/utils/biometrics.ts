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
