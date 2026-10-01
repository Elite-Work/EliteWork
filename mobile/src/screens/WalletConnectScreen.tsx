import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import { authenticateWithBiometrics, isBiometricUnlockAvailable } from '../utils/biometrics';

type Props = StackScreenProps<RootStackParamList, 'WalletConnect'>;

export default function WalletConnectScreen({ navigation }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [rememberedAddress, setRememberedAddress] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const { setWalletAddress, setToken, getRememberedWalletAddress } = useAuthStore();

  // #57: offer a faster re-auth path for returning users instead of always
  // requiring the full "paste your address" flow.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [address, hardwareReady] = await Promise.all([
        getRememberedWalletAddress(),
        isBiometricUnlockAvailable(),
      ]);
      if (cancelled) return;
      setRememberedAddress(address);
      setBiometricsAvailable(hardwareReady);
    })();

    return () => {
      cancelled = true;
    };
  }, [getRememberedWalletAddress]);

  const authenticateAddress = async (address: string) => {
    const { challenge } = await authApi.generateChallenge(address);
    // On mobile we cannot sign with Freighter; we use the challenge as a demo token
    const { token } = await authApi.verifyChallenge(address, challenge);
    await setToken(token);
    setWalletAddress(address);
    navigation.replace('TradeList');
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // @stellar/freighter-api is browser-only; on mobile we prompt for manual address entry
      // In a production build this would use a deep-link wallet (e.g. LOBSTR, xBull)
      Alert.prompt(
        'Enter Wallet Address',
        'Paste your Stellar wallet public key (G…)',
        async (address) => {
          if (!address?.startsWith('G') || address.length < 56) {
            Alert.alert('Invalid address', 'Please enter a valid Stellar public key.');
            setConnecting(false);
            return;
          }

          try {
            await authenticateAddress(address);
          } catch (err: unknown) {
            Alert.alert('Connection failed', (err as Error)?.message ?? 'Unknown error');
          } finally {
            setConnecting(false);
          }
        },
        'plain-text'
      );
    } catch {
      setConnecting(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (!rememberedAddress) return;
    setUnlocking(true);
    try {
      const result = await authenticateWithBiometrics('Unlock Amana to continue trading');
      if (!result.success) {
        if (result.error && result.error !== 'user_cancel') {
          Alert.alert('Unlock failed', 'Please try again or connect your wallet manually.');
        }
        return;
      }
      await authenticateAddress(rememberedAddress);
    } catch (err: unknown) {
      Alert.alert('Connection failed', (err as Error)?.message ?? 'Unknown error');
    } finally {
      setUnlocking(false);
    }
  };

  const showBiometricUnlock = biometricsAvailable && !!rememberedAddress;
  const truncatedAddress = rememberedAddress
    ? `${rememberedAddress.slice(0, 4)}…${rememberedAddress.slice(-4)}`
    : '';

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>🌾</Text>
        <Text style={styles.title}>Amana</Text>
        <Text style={styles.subtitle}>Trust as a Service{'\n'}for Agricultural Products</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connect your Stellar Wallet</Text>
        <Text style={styles.cardBody}>
          Link your wallet to start trading securely with escrow-backed protection.
        </Text>

        {showBiometricUnlock && (
          <TouchableOpacity
            style={[styles.biometricButton, unlocking && styles.buttonDisabled]}
            onPress={handleBiometricUnlock}
            disabled={unlocking || connecting}
            accessibilityRole="button"
            accessibilityLabel={`Unlock with Face ID or fingerprint as ${truncatedAddress}`}
            accessibilityHint="Uses your device biometrics to reconnect without retyping your wallet address"
          >
            {unlocking ? (
              <ActivityIndicator color="#2d6a2d" />
            ) : (
              <Text style={styles.biometricButtonText}>🔐 Unlock as {truncatedAddress}</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, connecting && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={connecting || unlocking}
          accessibilityRole="button"
          accessibilityLabel="Connect wallet"
          accessibilityState={{ disabled: connecting || unlocking, busy: connecting }}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {showBiometricUnlock ? 'Use a different wallet' : 'Connect Wallet'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f0',
    justifyContent: 'center',
    padding: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 64,
    marginBottom: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1a3a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#4a6a4a',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a3a1a',
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#2d6a2d',
    borderRadius: 8,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  biometricButton: {
    backgroundColor: '#f0f8f0',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#2d6a2d',
    paddingVertical: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  biometricButtonText: {
    color: '#2d6a2d',
    fontSize: 16,
    fontWeight: '600',
  },
});
