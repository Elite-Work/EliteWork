/**
 * DisputeDetailScreen
 *
 * Target for the `disputes/:id` deep link (see `src/constants/links.ts`).
 * This file was previously referenced by `AppNavigator` and declared in
 * `RootStackParamList` but never existed, so the mobile type-check failed
 * with TS2307 and the bundle could not resolve the route at runtime.
 *
 * This is intentionally a placeholder. The backend exposes only
 * `GET /disputes` (list) and `POST /disputes/:id/transition` — there is no
 * `GET /disputes/:id` endpoint to populate a detail view from, so rather
 * than invent a contract this screen renders the dispute id and an
 * explicit not-yet-available state. Wire it up once the single-dispute
 * read endpoint lands.
 */
import { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';

type Props = StackScreenProps<RootStackParamList, 'DisputeDetail'>;

export default function DisputeDetailScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Dispute</Text>
        <Text style={styles.label}>Reference</Text>
        <Text style={styles.id}>{id}</Text>
        <Text style={styles.body}>
          Dispute details are not available yet. The backend has no
          single-dispute read endpoint, so there is nothing to display here.
        </Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7f5',
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8e2',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a3a1a',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  id: {
    fontSize: 14,
    color: '#2d6a2d',
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
    color: '#666',
    lineHeight: 22,
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: '#2d6a2d',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  backBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
