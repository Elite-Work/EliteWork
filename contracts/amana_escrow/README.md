# amana_escrow

This crate contains the Soroban escrow contract used by Amana.

## Documentation

- [Public Interface](INTERFACE.md): every public entrypoint, its parameters, required auth, and the trade state transitions it allows — start here if you are integrating without reading the Rust source
- [Admin Governance Flow](docs/admin-governance.md): Comprehensive documentation on admin clawback operations, compliance requirements, and governance workflows

## Clawback amount bounds

`admin_clawback` / `queue_clawback` accept only strictly positive amounts:

- `amount > 0` — zero and negative values panic with `CLAWBACK_INVALID_AMOUNT`
- `amount <=` remaining escrowed `trade.amount` — over-clawback is rejected

Backend preview/CLI validation mirrors the same lower bound before submitting a transaction.

## Test setup

Contract unit and integration tests share a single **admin signer fixture** in
[`src/test_fixture.rs`](src/test_fixture.rs) (compiled for native / test builds
only; excluded when building with `--features wasm`).

| Item | Role |
|------|------|
| `admin_address(env)` | **Only** place that defines how the test admin is generated. Change this if the admin key / generation strategy changes. |
| `AdminSignerFixture` | Shared harness: env, contract, token, `admin`, `buyer`, `seller`, `mediator`, `treasury`, `stranger`. |
| `auth_invoke!` | Build a `MockAuth` for deny-path tests (non-admin callers). |

**Allow path** — `AdminSignerFixture::new()` enables `mock_all_auths()`:

```rust,ignore
use amana_escrow::test_fixture::AdminSignerFixture;

let f = AdminSignerFixture::new();
let tid = f.funded_trade(1_000);
f.client().admin_clawback(&tid, &1_000i128, &f.buyer);
```

**Deny path** — authorize only a non-admin address:

```rust,ignore
use amana_escrow::{auth_invoke, test_fixture::{clawback_auth_args, AdminSignerFixture}};

let f = AdminSignerFixture::new();
let tid = f.funded_trade(1_000);
let args = clawback_auth_args(&f.env, tid, 1_000, &f.buyer);
f.client()
    .mock_auths(&[auth_invoke!(&f, &f.stranger, "admin_clawback", args)])
    .admin_clawback(&tid, &1_000i128, &f.buyer); // panics: not admin
```

Run the suite from this directory:

```bash
cargo test
# CI:
cargo test --locked
```

## Snapshot regeneration

Snapshot files live in `test_snapshots/` and capture expected outputs (serialized
state, gas baselines, WASM golden binaries). Regenerate them idempotently with:

```bash
# From the repository root:
bash scripts/cleanup-test-snapshots.sh   # remove orphaned snapshots
UPDATE_SNAPSHOTS=1 cargo test --locked   # overwrite snapshots with current output
```

The regeneration is idempotent: running it twice produces identical files with no
diff. Commit updated snapshots in the same PR as the code change that caused them.

For details on snapshot hygiene rules, see [Test Determinism & Snapshot Hygiene](docs/test-determinism.md).

## cNGN migration and upgrade notes

### Migration behavior

- The contract already supports any Stellar token contract address passed to `initialize(admin, usdc_contract, treasury, fee_bps)`.
- For backward-compatibility, the storage key name remains `DataKey::UsdcContract`.
- Trades are token-bound at creation time (`Trade.token`), so existing trades keep their original token address and settlement path.
- The contract is single-initialize; it does not support in-place token switching after initialization.

### Storage compatibility contract

For production upgrades, these compatibility expectations must remain stable:

- `DataKey` variants and serialized layout remain unchanged, especially:
  - `UsdcContract`
  - `Trade(u64)`
  - `Mediator` and `MediatorRegistry(Address)`
  - `DisputeData(u64)`, `EvidenceList(u64)`, `VideoProof(u64)`, `Manifest(u64)`
- `initialize` remains one-time and rejects reinitialization.
- Legacy mediator compatibility is preserved:
  - `set_mediator()` legacy slot continues to interoperate with `add_mediator()` registry entries.
  - `remove_mediator()` continues clearing both legacy and registry paths when applicable.
- Legacy evidence accessor compatibility is preserved:
  - `get_evidence_list()` is the primary API.
  - `get_evidence()` remains available for legacy clients.

### Safe rollout guidance for cNGN production

1. Validate in staging using the same contract build and cNGN contract ID intended for production.
2. Run full contract test suite and verify lifecycle invariants before deployment.
3. Deploy upgraded WASM without renaming storage keys or changing `DataKey` ordering/serialization.
4. Initialize new production deployment with cNGN token contract.
5. Monitor event processing and settlement balances across:
   - new cNGN trades,
   - pre-existing trades bound to their original token.
6. Do not assume rollback can mutate already-initialized on-chain token configuration.

## Test determinism & contributor guide

See [Test Determinism & Snapshot Hygiene](docs/test-determinism.md) for:

- How to inject deterministic clocks instead of using system time
- Ordering and collection assertion rules
- Snapshot lifecycle (generate → commit → review → clean up)
- Parallel-safe test conventions
- Checklist for adding new tests

To verify determinism locally:

```bash
bash scripts/verify-test-determinism.sh 50   # 50-repeat determinism check
bash scripts/cleanup-test-snapshots.sh       # remove orphaned snapshots
```

## Migration test checklist

Existing tests in `src/lib.rs` and `tests/dispute_flow.rs` cover migration-sensitive behavior:

- lifecycle continuity, invalid transitions, and conservation checks
- legacy + registry mediator interoperability and revocation semantics
- evidence/video/manifest compatibility and persistence guarantees
- long-ledger-gap continuity (`test_trade_id_counter_survives_long_ledger_gap`)

Before production rollout, execute:

```bash
cargo test
```

## Deployment safety checks

Contract CI runs `scripts/check-contract-deployment-safety.sh` before the test
suite for contract changes. The script is intentionally static and
deterministic: it verifies deployment-critical files exist, the crate keeps the
explicit `wasm` feature and native `rlib` test configuration, initialization
remains guarded by admin auth and the one-time initialized flag, and no obvious
secret or live key material is committed under `contracts/`.

Run the same check locally from the repository root:

```bash
bash scripts/check-contract-deployment-safety.sh
```
