/// Issue #102 — Soroban contract integration test for admin clawback path.
///
/// This test suite covers the full end-to-end on-chain flow for admin clawback:
///
///   1. Contract deployment and initialization
///   2. Trade creation and funding
///   3. Admin clawback execution
///   4. Event emission verification
///   5. State update validation
///   6. Query method accuracy
///
/// Uses the shared [`AdminSignerFixture`] (#108).
extern crate std;

use amana_escrow::{EVENT_SCHEMA_VERSION, test_fixture::AdminSignerFixture, TradeStatus};
use soroban_sdk::{
    testutils::{Address as _, Events},
    xdr::{ContractEventBody, ScVal},
    Address, IntoVal, Symbol, TryIntoVal, Val,
};

fn clawback_events(env: &soroban_sdk::Env) -> std::vec::Vec<(std::vec::Vec<ScVal>, std::vec::Vec<ScVal>)> {
    let all = env.events().all();
    let expected_topic: ScVal = IntoVal::<soroban_sdk::Env, Val>::into_val(
        &Symbol::new(env, "CLWBCK"),
        env,
    )
    .try_into_val(env)
    .unwrap();

    all.events()
        .iter()
        .filter_map(|event| {
            let ContractEventBody::V0(v0) = &event.body;
            let topic = v0.topics.first()?;
            if topic != &expected_topic {
                return None;
            }
            let data = match &v0.data {
                ScVal::Map(Some(map)) => map.iter().map(|e| e.val.clone()).collect(),
                ScVal::Vec(Some(fields)) => fields.to_vec(),
                _ => return None,
            };
            Some((v0.topics.to_vec(), data))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

#[test]
fn test_admin_clawback_full_lifecycle() {
    let h = AdminSignerFixture::new();
    let client = h.client();
    let token = h.token();

    let amount = 10_000_i128;
    let trade_id = h.funded_trade(amount);

    assert_eq!(token.balance(&h.contract_id), amount);
    assert_eq!(token.balance(&h.buyer), 0);

    client.admin_clawback(&trade_id, &amount, &h.buyer);

    assert_eq!(token.balance(&h.contract_id), 0);
    assert_eq!(token.balance(&h.buyer), amount);

    let trade = client.get_trade(&trade_id);
    assert!(matches!(trade.status, TradeStatus::Cancelled));
    assert_eq!(trade.amount, 0);
    assert_eq!(client.get_clawback_total(&trade_id), amount);
}

#[test]
fn test_admin_clawback_event_emission() {
    let h = AdminSignerFixture::new();
    let client = h.client();

    let amount = 5_000_i128;
    let trade_id = h.funded_trade(amount);

    client.admin_clawback(&trade_id, &amount, &h.buyer);

    let events = clawback_events(&h.env);
    assert_eq!(events.len(), 1, "Expected exactly one clawback event");

    let (_topics, data) = &events[0];
    assert_eq!(data.len(), 6, "ClawbackExecutedEvent has 6 fields");
    assert!(
        data.iter()
            .any(|v| matches!(v, ScVal::U32(n) if *n == EVENT_SCHEMA_VERSION)),
        "event must include schema_version"
    );
    assert!(
        data.iter()
            .any(|v| matches!(v, ScVal::U64(n) if *n == trade_id)),
        "event must include trade_id"
    );
}

#[test]
fn test_admin_clawback_partial_flow() {
    let h = AdminSignerFixture::new();
    let client = h.client();
    let token = h.token();

    let amount = 10_000_i128;
    let trade_id = h.funded_trade(amount);

    let first_clawback = 3_000_i128;
    client.admin_clawback(&trade_id, &first_clawback, &h.buyer);

    let trade_after_first = client.get_trade(&trade_id);
    assert!(matches!(trade_after_first.status, TradeStatus::Funded));
    assert_eq!(trade_after_first.amount, amount - first_clawback);
    assert_eq!(client.get_clawback_total(&trade_id), first_clawback);

    let second_clawback = 7_000_i128;
    client.admin_clawback(&trade_id, &second_clawback, &h.buyer);

    let trade_after_second = client.get_trade(&trade_id);
    assert!(matches!(trade_after_second.status, TradeStatus::Cancelled));
    assert_eq!(trade_after_second.amount, 0);
    assert_eq!(client.get_clawback_total(&trade_id), amount);
    assert_eq!(token.balance(&h.buyer), amount);
}

#[test]
fn test_admin_clawback_state_query_methods() {
    let h = AdminSignerFixture::new();
    let client = h.client();

    let amount = 8_000_i128;
    let trade_id = h.funded_trade(amount);

    let (original, claimed_before, clawed_before) = client.get_stream_accounting(&trade_id);
    assert_eq!(original, amount);
    assert_eq!(claimed_before, 0);
    assert_eq!(clawed_before, 0);

    let clawback_amt = 3_000_i128;
    client.admin_clawback(&trade_id, &clawback_amt, &h.treasury);

    let (original_after, claimed_after, clawed_after) = client.get_stream_accounting(&trade_id);
    assert_eq!(original_after, amount - clawback_amt);
    assert_eq!(claimed_after, 0);
    assert_eq!(clawed_after, clawback_amt);
}

#[test]
fn test_admin_clawback_multiple_events() {
    let h = AdminSignerFixture::new();
    let client = h.client();

    let amount = 9_000_i128;
    let trade_id = h.funded_trade(amount);

    client.admin_clawback(&trade_id, &2_000, &h.buyer);
    assert_eq!(clawback_events(&h.env).len(), 1);
    client.admin_clawback(&trade_id, &3_000, &h.buyer);
    assert_eq!(clawback_events(&h.env).len(), 1);
    client.admin_clawback(&trade_id, &4_000, &h.buyer);
    assert_eq!(clawback_events(&h.env).len(), 1);
    assert_eq!(client.get_clawback_total(&trade_id), amount);
}

#[test]
fn test_admin_clawback_disputed_trade() {
    let h = AdminSignerFixture::new();
    let client = h.client();
    let token = h.token();

    let amount = 6_000_i128;
    let trade_id = h.funded_trade(amount);

    let reason = soroban_sdk::String::from_str(&h.env, "QmDisputeReason");
    client.initiate_dispute(&trade_id, &h.buyer, &reason);

    assert!(matches!(
        client.get_trade(&trade_id).status,
        TradeStatus::Disputed
    ));

    client.admin_clawback(&trade_id, &amount, &h.buyer);

    assert!(matches!(
        client.get_trade(&trade_id).status,
        TradeStatus::Cancelled
    ));
    assert_eq!(token.balance(&h.buyer), amount);
    assert_eq!(token.balance(&h.contract_id), 0);
}

#[test]
fn test_admin_clawback_to_custom_destination() {
    let h = AdminSignerFixture::new();
    let client = h.client();
    let token = h.token();

    let custom_destination = Address::generate(&h.env);
    let amount = 4_000_i128;
    let trade_id = h.funded_trade(amount);

    client.admin_clawback(&trade_id, &amount, &custom_destination);

    assert_eq!(token.balance(&custom_destination), amount);
    assert_eq!(token.balance(&h.buyer), 0);
    assert_eq!(token.balance(&h.contract_id), 0);
}

#[test]
#[should_panic(expected = "CLAWBACK_INVALID_AMOUNT")]
fn test_admin_clawback_rejects_zero_amount() {
    let h = AdminSignerFixture::new();
    let trade_id = h.funded_trade(5_000);
    h.client().admin_clawback(&trade_id, &0, &h.buyer);
}

#[test]
#[should_panic(expected = "CLAWBACK_INVALID_AMOUNT")]
fn test_admin_clawback_rejects_negative_amount() {
    let h = AdminSignerFixture::new();
    let trade_id = h.funded_trade(5_000);
    h.client().admin_clawback(&trade_id, &(-1), &h.buyer);
}

#[test]
#[should_panic(expected = "clawback_amount exceeds remaining escrowed amount")]
fn test_admin_clawback_rejects_excessive_amount() {
    let h = AdminSignerFixture::new();
    let trade_id = h.funded_trade(5_000);
    h.client().admin_clawback(&trade_id, &10_000, &h.buyer);
}

#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_admin_clawback_rejects_completed_trade() {
    let h = AdminSignerFixture::new();
    let client = h.client();

    let amount = 5_000_i128;
    let trade_id = h.funded_trade(amount);

    client.confirm_delivery(&trade_id);
    client.release_funds(&trade_id, &h.buyer);

    client.admin_clawback(&trade_id, &amount, &h.buyer);
}

#[test]
fn test_admin_clawback_updates_trade_history() {
    let h = AdminSignerFixture::new();
    let client = h.client();

    let amount = 7_000_i128;
    let trade_id = h.funded_trade(amount);

    client.admin_clawback(&trade_id, &amount, &h.buyer);

    let history = client.get_trade_history(&trade_id);
    let clawback_events: std::vec::Vec<_> = history
        .iter()
        .filter(|e| {
            let et = e.event_type.clone();
            // Soroban String has no std Display; compare via to_string helper on bytes length / known tags
            !et.is_empty()
                && (et == soroban_sdk::String::from_str(&h.env, "clawback_full")
                    || et == soroban_sdk::String::from_str(&h.env, "clawback_partial")
                    || et == soroban_sdk::String::from_str(&h.env, "admin_clawback"))
        })
        .collect();

    assert!(
        !clawback_events.is_empty(),
        "Trade history should contain clawback event"
    );
}
