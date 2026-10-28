import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';

import { setAuthToken } from '../api/client';

const REMEMBERED_WALLET_KEY = 'amana_remembered_wallet';

const DEFAULT_E2E_WALLET_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001';

function isE2EBuild(): boolean {
  return process.env.EXPO_PUBLIC_E2E_MODE === 'true';
}

export type AuthRole = 'admin' | 'user' | null;

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isLoading: boolean;
  /**
   * Role of the signed-in wallet, used by the Admin* screens to gate
   * admin-only UI.
   *
   * NOTE: this is currently never populated — the backend JWT carries no
   * `role` claim (see `AuthService.generateToken`, which signs only
   * sub/walletAddress/jti/tv/iss/aud/iat/nbf/exp), so there is nothing to
   * derive this from at login yet. Until role plumbing lands, `role` stays
   * `null` and the admin screens render their "Admin access required"
   * fallback. Treat the screens as gated-but-not-yet-wired, not as working
   * admin UI.
   */
  role: AuthRole;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => void;
  setRole: (role: AuthRole) => void;
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
  role: null,

  setRole: (role: AuthRole) => {
    set({ role });
  },

  setToken: async (token: string) => {
    await SecureStore.setItemAsync('amana_token', token);
    setAuthToken(token);
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
      if (isE2EBuild()) {
        // E2E builds use compile-time Expo variables so the native bridge is
        // not needed during Detox startup. A dedicated URL lets smoke tests
        // still exercise the unauthenticated route.
        let initialUrl: string | null = null;
        try {
          initialUrl = await Linking.getInitialURL();
        } catch {
          // Linking is unavailable in unit-test environments.
        }

        if (initialUrl?.includes('/e2e/unauth')) {
          await SecureStore.deleteItemAsync('amana_token');
          setAuthToken(null);
          set({ token: null, walletAddress: null, role: null });
          return null;
        }

        const mockToken = process.env.EXPO_PUBLIC_E2E_MOCK_JWT || 'e2e-token';
        const walletAddress =
          process.env.EXPO_PUBLIC_E2E_MOCK_WALLET_ADDRESS ||
          DEFAULT_E2E_WALLET_ADDRESS;

        await SecureStore.setItemAsync('amana_token', mockToken);
        setAuthToken(mockToken);
        set({ token: mockToken, walletAddress });
        return mockToken;
      }

      const token = await SecureStore.getItemAsync('amana_token');
      setAuthToken(token);
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
    setAuthToken(null);
    set({ token: null, walletAddress: null, role: null });
  },
}));
