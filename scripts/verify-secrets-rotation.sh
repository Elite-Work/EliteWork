#!/usr/bin/env bash
# verify-secrets-rotation.sh — Verification job asserting last-rotated
# timestamps for every secret in the inventory (docs/secrets-policy.md §8).
#
# Reads backend/scripts/secrets-rotation-status.json and fails (exit 1) if
# any secret's `lastRotated` date is older than its `maxAgeDays`, or if it
# is within WARN_WINDOW_DAYS of expiring (warns but doesn't fail).
#
# Usage:
#   ./scripts/verify-secrets-rotation.sh
#
# Exit codes:
#   0 — all secrets within their rotation window
#   1 — one or more secrets are overdue for rotation

set -euo pipefail

STATUS_FILE="${STATUS_FILE:-backend/scripts/secrets-rotation-status.json}"
WARN_WINDOW_DAYS="${WARN_WINDOW_DAYS:-14}"

echo "==============================================================="
echo "  EliteWork — Secrets Rotation Verification"
echo "==============================================================="

if [[ ! -f "$STATUS_FILE" ]]; then
  echo "❌ Error: status file not found at $STATUS_FILE"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "❌ Error: jq is required to run this script."
  exit 1
fi

TODAY_EPOCH=$(date -u +%s)
FAILED=0

COUNT=$(jq '.secrets | length' "$STATUS_FILE")
for i in $(seq 0 $((COUNT - 1))); do
  NAME=$(jq -r ".secrets[$i].name" "$STATUS_FILE")
  OWNER=$(jq -r ".secrets[$i].owner" "$STATUS_FILE")
  MAX_AGE=$(jq -r ".secrets[$i].maxAgeDays" "$STATUS_FILE")
  LAST_ROTATED=$(jq -r ".secrets[$i].lastRotated" "$STATUS_FILE")

  LAST_ROTATED_EPOCH=$(date -u -d "$LAST_ROTATED" +%s 2>/dev/null || date -u -j -f "%Y-%m-%d" "$LAST_ROTATED" +%s)
  AGE_DAYS=$(( (TODAY_EPOCH - LAST_ROTATED_EPOCH) / 86400 ))
  REMAINING_DAYS=$(( MAX_AGE - AGE_DAYS ))

  if (( AGE_DAYS > MAX_AGE )); then
    echo "  ❌ OVERDUE: $NAME (owner: $OWNER) — last rotated $LAST_ROTATED, ${AGE_DAYS}d ago, max age ${MAX_AGE}d"
    FAILED=1
  elif (( REMAINING_DAYS <= WARN_WINDOW_DAYS )); then
    echo "  ⚠️  DUE SOON: $NAME (owner: $OWNER) — ${REMAINING_DAYS}d remaining until rotation is required"
  else
    echo "  ✓ OK: $NAME — ${REMAINING_DAYS}d remaining"
  fi
done

echo ""
if [[ "$FAILED" -eq 1 ]]; then
  echo "❌ One or more secrets are overdue for rotation. See docs/secrets-policy.md §8."
  exit 1
fi

echo "✅ All secrets are within their rotation window."
exit 0
