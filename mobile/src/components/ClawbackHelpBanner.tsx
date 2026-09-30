import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

/**
 * ClawbackHelpBanner
 *
 * A collapsible informational banner that explains clawback semantics to
 * admin users during onboarding and trade management flows.
 *
 * Collapsed by default — only the toggle button is visible. Press the
 * button to expand/collapse the help text.
 */
export function ClawbackHelpBanner() {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.container} testID="clawback-help-banner">
      <TouchableOpacity
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide clawback help' : 'Show clawback help'}
        accessibilityHint="Toggles an explanation of clawback semantics"
        style={styles.toggleRow}
        testID="clawback-help-toggle"
      >
        <View style={styles.iconBadge}>
          <Text style={styles.iconText}>ⓘ</Text>
        </View>
        <Text style={styles.toggleLabel}>What is a clawback?</Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.helpContent} testID="clawback-help-content">
          <Text style={styles.helpText}>
            • Clawback allows an admin to reclaim unvested tokens from a stream.
          </Text>
          <Text style={styles.helpText}>
            • This action reduces the stream balance immediately and is recorded on-chain.
          </Text>
          <Text style={[styles.helpText, styles.warningText]}>
            • Use with caution: clawbacks cannot be undone once confirmed.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f0f4f0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1e0d1',
    marginVertical: 8,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  iconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2d6a2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 14,
  },
  toggleLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a3a1a',
  },
  chevron: {
    fontSize: 10,
    color: '#6b7280',
  },
  helpContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 6,
  },
  helpText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  warningText: {
    color: '#b45309',
    fontWeight: '500',
  },
});
