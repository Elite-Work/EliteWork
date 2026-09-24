import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const REMEMBERED_WALLET_KEY = 'amana_remembered_wallet';

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => void;
  getToken: () => Promise<string | null>;
  /**
   * Returns the last wallet address that successfully connected, even
   * across a logout — this is what powers the biometric "unlock" shortcut
   * on WalletConnectScreen (#57), so a returning user doesn't have to
   * retype their full public key after a fast re-auth.
   */
  getRememberedWalletAddress: () => Promise<string | null>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletAddress: null,
  isLoading: true,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync('amana_token', token);
    set({ token });
  },

  setWalletAddress: (address: string) => {
    set({ walletAddress: address });
    // Fire-and-forget: remembering the address is a convenience, not a
    // security boundary, so a write failure here shouldn't block login.
    SecureStore.setItemAsync(REMEMBERED_WALLET_KEY, address).catch((error) => {
      console.error('Failed to persist remembered wallet address:', error);
    });
  },

  getToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('amana_token');
      set({ token });
      return token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  },

  getRememberedWalletAddress: async () => {
    try {
      return await SecureStore.getItemAsync(REMEMBERED_WALLET_KEY);
    } catch (error) {
      console.error('Failed to retrieve remembered wallet address:', error);
      return null;
    }
  },

  clearAuth: async () => {
    // Intentionally leaves REMEMBERED_WALLET_KEY in place: signing out
    // ends the session, but the biometric-unlock shortcut for this
    // device/wallet pair should still work on the next launch.
    await SecureStore.deleteItemAsync('amana_token');
    set({ token: null, walletAddress: null });
  },
}));
