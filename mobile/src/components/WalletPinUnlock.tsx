import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { WALLET_PIN_MAX_LENGTH, WALLET_PIN_MIN_LENGTH } from '../utils/walletPin';

export interface WalletPinUnlockProps {
  /** Verifies the PIN; resolves true when the wallet unlocked. */
  onSubmit: (pin: string) => Promise<boolean>;
  /** Explains why PIN entry is being shown (e.g. biometrics failed). */
  message?: string;
  /** Escape hatch for a user who no longer knows the PIN. */
  onUseDifferentWallet?: () => void;
  disabled?: boolean;
}

/**
 * PIN entry fallback for wallet unlock (#511).
 *
 * Rendered after biometric unlock fails, or when a device has no usable
 * biometrics but a PIN is configured. Kept presentational: verification is
 * the caller's job, so the screen owns auth + navigation.
 */
export function WalletPinUnlock({
  onSubmit,
  message,
  onUseDifferentWallet,
  disabled = false,
}: WalletPinUnlockProps): React.ReactElement {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    !disabled && !submitting && pin.length >= WALLET_PIN_MIN_LENGTH;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const unlocked = await onSubmit(pin);
      if (!unlocked) {
        setError('Incorrect PIN. Try again.');
        setPin('');
      }
    } catch {
      setError('Could not verify the PIN. Try again.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter your wallet PIN</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(value) => {
          setPin(value.replace(/[^0-9]/g, '').slice(0, WALLET_PIN_MAX_LENGTH));
          setError(null);
        }}
        onSubmitEditing={handleSubmit}
        placeholder="••••"
        placeholderTextColor="#9aa79a"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={WALLET_PIN_MAX_LENGTH}
        editable={!disabled && !submitting}
        accessibilityLabel="Wallet PIN"
        accessibilityHint={`${WALLET_PIN_MIN_LENGTH} to ${WALLET_PIN_MAX_LENGTH} digits`}
        testID="wallet-pin-input"
      />

      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Unlock with PIN"
        accessibilityState={{ disabled: !canSubmit, busy: submitting }}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Unlock with PIN</Text>
        )}
      </TouchableOpacity>

      {onUseDifferentWallet ? (
        <TouchableOpacity
          onPress={onUseDifferentWallet}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Use a different wallet"
        >
          <Text style={styles.link}>Forgot PIN? Use a different wallet</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a3a1a',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c7d3c7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    fontSize: 18,
    letterSpacing: 6,
    color: '#1a3a1a',
    backgroundColor: '#f7faf7',
  },
  error: {
    color: '#b3261e',
    fontSize: 13,
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
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    color: '#2d6a2d',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 6,
  },
});

export default WalletPinUnlock;
