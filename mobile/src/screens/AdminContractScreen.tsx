import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';
import { adminApi, ContractTxResult } from '../api/admin';
import { viewForError } from '../api/errorInterceptor';
import { AdminErrorBanner } from '../components/AdminErrorBanner';
import { SignAndSubmitXdr } from '../components/SignAndSubmitXdr';
import { buildSupportMailto } from '../constants/support';

type Props = StackScreenProps<RootStackParamList, 'AdminContract'>;

/**
 * Mobile screen for the contract admin endpoints:
 *  - POST /api/admin/contract/mediators
 *  - DELETE /api/admin/contract/mediators/:address
 *  - PATCH /api/admin/contract/fee
 *
 * All three return an `unsignedXdr` the admin must sign with their
 * Stellar wallet (Freighter). Each result card offers "Sign & submit with
 * Freighter", which signs the XDR and submits it to the Stellar network
 * (see `services/freighterSigner`). The XDR is still shown as a
 * `selectable` string so the admin can long-press to copy it and sign
 * externally when Freighter is not available on the device. The error
 * banner pattern is the same as AdminStreamsOverviewScreen.
 *
 * Two per-section error slots keep user input on failure: the add-input
 * + fee-input both survive `sectionErrorView` so a retry doesn't have
 * to re-type them.
 */
export default function AdminContractScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { role, clearAuth, walletAddress } = useAuthStore();
  const isAdmin = role === 'admin';

  // Mediators section.
  const [mediatorInput, setMediatorInput] = useState('');
  const [medBusy, setMedBusy] = useState(false);
  const [medErrorView, setMedErrorView] = useState<
    ReturnType<typeof viewForError> | null
  >(null);
  const [medTx, setMedTx] = useState<ContractTxResult | null>(null);

  // Fee section.
  const [feeBpsInput, setFeeBpsInput] = useState('100');
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeErrorView, setFeeErrorView] = useState<
    ReturnType<typeof viewForError> | null
  >(null);
  const [feeTx, setFeeTx] = useState<ContractTxResult | null>(null);

  const addMediator = useCallback(async () => {
    const address = mediatorInput.trim();
    if (!address) return;
    setMedBusy(true);
    setMedErrorView(null);
    setMedTx(null);
    try {
      const result = await adminApi.addMediator(address);
      setMedTx(result);
      setMediatorInput('');
    } catch (error: unknown) {
      setMedErrorView(viewForError(error));
    } finally {
      setMedBusy(false);
    }
  }, [mediatorInput]);

  const updateFee = useCallback(async () => {
    const bps = Number.parseInt(feeBpsInput, 10);
    if (!Number.isFinite(bps) || bps < 1 || bps > 500) {
      // Client-side validation that mirrors backend zod range; we
      // don't surface this as a banner — the field hint is enough.
      return;
    }
    setFeeBusy(true);
    setFeeErrorView(null);
    setFeeTx(null);
    try {
      const result = await adminApi.updateContractFeeBps(bps);
      setFeeTx(result);
    } catch (error: unknown) {
      setFeeErrorView(viewForError(error));
    } finally {
      setFeeBusy(false);
    }
  }, [feeBpsInput]);

  const handleSignOut = useCallback(async () => {
    await clearAuth();
    navigation.goBack();
  }, [clearAuth, navigation]);

  const openMailToSupport = useCallback(
    (view: ReturnType<typeof viewForError> | null) => {
      void Linking.openURL(buildSupportMailto(view, 'contract'));
    },
    [],
  );

  if (!isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Admin access required</Text>
        <Text style={styles.body}>
          Only administrators can manage contract mediators and fees.
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin contract</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* --- Mediators section --- */}
        <Text style={styles.sectionTitle}>Add mediator</Text>
        <Text style={styles.sectionBody}>
          Builds a backend `unsignedXdr`, then signs and submits it with
          Freighter. If Freighter isn't available on this device, copy the
          XDR (long-press the field) and sign it externally.
        </Text>
        {medErrorView ? (
          <AdminErrorBanner
            view={medErrorView}
            onRetry={() => void addMediator()}
            onSignOut={handleSignOut}
            onGoBack={() => navigation.goBack()}
            onContactSupport={() => openMailToSupport(medErrorView)}
          />
        ) : null}
        <TextInput
          testID="admin-contract-add-input"
          style={styles.input}
          placeholder="G... Stellar public key"
          placeholderTextColor="#7e977e"
          value={mediatorInput}
          onChangeText={setMediatorInput}
          editable={!medBusy}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          testID="admin-contract-add"
          onPress={() => void addMediator()}
          disabled={medBusy || mediatorInput.trim().length === 0}
          style={[
            styles.actionButton,
            (medBusy || mediatorInput.trim().length === 0) &&
              styles.actionButtonDisabled,
          ]}
        >
          {medBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.actionButtonText}>Build add-mediator XDR</Text>
          )}
        </TouchableOpacity>
        {medTx ? (
          <View style={styles.txCard} testID="admin-contract-add-tx">
            <Text style={styles.txLabel}>unsignedXdr</Text>
            <Text
              style={styles.txValue}
              selectable
              numberOfLines={3}
              testID="admin-contract-add-xdr"
            >
              {medTx.unsignedXdr}
            </Text>
            <SignAndSubmitXdr
              unsignedXdr={medTx.unsignedXdr}
              address={walletAddress ?? undefined}
              testIDPrefix="admin-contract-add"
            />
          </View>
        ) : null}

        {/* --- Fee section --- */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Update fee (bps)</Text>
        <Text style={styles.sectionBody}>
          Whole percent = 100 bps. Backend validates 1–500.
        </Text>
        {feeErrorView ? (
          <AdminErrorBanner
            view={feeErrorView}
            onRetry={() => void updateFee()}
            onSignOut={handleSignOut}
            onGoBack={() => navigation.goBack()}
            onContactSupport={() => openMailToSupport(feeErrorView)}
          />
        ) : null}
        <TextInput
          testID="admin-contract-fee-input"
          style={styles.input}
          keyboardType="number-pad"
          value={feeBpsInput}
          onChangeText={setFeeBpsInput}
          editable={!feeBusy}
        />
        <TouchableOpacity
          testID="admin-contract-fee"
          onPress={() => void updateFee()}
          disabled={feeBusy}
          style={[styles.actionButton, feeBusy && styles.actionButtonDisabled]}
        >
          {feeBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.actionButtonText}>Build update-fee XDR</Text>
          )}
        </TouchableOpacity>
        {feeTx ? (
          <View style={styles.txCard} testID="admin-contract-fee-tx">
            <Text style={styles.txLabel}>unsignedXdr</Text>
            <Text
              style={styles.txValue}
              selectable
              numberOfLines={3}
              testID="admin-contract-fee-xdr"
            >
              {feeTx.unsignedXdr}
            </Text>
            <SignAndSubmitXdr
              unsignedXdr={feeTx.unsignedXdr}
              address={walletAddress ?? undefined}
              testIDPrefix="admin-contract-fee"
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7f4', paddingHorizontal: 16 },
  scroll: { paddingBottom: 32, gap: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#1f3d1f' },
  body: { fontSize: 14, color: '#4f5d4f', marginTop: 8, lineHeight: 20 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f3d1f',
    marginTop: 8,
  },
  sectionBody: {
    fontSize: 13,
    color: '#4f5d4f',
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#1f3d1f',
  },
  actionButton: {
    backgroundColor: '#2d6a2d',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonDisabled: { backgroundColor: '#7e977e' },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  backButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: '#2d6a2d',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backButtonText: { color: '#fff', fontWeight: '600' },
  txCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  txLabel: { fontSize: 12, fontWeight: '700', color: '#1f3d1f' },
  txValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#4f5d4f',
  },
});
