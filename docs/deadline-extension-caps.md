# Deadline extension caps

Tracking issue: [#194](https://github.com/Elite-Work/EliteWork/issues/194)

## Why

`extend_deadline()` requires both the buyer's and the seller's signature, which
looks like sufficient protection until you consider what a buyer is actually
choosing between. Their capital is already escrowed. Refusing an extension does
not return it — it starts a dispute. So "extend or we go to mediation" is a
credible threat a seller can repeat indefinitely, and each individual extension
looks reasonable in isolation.

Two caps close that: a limit on **how many times** a deadline may move, and an
absolute limit on **how far** it may move from where it started.

## The caps

| Cap | Default | Ceiling | Contract constant |
| --- | --- | --- | --- |
| Extension count | 3 | 12 | `DEFAULT_MAX_DEADLINE_EXTENSIONS` |
| Total extension | 30 days | 365 days | `DEFAULT_MAX_TOTAL_EXTENSION_SECS` |

Both apply together — an extension must satisfy the count cap *and* the lifetime
cap.

The lifetime cap is measured from the trade's **original** deadline, captured on
its first extension and stored under `DataKey::OriginalDeadline(trade_id)`. This
is the part that makes the cap bind: measuring from the *current* deadline would
let a seller walk the deadline forward in small steps forever, each step
individually inside the limit.

The ceilings bound what an admin may configure. A cap an admin can raise without
limit is not a cap, and this is what a buyer relies on if the admin key is ever
compromised.

## Contract interface

```rust
// Read the active policy. Returns the defaults when no admin has set one,
// so trades predating the policy are governed by the defaults, not uncapped.
get_extension_policy() -> ExtensionPolicy

// Admin only. Both values are checked against the ceilings.
// max_extensions = 0 disables extensions entirely.
set_extension_policy(max_extensions: u32, max_total_extension_secs: u64)

// Per-trade remaining budget — the read model behind the "final extension"
// warning. Read-only, safe to call before the parties sign.
get_extension_status(trade_id: u64) -> ExtensionStatus
```

`ExtensionStatus` carries `is_final_extension` (exactly one left — warn before
signing) and `is_exhausted` (no extension possible under either cap).

## Events

`extend_deadline()` publishes two events, in this order:

1. `DeadlineExtensionBudgetEvent` (topic `DEDBGT`) — the remaining budget.
2. `DeadlineExtendedEvent` (topic `DEDEXT`) — unchanged from before.

The budget is a **separate event** rather than new fields on
`DeadlineExtendedEvent`. The v1 event shapes are locked by
`event_schema_tests.rs` and consumed by deployed listeners, and the schema policy
on `EVENT_SCHEMA_VERSION` admits new event types without disturbing existing
ones. Listeners that want the budget subscribe to `DEDBGT`; listeners that do
not are unaffected. `DEDEXT` remains the last event the call emits, which
existing consumers rely on to identify the extension.

## Backend mirror

`backend/src/services/deadlineExtension.service.ts` mirrors both caps so the API
can refuse an over-cap extension before the parties assemble and sign a
transaction the chain would only revert, and so clients can render the remaining
budget without a contract round-trip.

**The contract is authoritative.** The mirror is a convenience; a caller can
always reach `extend_deadline()` directly. The two must agree, and
`deadlineExtension.service.test.ts` pins the boundary cases that would otherwise
drift apart silently. When the contract's constants change, change the mirror's
in the same PR.

Rejection reasons are evaluated in the same order as the contract's assertions,
so the first failure reported is the same on both sides:

`NO_DEADLINE` → `ALREADY_EXPIRED` → `NOT_IN_FUTURE` → `NOT_LATER_THAN_CURRENT` →
`COUNT_EXHAUSTED` → `LIFETIME_CAP_EXCEEDED`

## Admin configuration

Changing the policy is an on-chain admin action, authorised by the admin address
stored at `DataKey::Admin`:

```bash
soroban contract invoke \
  --id "$ESCROW_CONTRACT_ID" \
  --source-account "$ADMIN" \
  -- set_extension_policy \
  --max_extensions 3 \
  --max_total_extension_secs 2592000
```

It emits `ExtensionPolicyUpdatedEvent` (topic `EXTPOL`). A policy change applies
to every trade immediately, including trades mid-flight: a trade that has
already used more extensions than a newly-tightened cap allows simply cannot
extend again. It is never applied retroactively to shorten a deadline already in
force.

Validate a policy against the ceilings before submitting it with
`assertPolicyWithinCeilings()` from the backend service, which rejects with a
400 rather than letting the transaction revert.
