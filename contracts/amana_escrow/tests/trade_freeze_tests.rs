/// Issue #498 — per-trade emergency freeze.
///
/// `freeze_trade(trade_id)` is an admin-only escape hatch for the Phase 4
/// operations incident path. These tests cover the two acceptance criteria and
/// the containment property that makes a *per-trade* freeze different from the
/// existing contract-wide guardian pause:
///   - auth guard: only the admin may freeze or unfreeze;
///   - affected entry points: deposit, release, dispute settlement and clawback;
///   - blast radius: other trades stay fully operable.
extern crate std;

use amana_escrow::{TradeStatus, auth_invoke, test_fixture::AdminSignerFixture};
use soroban_sdk::{
    symbol_short,
    testutils::Events as _,
    Env, IntoVal, Val, Vec,
};

type Harness = AdminSignerFixture;

fn freeze_auth_args(env: &Env, trade_id: u64) -> Vec<Val> {
    soroban_sdk::vec![env, trade_id.into_val(env)]
}

fn create_trade(h: &Harness, amount: i128) -> u64 {
    h.mint(&h.buyer, amount);
    h.client()
        .create_trade(&h.buyer, &h.seller, &amount, &5000u32, &5000u32, &None)
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

#[test]
fn admin_can_freeze_and_unfreeze_a_trade() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);

    h.client().freeze_trade(&tid);
    assert!(h.client().is_trade_frozen(&tid), "trade should be frozen");

    h.client().unfreeze_trade(&tid);
    assert!(!h.client().is_trade_frozen(&tid), "trade should be unfrozen");
}

#[test]
fn freeze_emits_the_frozen_event() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);

    h.client().freeze_trade(&tid);

    let all = h.env.events().all();
    let last = all.events().last().expect("freeze must emit an event");
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &last.body;
    let expected: soroban_sdk::xdr::ScVal = symbol_short!("TRDFRZ").into_val(&h.env);
    assert_eq!(body.topics.get(0).unwrap(), &expected);
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn stranger_cannot_freeze_a_trade() {
    let h = Harness::new();
    let tid = create_trade(&h, 1_000);
    let args = freeze_auth_args(&h.env, tid);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.stranger, "freeze_trade", args)])
        .freeze_trade(&tid);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn buyer_cannot_freeze_a_trade() {
    let h = Harness::new();
    let tid = create_trade(&h, 1_000);
    let args = freeze_auth_args(&h.env, tid);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.buyer, "freeze_trade", args)])
        .freeze_trade(&tid);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn stranger_cannot_unfreeze_a_trade() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().freeze_trade(&tid);
    let args = freeze_auth_args(&h.env, tid);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.stranger, "unfreeze_trade", args)])
        .unfreeze_trade(&tid);
}

#[test]
#[should_panic(expected = "Trade not found")]
fn cannot_freeze_an_unknown_trade() {
    let h = Harness::new();
    h.client().freeze_trade(&99_999u64);
}

// ---------------------------------------------------------------------------
// Blocked entry points
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "trade is frozen")]
fn frozen_trade_blocks_deposit() {
    let h = Harness::new();
    let tid = create_trade(&h, 1_000);
    h.client().freeze_trade(&tid);

    h.client().deposit(&tid);
}

#[test]
#[should_panic(expected = "trade is frozen")]
fn frozen_trade_blocks_release() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().confirm_delivery(&tid);
    h.client().freeze_trade(&tid);

    h.client().release_funds(&tid, &h.buyer);
}

#[test]
#[should_panic(expected = "trade is frozen")]
fn frozen_trade_blocks_admin_clawback() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().freeze_trade(&tid);

    h.client().admin_clawback(&tid, &1_000i128, &h.buyer);
}

#[test]
#[should_panic(expected = "trade is frozen")]
fn frozen_trade_blocks_queued_clawback() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().freeze_trade(&tid);

    h.client().queue_clawback(&tid, &1_000i128, &h.buyer);
}

#[test]
#[should_panic(expected = "trade is frozen")]
fn frozen_trade_blocks_dispute_settlement() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client()
        .initiate_dispute(&tid, &h.buyer, &soroban_sdk::String::from_str(&h.env, "ipfs://reason"));
    h.client().freeze_trade(&tid);

    h.client().resolve_dispute(&tid, &h.mediator, &5_000u32);
}

// ---------------------------------------------------------------------------
// Blast radius: unrelated trades continue normally
// ---------------------------------------------------------------------------

#[test]
fn freezing_one_trade_does_not_affect_another() {
    let h = Harness::new();
    let frozen = create_trade(&h, 1_000);
    let healthy = create_trade(&h, 2_000);

    h.client().freeze_trade(&frozen);
    h.client().deposit(&healthy);

    assert!(matches!(
        h.client().get_trade(&healthy).status,
        TradeStatus::Funded
    ));
    assert!(h.client().is_trade_frozen(&frozen));
}

#[test]
fn unfreeze_restores_deposit_and_release() {
    let h = Harness::new();
    let tid = create_trade(&h, 1_000);
    h.client().freeze_trade(&tid);
    h.client().unfreeze_trade(&tid);

    h.client().deposit(&tid);
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.buyer);

    assert!(matches!(
        h.client().get_trade(&tid).status,
        TradeStatus::Completed
    ));
}
