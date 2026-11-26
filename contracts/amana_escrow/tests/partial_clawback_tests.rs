//! Issue #94 — Contract test coverage for partial clawback
//!
//! Validates the `admin_clawback` entry point across a range of scenarios:
//!
//!   1. A single partial clawback reduces `trade.amount` correctly and leaves
//!      the trade in its original status (Funded or Disputed).
//!   2. Multiple successive partial clawbacks each reduce the remaining balance
//!      and cumulatively track the full clawed-back total via `get_clawback_total`.
//!   3. A clawback that equals the entire remaining balance cancels the trade.
//!   4. Attempting to clawback more than the remaining balance is rejected.
//!   5. Clawback is blocked on non-clawbackable statuses (Created, Delivered,
//!      Completed, Cancelled).
//!   6. Only the admin may call `admin_clawback`.
//!
//! # Terminology
//! In the Amana escrow context, "clawback" means the admin reclaims a portion
//! of the escrowed principal — for example, to comply with a regulatory order
//! or to handle a detected fraud scenario — before the normal trade resolution
//! path (release / dispute / expiry) has concluded.
//!
//! # Expected post-clawback state
//! | Action                          | `trade.amount` | `trade.status`   |
//! |---------------------------------|----------------|------------------|
//! | Partial clawback, funds remain  | original − cb  | unchanged        |
//! | Full clawback (zero remaining)  | 0              | Cancelled        |
//! | Second partial, funds remain    | prev − cb2     | unchanged        |

extern crate std;

use amana_escrow::{TradeStatus, test_fixture::AdminSignerFixture};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    xdr::ContractEventBody,
    xdr::ScVal,
    Address, String as SStr,
};

type Harness = AdminSignerFixture;

fn disputed_trade(h: &Harness, amount: i128) -> u64 {
    let trade_id = h.funded_trade(amount);
    h.client().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SStr::from_str(&h.env, "QmClawbackTest"),
    );
    trade_id
}

/// Helper: return the raw ScVal fields of the most-recently emitted event.
fn last_event_data(h: &Harness) -> std::vec::Vec<ScVal> {
    let all = h.env.events().all();
    let events = all.events();
    let last = events.last().unwrap();
    match &last.body {
        ContractEventBody::V0(v0) => match &v0.data {
            ScVal::Map(Some(map)) => {
                let mut vals = std::vec::Vec::new();
                for entry in map.iter() {
                    vals.push(entry.val.clone());
                }
                vals
            }
            ScVal::Vec(Some(fields)) => fields.to_vec(),
            other => panic!("unexpected event data shape: {other:?}"),
        },
    }
}

// ---------------------------------------------------------------------------
// #94-1  Single partial clawback reduces trade.amount; status unchanged
// ---------------------------------------------------------------------------

#[test]
fn partial_clawback_reduces_trade_amount() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let destination = Address::generate(&h.env);

    // Clawback 3 000 out of 10 000
    h.client().admin_clawback(&trade_id, &3_000_i128, &destination);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(
        trade.amount, 7_000,
        "trade.amount must decrease by the clawback amount"
    );
    assert!(
        matches!(trade.status, TradeStatus::Funded),
        "trade must remain Funded after a partial clawback"
    );
}

// ---------------------------------------------------------------------------
// #94-2  Token balances are correct after partial clawback
// ---------------------------------------------------------------------------

#[test]
fn partial_clawback_transfers_correct_token_amount() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let destination = Address::generate(&h.env);

    assert_eq!(
        h.token().balance(&h.contract_id),
        10_000,
        "contract must hold full amount before clawback"
    );
    assert_eq!(h.token().balance(&destination), 0);

    h.client().admin_clawback(&trade_id, &4_000_i128, &destination);

    assert_eq!(
        h.token().balance(&h.contract_id),
        6_000,
        "contract must hold remaining amount after clawback"
    );
    assert_eq!(
        h.token().balance(&destination),
        4_000,
        "destination must receive exactly the clawback amount"
    );
}

// ---------------------------------------------------------------------------
// #94-3  Multiple successive partial clawbacks across one trade
// ---------------------------------------------------------------------------

#[test]
fn multiple_partial_clawbacks_reduce_balance_incrementally() {
    let h = Harness::new();
    let trade_id = h.funded_trade(12_000);
    let dest = Address::generate(&h.env);

    // First clawback: 3 000
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);
    assert_eq!(h.client().get_trade(&trade_id).amount, 9_000);
    assert_eq!(h.client().get_clawback_total(&trade_id), 3_000);

    // Second clawback: 4 000
    h.client().admin_clawback(&trade_id, &4_000_i128, &dest);
    assert_eq!(h.client().get_trade(&trade_id).amount, 5_000);
    assert_eq!(h.client().get_clawback_total(&trade_id), 7_000);

    // Third clawback: 2 000
    h.client().admin_clawback(&trade_id, &2_000_i128, &dest);
    assert_eq!(h.client().get_trade(&trade_id).amount, 3_000);
    assert_eq!(h.client().get_clawback_total(&trade_id), 9_000);

    // Trade still Funded; normal operations can continue
    assert!(matches!(
        h.client().get_trade(&trade_id).status,
        TradeStatus::Funded
    ));
}

// ---------------------------------------------------------------------------
// #94-4  Cumulative get_clawback_total after multiple clawbacks
// ---------------------------------------------------------------------------

#[test]
fn get_clawback_total_tracks_cumulative_clawback() {
    let h = Harness::new();
    let trade_id = h.funded_trade(20_000);
    let dest = Address::generate(&h.env);

    assert_eq!(
        h.client().get_clawback_total(&trade_id),
        0,
        "clawback total must start at zero"
    );

    h.client().admin_clawback(&trade_id, &5_000_i128, &dest);
    h.client().admin_clawback(&trade_id, &5_000_i128, &dest);
    h.client().admin_clawback(&trade_id, &5_000_i128, &dest);

    assert_eq!(
        h.client().get_clawback_total(&trade_id),
        15_000,
        "clawback total must equal the sum of all clawbacks"
    );
    assert_eq!(
        h.client().get_trade(&trade_id).amount,
        5_000,
        "5 000 must remain in escrow"
    );
}

// ---------------------------------------------------------------------------
// #94-5  Full clawback (zero remaining) cancels the trade
// ---------------------------------------------------------------------------

#[test]
fn full_clawback_cancels_trade() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &10_000_i128, &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(trade.amount, 0, "trade.amount must be zero after full clawback");
    assert!(
        matches!(trade.status, TradeStatus::Cancelled),
        "trade must be Cancelled after a full clawback"
    );
    assert_eq!(h.token().balance(&h.contract_id), 0);
    assert_eq!(h.token().balance(&dest), 10_000);
}

// ---------------------------------------------------------------------------
// #94-6  Partial clawbacks leading to zero: second partial completing the total
// ---------------------------------------------------------------------------

#[test]
fn sequential_clawbacks_reaching_zero_cancel_trade() {
    let h = Harness::new();
    let trade_id = h.funded_trade(6_000);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &4_000_i128, &dest);
    assert!(matches!(
        h.client().get_trade(&trade_id).status,
        TradeStatus::Funded
    ));

    h.client().admin_clawback(&trade_id, &2_000_i128, &dest);
    assert!(
        matches!(h.client().get_trade(&trade_id).status, TradeStatus::Cancelled),
        "final clawback exhausting the balance must cancel the trade"
    );
    assert_eq!(h.client().get_clawback_total(&trade_id), 6_000);
}

// ---------------------------------------------------------------------------
// #94-7  Clawback on a Disputed trade is allowed
// ---------------------------------------------------------------------------

#[test]
fn partial_clawback_allowed_on_disputed_trade() {
    let h = Harness::new();
    let trade_id = disputed_trade(&h, 10_000);
    let dest = Address::generate(&h.env);

    // Clawback while Disputed
    h.client().admin_clawback(&trade_id, &2_000_i128, &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(trade.amount, 8_000);
    // The trade remains Disputed — admin clawback does not auto-resolve the dispute
    assert!(
        matches!(trade.status, TradeStatus::Disputed),
        "trade must remain Disputed after partial clawback"
    );
}

// ---------------------------------------------------------------------------
// #94-8  Over-clawback is rejected (cannot exceed remaining amount)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "clawback_amount exceeds remaining escrowed amount")]
fn over_clawback_is_rejected() {
    let h = Harness::new();
    let trade_id = h.funded_trade(5_000);
    let dest = Address::generate(&h.env);

    // Remove 3 000 first, leaving 2 000
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);

    // Attempt to clawback 3 000 more (2 000 remain) — must panic
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);
}

// ---------------------------------------------------------------------------
// #94-9  Zero-amount clawback is rejected
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "CLAWBACK_INVALID_AMOUNT")]
fn zero_clawback_is_rejected() {
    let h = Harness::new();
    let trade_id = h.funded_trade(5_000);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &0_i128, &dest);
}

// ---------------------------------------------------------------------------
// #94-10  Clawback blocked on Created trade
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn clawback_blocked_on_created_trade() {
    let h = Harness::new();
    let trade_id = h.client().create_trade(
        &h.buyer,
        &h.seller,
        &5_000_i128,
        &5000_u32,
        &5000_u32,
        &None,
    );
    let dest = Address::generate(&h.env);
    // Trade is Created (not yet funded) — must panic
    h.client().admin_clawback(&trade_id, &1_000_i128, &dest);
}

// ---------------------------------------------------------------------------
// #94-11  Clawback blocked on Completed trade
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn clawback_blocked_on_completed_trade() {
    let h = Harness::new();
    let trade_id = h.funded_trade(5_000);
    h.client().confirm_delivery(&trade_id);
    h.client().release_funds(&trade_id, &h.buyer);

    let dest = Address::generate(&h.env);
    h.client().admin_clawback(&trade_id, &1_000_i128, &dest);
}

// ---------------------------------------------------------------------------
// #94-12  ClawbackExecutedEvent payload integrity
// ---------------------------------------------------------------------------

#[test]
fn clawback_event_payload_has_correct_fields() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &4_000_i128, &dest);

    let data = last_event_data(&h);
    // ClawbackExecutedEvent has 6 fields:
    // admin, clawback_amount, destination, remaining_amount, schema_version, trade_id
    assert_eq!(
        data.len(),
        6,
        "ClawbackExecutedEvent must emit exactly 6 payload fields"
    );

    // Verify clawback_amount (I128, = 4 000) and remaining_amount (I128, = 6 000) are present
    let has_clawback_amount = data.iter().any(|v| {
        matches!(v, ScVal::I128(p) if p.lo == 4_000 && p.hi == 0)
    });
    let has_remaining_amount = data.iter().any(|v| {
        matches!(v, ScVal::I128(p) if p.lo == 6_000 && p.hi == 0)
    });
    assert!(has_clawback_amount, "ClawbackExecutedEvent must carry clawback_amount = 4 000");
    assert!(has_remaining_amount, "ClawbackExecutedEvent must carry remaining_amount = 6 000");
}

// ---------------------------------------------------------------------------
// #94-13  get_clawback_total returns zero for untouched trade
// ---------------------------------------------------------------------------

#[test]
fn clawback_total_zero_for_untouched_trade() {
    let h = Harness::new();
    let trade_id = h.funded_trade(5_000);
    assert_eq!(
        h.client().get_clawback_total(&trade_id),
        0,
        "clawback total must be zero before any clawback"
    );
}

// ---------------------------------------------------------------------------
// #94-14  Remaining funds after partial clawback can still be released normally
// ---------------------------------------------------------------------------

#[test]
fn remaining_funds_after_partial_clawback_can_be_released() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    // Admin claws back 3 000; 7 000 remains
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);

    // Normal flow continues on the remaining 7 000
    h.client().confirm_delivery(&trade_id);
    h.client().release_funds(&trade_id, &h.buyer);

    let trade = h.client().get_trade(&trade_id);
    assert!(
        matches!(trade.status, TradeStatus::Completed),
        "trade must reach Completed after clawback + release"
    );

    // seller receives 7 000 minus fee (100 bps = 70), = 6 930
    let fee_bps = 100_u64;
    let remaining = 7_000_i128;
    let expected_fee = remaining * fee_bps as i128 / 10_000;
    let expected_seller = remaining - expected_fee;
    assert_eq!(
        h.token().balance(&h.seller),
        expected_seller,
        "seller must receive remaining funds minus fee"
    );
}

// ---------------------------------------------------------------------------
// Feature flag gating (Issue #113)
// ---------------------------------------------------------------------------

/// Clawback is enabled by default (unset flag preserves current behavior for
/// upgraded deployments).
#[test]
fn clawback_enabled_by_default() {
    let h = Harness::new();
    assert!(h.client().is_clawback_enabled());
}

/// Once an admin disables the feature, `admin_clawback` must be rejected.
#[test]
#[should_panic(expected = "admin_clawback: clawback feature is currently disabled")]
fn clawback_rejected_while_disabled() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    h.client().set_clawback_enabled(&false);
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);
}

/// Re-enabling the feature restores normal clawback behavior.
#[test]
fn clawback_succeeds_after_re_enabling() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    h.client().set_clawback_enabled(&false);
    h.client().set_clawback_enabled(&true);
    h.client().admin_clawback(&trade_id, &3_000_i128, &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(trade.amount, 7_000_i128);
}

// ---------------------------------------------------------------------------
// #452  Partial-amount edge cases — 1 stroop and total-minus-one
// ---------------------------------------------------------------------------

/// Clawback of exactly 1 stroop (the minimum transferable unit) must succeed:
/// the trade remains open with amount reduced by 1, and the destination receives
/// exactly 1 token unit.
#[test]
fn clawback_of_one_stroop_reduces_amount_by_one() {
    let h = Harness::new();
    let trade_id = h.funded_trade(10_000);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &1_i128, &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(
        trade.amount, 9_999,
        "clawback of 1 stroop must reduce trade.amount by exactly 1"
    );
    assert!(
        matches!(trade.status, TradeStatus::Funded),
        "trade must remain Funded after a 1-stroop clawback"
    );
    assert_eq!(
        h.token().balance(&dest),
        1,
        "destination must receive exactly 1 stroop"
    );
    assert_eq!(
        h.client().get_clawback_total(&trade_id),
        1,
        "clawback total must equal 1 after a 1-stroop clawback"
    );
}

/// Clawback of exactly (total − 1) leaves a single stroop in escrow.  The trade
/// must remain open (not cancelled) since 1 unit of escrowed principal remains.
#[test]
fn clawback_of_total_minus_one_leaves_one_stroop_in_escrow() {
    let total: i128 = 10_000;
    let h = Harness::new();
    let trade_id = h.funded_trade(total);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &(total - 1), &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(
        trade.amount, 1,
        "one stroop must remain in escrow after (total - 1) clawback"
    );
    assert!(
        matches!(trade.status, TradeStatus::Funded),
        "trade must remain Funded while any principal remains"
    );
    assert_eq!(
        h.token().balance(&dest),
        total - 1,
        "destination must receive exactly total - 1 stroops"
    );
    assert_eq!(
        h.client().get_clawback_total(&trade_id),
        total - 1,
    );
}

/// Clawback of 1 stroop on a 1-stroop escrow must cancel the trade.
/// This is the degenerate case where a single-unit escrow is fully claimed.
#[test]
fn clawback_of_one_stroop_on_single_stroop_escrow_cancels_trade() {
    let h = Harness::new();
    let trade_id = h.funded_trade(1);
    let dest = Address::generate(&h.env);

    h.client().admin_clawback(&trade_id, &1_i128, &dest);

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(trade.amount, 0);
    assert!(
        matches!(trade.status, TradeStatus::Cancelled),
        "clawback of the only stroop must cancel the trade"
    );
    assert_eq!(h.token().balance(&dest), 1);
}

/// Two successive clawbacks: first 1 stroop, then (total − 1 − 1) stroops,
/// leaving 1 stroop in escrow each time the trade stays Funded, confirming
/// that the cumulative total tracks correctly through two minimal operations.
#[test]
fn successive_one_stroop_and_near_total_clawbacks_track_correctly() {
    let total: i128 = 10_000;
    let h = Harness::new();
    let trade_id = h.funded_trade(total);
    let dest = Address::generate(&h.env);

    // First: 1 stroop
    h.client().admin_clawback(&trade_id, &1_i128, &dest);
    assert_eq!(h.client().get_trade(&trade_id).amount, total - 1);
    assert_eq!(h.client().get_clawback_total(&trade_id), 1);
    assert!(matches!(
        h.client().get_trade(&trade_id).status,
        TradeStatus::Funded
    ));

    // Second: (total - 1 - 1) stroops — leaves 1 stroop
    h.client()
        .admin_clawback(&trade_id, &(total - 2), &dest);
    assert_eq!(h.client().get_trade(&trade_id).amount, 1);
    assert_eq!(h.client().get_clawback_total(&trade_id), total - 1);
    assert!(matches!(
        h.client().get_trade(&trade_id).status,
        TradeStatus::Funded
    ));
}
