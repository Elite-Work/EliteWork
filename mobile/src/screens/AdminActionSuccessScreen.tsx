/**
 * AdminActionSuccessScreen — #85
 *
 * Displayed after a successful admin operation (clawback, lock, terminate).
 * Shows a clear confirmation of the completed action and provides access to
 * the admin action history so operators can audit what was done.
 *
 * Navigation params:
 *   - actionType: human-readable label for the operation ('Clawback' | 'Lock' | 'Terminate')
 *   - streamId:   the stream the action was applied to
 *   - timestamp:  ISO string when the action completed
 */
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../types/navigation';
import { useAdminActionHistoryStore } from '../stores/adminActionHistoryStore';

export type AdminActionType = 'Clawback' | 'Lock' | 'Terminate';

type Props = StackScreenProps<RootStackParamList, 'AdminActionSuccess'>;

/** Pill badge that shows the operation type with a distinct colour per action. */
function ActionBadge({ actionType }: { actionType: AdminActionType }) {
  const label = actionType.toUpperCase();
  const badgeStyle =
    actionType === 'Clawback'
      ? styles.badgeClawback
      : actionType === 'Terminate'
        ? styles.badgeTerminate
        : styles.badgeLock;

  return (
    <View
      style={[styles.badge, badgeStyle]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Action type: ${actionType}`}
    >
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

/** Single row in the history list. */
function HistoryRow({
  actionType,
  streamId,
  timestamp,
}: {
  actionType: AdminActionType;
  streamId: string;
  timestamp: string;
}) {
  const formatted = new Date(timestamp).toLocaleString();
  return (
    <View
      style={styles.historyRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${actionType} on stream ${streamId} at ${formatted}`}
    >
      <ActionBadge actionType={actionType} />
      <View style={styles.historyRowBody}>
        <Text style={styles.historyStreamId} numberOfLines={1}>
          {streamId}
        </Text>
        <Text style={styles.historyTimestamp}>{formatted}</Text>
      </View>
    </View>
  );
}

export default function AdminActionSuccessScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { actionType, streamId, timestamp } = route.params;
  const { history } = useAdminActionHistoryStore();

  // Animated scale pop for the success icon
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Announce completion to screen readers as soon as the screen mounts
    AccessibilityInfo.announceForAccessibility(
      `${actionType} completed successfully on stream ${streamId}.`,
    );

    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [actionType, scaleAnim, streamId]);

  const formatted = new Date(timestamp).toLocaleString();

  return (
    <View
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      {/* ── Success hero ─────────────────────────────────────────────── */}
      <View
        style={styles.hero}
        accessible
        accessibilityRole="header"
        accessibilityLabel="Admin action completed successfully"
      >
        <Animated.View
          style={[styles.iconCircle, { transform: [{ scale: scaleAnim }] }]}
          accessible={false}
        >
          <Text style={styles.iconText}>✓</Text>
        </Animated.View>
        <Text style={styles.heroTitle}>Action completed</Text>
        <ActionBadge actionType={actionType} />
        <Text
          style={styles.heroSubtitle}
          accessibilityLabel={`Stream ${streamId} — ${formatted}`}
        >
          {streamId} · {formatted}
        </Text>
      </View>

      {/* ── Action history ───────────────────────────────────────────── */}
      <View style={styles.historySection}>
        <Text
          style={styles.sectionTitle}
          accessibilityRole="header"
        >
          Recent admin actions
        </Text>

        {history.length === 0 ? (
          <Text style={styles.emptyHistory}>No previous actions recorded.</Text>
        ) : (
          <ScrollView
            style={styles.historyList}
            accessible
            accessibilityRole="list"
            accessibilityLabel="Admin action history list"
          >
            {history.map((entry, idx) => (
              <HistoryRow
                key={`${entry.streamId}-${entry.timestamp}-${idx}`}
                actionType={entry.actionType}
                streamId={entry.streamId}
                timestamp={entry.timestamp}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Footer actions ───────────────────────────────────────────── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('AdminStreamsOverview')}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Back to admin stream overview"
          accessibilityHint="Returns to the list of streams for further admin operations"
        >
          <Text style={styles.primaryButtonText}>Back to streams</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('VaultDashboard')}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Go to vault dashboard"
          accessibilityHint="Opens the vault dashboard to view trade statistics"
        >
          <Text style={styles.secondaryButtonText}>Vault dashboard</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7f4',
  },

  // ── Hero ──────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 12,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2d6a2d',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2d6a2d',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  iconText: {
    fontSize: 40,
    color: '#fff',
    fontWeight: '700',
    lineHeight: 48,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1f3d1f',
    marginTop: 4,
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },

  // ── Badges ────────────────────────────────────────────────────────────
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeClawback: { backgroundColor: '#fee2e2' },
  badgeLock: { backgroundColor: '#fef9c3' },
  badgeTerminate: { backgroundColor: '#fce7f3' },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
    letterSpacing: 0.5,
  },

  // ── History section ───────────────────────────────────────────────────
  historySection: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  historyList: {
    flex: 1,
  },
  emptyHistory: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 20,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  historyRowBody: {
    flex: 1,
    gap: 2,
  },
  historyStreamId: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f3d1f',
  },
  historyTimestamp: {
    fontSize: 11,
    color: '#9ca3af',
  },

  // ── Footer ────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#2d6a2d',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#eaf4ea',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#2d6a2d',
    fontWeight: '600',
    fontSize: 14,
  },
});
