/**
 * Tests for the cooperative pilot access helpers (issues #43/#44).
 *
 * Membership and the cooperative-admin role are env allowlists
 * (`COOPERATIVE_ADMINS` / `COOPERATIVE_MEMBERS` as "coop-id:wallet" pairs)
 * until the ADR-006 tables are migrated.
 */
import {
  canViewCooperativeTrades,
  getCooperativeAdmins,
  getCooperativeMembers,
  isCooperativeAdmin,
} from "../lib/cooperativeAccess";

const COOP = "kebbi-coop";
const ADMIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const MEMBER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const OUTSIDER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

describe("cooperativeAccess", () => {
  const prevAdmins = process.env.ADMIN_STELLAR_PUBKEYS;
  const prevCoopAdmins = process.env.COOPERATIVE_ADMINS;
  const prevCoopMembers = process.env.COOPERATIVE_MEMBERS;

  afterEach(() => {
    if (prevAdmins === undefined) delete process.env.ADMIN_STELLAR_PUBKEYS;
    else process.env.ADMIN_STELLAR_PUBKEYS = prevAdmins;
    if (prevCoopAdmins === undefined) delete process.env.COOPERATIVE_ADMINS;
    else process.env.COOPERATIVE_ADMINS = prevCoopAdmins;
    if (prevCoopMembers === undefined) delete process.env.COOPERATIVE_MEMBERS;
    else process.env.COOPERATIVE_MEMBERS = prevCoopMembers;
  });

  beforeEach(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = "";
    process.env.COOPERATIVE_ADMINS = `${COOP}:${ADMIN}`;
    process.env.COOPERATIVE_MEMBERS = `${COOP}:${MEMBER}`;
  });

  it("resolves admins scoped to one cooperative only", () => {
    expect(getCooperativeAdmins(COOP).has(ADMIN.toLowerCase())).toBe(true);
    expect(getCooperativeAdmins("other-coop").size).toBe(0);
  });

  it("isCooperativeAdmin is case-insensitive and rejects outsiders", () => {
    expect(isCooperativeAdmin(COOP, ADMIN.toLowerCase())).toBe(true);
    expect(isCooperativeAdmin(COOP, OUTSIDER)).toBe(false);
    expect(isCooperativeAdmin(COOP, "")).toBe(false);
  });

  it("ignores malformed pairs without aborting parsing", () => {
    process.env.COOPERATIVE_ADMINS = `no-separator,${COOP}:${ADMIN},:empty-coop`;
    expect(isCooperativeAdmin(COOP, ADMIN)).toBe(true);
  });

  it("lets a cooperative-admin view their own cooperative", () => {
    expect(canViewCooperativeTrades(COOP, ADMIN)).toBe(true);
  });

  it("lets a global admin view any cooperative", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = OUTSIDER;
    expect(canViewCooperativeTrades(COOP, OUTSIDER)).toBe(true);
  });

  it("denies outsiders and anonymous callers", () => {
    expect(canViewCooperativeTrades(COOP, OUTSIDER)).toBe(false);
    expect(canViewCooperativeTrades(COOP, "")).toBe(false);
  });

  it("resolves member wallets for trade scoping", () => {
    expect(getCooperativeMembers(COOP)).toEqual([MEMBER.toLowerCase()]);
    expect(getCooperativeMembers("unknown-coop")).toEqual([]);
  });
});
