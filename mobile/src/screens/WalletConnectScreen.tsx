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
import {
  BIOMETRIC_ATTEMPTS_BEFORE_PIN,
  authenticateWithBiometrics,
  classifyBiometricFailure,
  isBiometricUnlockAvailable,
  shouldFallBackToPin,
} from '../utils/biometrics';
import {
  WALLET_PIN_MAX_LENGTH,
  WALLET_PIN_MIN_LENGTH,
  hasWalletPin,
  isValidWalletPinFormat,
  setWalletPin,
  verifyWalletPin,
} from '../utils/walletPin';
import { WalletPinUnlock } from '../components/WalletPinUnlock';

type Props = StackScreenProps<RootStackParamList, 'WalletConnect'>;

export default function WalletConnectScreen({ navigation }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [rememberedAddress, setRememberedAddress] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  // #511: PIN fallback state. `biometricFailures` counts genuine failed
  // attempts only — a dismissed prompt does not count — and `pinRequired`
  // switches the card from the Face ID / fingerprint button to PIN entry.
  const [biometricFailures, setBiometricFailures] = useState(0);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const { setWalletAddress, setToken, getRememberedWalletAddress } = useAuthStore();

  // #57: offer a faster re-auth path for returning users instead of always
  // requiring the full "paste your address" flow.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [address, hardwareReady, hasPin] = await Promise.all([
        getRememberedWalletAddress(),
        isBiometricUnlockAvailable(),
        hasWalletPin(),
      ]);
      if (cancelled) return;
      setRememberedAddress(address);
      setBiometricsAvailable(hardwareReady);
      setPinConfigured(hasPin);
      // A configured PIN is the only unlock path when the device has no
      // usable biometrics.
      setPinRequired(Boolean(address && hasPin && !hardwareReady));
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

  const showPinPrompt = (message: string) => {
    if (!pinConfigured) {
      setBiometricFailures(BIOMETRIC_ATTEMPTS_BEFORE_PIN);
      Alert.alert(
        'Unlock failed',
        'Biometric unlock is unavailable. Set up a wallet PIN or connect your wallet manually.'
      );
      return;
    }
    setBiometricFailures(BIOMETRIC_ATTEMPTS_BEFORE_PIN);
    setPinRequired(true);
    if (message) Alert.alert('Enter your PIN', message);
  };

  const handleBiometricUnlock = async () => {
    if (!rememberedAddress) return;
    setUnlocking(true);
    try {
      const result = await authenticateWithBiometrics('Unlock Amana to continue trading');
      if (result.success) {
        await authenticateAddress(rememberedAddress);
        return;
      }

      const disposition = classifyBiometricFailure(result.error);
      if (disposition === 'ignore') return;

      const nextFailures = biometricFailures + 1;
      if (disposition === 'fallback' || shouldFallBackToPin(nextFailures)) {
        showPinPrompt(
          `Face ID / fingerprint failed ${BIOMETRIC_ATTEMPTS_BEFORE_PIN} times. Enter your wallet PIN to continue.`
        );
        return;
      }

      setBiometricFailures(nextFailures);
      const remaining = BIOMETRIC_ATTEMPTS_BEFORE_PIN - nextFailures;
      Alert.alert(
        'Unlock failed',
        `Please try again. PIN entry unlocks after ${remaining} more failed ${
          remaining === 1 ? 'attempt' : 'attempts'
        }.`
      );
    } catch (err: unknown) {
      Alert.alert('Connection failed', (err as Error)?.message ?? 'Unknown error');
    } finally {
      setUnlocking(false);
    }
  };

  const handlePinSubmit = async (pin: string): Promise<boolean> => {
    if (!rememberedAddress) return false;
    const valid = await verifyWalletPin(pin);
    if (!valid) return false;
    await authenticateAddress(rememberedAddress);
    return true;
  };

  const handleSetPin = () => {
    Alert.prompt(
      'Set wallet PIN',
      `Choose a ${WALLET_PIN_MIN_LENGTH}–${WALLET_PIN_MAX_LENGTH} digit PIN. It unlocks this wallet when biometrics fail.`,
      async (value) => {
        const pin = (value ?? '').trim();
        if (!isValidWalletPinFormat(pin)) {
          Alert.alert(
            'Invalid PIN',
            `Use ${WALLET_PIN_MIN_LENGTH} to ${WALLET_PIN_MAX_LENGTH} digits.`
          );
          return;
        }
        try {
          await setWalletPin(pin);
          setPinConfigured(true);
          Alert.alert('PIN saved', 'You can now unlock with your PIN if biometrics fail.');
        } catch (err: unknown) {
          Alert.alert('Could not save PIN', (err as Error)?.message ?? 'Unknown error');
        }
      },
      'plain-text'
    );
  };

  const showBiometricUnlock =
    biometricsAvailable &&
    !!rememberedAddress &&
    !pinRequired &&
    // Once the fallback threshold is reached, stop offering the biometric
    // prompt so the user cannot get stuck in a failing loop (#511).
    !shouldFallBackToPin(biometricFailures);
  const showPinUnlock =
    !!rememberedAddress && (pinRequired || (pinConfigured && !biometricsAvailable));
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

        {showPinUnlock && (
          <View style={styles.pinSection}>
            <WalletPinUnlock
              onSubmit={handlePinSubmit}
              message={
                pinRequired
                  ? `Face ID / fingerprint failed ${BIOMETRIC_ATTEMPTS_BEFORE_PIN} times. Enter the PIN you set for this wallet.`
                  : 'Biometrics are unavailable on this device. Enter your wallet PIN.'
              }
              onUseDifferentWallet={handleConnect}
              disabled={connecting}
            />
          </View>
        )}

        {showBiometricUnlock && !pinConfigured && (
          <TouchableOpacity
            onPress={handleSetPin}
            disabled={unlocking || connecting}
            accessibilityRole="button"
            accessibilityLabel="Set up wallet PIN"
          >
            <Text style={styles.pinLink}>Set up a PIN as a backup</Text>
          </TouchableOpacity>
        )}

        {showBiometricUnlock && pinConfigured && (
          <TouchableOpacity
            onPress={() => setPinRequired(true)}
            disabled={unlocking || connecting}
            accessibilityRole="button"
            accessibilityLabel="Unlock with PIN instead"
          >
            <Text style={styles.pinLink}>Unlock with PIN instead</Text>
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
              {showBiometricUnlock || showPinUnlock ? 'Use a different wallet' : 'Connect Wallet'}
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
  pinSection: {
    marginBottom: 12,
  },
  pinLink: {
    color: '#2d6a2d',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
