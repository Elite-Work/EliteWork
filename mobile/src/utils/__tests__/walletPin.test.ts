import * as SecureStore from 'expo-secure-store';

import {
  WALLET_PIN_MAX_LENGTH,
  clearWalletPin,
  hasWalletPin,
  isValidWalletPinFormat,
  setWalletPin,
  verifyWalletPin,
} from '../walletPin';

jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    __reset: () => {
      store = {};
    },
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

const secureStoreMock = SecureStore as unknown as typeof SecureStore & {
  __reset: () => void;
};

describe('walletPin', () => {
  beforeEach(() => {
    secureStoreMock.__reset();
    jest.clearAllMocks();
  });

  describe('isValidWalletPinFormat', () => {
    it('accepts 4 to 6 digits', () => {
      expect(isValidWalletPinFormat('1234')).toBe(true);
      expect(isValidWalletPinFormat('123456')).toBe(true);
    });

    it('rejects non-numeric, too short and too long values', () => {
      expect(isValidWalletPinFormat('123')).toBe(false);
      expect(isValidWalletPinFormat('1234567')).toBe(false);
      expect(isValidWalletPinFormat('12a4')).toBe(false);
      expect(isValidWalletPinFormat('')).toBe(false);
    });
  });

  it('reports whether a PIN is configured', async () => {
    await expect(hasWalletPin()).resolves.toBe(false);
    await setWalletPin('1234');
    await expect(hasWalletPin()).resolves.toBe(true);
  });

  it('stores the PIN in SecureStore', async () => {
    await setWalletPin('4321');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('amana_wallet_pin', '4321');
    await expect(SecureStore.getItemAsync('amana_wallet_pin')).resolves.toBe('4321');
  });

  it('refuses to store an invalid PIN', async () => {
    await expect(setWalletPin('12')).rejects.toThrow(/4–6 digits/);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('verifies only the exact PIN', async () => {
    await setWalletPin('1234');
    await expect(verifyWalletPin('1234')).resolves.toBe(true);
    await expect(verifyWalletPin('1235')).resolves.toBe(false);
    await expect(verifyWalletPin('123456')).resolves.toBe(false);
    await expect(WALLET_PIN_MAX_LENGTH).toBe(6);
  });

  it('returns false when no PIN has been set', async () => {
    await expect(verifyWalletPin('1234')).resolves.toBe(false);
  });

  it('removes the PIN on clear', async () => {
    await setWalletPin('1234');
    await clearWalletPin();
    await expect(hasWalletPin()).resolves.toBe(false);
    await expect(verifyWalletPin('1234')).resolves.toBe(false);
  });

  it('fails closed when SecureStore throws', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore down'));
    await expect(verifyWalletPin('1234')).resolves.toBe(false);
  });
});
