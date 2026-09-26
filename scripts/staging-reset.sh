#!/usr/bin/env bash
# staging-reset.sh — Restore staging to the known-good baseline the hourly
# synthetic probe assumes (see docs/synthetic-probes-policy.md).
#
# "Baseline" is defined as exactly:
#   1. the schema produced by every committed Prisma migration, and
#   2. the fixture set written by backend/prisma/seed.staging.ts, and
#   3. an empty staging Redis (no stale idempotency locks or cached responses).
#
# Manual staging debugging often leaves extra trades, mutated statuses, or
# half-consumed idempotency locks behind. Because the probe creates its own
# trade and asserts the full auth → create → deposit → confirm → release
# journey, those leftovers can make a probe run non-reproducible. Run this
# script after any manual debugging session to get back to the baseline.
#
# Usage:
#   ./scripts/staging-reset.sh [--dry-run] [--yes] [--skip-redis] [--skip-validate] [--force]
#
# Options:
#   --dry-run        Print the plan and run the safety guard, but change nothing.
#   --yes            Skip the interactive confirmation (required when not a TTY,
#                    e.g. from CI or automation).
#   --skip-redis     Do not flush the staging Redis database.
#   --skip-validate  Do not run scripts/staging-validate.sh afterwards.
#   --force          Allow a database URL whose name does not look like staging.
#
# Environment (falls back to .env.staging / compose defaults):
#   STAGING_DATABASE_URL    PostgreSQL connection string for staging
#   STAGING_REDIS_PASSWORD  Password for the staging Redis container
#
# Exit codes:
#   0 — staging is back on the baseline (or --dry-run completed)
#   1 — safety guard tripped, a step failed, or confirmation was declined
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

DRY_RUN=false
ASSUME_YES=false
SKIP_REDIS=false
SKIP_VALIDATE=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --yes)            ASSUME_YES=true ;;
    --skip-redis)     SKIP_REDIS=true ;;
    --skip-validate)  SKIP_VALIDATE=true ;;
    --force)          FORCE=true ;;
    -h|--help)
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "staging-reset: unknown option '$arg' (see --help)" >&2
      exit 1
      ;;
  esac
done

# Load staging credentials the same way staging-up.sh does. Values already set
# in the environment win, so callers can target a remote staging DB explicitly.
ENV_FILE="$ROOT_DIR/.env.staging"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ENV_FILE"; set +o allexport
  echo "→ Loaded environment from .env.staging"
fi

DB_URL="${STAGING_DATABASE_URL:-postgresql://postgres:staging-password@localhost:5434/amana_staging}"
REDIS_PASSWORD="${STAGING_REDIS_PASSWORD:-staging-redis-pass}"

# ── Safety guard ─────────────────────────────────────────────────────────────
# Dropping and reseeding a database is destructive. Refuse anything whose name
# does not look like the staging database unless the operator opts in with
# --force, so a prod URL pasted into STAGING_DATABASE_URL cannot be wiped.
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
if [[ "$FORCE" != "true" && "$DB_NAME" != *staging* ]]; then
  echo "✗ Refusing to reset: database name '$DB_NAME' does not look like staging." >&2
  echo "  Set STAGING_DATABASE_URL to the staging database, or pass --force if you are sure." >&2
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Amana — Staging Baseline Reset"
echo "═══════════════════════════════════════════════════════════════"
echo "  Database : ${DB_URL%%\?*}"
echo "  Redis    : $([[ "$SKIP_REDIS" == "true" ]] && echo "skipped" || echo "flush staging DB")"
echo "  Validate : $([[ "$SKIP_VALIDATE" == "true" ]] && echo "skipped" || echo "scripts/staging-validate.sh")"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "→ DRY RUN: nothing was changed. Planned steps:"
  echo "  1. prisma migrate reset --force --skip-seed"
  echo "  2. npx tsx prisma/seed.staging.ts"
  echo "  3. redis-cli FLUSHALL (staging)"
  echo "  4. scripts/staging-validate.sh"
  echo ""
  echo "✓ Dry run complete — safety guard passed for '$DB_NAME'."
  exit 0
fi

if [[ "$ASSUME_YES" != "true" ]]; then
  if [[ ! -t 0 ]]; then
    echo "✗ Refusing to run destructively without --yes (no interactive terminal)." >&2
    exit 1
  fi
  read -r -p "This DESTROYS all staging data and reseeds the baseline. Continue? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── 1 + 2. Reset the schema and seed the baseline ────────────────────────────
# `migrate reset` drops the schema, replays every committed migration, and
# (with --skip-seed) leaves seeding to us so the staging fixture set — not the
# dev seed configured in package.json — is what lands in the database.
echo "→ Resetting staging schema (migrate reset)..."
cd "$BACKEND_DIR"
DATABASE_URL="$DB_URL" npx prisma migrate reset --force --skip-seed

echo "→ Seeding staging baseline data..."
DATABASE_URL="$DB_URL" npx tsx prisma/seed.staging.ts

cd "$ROOT_DIR"

# ── 3. Clear staging Redis ───────────────────────────────────────────────────
if [[ "$SKIP_REDIS" != "true" ]]; then
  echo "→ Flushing staging Redis..."
  if docker compose --profile staging exec -T redis-staging \
    redis-cli -a "$REDIS_PASSWORD" FLUSHALL >/dev/null 2>&1; then
    echo "  staging Redis flushed."
  else
    echo "⚠  Could not flush staging Redis (is the staging stack running?)." >&2
    echo "   Idempotency keys cached there can make the probe non-reproducible; run" >&2
    echo "   './scripts/staging-up.sh' and re-run this script if that happens." >&2
    exit 1
  fi
fi

# ── 4. Prove the baseline is actually in place ───────────────────────────────
if [[ "$SKIP_VALIDATE" != "true" ]]; then
  echo "→ Validating staging against the baseline..."
  STAGING_DATABASE_URL="$DB_URL" "$SCRIPT_DIR/staging-validate.sh"
fi

echo ""
echo "✓ Staging is back on the baseline. The synthetic probe's assumptions hold again."
