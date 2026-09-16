# Mediator quorum for high-value disputes

Tracking issue: [#195](https://github.com/Elite-Work/EliteWork/issues/195)

## Why

Every dispute, regardless of size, resolved on one mediator's signature. That
put the weakest trust guarantee on the largest trades — the ones where the
incentive to bribe a mediator is highest and the loss from a bad decision is
worst. A platform positioned as "Trust as a Service" cannot have its trust model
thin out precisely as the stakes rise.

Above a configured value threshold, disputes now resolve by weighted vote across
several mediators instead.

## Escalation policy

```
                    dispute initiated
                            │
                 amount >= value_threshold
                    and quorum enabled?
                    │                  │
                   no                 yes
                    │                  │
            resolve_dispute      cast_dispute_vote
         (one mediator decides)   (each mediator votes once,
                                   with a rationale hash)
                                          │
                            ┌─────────────┴─────────────┐
                    one outcome reaches        vote_window_secs
                    required_weight            elapses without it
                            │                          │
                       settles as              resolve_dispute_by_fallback
                    QuorumOutcome::Quorum      (plurality, needs
                                                fallback_min_weight)
                                                        │
                                                   settles as
                                              QuorumOutcome::Fallback
```

Three properties make this safe:

**Quorum is agreement, not turnout.** Weight pools per *outcome*, not across all
votes. Three mediators voting for three different splits reach nothing.

**A stuck quorum still resolves.** Requiring N mediators to agree introduces a
liveness risk that the single-mediator design did not have: if they never agree,
the escrow is frozen. The fallback closes that. Trading a trust problem for a
worse liveness problem would not be an improvement.

**Ties break toward the buyer.** A tie must resolve deterministically, and the
lowest `seller_gets_bps` among the tied outcomes wins. The buyer is the party
whose funds are held and who did not receive what they paid for, so ambiguity
resolves in their favour.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch. Off means every dispute uses the single-mediator path. |
| `value_threshold` | 10,000,000,000 | Escrow value at or above which quorum applies. |
| `required_weight` | 3 | Weight one outcome needs to settle. |
| `vote_window_secs` | 7 days | From the **first vote** until fallback unlocks. |
| `fallback_min_weight` | 2 | Weight that must have voted for fallback to proceed. |

Quorum is **disabled by default**. Enabling it changes how deployed trades
resolve, so it is a deliberate governance action rather than something that
arrives with an upgrade.

`fallback_min_weight` may not exceed `required_weight` — a fallback threshold
above the quorum threshold could never be met by a vote set that already failed
quorum, which would strand the escrow.

The window runs from the first vote, not from the dispute's start, so a dispute
nobody has looked at yet does not quietly age into a fallback.

## Mediator weights

Each mediator carries a weight (default 1), settable by the admin and capped at
`MAX_MEDIATOR_WEIGHT` (10). Weighting lets a deployment recognise seniority
without maintaining separate mediator tiers. The cap is what keeps "quorum"
meaningful: without it an admin could set one mediator's weight above
`required_weight` and quietly restore single-signature resolution.

## Contract interface

```rust
get_quorum_config() -> QuorumConfig
set_quorum_config(enabled, value_threshold, required_weight,
                  vote_window_secs, fallback_min_weight)   // admin

get_mediator_weight(mediator) -> u32
set_mediator_weight(mediator, weight)                       // admin

requires_quorum(trade_id) -> bool
cast_dispute_vote(trade_id, mediator, seller_gets_bps, rationale_hash)
get_dispute_votes(trade_id) -> Vec<MediatorVote>
resolve_dispute_by_fallback(trade_id, caller)
```

`resolve_dispute()` now rejects any trade that requires quorum, so the two paths
cannot be confused or used to bypass one another.

`resolve_dispute_by_fallback` is callable by either trade party or any approved
mediator. The parties are the ones whose funds are stuck; they must not have to
wait for a mediator to choose to act.

## Audit trail

Every vote emits `DisputeVoteCastEvent` (topic `DVOTE`) carrying the voter, the
outcome they chose, their weight, and their rationale hash — including votes that
did not prevail. Votes stay in storage after resolution; `get_dispute_votes()`
keeps answering, because the trail is the record of a decision that moved money.

Resolution emits `DisputeQuorumResolvedEvent` (topic `DQURES`) with the winning
outcome, the weight behind it, and whether it was `Quorum` or `Fallback`.
`DisputeResolvedEvent` still fires with the payout figures, so listeners that
only track settlement need no change.

Rationale hashes are IPFS CIDs or digests of the mediator's written reasoning.
The contract stores the hash, never the text; it enforces only that one is
present and within `MAX_HASH_LEN`.

## Backend mirror

`backend/src/services/mediatorQuorum.service.ts` mirrors the tally, the distance
to quorum, and the fallback timing so the mediator dashboard can show a live
picture and refuse an impossible vote before a mediator signs.

**The contract is authoritative.** `mediatorQuorum.service.test.ts` and
`quorum_stress_tests.rs` pin the same branches — quorum, split vote, tie,
timeout — so drift between the layers shows up as a test failure rather than as
a dispute resolving two different ways depending on who you ask.

## Not yet built

The dashboard's sequential multi-signature flow (issue point 4) is not part of
this change. The contract and its mirror expose everything that flow needs —
`get_dispute_votes`, `quorumStatus`, and the `DVOTE` / `DQURES` events — but
`frontend/src/app/mediator` still renders the single-mediator resolution form.
