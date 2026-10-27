import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { LaunchArguments } from 'react-native-launch-arguments';

import { setAuthToken } from '../api/client';

const REMEMBERED_WALLET_KEY = 'amana_remembered_wallet';

interface E2ELaunchArguments {
  E2E_MODE?: string;
  E2E_MOCK_JWT?: string;
  E2E_MOCK_WALLET_ADDRESS?: string;
}

function getE2ELaunchArguments(): E2ELaunchArguments {
  try {
    return LaunchArguments.value<E2ELaunchArguments>();
  } catch {
    // The native bridge is unavailable in unit-test environments.
    return {};
  }
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
      const launchArgs = getE2ELaunchArguments();

      // Detox launch arguments are the source of truth for E2E auth. Clear
      // persisted state when a test explicitly launches unauthenticated so
      // tests remain isolated across app reloads.
      if (launchArgs.E2E_MODE === 'true') {
        const mockToken = launchArgs.E2E_MOCK_JWT;
        const walletAddress = launchArgs.E2E_MOCK_WALLET_ADDRESS ?? null;

        if (mockToken) {
          await SecureStore.setItemAsync('amana_token', mockToken);
          setAuthToken(mockToken);
          set({ token: mockToken, walletAddress });
          return mockToken;
        }

        await SecureStore.deleteItemAsync('amana_token');
        setAuthToken(null);
        set({ token: null, walletAddress: null, role: null });
        return null;
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
