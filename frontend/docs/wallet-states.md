# Wallet connection edge states

Freighter is not always "installed + unlocked + right network". Every other
reality is now an enumerated state with its own actionable UI — no silent
stalls, no "button does nothing".

## State machine

`src/lib/wallet/state-machine.ts` is the single source of truth.

| State | Meaning | UI / next action |
| --- | --- | --- |
| `idle` | Nothing attempted | "Connect wallet" button |
| `detecting` | Probing the extension | inline spinner |
| `absent` | Freighter not installed | Install panel → deep link to freighter.app |
| `locked` | Installed, password not entered | Unlock panel → deep link + retry |
| `connecting` | `requestAccess()` awaiting user | inline spinner (bounded by timeout) |
| `rejected` | User dismissed the popup | "Try again" |
| `wrong-network` | Connected on a different network | One-click "Switch to \<network\>" |
| `timeout` | Extension didn't answer in `WALLET_CALL_TIMEOUT_MS` (8s) | "Try again" |
| `error` | Unexpected failure | "Try again" |
| `connected` | Authorized + address + right network | — (no callout) |

`deriveWalletState(probe)` maps Freighter probe results → state.
`describeWalletState(state)` maps state → `{ title, body, ctaLabel, action, href }`
(copy comes from the i18n catalog, `wallet.*` keys).

### No silent stalls

Every Freighter call is wrapped in `withWalletTimeout(...)`. A hung extension
resolves to the `WALLET_TIMEOUT` sentinel → `timeout` state → visible retry,
within 8 seconds. There is no code path where a user action produces no
feedback.

## Integration status

`state-machine.ts` and `WalletStateCallout` (`src/components/wallet/`) are
implemented and unit-tested, but no route renders `WalletStateCallout` yet and
nothing outside that component imports the state machine. Until it is wired
into a connect flow, the table above describes the behaviour the component
produces in isolation, and the manual test matrix below only applies once it is
mounted.

## Telemetry

`trackWalletState(state, meta)` emits:

- `wallet_state` `{ state }` — for every state, to measure frequencies
- `ui_failure` `{ type: "wallet_blocked", state }` — additionally for
  `absent | locked | rejected | wrong-network | timeout | error`

Dashboards: watch `wrong-network` and `locked` rates (first-run friction) and
`timeout` rate (extension health).

## Automated coverage

`src/lib/wallet/__tests__/state-machine.test.ts` — every enumerated state is
reachable and asserted (derive matrix + copy + timeout + telemetry).
`src/components/wallet/__tests__/WalletStateCallout.test.tsx` — per-state UI +
action wiring.

## Manual test matrix

Run before each release. Record date + build SHA.

| Scenario | Chrome | Firefox | Brave | Expected |
| --- | --- | --- | --- | --- |
| Extension not installed | ☐ | ☐ | ☐ | `absent` panel, install link opens freighter.app |
| Installed, locked | ☐ | ☐ | ☐ | `locked` panel; unlocking + retry connects |
| Click connect, dismiss popup | ☐ | ☐ | ☐ | `rejected`; "Try again" re-opens popup |
| Click connect, approve | ☐ | ☐ | ☐ | `connected`; address shown |
| Wallet on PUBLIC, app needs TESTNET | ☐ | ☐ | ☐ | `wrong-network`; switch prompt; after switch → `connected` |
| Freeze extension (devtools breakpoint) during connect | ☐ | ☐ | ☐ | `timeout` within 8s; retry works |
| Disconnect mid-session (lock extension) | ☐ | ☐ | ☐ | returns to `locked` on next probe |
| `prefers-reduced-motion` on | ☐ | ☐ | ☐ | spinners static, panels unaffected |

### Notes

- Brave: shields can block the extension's injected script — verify `absent`
  is shown (not a blank state) when shields are up.
- Firefox: `requestAccess` popup focus differs; confirm dismiss is detected as
  `rejected`, not `timeout`.
