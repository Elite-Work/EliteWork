import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  signAndSubmitXdr,
  TransactionSigningError,
} from '../services/freighterSigner';

export interface SignAndSubmitXdrProps {
  /** Backend-built transaction the wallet should sign. */
  unsignedXdr: string;
  /** Wallet address expected to sign (passed to Freighter as a hint). */
  address?: string;
  /** Prefix for the `testID`s of the button, hash and error text. */
  testIDPrefix: string;
  /** Called with the transaction hash once the network has accepted it. */
  onSubmitted?: (hash: string) => void;
}

type Status = 'idle' | 'busy' | 'submitted' | 'error';

/**
 * "Sign & submit" control that sits under an `unsignedXdr` card. It asks
 * Freighter to sign the transaction, submits it to the Stellar network and
 * reports the outcome inline.
 *
 * The XDR stays copyable above this control, so when Freighter is not
 * available on the device (`WALLET_UNAVAILABLE`) the admin can still sign
 * externally; every other failure can simply be retried.
 */
export function SignAndSubmitXdr({
  unsignedXdr,
  address,
  testIDPrefix,
  onSubmitted,
}: SignAndSubmitXdrProps): React.ReactElement {
  const [status, setStatus] = useState<Status>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<TransactionSigningError | null>(null);

  const signAndSubmit = useCallback(async () => {
    setStatus('busy');
    setError(null);
    try {
      const result = await signAndSubmitXdr(unsignedXdr, { address });
      setHash(result.hash);
      setStatus('submitted');
      onSubmitted?.(result.hash);
    } catch (e: unknown) {
      setError(
        e instanceof TransactionSigningError
          ? e
          : new TransactionSigningError(
              'SIGNING_FAILED',
              e instanceof Error && e.message
                ? e.message
                : 'Could not sign the transaction.',
            ),
      );
      setStatus('error');
    }
  }, [unsignedXdr, address, onSubmitted]);

  const disabled = status === 'busy' || status === 'submitted';

  return (
    <View style={styles.container}>
      {status !== 'submitted' ? (
        <TouchableOpacity
          testID={`${testIDPrefix}-sign`}
          accessibilityRole="button"
          accessibilityLabel="Sign and submit with Freighter"
          accessibilityState={{ disabled, busy: status === 'busy' }}
          onPress={() => void signAndSubmit()}
          disabled={disabled}
          style={[styles.button, disabled && styles.buttonDisabled]}
        >
          {status === 'busy' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {status === 'error' ? 'Try signing again' : 'Sign & submit with Freighter'}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}

      {status === 'submitted' && hash ? (
        <View testID={`${testIDPrefix}-submitted`} accessibilityRole="alert">
          <Text style={styles.successTitle}>Transaction submitted</Text>
          <Text style={styles.label}>Transaction hash</Text>
          <Text style={styles.mono} selectable testID={`${testIDPrefix}-hash`}>
            {hash}
          </Text>
        </View>
      ) : null}

      {status === 'error' && error ? (
        <View testID={`${testIDPrefix}-error`} accessibilityRole="alert">
          <Text style={styles.errorTitle}>{titleFor(error.code)}</Text>
          <Text style={styles.errorBody}>{error.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

function titleFor(code: TransactionSigningError['code']): string {
  switch (code) {
    case 'WALLET_UNAVAILABLE':
      return 'Freighter unavailable';
    case 'USER_REJECTED':
      return 'Signature declined';
    case 'SUBMISSION_FAILED':
      return 'Submission failed';
    case 'SIGNING_FAILED':
      return 'Signing failed';
  }
}

export default SignAndSubmitXdr;

const styles = StyleSheet.create({
  container: { gap: 6, marginTop: 4 },
  button: {
    backgroundColor: '#2d6a2d',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: '#7e977e' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#1f3d1f' },
  mono: { fontSize: 12, fontFamily: 'monospace', color: '#4f5d4f' },
  successTitle: { fontSize: 14, fontWeight: '700', color: '#2d6a2d' },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#8a2a1f' },
  errorBody: { fontSize: 13, color: '#8a2a1f', lineHeight: 18 },
});
