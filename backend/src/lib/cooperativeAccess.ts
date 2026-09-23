/**
 * Cooperative pilot access helpers (issues #43/#44).
 *
 * The pilot runs a single cohort of regional agricultural cooperatives whose
 * membership is onboarded off-chain by ops. Until the Cooperative /
 * CooperativeMember tables from ADR-006 are migrated, membership and the
 * cooperative-admin role are expressed as env allowlists so the pilot can
 * ship without a database migration:
 *
 *   COOPERATIVE_ADMINS  = "coop-id:wallet,coop-id:wallet,..."
 *   COOPERATIVE_MEMBERS = "coop-id:wallet,coop-id:wallet,..."
 *
 * Wallet comparison is case-insensitive (addresses are stored lowercase).
 * The global admin allowlist (ADMIN_STELLAR_PUBKEYS) is always a superset:
 * a global admin may view any cooperative's trades.
 */

import { getAdminAllowlistLowercase } from "./accessControl";

function cooperativePairsRaw(): string {
  return process.env.COOPERATIVE_ADMINS ?? "";
}

function cooperativeMembersRaw(): string {
  return process.env.COOPERATIVE_MEMBERS ?? "";
}

function parsePairs(raw: string): Map<string, Set<string>> {
  const byCoop = new Map<string, Set<string>>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const coopId = trimmed.slice(0, separator).trim().toLowerCase();
    const wallet = trimmed.slice(separator + 1).trim().toLowerCase();
    if (!coopId || !wallet) continue;
    const set = byCoop.get(coopId) ?? new Set<string>();
    set.add(wallet);
    byCoop.set(coopId, set);
  }
  return byCoop;
}

/** Wallet addresses registered as admins of `cooperativeId` (lowercase). */
export function getCooperativeAdmins(cooperativeId: string): Set<string> {
  return parsePairs(cooperativePairsRaw()).get(cooperativeId.trim().toLowerCase()) ?? new Set();
}

/** Wallet addresses registered as members of `cooperativeId` (lowercase). */
export function getCooperativeMembers(cooperativeId: string): string[] {
  const set = parsePairs(cooperativeMembersRaw()).get(cooperativeId.trim().toLowerCase());
  return set ? [...set] : [];
}

/** True when `address` is a cooperative-admin of `cooperativeId`. */
export function isCooperativeAdmin(cooperativeId: string, address: string): boolean {
  if (!address) return false;
  return getCooperativeAdmins(cooperativeId).has(address.trim().toLowerCase());
}

/**
 * True when `caller` may view `cooperativeId` trades: a cooperative-admin of
 * that cooperative, or a global admin. Read-only — cooperative-admins can
 * never mutate trades through this path.
 */
export function canViewCooperativeTrades(cooperativeId: string, caller: string): boolean {
  if (!caller) return false;
  const lower = caller.trim().toLowerCase();
  return isCooperativeAdmin(cooperativeId, lower) || getAdminAllowlistLowercase().has(lower);
}
