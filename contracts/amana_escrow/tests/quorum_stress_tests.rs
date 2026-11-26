/// Issue #195 — Mediator quorum stress scenarios.
///
/// Mirrors the harness and style of `dispute_stress_tests.rs`, covering the
/// paths that decide who gets someone's money when no single mediator is
/// trusted to decide alone:
///   - Threshold gating: below it the single-mediator path still applies
///   - Weighted accumulation to quorum, including one heavy mediator
///   - Split votes that never reach quorum, and the deadline fallback
///   - Tie-breaking, which must be deterministic and buyer-protective
///   - Double-vote rejection and mediator-registry churn mid-vote
///   - Settlement invariants after every quorum path
///   - The mediator-roster and vote-weight ceilings (#453)
extern crate std;

use amana_escrow::{
    EscrowContract, EscrowContractClient, QuorumOutcome, TradeStatus, MAX_MEDIATOR_WEIGHT,
};
use soroban_sdk::{
    Address, Env, String as SStr,
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    token,
};

const THRESHOLD: i128 = 1_000_000;
const WINDOW_SECS: u64 = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

struct Quorum {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    treasury: Address,
    mediators: std::vec::Vec<Address>,
}

impl Quorum {
    /// Register `mediator_count` mediators and enable quorum at `THRESHOLD`
    /// with the given required and fallback weights.
    fn new(fee_bps: u32, mediator_count: usize, required_weight: u32, fallback_min: u32) -> Self {
        Self::build(
            Env::default(),
            fee_bps,
            mediator_count,
            required_weight,
            fallback_min,
        )
    }

    /// The same harness with snapshot capture disabled.
    ///
    /// The roster-ceiling cases (#453) drive a full mediator roster through the
    /// whole quorum path and assert each outcome directly, so a golden ledger
    /// dump per case would be large and low-signal. That is the same reasoning
    /// `state_machine_fuzz_tests.rs` records for its generated cases.
    fn new_without_snapshot(
        fee_bps: u32,
        mediator_count: usize,
        required_weight: u32,
        fallback_min: u32,
    ) -> Self {
        Self::build(
            Env::new_with_config(EnvTestConfig {
                capture_snapshot_at_drop: false,
            }),
            fee_bps,
            mediator_count,
            required_weight,
            fallback_min,
        )
    }

    fn build(
        env: Env,
        fee_bps: u32,
        mediator_count: usize,
        required_weight: u32,
        fallback_min: u32,
    ) -> Self {
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000;
        });

        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());

        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &usdc_id, &treasury, &fee_bps, &usdc_id);

        let mut mediators = std::vec::Vec::new();
        for _ in 0..mediator_count {
            let m = Address::generate(&env);
            client.add_mediator(&m);
            mediators.push(m);
        }

        client.set_quorum_config(
            &true,
            &THRESHOLD,
            &required_weight,
            &WINDOW_SECS,
            &fallback_min,
        );

        Quorum {
            env,
            contract_id,
            usdc_id,
            admin,
            buyer,
            seller,
            treasury,
            mediators,
        }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.usdc_id).mint(to, &amount);
    }

    fn tok(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.usdc_id)
    }

    fn disputed_trade(&self, amount: i128) -> u64 {
        self.mint(&self.buyer, amount);
        let tid = self.client().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &None,
        );
        self.client().deposit(&tid);
        self.client().initiate_dispute(
            &tid,
            &self.buyer,
            &SStr::from_str(&self.env, "QmQuorumDispute"),
        );
        tid
    }

    fn vote(&self, tid: u64, mediator_idx: usize, bps: u32, rationale: &str) {
        self.client().cast_dispute_vote(
            &tid,
            &self.mediators[mediator_idx],
            &bps,
            &SStr::from_str(&self.env, rationale),
        );
    }

    fn advance(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }

    /// Assert every stroop escrowed has been accounted for after settlement.
    fn assert_conservation(&self, amount: i128) {
        let escrow_balance = self.tok().balance(&self.contract_id);
        let buyer_balance = self.tok().balance(&self.buyer);
        let seller_balance = self.tok().balance(&self.seller);
        assert_eq!(
            buyer_balance + seller_balance + escrow_balance,
            amount,
            "conservation violated: buyer + seller + escrow must equal the escrowed total"
        );
    }
}

// ---------------------------------------------------------------------------
// Threshold gating
// ---------------------------------------------------------------------------

/// Below the threshold a dispute is still one mediator's to decide — quorum is
/// reserved for the trades whose size justifies the extra coordination.
#[test]
fn test_below_threshold_uses_single_mediator_path() {
    let q = Quorum::new(100, 3, 3, 2);
    let amount = THRESHOLD - 1;
    let tid = q.disputed_trade(amount);

    assert!(!q.client().requires_quorum(&tid));

    q.client().resolve_dispute(&tid, &q.mediators[0], &7_000u32);

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

/// At the threshold exactly, quorum is required.
#[test]
fn test_at_threshold_requires_quorum() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD);
    assert!(q.client().requires_quorum(&tid));
}

/// A single mediator cannot short-circuit a high-value dispute.
#[test]
#[should_panic(expected = "Trade value requires a mediator quorum")]
fn test_single_mediator_cannot_resolve_high_value_dispute() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 5);

    q.client().resolve_dispute(&tid, &q.mediators[0], &7_000u32);
}

/// With quorum disabled the single-mediator path applies at any value — the
/// default posture, so enabling quorum is a deliberate governance action.
#[test]
fn test_disabled_quorum_leaves_single_mediator_path_intact() {
    let q = Quorum::new(100, 3, 3, 2);
    q.client()
        .set_quorum_config(&false, &THRESHOLD, &3u32, &WINDOW_SECS, &2u32);

    let amount = THRESHOLD * 10;
    let tid = q.disputed_trade(amount);
    assert!(!q.client().requires_quorum(&tid));

    q.client().resolve_dispute(&tid, &q.mediators[0], &6_000u32);
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

// ---------------------------------------------------------------------------
// Reaching quorum
// ---------------------------------------------------------------------------

/// Three unit-weight mediators agreeing settles on the third vote, with no
/// further call needed.
#[test]
fn test_quorum_reached_settles_on_the_deciding_vote() {
    let q = Quorum::new(100, 3, 3, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 7_000, "QmRationale0");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Disputed);

    q.vote(tid, 1, 7_000, "QmRationale1");
    assert_eq!(
        q.client().get_trade(&tid).status,
        TradeStatus::Disputed,
        "two of three votes must not settle"
    );

    q.vote(tid, 2, 7_000, "QmRationale2");
    assert_eq!(
        q.client().get_trade(&tid).status,
        TradeStatus::Completed,
        "the deciding vote must settle without a separate call"
    );

    q.assert_conservation(amount);
}

/// Votes are retained after settlement — they are the audit trail for a
/// decision that moved money.
#[test]
fn test_votes_retained_after_resolution() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmRationale0");
    q.vote(tid, 1, 7_000, "QmRationale1");
    q.vote(tid, 2, 7_000, "QmRationale2");

    let votes = q.client().get_dispute_votes(&tid);
    assert_eq!(votes.len(), 3);
    for (idx, vote) in votes.iter().enumerate() {
        assert_eq!(vote.seller_gets_bps, 7_000);
        assert_eq!(vote.weight, 1);
        assert_eq!(
            vote.rationale_hash,
            SStr::from_str(&q.env, &std::format!("QmRationale{idx}")),
            "each vote must retain its own rationale hash"
        );
    }
}

/// Weight, not headcount, is what reaches quorum: one weight-3 mediator can
/// carry it alone when the admin has deliberately weighted them that way.
#[test]
fn test_weighted_mediator_reaches_quorum_alone() {
    let q = Quorum::new(100, 3, 3, 2);
    q.client().set_mediator_weight(&q.mediators[0], &3u32);
    assert_eq!(q.client().get_mediator_weight(&q.mediators[0]), 3);

    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 8_000, "QmHeavyRationale");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

/// Mixed weights accumulate across mediators.
#[test]
fn test_mixed_weights_accumulate_to_quorum() {
    let q = Quorum::new(100, 4, 4, 2);
    q.client().set_mediator_weight(&q.mediators[0], &3u32);

    let amount = THRESHOLD * 6;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 5_000, "QmWeighted");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Disputed);

    // 3 + 1 == the required weight of 4.
    q.vote(tid, 1, 5_000, "QmUnit");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

/// Votes for different outcomes do not pool — quorum is agreement on one
/// outcome, not merely turnout.
#[test]
fn test_disagreeing_votes_do_not_reach_quorum() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 3_000, "QmB");
    q.vote(tid, 2, 10_000, "QmC");

    assert_eq!(
        q.client().get_trade(&tid).status,
        TradeStatus::Disputed,
        "three votes across three outcomes must not settle anything"
    );
}

// ---------------------------------------------------------------------------
// Double voting and registry churn
// ---------------------------------------------------------------------------

/// A mediator votes once. Otherwise quorum is trivially defeated.
#[test]
#[should_panic(expected = "Mediator has already voted on this dispute")]
fn test_mediator_cannot_vote_twice() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmFirst");
    q.vote(tid, 0, 7_000, "QmSecond");
}

/// Nor can a mediator change their mind by voting for a different outcome.
#[test]
#[should_panic(expected = "Mediator has already voted on this dispute")]
fn test_mediator_cannot_switch_vote() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmFirst");
    q.vote(tid, 0, 2_000, "QmSwitched");
}

/// A mediator removed from the registry mid-vote can no longer vote, but the
/// vote they already cast stands — it was valid when made.
#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_removed_mediator_cannot_vote() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmBeforeRemoval");
    q.client().remove_mediator(&q.mediators[0]);
    assert_eq!(
        q.client().get_dispute_votes(&tid).len(),
        1,
        "an already-cast vote survives the voter's removal"
    );

    q.client().cast_dispute_vote(
        &tid,
        &q.mediators[0],
        &7_000u32,
        &SStr::from_str(&q.env, "QmAfterRemoval"),
    );
}

/// A rationale hash is mandatory — a vote that moves money must be accountable
/// to a stated reason.
#[test]
#[should_panic(expected = "rationale_hash must not be empty")]
fn test_vote_requires_rationale_hash() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.client().cast_dispute_vote(
        &tid,
        &q.mediators[0],
        &7_000u32,
        &SStr::from_str(&q.env, ""),
    );
}

// ---------------------------------------------------------------------------
// Deadline fallback
// ---------------------------------------------------------------------------

/// Before the window closes there is no fallback — otherwise the window means
/// nothing and a minority could settle immediately.
#[test]
#[should_panic(expected = "Vote window has not closed yet")]
fn test_fallback_rejected_before_window_closes() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");

    q.advance(WINDOW_SECS - 1);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);
}

/// After the window, the plurality outcome settles the dispute. Without this a
/// quorum that never assembles would strand the escrow permanently.
#[test]
fn test_fallback_applies_plurality_after_window() {
    let q = Quorum::new(100, 4, 3, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");
    q.vote(tid, 2, 2_000, "QmC");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Disputed);

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

/// The window runs from the first vote, not from the dispute's start.
#[test]
fn test_fallback_window_runs_from_the_first_vote() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    // A long quiet period before anyone votes must not consume the window.
    q.advance(WINDOW_SECS * 2);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
}

/// Too little weight voted for a fallback to be legitimate.
#[test]
#[should_panic(expected = "Insufficient vote weight for fallback resolution")]
fn test_fallback_rejected_below_minimum_weight() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmLonely");

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);
}

/// A dispute with no votes at all has nothing to fall back to.
#[test]
#[should_panic(expected = "No votes cast on this dispute")]
fn test_fallback_rejected_with_no_votes() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);
}

/// Either party may trigger the fallback — their funds are the ones stuck, so
/// they must not depend on a mediator choosing to act.
#[test]
fn test_seller_can_trigger_fallback() {
    let q = Quorum::new(100, 4, 3, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.seller);
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    q.assert_conservation(amount);
}

/// A stranger cannot.
#[test]
#[should_panic(expected = "Only a trade party or an approved mediator may trigger fallback")]
fn test_stranger_cannot_trigger_fallback() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");

    let stranger = Address::generate(&q.env);
    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &stranger);
}

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

/// A tie must break deterministically, and toward the buyer: they are the party
/// whose funds are held and who did not receive what they paid for.
#[test]
fn test_tie_breaks_to_the_lower_seller_share() {
    let q = Quorum::new(0, 4, 4, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    // Two votes each for 8_000 and 2_000 — a dead heat on weight.
    q.vote(tid, 0, 8_000, "QmHighA");
    q.vote(tid, 1, 2_000, "QmLowA");
    q.vote(tid, 2, 8_000, "QmHighB");
    q.vote(tid, 3, 2_000, "QmLowB");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Disputed);

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);

    // The tie broke to seller_gets_bps = 2_000. With 50/50 loss sharing and no
    // platform fee that is:
    //   loss_bps     = 10_000 - 2_000              = 8_000
    //   seller_loss  = amount * 0.8 * 0.5          = 0.4 * amount
    //   seller_raw   = amount - seller_loss        = 0.6 * amount
    //   buyer_refund = amount - seller_raw         = 0.4 * amount
    // Had it broken to 8_000 the buyer would have received only 0.1 * amount,
    // so this figure is what distinguishes the two directions.
    assert_eq!(
        q.tok().balance(&q.buyer),
        amount * 4 / 10,
        "a tie must break to the lower seller share, which pays the buyer more"
    );
    assert_eq!(q.tok().balance(&q.seller), amount * 6 / 10);
    q.assert_conservation(amount);
}

// ---------------------------------------------------------------------------
// Config validation and isolation
// ---------------------------------------------------------------------------

/// A fallback threshold above the quorum threshold could never be met by a vote
/// set that failed quorum, which would strand the escrow.
#[test]
#[should_panic(expected = "fallback_min_weight must not exceed required_weight")]
fn test_fallback_min_weight_cannot_exceed_required_weight() {
    let q = Quorum::new(100, 3, 3, 2);
    q.client()
        .set_quorum_config(&true, &THRESHOLD, &2u32, &WINDOW_SECS, &3u32);
}

/// Weighting cannot quietly collapse a quorum into one decisive signature.
#[test]
#[should_panic(expected = "mediator weight exceeds the maximum")]
fn test_mediator_weight_is_capped() {
    let q = Quorum::new(100, 3, 3, 2);
    q.client().set_mediator_weight(&q.mediators[0], &11u32);
}

/// Votes on one trade never leak into another.
#[test]
fn test_votes_isolated_across_trades() {
    let q = Quorum::new(100, 3, 3, 2);
    let tid_a = q.disputed_trade(THRESHOLD * 4);
    let tid_b = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid_a, 0, 7_000, "QmA0");
    q.vote(tid_a, 1, 7_000, "QmA1");
    q.vote(tid_b, 0, 3_000, "QmB0");

    assert_eq!(q.client().get_dispute_votes(&tid_a).len(), 2);
    assert_eq!(q.client().get_dispute_votes(&tid_b).len(), 1);
    assert_eq!(q.client().get_trade(&tid_a).status, TradeStatus::Disputed);
    assert_eq!(q.client().get_trade(&tid_b).status, TradeStatus::Disputed);
}

/// The quorum resolution event distinguishes the two ways a dispute can end,
/// so the audit trail records which one applied.
#[test]
fn test_quorum_outcome_variants_are_distinct() {
    assert_ne!(QuorumOutcome::Quorum, QuorumOutcome::Fallback);
}

// ---------------------------------------------------------------------------
// Maximum mediator roster and weight ceilings (#453)
// ---------------------------------------------------------------------------

/// The largest mediator roster these cases exercise.
///
/// The contract does not cap the registry; what it caps is *weight* — a
/// mediator carries at least `DEFAULT_MEDIATOR_WEIGHT` and at most
/// `MAX_MEDIATOR_WEIGHT` (10), and a dispute settles the moment
/// `required_weight` backs one outcome. The roster ceiling that follows from
/// that is a roster of `required_weight` unit-weight mediators: a larger roster
/// cannot all be *needed*, yet every one of them must still be able to vote
/// when the outcome splits and the dispute falls through to the deadline
/// fallback. These cases pin that ceiling at both ends — a roster sized exactly
/// to `required_weight`, a roster carried entirely by maximum weights, and the
/// `u32` weight ceiling where quorum can never assemble and the fallback is the
/// only thing that unsticks the escrow.
const MAX_MEDIATORS: usize = 20;

/// A roster sized exactly to `required_weight` settles on the final vote, not
/// before: no early settlement from a partial roster.
#[test]
fn test_roster_at_ceiling_settles_on_the_final_vote() {
    let q = Quorum::new_without_snapshot(100, MAX_MEDIATORS, MAX_MEDIATORS as u32, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    for idx in 0..MAX_MEDIATORS - 1 {
        q.vote(tid, idx, 7_000, &std::format!("QmCeiling{idx}"));
        assert_eq!(
            q.client().get_trade(&tid).status,
            TradeStatus::Disputed,
            "a roster-sized quorum must not settle before the last vote"
        );
    }

    q.vote(tid, MAX_MEDIATORS - 1, 7_000, "QmCeilingFinal");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    assert_eq!(
        q.client().get_dispute_votes(&tid).len(),
        MAX_MEDIATORS as u32,
        "every roster vote must be recorded"
    );
    q.assert_conservation(amount);
}

/// A full roster voting at the maximum weight reaches a quorum that is itself
/// expressed in maximum-weight units — the largest tally the roster can carry.
#[test]
fn test_roster_at_ceiling_with_max_weights_reaches_quorum() {
    let required_weight = (MAX_MEDIATORS as u32) * MAX_MEDIATOR_WEIGHT;
    let q = Quorum::new_without_snapshot(100, MAX_MEDIATORS, required_weight, 2);
    for mediator in q.mediators.iter() {
        q.client().set_mediator_weight(mediator, &MAX_MEDIATOR_WEIGHT);
    }

    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    for idx in 0..MAX_MEDIATORS - 1 {
        q.vote(tid, idx, 6_000, &std::format!("QmMaxWeight{idx}"));
        assert_eq!(
            q.client().get_trade(&tid).status,
            TradeStatus::Disputed,
            "the roster must still be one vote short of a maximum-weight quorum"
        );
    }

    q.vote(tid, MAX_MEDIATORS - 1, 6_000, "QmMaxWeightFinal");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    let votes = q.client().get_dispute_votes(&tid);
    assert_eq!(votes.len(), MAX_MEDIATORS as u32);
    for vote in votes.iter() {
        assert_eq!(vote.weight, MAX_MEDIATOR_WEIGHT);
    }
    q.assert_conservation(amount);
}

/// A roster at the ceiling that splits evenly reaches nothing and must still
/// unstuck itself: the fallback applies the plurality, and the tie breaks to
/// the lower seller share so the buyer is refunded more.
#[test]
fn test_roster_at_ceiling_split_votes_fall_back_to_the_tie_break() {
    let q = Quorum::new_without_snapshot(0, MAX_MEDIATORS, MAX_MEDIATORS as u32, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    for idx in 0..MAX_MEDIATORS {
        let bps = if idx % 2 == 0 { 8_000 } else { 2_000 };
        q.vote(tid, idx, bps, &std::format!("QmSplit{idx}"));
    }

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Disputed);
    assert_eq!(q.client().get_dispute_votes(&tid).len(), MAX_MEDIATORS as u32);

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.buyer);

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    // Ten votes each way is a dead heat on weight; the tie broke to 2_000, so
    // with 50/50 loss sharing and no platform fee the buyer receives 40%.
    assert_eq!(q.tok().balance(&q.buyer), amount * 4 / 10);
    assert_eq!(q.tok().balance(&q.seller), amount * 6 / 10);
    q.assert_conservation(amount);
}

/// At the weight ceiling the roster can never assemble a quorum, so the
/// fallback is what keeps the escrow live — and the weight tally must sum
/// without overflowing `u32`.
#[test]
fn test_roster_at_ceiling_cannot_reach_max_weight_and_falls_back() {
    let q = Quorum::new_without_snapshot(100, MAX_MEDIATORS, u32::MAX, 2);
    for mediator in q.mediators.iter() {
        q.client().set_mediator_weight(mediator, &MAX_MEDIATOR_WEIGHT);
    }

    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    for idx in 0..MAX_MEDIATORS {
        q.vote(tid, idx, 6_000, &std::format!("QmWeightCeiling{idx}"));
    }

    assert_eq!(
        q.client().get_trade(&tid).status,
        TradeStatus::Disputed,
        "a maximum-weight roster still sits below a u32-maximum required weight"
    );

    q.advance(WINDOW_SECS);
    q.client().resolve_dispute_by_fallback(&tid, &q.seller);

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    let votes = q.client().get_dispute_votes(&tid);
    assert_eq!(votes.len(), MAX_MEDIATORS as u32);
    let total_weight: u32 = votes.iter().map(|vote| vote.weight).sum();
    assert_eq!(
        total_weight,
        (MAX_MEDIATORS as u32) * MAX_MEDIATOR_WEIGHT,
        "the weight tally must accumulate, not overflow"
    );
    q.assert_conservation(amount);
}

/// Once quorum settles, the rest of the roster is locked out — a large roster
/// must not become a way to keep voting on a decided dispute.
#[test]
#[should_panic(expected = "Trade must be in Disputed status")]
fn test_roster_at_ceiling_cannot_vote_after_quorum_settles() {
    let q = Quorum::new_without_snapshot(100, MAX_MEDIATORS, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");
    q.vote(tid, 2, 7_000, "QmC");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);

    // Seventeen registered mediators remain, and none of them may vote now.
    q.vote(tid, 3, 7_000, "QmLate");
}

/// Weight is read when the vote is cast and stays fixed: raising a mediator's
/// weight afterwards must not retroactively strengthen their earlier vote, or
/// the audit trail would not describe the tally that decided the dispute.
#[test]
fn test_roster_vote_weight_is_snapshotted_at_the_ceiling() {
    let q = Quorum::new_without_snapshot(100, MAX_MEDIATORS, MAX_MEDIATORS as u32, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 7_000, "QmSnapshot0");
    q.client().set_mediator_weight(&q.mediators[0], &MAX_MEDIATOR_WEIGHT);
    assert_eq!(q.client().get_mediator_weight(&q.mediators[0]), MAX_MEDIATOR_WEIGHT);

    // If the raised weight counted retroactively the quorum would settle after
    // ten more votes; it must need all twenty recorded unit weights instead.
    for idx in 1..MAX_MEDIATORS - 1 {
        q.vote(tid, idx, 7_000, &std::format!("QmSnapshot{idx}"));
        assert_eq!(
            q.client().get_trade(&tid).status,
            TradeStatus::Disputed,
            "a re-weighted mediator must not settle the dispute early"
        );
    }

    q.vote(tid, MAX_MEDIATORS - 1, 7_000, "QmSnapshotFinal");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);

    let votes = q.client().get_dispute_votes(&tid);
    assert_eq!(votes.len(), MAX_MEDIATORS as u32);
    assert_eq!(
        votes.get(0).unwrap().weight,
        1,
        "the weight recorded at vote time is the weight that was tallied"
    );
    q.assert_conservation(amount);
}

/// A resolved dispute cannot be voted on again.
#[test]
#[should_panic(expected = "Trade must be in Disputed status")]
fn test_cannot_vote_after_resolution() {
    let q = Quorum::new(100, 4, 3, 2);
    let tid = q.disputed_trade(THRESHOLD * 4);

    q.vote(tid, 0, 7_000, "QmA");
    q.vote(tid, 1, 7_000, "QmB");
    q.vote(tid, 2, 7_000, "QmC");
    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);

    q.vote(tid, 3, 7_000, "QmLate");
}

/// Admin and treasury are part of the harness contract setup; touching them
/// here keeps the fields live and documents that quorum does not change fee
/// routing.
#[test]
fn test_quorum_settlement_leaves_fee_routing_unchanged() {
    let q = Quorum::new(100, 3, 3, 2);
    let amount = THRESHOLD * 4;
    let tid = q.disputed_trade(amount);

    q.vote(tid, 0, 10_000, "QmA");
    q.vote(tid, 1, 10_000, "QmB");
    q.vote(tid, 2, 10_000, "QmC");

    assert_eq!(q.client().get_trade(&tid).status, TradeStatus::Completed);
    // Fees accrue inside the contract for later withdrawal rather than being
    // pushed to the treasury at settlement time.
    assert_eq!(
        q.tok().balance(&q.treasury),
        0,
        "settlement must not transfer fees to the treasury directly"
    );
    assert!(q.client().get_accrued_fees() > 0, "platform fee must accrue");
    let _ = &q.admin;
    q.assert_conservation(amount);
}
