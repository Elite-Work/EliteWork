/// Tests for extend_deadline — mutual agreement to extend delivery deadline.
///
/// Verifies that:
/// - Both parties can extend a deadline on a funded trade.
/// - A single-party call (buyer-only or seller-only) is rejected.
/// - Extending a deadline that has already passed is rejected.
/// - Extending with a past new deadline is rejected.
/// - A trade without a deadline cannot be extended.
/// - The trade's expires_at field is updated and a DeadlineExtendedEvent is emitted.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, test_fixture::admin_address};
use soroban_sdk::{
    Address, Env, IntoVal, contract, contractimpl, contracttype,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    xdr::{ContractEventBody, ScVal},
};

// ---------------------------------------------------------------------------
// Minimal mock token (same pattern as expiration_tests.rs)
// ---------------------------------------------------------------------------

#[contract]
pub struct MockToken;

#[contracttype]
#[derive(Clone)]
pub enum MTKey {
    Balance(Address),
}

#[contractimpl]
impl MockToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MTKey::Balance(to);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MTKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = MTKey::Balance(from);
        let to_key = MTKey::Balance(to);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    #[allow(dead_code)]
    stranger: Address,
}

impl H {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000;
            l.sequence_number = 100;
        });

        let escrow = env.register(EscrowContract, ());
        let token = env.register(MockToken, ());
        let admin = admin_address(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let stranger = Address::generate(&env);

        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            stranger,
        }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn init(&self) {
        self.c()
            .initialize(&self.admin, &self.token, &self.admin, &0u32, &self.token);
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }

    /// Create a funded trade with the given deadline (seconds from now).
    fn funded_trade_with_deadline(&self, amount: i128, deadline_offset: u64) -> u64 {
        let deadline = self.now() + deadline_offset;
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &Some(deadline),
        );
        self.c().deposit(&trade_id);
        trade_id
    }

    /// Create a funded trade with no deadline.
    fn funded_trade_no_deadline(&self, amount: i128) -> u64 {
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &None,
        );
        self.c().deposit(&trade_id);
        trade_id
    }
}

/// Return the topics of the last emitted event as a Vec of ScVal for comparison.
fn last_event_topics(env: &Env) -> Vec<ScVal> {
    let all = env.events().all();
    let events = all.events();
    assert!(!events.is_empty(), "no events emitted");
    let last = events.last().unwrap();
    match &last.body {
        ContractEventBody::V0(v0) => v0.topics.to_vec(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Happy path: both parties can mutually extend the deadline.
#[test]
fn test_mutual_extension_succeeds() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600); // 1 hour deadline
    let original_deadline = h.c().get_trade(&trade_id).expires_at.unwrap();
    let new_deadline = original_deadline + 3600; // extend by another hour

    h.c().extend_deadline(&trade_id, &new_deadline);

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, Some(new_deadline));
}

/// Happy path: confirm DeadlineExtendedEvent is emitted.
#[test]
fn test_extend_deadline_emits_event() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();
    let new_deadline = original + 7200;

    h.c().extend_deadline(&trade_id, &new_deadline);

    let topics = last_event_topics(&h.env);
    let topic_str = std::format!("{:?}", topics.first().unwrap());
    assert!(
        topic_str.contains("DEDEXT"),
        "expected DeadlineExtended event, got: {topic_str}"
    );
}

/// Rejection: trade not in Funded status (still Created).
#[test]
#[should_panic(expected = "Trade must be Funded to extend deadline")]
fn test_extend_deadline_fails_if_not_funded() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    h.tok().mint(&h.buyer, &100_000);
    let trade_id = h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000,
        &5000u32,
        &5000u32,
        &Some(deadline),
    );
    // Trade is Created, not Funded

    let new_deadline = deadline + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: cannot extend a deadline that has already passed.
#[test]
#[should_panic(expected = "Cannot extend a deadline that has already passed")]
fn test_extend_deadline_fails_if_past_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    // Advance past the deadline
    h.advance_time(3601);

    let new_deadline = h.now() + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: new deadline must be in the future.
#[test]
#[should_panic(expected = "New deadline must be in the future")]
fn test_extend_deadline_fails_if_new_deadline_in_past() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let past = h.now() - 1;
    h.c().extend_deadline(&trade_id, &past);
}

/// Rejection: trade has no deadline set.
#[test]
#[should_panic(expected = "Trade has no deadline to extend")]
fn test_extend_deadline_fails_if_no_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_no_deadline(100_000);

    let new_deadline = h.now() + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: only buyer signs (seller did not authorize).
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_extend_deadline_fails_if_only_buyer_signs() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let new_dl = deadline + 7200;
    // Override auths to only include buyer — seller auth is missing.
    h.c()
        .mock_auths(&[MockAuth {
            address: &h.buyer,
            invoke: &MockAuthInvoke {
                contract: &h.escrow,
                fn_name: "extend_deadline",
                args: (&trade_id, &new_dl).into_val(&h.env),
                sub_invokes: &[],
            },
        }])
        .extend_deadline(&trade_id, &new_dl);
}

/// Rejection: only seller signs (buyer did not authorize).
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_extend_deadline_fails_if_only_seller_signs() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let new_dl = deadline + 7200;
    // Override auths to only include seller — buyer auth is missing.
    h.c()
        .mock_auths(&[MockAuth {
            address: &h.seller,
            invoke: &MockAuthInvoke {
                contract: &h.escrow,
                fn_name: "extend_deadline",
                args: (&trade_id, &new_dl).into_val(&h.env),
                sub_invokes: &[],
            },
        }])
        .extend_deadline(&trade_id, &new_dl);
}

// ---------------------------------------------------------------------------
// #194  Extension caps — count cap, absolute lifetime cap, and admin policy
// ---------------------------------------------------------------------------
//
// Without a cap a seller can string a reluctant buyer along indefinitely: each
// individual extension looks reasonable and requires both signatures, but a
// buyer facing "extend or lose the goods" has no real exit. These tests pin the
// boundaries of both caps, since an off-by-one in either direction is the whole
// difference between a cap that binds and one that does not.

/// Default policy constants, mirrored from the contract for readability.
const DEFAULT_MAX_EXTENSIONS: u32 = 3;
const DEFAULT_MAX_TOTAL_EXTENSION_SECS: u64 = 30 * 24 * 60 * 60;

/// True when any emitted event carries `needle` in its first topic.
fn any_event_topic_contains(env: &Env, needle: &str) -> bool {
    let all = env.events().all();
    all.events().iter().any(|event| {
        let topics = match &event.body {
            ContractEventBody::V0(v0) => v0.topics.to_vec(),
        };
        topics
            .first()
            .map(|topic| std::format!("{topic:?}").contains(needle))
            .unwrap_or(false)
    })
}

/// The default policy applies to trades created before any admin configured one.
#[test]
fn test_default_extension_policy_applies_without_admin_config() {
    let h = H::new();
    h.init();

    let policy = h.c().get_extension_policy();
    assert_eq!(policy.max_extensions, DEFAULT_MAX_EXTENSIONS);
    assert_eq!(
        policy.max_total_extension_secs,
        DEFAULT_MAX_TOTAL_EXTENSION_SECS
    );
}

/// Count cap: the third extension is permitted, the fourth is not.
#[test]
#[should_panic(expected = "Trade has exhausted its deadline extension allowance")]
fn test_fourth_extension_is_rejected_at_the_count_cap() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    // Three extensions exhaust the default allowance.
    for step in 1..=DEFAULT_MAX_EXTENSIONS as u64 {
        h.c().extend_deadline(&trade_id, &(original + step * 3600));
    }
    assert_eq!(
        h.c().get_extension_status(&trade_id).extensions_used,
        DEFAULT_MAX_EXTENSIONS
    );

    // The fourth must be refused.
    h.c()
        .extend_deadline(&trade_id, &(original + 4 * 3600));
}

/// Boundary: at cap-1 used, one extension remains and is flagged as final.
#[test]
fn test_status_flags_the_final_extension() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    h.c().extend_deadline(&trade_id, &(original + 3600));
    let after_one = h.c().get_extension_status(&trade_id);
    assert_eq!(after_one.extensions_remaining, 2);
    assert!(!after_one.is_final_extension);

    h.c().extend_deadline(&trade_id, &(original + 7200));
    let after_two = h.c().get_extension_status(&trade_id);
    assert_eq!(after_two.extensions_used, 2);
    assert_eq!(after_two.extensions_remaining, 1);
    assert!(
        after_two.is_final_extension,
        "one remaining extension must be flagged so the UI can warn"
    );
    assert!(!after_two.is_exhausted);

    h.c().extend_deadline(&trade_id, &(original + 10_800));
    let after_three = h.c().get_extension_status(&trade_id);
    assert_eq!(after_three.extensions_remaining, 0);
    assert!(after_three.is_exhausted);
}

/// Lifetime cap boundary: exactly at the cap is permitted.
#[test]
fn test_extension_exactly_at_the_lifetime_cap_is_allowed() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    let at_cap = original + DEFAULT_MAX_TOTAL_EXTENSION_SECS;
    h.c().extend_deadline(&trade_id, &at_cap);

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, Some(at_cap));

    let status = h.c().get_extension_status(&trade_id);
    assert_eq!(status.extended_by_secs, DEFAULT_MAX_TOTAL_EXTENSION_SECS);
    assert_eq!(status.extension_secs_remaining, 0);
    assert!(
        status.is_exhausted,
        "a spent lifetime budget exhausts the trade even with count remaining"
    );
}

/// Lifetime cap boundary: one second past the cap is refused.
#[test]
#[should_panic(expected = "New deadline exceeds the maximum total extension for this trade")]
fn test_extension_one_second_past_the_lifetime_cap_is_rejected() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    h.c()
        .extend_deadline(&trade_id, &(original + DEFAULT_MAX_TOTAL_EXTENSION_SECS + 1));
}

/// The lifetime cap is measured from the *original* deadline, so a sequence of
/// individually-modest extensions cannot walk past a limit that a single large
/// extension would hit. This is the griefing vector the cap exists to close.
#[test]
#[should_panic(expected = "New deadline exceeds the maximum total extension for this trade")]
fn test_small_extensions_cannot_outflank_the_lifetime_cap() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    // Two extensions of 20 days each: the second is only 20 days past the
    // *current* deadline but 40 days past the original.
    h.c()
        .extend_deadline(&trade_id, &(original + 20 * 24 * 60 * 60));
    h.c()
        .extend_deadline(&trade_id, &(original + 40 * 24 * 60 * 60));
}

/// An "extension" that does not move the deadline forward would burn budget
/// while giving the buyer nothing.
#[test]
#[should_panic(expected = "New deadline must be later than the current deadline")]
fn test_extension_must_move_the_deadline_forward() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 7200);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    h.c().extend_deadline(&trade_id, &original);
}

/// The remaining budget is published so indexers and clients can surface it.
#[test]
fn test_extension_emits_budget_event() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    h.c().extend_deadline(&trade_id, &(original + 3600));

    assert!(
        any_event_topic_contains(&h.env, "DEDBGT"),
        "extension must publish the remaining-budget event"
    );
    // The extension event still lands last, so existing listeners are unaffected.
    let topics = last_event_topics(&h.env);
    let topic_str = std::format!("{:?}", topics.first().unwrap());
    assert!(
        topic_str.contains("DEDEXT"),
        "DeadlineExtended must remain the final event, got: {topic_str}"
    );
}

/// Status before any extension treats the current deadline as the original.
#[test]
fn test_status_before_any_extension() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    let status = h.c().get_extension_status(&trade_id);
    assert_eq!(status.extensions_used, 0);
    assert_eq!(status.extensions_remaining, DEFAULT_MAX_EXTENSIONS);
    assert_eq!(status.original_deadline, Some(original));
    assert_eq!(status.extended_by_secs, 0);
    assert_eq!(
        status.extension_secs_remaining,
        DEFAULT_MAX_TOTAL_EXTENSION_SECS
    );
    assert!(!status.is_exhausted);
}

/// Admin can tighten the policy, and the new caps bind immediately.
#[test]
#[should_panic(expected = "Trade has exhausted its deadline extension allowance")]
fn test_admin_tightened_count_cap_binds_immediately() {
    let h = H::new();
    h.init();

    h.c().set_extension_policy(&1u32, &DEFAULT_MAX_TOTAL_EXTENSION_SECS);
    assert_eq!(h.c().get_extension_policy().max_extensions, 1);

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();

    h.c().extend_deadline(&trade_id, &(original + 3600));
    h.c().extend_deadline(&trade_id, &(original + 7200));
}

/// A zero-count policy disables extensions entirely.
#[test]
#[should_panic(expected = "Trade has exhausted its deadline extension allowance")]
fn test_zero_count_policy_disables_extensions() {
    let h = H::new();
    h.init();

    h.c().set_extension_policy(&0u32, &DEFAULT_MAX_TOTAL_EXTENSION_SECS);

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();
    h.c().extend_deadline(&trade_id, &(original + 3600));
}

/// The admin cannot raise the count cap beyond the hard ceiling — otherwise the
/// cap offers buyers no guarantee against a compromised admin key.
#[test]
#[should_panic(expected = "max_extensions exceeds the policy ceiling")]
fn test_admin_cannot_exceed_count_ceiling() {
    let h = H::new();
    h.init();

    h.c()
        .set_extension_policy(&13u32, &DEFAULT_MAX_TOTAL_EXTENSION_SECS);
}

/// Same for the lifetime ceiling.
#[test]
#[should_panic(expected = "max_total_extension_secs exceeds the policy ceiling")]
fn test_admin_cannot_exceed_lifetime_ceiling() {
    let h = H::new();
    h.init();

    let over_ceiling = 365 * 24 * 60 * 60 + 1;
    h.c().set_extension_policy(&3u32, &over_ceiling);
}

// ---------------------------------------------------------------------------
// #451  Boundary conditions — near-overflow timestamps and zero-extension
// ---------------------------------------------------------------------------

/// A new_deadline near u64::MAX exceeds the maximum total extension budget and
/// must be refused.  Without this guard an adversary could anchor a deadline at
/// u64::MAX, preventing expiration checks from ever firing.
#[test]
#[should_panic(expected = "New deadline exceeds the maximum total extension for this trade")]
fn test_near_overflow_timestamp_is_rejected() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);

    // u64::MAX is astronomically larger than any allowed extension budget.
    h.c().extend_deadline(&trade_id, &u64::MAX);
}

/// A new_deadline of u64::MAX - 1 must also be rejected for the same reason.
#[test]
#[should_panic(expected = "New deadline exceeds the maximum total extension for this trade")]
fn test_near_overflow_timestamp_minus_one_is_rejected() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);

    h.c().extend_deadline(&trade_id, &(u64::MAX - 1));
}

/// A zero-extension (new_deadline == current deadline) must be rejected.
/// Accepting it would burn the extension count without advancing the deadline,
/// giving the buyer nothing while exhausting the allowance.
#[test]
#[should_panic(expected = "New deadline must be later than the current deadline")]
fn test_zero_extension_amount_is_rejected() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let current = h.c().get_trade(&trade_id).expires_at.unwrap();

    // new_deadline == current deadline → no advancement
    h.c().extend_deadline(&trade_id, &current);
}

/// A single-second extension (minimum valid advancement) must succeed as long
/// as it stays within the lifetime budget.  This is the boundary on the other
/// side — the smallest non-zero extension that is not a zero-extension.
#[test]
fn test_single_second_extension_succeeds() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let current = h.c().get_trade(&trade_id).expires_at.unwrap();

    // Advance by exactly 1 second.
    h.c().extend_deadline(&trade_id, &(current + 1));

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(
        trade.expires_at,
        Some(current + 1),
        "single-second extension must move the deadline forward by exactly 1 s"
    );
    let status = h.c().get_extension_status(&trade_id);
    assert_eq!(status.extended_by_secs, 1);
    assert_eq!(status.extensions_used, 1);
}
