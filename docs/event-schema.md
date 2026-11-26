# Contract event schema: one source, two generated clients

Event parsing used to exist twice — once in the Rust contract that emits, once
in the TypeScript that decodes — with nothing tying them together. Drift was
silent: the decoder dispatched on `"TradeCreated"` while the contract published
`"TRDCRT"`, so no on-chain event ever matched, settlement stalled, and the only
trace was a `"Unknown event symbol"` warning.

`schemas/events/amana_escrow.events.json` is now the single source of truth.

## What is generated from it

| Artefact | Purpose |
| --- | --- |
| `contracts/amana_escrow/src/generated/event_schema.rs` | Topic and field constants the contract's tests assert against |
| `backend/src/types/generated/events.generated.ts` | Event enum, topic → type dispatch map, per-event payload interfaces, trade-status mapping |

Both are committed. Neither is edited by hand.

```bash
npm run codegen:events          # regenerate both
npm run codegen:events:check    # verify without writing (what CI runs)
```

## The drift gates

`scripts/codegen-events.mjs` refuses to run if any of these hold:

1. The schema declares an event the contract no longer emits, or misses one it
   does — it parses `#[contractevent]` declarations from the
   `contracts/amana_escrow/src/` source tree and compares.
2. An event's topics or field list differ between the schema and the contract.
3. `schemaVersion` disagrees with the contract's `EVENT_SCHEMA_VERSION`.
4. Two events claim the same first topic — the decoder dispatches on it, so one
   would silently shadow the other.
5. A field uses a Soroban type with no TypeScript mapping. Unmapped types fail
   loudly rather than degrading to `any`.

CI runs the same script with `--check` and then regenerates and fails on any
uncommitted diff, so a schema edit that was never regenerated cannot merge.

The Contracts Required Gate also runs
[`scripts/check-contract-abi-drift.mjs`](../scripts/check-contract-abi-drift.mjs).
It invokes the generator in check-only mode, validating the contract event
definitions and generated Rust/TypeScript event clients against this schema.
This check covers the event interface represented here; it is not a complete
manifest of every callable Soroban contract function.

## Evolving a schema safely

Event consumers are deployed independently of the contract, so an old listener
must keep working against a new emitter. The rules follow the contract's own
policy in `contracts/amana_escrow/docs/event-schema-migration-plan.md`:

- **Additive only.** Add new fields at the end. Never remove, reorder or retype
  an existing field — a listener reading positionally will silently misparse.
- **Bump `schemaVersion`** in the JSON and `EVENT_SCHEMA_VERSION` in `lib.rs`
  together, in the same commit. The codegen fails if they disagree.
- **Never reuse a topic.** A retired topic stays retired; recycling it makes old
  events decode as the wrong type.
- **Keep the decoder's legacy aliases.** `backend/src/lib/eventDecoder.ts` still
  recognises the pre-rename long-form symbols so events emitted by contract
  versions already on-chain continue to decode. Generated topics take
  precedence; aliases are a fallback, and are only removed once no deployed
  contract emits them.

### Adding an event

1. Add the `#[contractevent]` struct in `contracts/amana_escrow/src/lib.rs`.
2. Add the matching entry to `schemas/events/amana_escrow.events.json`, with
   `rustStruct` set to the struct name and `topics` to the exact strings from the
   attribute. Add `tradeStatus` only if the event moves a trade's status.
3. Run `npm run codegen:events`.
4. If the backend should react to it, map the generated type onto `EventType` in
   `backend/src/lib/eventDecoder.ts`. Events with no mapping decode to `null` and
   are skipped — a deliberate no-op, not a failure.
5. Commit the schema, both generated files, and the contract change together.

### Changing an existing event

Same loop, but bump both version constants and add a note to
`contracts/amana_escrow/docs/event-schema-migration-plan.md` describing what
changed and what a listener has to do about it.

## Tests

- `backend/src/__tests__/events.schema.codegen.test.ts` — asserts the generated
  client matches the schema file, that every topic appears in the contract
  source, and round-trips emit → decode for each settlement event.
- `contracts/amana_escrow/src/tests/generated_schema_tests.rs` — asserts the
  running contract's version constant and lifecycle topics match the generated
  constants.
