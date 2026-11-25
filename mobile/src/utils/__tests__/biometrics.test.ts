import * as LocalAuthentication from 'expo-local-authentication';

import {
  BIOMETRIC_ATTEMPTS_BEFORE_PIN,
  authenticateWithBiometrics,
  classifyBiometricFailure,
  isBiometricUnlockAvailable,
  shouldFallBackToPin,
} from '../biometrics';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;

describe('isBiometricUnlockAvailable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires both hardware and an enrollment', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    await expect(isBiometricUnlockAvailable()).resolves.toBe(true);

    mockIsEnrolled.mockResolvedValue(false);
    await expect(isBiometricUnlockAvailable()).resolves.toBe(false);

    mockHasHardware.mockResolvedValue(false);
    await expect(isBiometricUnlockAvailable()).resolves.toBe(false);
  });

  it('returns false when the native module throws', async () => {
    mockHasHardware.mockRejectedValue(new Error('unavailable'));
    await expect(isBiometricUnlockAvailable()).resolves.toBe(false);
  });
});

describe('authenticateWithBiometrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns success and passes the prompt message through', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });
    await expect(authenticateWithBiometrics('Unlock Amana')).resolves.toEqual({
      success: true,
    });
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Unlock Amana' }),
    );
  });

  it('returns the OS error when authentication fails', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, error: 'lockout' });
    await expect(authenticateWithBiometrics('Unlock Amana')).resolves.toEqual({
      success: false,
      error: 'lockout',
    });
  });
});

describe('classifyBiometricFailure', () => {
  it('counts ordinary failed attempts', () => {
    expect(classifyBiometricFailure('authentication_failed')).toBe('count');
    expect(classifyBiometricFailure(undefined)).toBe('count');
  });

  it('falls back immediately on lockout / enrollment problems', () => {
    expect(classifyBiometricFailure('lockout')).toBe('fallback');
    expect(classifyBiometricFailure('not_enrolled')).toBe('fallback');
    expect(classifyBiometricFailure('passcode_not_set')).toBe('fallback');
  });

  it('ignores user cancellations', () => {
    expect(classifyBiometricFailure('user_cancel')).toBe('ignore');
    expect(classifyBiometricFailure('system_cancel')).toBe('ignore');
    expect(classifyBiometricFailure('app_cancel')).toBe('ignore');
  });
});

describe('shouldFallBackToPin', () => {
  it('only trips after three failures', () => {
    expect(BIOMETRIC_ATTEMPTS_BEFORE_PIN).toBe(3);
    expect(shouldFallBackToPin(0)).toBe(false);
    expect(shouldFallBackToPin(2)).toBe(false);
    expect(shouldFallBackToPin(3)).toBe(true);
    expect(shouldFallBackToPin(4)).toBe(true);
  });
});
