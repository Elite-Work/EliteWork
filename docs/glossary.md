# Glossary — Amana / EziAgric domain terms

> Tracking issue: [#479](https://github.com/Elite-Work/EliteWork/issues/479)

Terms like *Loss Ratio*, *PoD*, *cNGN* and *Trust Score* are used throughout the
contracts, backend, frontend and docs without ever being defined in one place.
This glossary is the lookup table for that vocabulary: every entry says what the
term means **and** where it is defined in the codebase, so a definition can be
checked against its source rather than inferred from context.

Start here if you are reading a design doc, reviewing a money-math change, or
picking up an issue in `contracts/`. Terms are alphabetical; the **Source of
truth** column points at the file that is authoritative and should be updated
alongside any change in meaning.

## Naming: Amana, EziAgric and EliteWork

All three names are still in use, and none of them is a mistake:

| Name | Where it appears | Meaning |
| --- | --- | --- |
| **EliteWork** | Product, docs, UI copy, GitHub org/repo | The current brand name. |
| **EziAgric** | Older docs, issue history, archive notes | The previous brand name; replaced in the [rebrand release note](./releases/2026-10-19-rebrand-eziagric-to-elitework.md). |
| **Amana** (`amana_escrow`, `amana_*` metrics) | Contract crate, backend identifiers, this docs directory | Legacy internal codename, kept because renaming the crate or metrics would require a deployment/migration. Read it as "the project". |

## Terms

| Term | Meaning | Source of truth |
| --- | --- | --- |
| **ADR** | Architecture Decision Record — a numbered, immutable note capturing a decision, its context and its consequences. Referenced as `ADR-00N`, listed under [`docs/adr/`](./adr). | [`docs/adr/`](./adr) |
| **Amana** | The project's internal codename; see the naming table above. The on-chain escrow crate is `amana_escrow`. | [Rebrand note](./releases/2026-10-19-rebrand-eziagric-to-elitework.md) |
| **Basis points (bps)** | The unit for every fraction in the protocol: **1 bps = 0.01%**, so `10_000` bps = 100%. All on-chain math is integer bps (`BPS_DIVISOR = 10_000`) — there are no floats in Soroban. | [ADR-002](./adr/ADR-002-escrow-loss-sharing-model.md) |
| **Buyer / Seller** | The two parties to a trade. The buyer funds the escrow; the seller delivers the goods. A dispute can be raised by either, but the escrow always holds the **buyer's** money, which is why ambiguous rulings resolve toward the buyer. | [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **cNGN** | A Nigerian-naira-pegged Stellar asset, and the platform's token symbol in the backend (`TOKEN_CONFIG.symbol`). A buyer can pay in local-currency assets while the escrow locks value in cNGN, converted atomically through a Stellar path payment. | [`docs/api/wallet.md`](./api/wallet.md), [ADR-001](./adr/ADR-001-stellar-path-payment-architecture.md) |
| **Clawback (admin clawback)** | An emergency, admin-only recovery of funds from a trade. Cumulative clawbacks per trade are capped at the original amount (`ClawbackTotal`), the feature can be disabled by an admin, and large clawbacks are meant to travel through the timelock. | [`docs/admin_clawback_function.md`](./admin_clawback_function.md), [`docs/cli-clawback.md`](./cli-clawback.md) |
| **Cooperative** | A group of traders (farmers, aggregators) onboarded as a unit during the pilot. Cooperative *members* and *admins* are allowlisted off-chain; cooperative features are gated by that membership, not by a new on-chain role. | [ADR-006](./adr/ADR-006-cooperative-account-model.md), [ADR-007](./adr/ADR-007-cooperative-admin-role.md), [ADR-013](./adr/ADR-013-pilot-onboarding.md) |
| **Delivery manifest** | The dispatch record a seller submits before delivery: hashes of the driver's name and ID, anchored on-chain. Only hashes are stored — the identity data stays off-chain (PII). | [`docs/api/manifest.md`](./api/manifest.md), [ADR-010](./adr/ADR-010-offline-manifest-and-evidence-sync.md) |
| **Dispute** | The `Disputed` state a funded trade enters when a party contests delivery or condition, carrying a `DisputeRecord` with the initiator and a reason hash. On-chain a settled dispute returns the trade to `Completed`; there is no separate "resolved" trade status. | [`docs/api/dispute.md`](./api/dispute.md), [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Dispute evidence** | Hash-only records (`EvidenceRecord`) appended during a dispute by a party or a mediator: an `ipfs_hash`, an optional `description_hash`, the submitter and a timestamp. The list is append-only and FIFO, so ordering is deterministic. | [`docs/api/evidence.md`](./api/evidence.md), [ADR-003](./adr/ADR-003-offchain-vs-onchain-data-partitioning.md) |
| **Escrow** | The contract-held balance for a trade. Funds leave the buyer's wallet at `deposit` and are released only by contract rules (release, dispute settlement, clawback or expiry refund), which is what replaces "trust the other party". | [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Event topic** | The short symbol topic stamped on each contract event (`[TRADE]`, `[DISRES]`, `[DVOTE]`, `[DQURES]`, `[MEDADD]`, …). Backend listeners and the event-schema drift check dispatch on it, so a topic is public interface and is never reused. | [`docs/event-schema.md`](./event-schema.md), [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Fee (`fee_bps`)** | The platform fee, taken **from the seller's gross share only** and accrued inside the contract (`AccruedFees`) for later withdrawal rather than pushed to the treasury at settlement. The README quotes 1%; admin updates are bounded to `MIN_FEE_BPS` (1) … `MAX_FEE_BPS` (500). | [`docs/api/treasury.md`](./api/treasury.md), [ADR-002](./adr/ADR-002-escrow-loss-sharing-model.md) |
| **Guardian** | An address the admin registers (`add_guardian`) that may `pause` / `unpause` the contract in an emergency. Guardians can stop state changes; they cannot move funds. | [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Idempotency-Key** | An optional header on mutating backend endpoints. A retried request with the same key replays the original response; the same key with a *different* body is rejected with `409` instead of silently serving the wrong result. | [ADR-004](./adr/ADR-004-idempotency-and-retry-strategy.md), [`docs/api/overview.md`](./api/overview.md) |
| **Loss Ratio** | The pair `buyer_loss_bps` / `seller_loss_bps` agreed by both parties at trade creation, which **must sum to exactly `10_000`**. It says how a loss (if one occurs) is shared between them — not how large the loss is. It is immutable for the trade, and the mediator never sets it. | [ADR-002](./adr/ADR-002-escrow-loss-sharing-model.md) |
| **Mediator** | An approved dispute resolver. A mediator either rules alone (`resolve_dispute`, low-value trades) or votes (`cast_dispute_vote`, trades above the quorum value threshold). Authorisation comes from the mediator registry, or the legacy single-mediator slot. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Mediator registry / legacy slot** | Two authorisation paths: `MediatorRegistry(address)` (add/remove, the current path) and the older single `Mediator` slot written by `set_mediator`. Removing a mediator clears both, so revocation is complete. | [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Mediator weight** | How much one mediator's vote counts. Default `1`, admin-settable, capped at `MAX_MEDIATOR_WEIGHT` (10). The cap is what keeps "quorum" meaningful: without it a weight could exceed `required_weight` and quietly restore single-signature resolution. Weight is snapshotted on the vote, so later changes do not rewrite the tally. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Off-chain mirror** | The Postgres/Prisma copy of trade state used for listing, filtering and pagination. It mirrors on-chain status but is never authoritative: funds and the numbers that move them live on-chain only. | [ADR-003](./adr/ADR-003-offchain-vs-onchain-data-partitioning.md), [`docs/event-flow.md`](./event-flow.md) |
| **Path payment** | A Stellar operation that lets the buyer pay in one asset (e.g. NGN or cNGN) while the escrow receives another, converted atomically on the DEX. Quotes are read-only, un-cached, and protected by retry + circuit breaker. | [ADR-001](./adr/ADR-001-stellar-path-payment-architecture.md), [`docs/api/stellar.md`](./api/stellar.md) |
| **Pilot cohort** | The first set of cooperatives and their members, tracked as its own metric dimension (trades, GMV, dispute rate per cooperative/region) and gated by an environment-variable allowlist instead of full KYC. | [ADR-009](./adr/ADR-009-pilot-cohort-metrics.md), [ADR-013](./adr/ADR-013-pilot-onboarding.md) |
| **PoD (Proof of Delivery)** | The video-and-driver confirmation that goods arrived in the expected condition. On-chain the contract stores only the IPFS CID (`submit_video_proof`), one immutable proof per trade, which becomes the evidence a dispute leans on. | [`README.md`](../README.md), [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Quorum** | The weighted-vote path for high-value disputes: a dispute settles only when enough **weight backing one outcome** reaches `required_weight`. Quorum is *agreement*, not turnout — votes for different outcomes do not pool. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Quorum config** | `enabled`, `value_threshold`, `required_weight`, `vote_window_secs`, `fallback_min_weight`. Quorum is **disabled by default**; enabling it is a deliberate governance action. `fallback_min_weight` may never exceed `required_weight`. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Quorum fallback** | The liveness valve. Once the vote window closes without quorum, either trade party (or a mediator) can apply the **plurality** outcome, provided at least `fallback_min_weight` voted. A tie breaks to the **lowest `seller_gets_bps`** — the buyer-protective direction. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Rationale hash** | The mandatory reason attached to a quorum vote: an IPFS CID or digest of the mediator's written reasoning, non-empty and at most `MAX_HASH_LEN` (256 bytes). The contract stores the hash, never the text. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Schema version** | Two independent monotonic versions: `CURRENT_SCHEMA_VERSION` for storage layout and `EVENT_SCHEMA_VERSION` for event payloads. They let readers detect an older trade record or event without migrating everything at once. | [`docs/event-schema.md`](./event-schema.md) |
| **`seller_gets_bps`** | The mediator's ruling: what fraction of the total the seller deserves, `0`–`10_000`. Everything else — loss, buyer refund, fee, seller net — is derived from it and the trade's immutable Loss Ratio. | [ADR-002](./adr/ADR-002-escrow-loss-sharing-model.md) |
| **Settlement** | The payout step that moves an escrowed trade to `Completed`: seller net + buyer refund + accrued fee always equal the escrowed total, with no remainder floating outside the contract. | [ADR-002](./adr/ADR-002-escrow-loss-sharing-model.md) |
| **Timelock** | The mandatory delay between queuing and executing a privileged operation: 1 day for clawbacks, 7 days for contract upgrades. A compromised admin key therefore cannot drain funds or ship new code instantly. | [`docs/TIMELOCK_POLICY.md`](./TIMELOCK_POLICY.md) |
| **Trade** | One escrowed deal (`TradeV0`): buyer, seller, token, amount, status, loss ratios and an optional deadline. It is the unit every other term in this glossary hangs off. | [`contracts/amana_escrow/INTERFACE.md`](../contracts/amana_escrow/INTERFACE.md) |
| **Trade status** | The lifecycle enum: `Created` → `Funded` → `Delivered` → `Completed`, with `Disputed` (from `Funded`) and `Cancelled` as the exits. Transitions are enforced on-chain; anything else reverts. | [`contracts/amana_escrow/src/types.rs`](../contracts/amana_escrow/src/types.rs) |
| **Trust Score** | A 0–100 reputation score computed **off-chain** from a wallet's trade history: starts at 50, `+5` per completed trade, `−8` per initiated dispute that was resolved/closed, `−2` per initiated dispute, plus a volume bonus (`+5`/`+8`/`+15` at 10/25/50 trades), clamped to 0–100. It is advisory — it never gates escrow logic. | [`backend/src/services/reputation.service.ts`](../backend/src/services/reputation.service.ts) |
| **TTL (time-to-live)** | Soroban's per-entry expiry, measured in ledgers. The contract bumps instance TTL on state transitions (`bump_instance_ttl`) so an idle deployment does not silently archive its configuration. | [`contracts/amana_escrow/src/lib.rs`](../contracts/amana_escrow/src/lib.rs) |
| **Value threshold** | The escrow amount at or above which a dispute requires quorum instead of a single mediator (`DEFAULT_QUORUM_VALUE_THRESHOLD` = 10,000,000,000). Below it, one mediator still decides. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |
| **Vote window** | `vote_window_secs` (default 7 days), measured from the **first vote** rather than from the dispute's start, after which the fallback unlocks. A dispute nobody has looked at yet therefore cannot quietly age into a fallback. | [`docs/mediator-quorum.md`](./mediator-quorum.md) |

## Keeping this glossary accurate

- A term's **Source of truth** is the file that must change when the meaning
  changes; update the row in the same PR.
- New protocol-level constants with names a reader would not know (`MAX_*`,
  `DEFAULT_*`, `*_bps`) deserve a row here.
- If a term is aspirational rather than implemented, say so explicitly instead
  of describing the intended behaviour as current.

## See also

- [Contributor onboarding](./onboarding.md) — issue-to-PR workflow.
- [Architecture Decision Records](./adr) — the reasoning behind the terms above.
- [Contract interface](../contracts/amana_escrow/INTERFACE.md) — every
  entrypoint and its preconditions.
- [Mediator quorum](./mediator-quorum.md) — the long-form design of the quorum
  terms.
