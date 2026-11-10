//! Issue #98 — Admin transaction payload helper
//!
//! Provides strongly-typed builder functions for constructing the XDR-serializable
//! argument vectors required to invoke admin entry points on the Amana Escrow
//! contract. Using these helpers instead of hand-rolling argument arrays eliminates
//! a class of encoding mistakes — wrong argument order, wrong type, missing arguments
//! — that are otherwise only caught at runtime when the contract panics.
//!
//! # Scope
//!
//! | Helper | Contract function | Description |
//! |---|---|---|
//! | [`AdminClawbackPayload`] | `admin_clawback` | Partial/full admin clawback |
//! | [`AdminCancelTradePayload`] | `cancel_trade` (admin caller) | Admin-forced trade cancel |
//! | [`AdminUpdateFeePayload`] | `update_fee_bps` | Platform fee rate update |
//! | [`AdminWithdrawFeesPayload`] | `withdraw_fees` | Fee withdrawal to treasury |
//!
//! All helpers implement [`IntoVal`] to produce `soroban_sdk::Val` sequences
//! compatible with direct use in test harnesses and off-chain tooling that
//! constructs `InvokeContractArgs`.
//!
//! # Usage (tests)
//!
//! ```rust,ignore
//! use amana_escrow::admin_payload::AdminClawbackPayload;
//! use soroban_sdk::{Address, Env};
//!
//! let env = Env::default();
//! let payload = AdminClawbackPayload {
//!     trade_id: 42,
//!     clawback_amount: 5_000,
//!     destination: Address::generate(&env),
//! };
//! // Inspect the argument order is correct before submitting
//! let args = payload.to_args(&env);
//! assert_eq!(args.len(), 3);
//! ```
//!
//! # Usage (backend / off-chain)
//!
//! The struct fields map 1-to-1 to the Soroban contract function arguments in
//! declaration order. Serialize them with the Stellar XDR crate in the same order
//! to produce the `ScVec` for `InvokeContractArgs::args`.

use soroban_sdk::{Address, Env, IntoVal, Val, Vec};

// ---------------------------------------------------------------------------
// AdminClawbackPayload
// ---------------------------------------------------------------------------

/// Arguments for `admin_clawback(trade_id, clawback_amount, destination)`.
///
/// # Invariants (validated by the contract, not this struct)
/// - `clawback_amount` must be > 0.
/// - `clawback_amount` must be ≤ the remaining escrowed amount.
/// - The trade must be in `Funded` or `Disputed` status.
/// - The caller must be the contract admin.
///
/// # Example
/// ```rust,ignore
/// let payload = AdminClawbackPayload {
///     trade_id: my_trade_id,
///     clawback_amount: 5_000,
///     destination: treasury_address,
/// };
/// let args = payload.to_args(&env);
/// // Pass args to EscrowContractClient::admin_clawback or XDR serialization
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminClawbackPayload {
    /// The on-chain trade ID to claw back from.
    pub trade_id: u64,
    /// Amount (in the contract token's base unit) to remove from escrow.
    pub clawback_amount: i128,
    /// Address that will receive the clawed-back funds.
    pub destination: Address,
}

impl AdminClawbackPayload {
    /// Construct a new payload, performing basic pre-validation.
    ///
    /// # Panics
    /// - If `clawback_amount` is zero.
    /// - If `clawback_amount` is negative.
    pub fn new(trade_id: u64, clawback_amount: i128, destination: Address) -> Self {
        assert!(clawback_amount > 0, "AdminClawbackPayload: clawback_amount must be > 0");
        Self { trade_id, clawback_amount, destination }
    }

    /// Return the ordered argument vector for the `admin_clawback` contract call.
    ///
    /// Argument order mirrors the contract function signature:
    /// `admin_clawback(trade_id: u64, clawback_amount: i128, destination: Address)`
    pub fn to_args(&self, env: &Env) -> Vec<Val> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(self.trade_id.into_val(env));
        args.push_back(self.clawback_amount.into_val(env));
        args.push_back(self.destination.into_val(env));
        args
    }

    /// Name of the contract function this payload targets.
    pub const FUNCTION_NAME: &'static str = "admin_clawback";
}

// ---------------------------------------------------------------------------
// AdminCancelTradePayload
// ---------------------------------------------------------------------------

/// Arguments for `cancel_trade(trade_id, caller)` when `caller` is the admin.
///
/// Admin cancellation works for both `Created` and `Funded` trades. For funded
/// trades the full escrowed amount is refunded to the buyer.
///
/// # Example
/// ```rust,ignore
/// let payload = AdminCancelTradePayload {
///     trade_id: my_trade_id,
///     admin: admin_address,
/// };
/// let args = payload.to_args(&env);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminCancelTradePayload {
    /// The on-chain trade ID to cancel.
    pub trade_id: u64,
    /// The admin address. Must match the contract's stored admin.
    pub admin: Address,
}

impl AdminCancelTradePayload {
    /// Construct a new payload.
    pub fn new(trade_id: u64, admin: Address) -> Self {
        Self { trade_id, admin }
    }

    /// Return the ordered argument vector for the `cancel_trade` admin call.
    ///
    /// Argument order: `cancel_trade(trade_id: u64, caller: Address)`
    pub fn to_args(&self, env: &Env) -> Vec<Val> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(self.trade_id.into_val(env));
        args.push_back(self.admin.into_val(env));
        args
    }

    /// Name of the contract function this payload targets.
    pub const FUNCTION_NAME: &'static str = "cancel_trade";
}

// ---------------------------------------------------------------------------
// AdminUpdateFeePayload
// ---------------------------------------------------------------------------

/// Arguments for `update_fee_bps(new_fee_bps)`.
///
/// `new_fee_bps` must be within `[MIN_FEE_BPS, MAX_FEE_BPS]` (1–500 bps).
///
/// # Example
/// ```rust,ignore
/// let payload = AdminUpdateFeePayload::new(150)?; // 1.5%
/// let args = payload.to_args(&env);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminUpdateFeePayload {
    /// New platform fee in basis points. Validated to [1, 500].
    pub new_fee_bps: u32,
}

impl AdminUpdateFeePayload {
    /// Construct a new payload, validating that `new_fee_bps` is in range.
    ///
    /// # Panics
    /// - If `new_fee_bps` is 0 or > 500.
    pub fn new(new_fee_bps: u32) -> Self {
        assert!(
            (1..=500).contains(&new_fee_bps),
            "AdminUpdateFeePayload: new_fee_bps must be in [1, 500]"
        );
        Self { new_fee_bps }
    }

    /// Return the ordered argument vector for `update_fee_bps`.
    ///
    /// Argument order: `update_fee_bps(new_fee_bps: u32)`
    pub fn to_args(&self, env: &Env) -> Vec<Val> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(self.new_fee_bps.into_val(env));
        args
    }

    /// Name of the contract function this payload targets.
    pub const FUNCTION_NAME: &'static str = "update_fee_bps";
}

// ---------------------------------------------------------------------------
// AdminWithdrawFeesPayload
// ---------------------------------------------------------------------------

/// Arguments for `withdraw_fees(amount, destination)`.
///
/// Withdraws accrued platform fees from the contract to `destination`.
/// `amount` must be > 0 and ≤ the currently accrued fees (checked on-chain).
///
/// # Example
/// ```rust,ignore
/// let payload = AdminWithdrawFeesPayload {
///     amount: 10_000,
///     destination: treasury_address,
/// };
/// let args = payload.to_args(&env);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminWithdrawFeesPayload {
    /// Amount of accrued platform fees to withdraw.
    pub amount: i128,
    /// Address that will receive the withdrawn fees.
    pub destination: Address,
}

impl AdminWithdrawFeesPayload {
    /// Construct a new payload with basic pre-validation.
    ///
    /// # Panics
    /// - If `amount` is zero or negative.
    pub fn new(amount: i128, destination: Address) -> Self {
        assert!(amount > 0, "AdminWithdrawFeesPayload: amount must be > 0");
        Self { amount, destination }
    }

    /// Return the ordered argument vector for `withdraw_fees`.
    ///
    /// Argument order: `withdraw_fees(amount: i128, destination: Address)`
    pub fn to_args(&self, env: &Env) -> Vec<Val> {
        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(self.amount.into_val(env));
        args.push_back(self.destination.into_val(env));
        args
    }

    /// Name of the contract function this payload targets.
    pub const FUNCTION_NAME: &'static str = "withdraw_fees";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    extern crate std;
    use std::collections::BTreeSet;
    use super::*;
    use soroban_sdk::{Env, TryIntoVal, testutils::Address as _};

    // -----------------------------------------------------------------------
    // AdminClawbackPayload
    // -----------------------------------------------------------------------

    #[test]
    fn admin_clawback_payload_correct_arg_count() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let payload = AdminClawbackPayload::new(1_u64, 5_000_i128, destination);
        let args = payload.to_args(&env);
        assert_eq!(args.len(), 3, "admin_clawback must have exactly 3 arguments");
    }

    #[test]
    fn admin_clawback_payload_function_name() {
        assert_eq!(AdminClawbackPayload::FUNCTION_NAME, "admin_clawback");
    }

    #[test]
    fn admin_clawback_payload_serializes_trade_id() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let payload = AdminClawbackPayload::new(42_u64, 1_000_i128, destination);
        let args = payload.to_args(&env);
        // First arg is trade_id (u64)
        let got: u64 = args.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got, 42_u64, "first argument must be the trade_id");
    }

    #[test]
    fn admin_clawback_payload_serializes_clawback_amount() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let payload = AdminClawbackPayload::new(1_u64, 7_500_i128, destination);
        let args = payload.to_args(&env);
        // Second arg is clawback_amount (i128)
        let got: i128 = args.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got, 7_500_i128, "second argument must be clawback_amount");
    }

    #[test]
    fn admin_clawback_payload_serializes_destination() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let payload = AdminClawbackPayload::new(1_u64, 1_000_i128, destination.clone());
        let args = payload.to_args(&env);
        // Third arg is destination (Address)
        let got: Address = args.get(2).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got, destination, "third argument must be the destination address");
    }

    #[test]
    #[should_panic(expected = "AdminClawbackPayload: clawback_amount must be > 0")]
    fn admin_clawback_payload_rejects_zero_amount() {
        let env = Env::default();
        let destination = Address::generate(&env);
        AdminClawbackPayload::new(1_u64, 0_i128, destination);
    }

    #[test]
    #[should_panic(expected = "AdminClawbackPayload: clawback_amount must be > 0")]
    fn admin_clawback_payload_rejects_negative_amount() {
        let env = Env::default();
        let destination = Address::generate(&env);
        AdminClawbackPayload::new(1_u64, -1_i128, destination);
    }

    // -----------------------------------------------------------------------
    // AdminCancelTradePayload
    // -----------------------------------------------------------------------

    #[test]
    fn admin_cancel_trade_payload_correct_arg_count() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let payload = AdminCancelTradePayload::new(5_u64, admin);
        let args = payload.to_args(&env);
        assert_eq!(args.len(), 2, "cancel_trade must have exactly 2 arguments");
    }

    #[test]
    fn admin_cancel_trade_payload_function_name() {
        assert_eq!(AdminCancelTradePayload::FUNCTION_NAME, "cancel_trade");
    }

    #[test]
    fn admin_cancel_trade_payload_correct_arg_order() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let trade_id = 99_u64;
        let payload = AdminCancelTradePayload::new(trade_id, admin.clone());
        let args = payload.to_args(&env);

        let got_tid: u64 = args.get(0).unwrap().try_into_val(&env).unwrap();
        let got_admin: Address = args.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got_tid, trade_id);
        assert_eq!(got_admin, admin);
    }

    // -----------------------------------------------------------------------
    // AdminUpdateFeePayload
    // -----------------------------------------------------------------------

    #[test]
    fn admin_update_fee_payload_correct_arg_count() {
        let env = Env::default();
        let payload = AdminUpdateFeePayload::new(100_u32);
        let args = payload.to_args(&env);
        assert_eq!(args.len(), 1, "update_fee_bps must have exactly 1 argument");
    }

    #[test]
    fn admin_update_fee_payload_function_name() {
        assert_eq!(AdminUpdateFeePayload::FUNCTION_NAME, "update_fee_bps");
    }

    #[test]
    fn admin_update_fee_payload_serializes_fee_bps() {
        let env = Env::default();
        let payload = AdminUpdateFeePayload::new(150_u32);
        let args = payload.to_args(&env);
        let got: u32 = args.get(0).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got, 150_u32);
    }

    #[test]
    #[should_panic(expected = "AdminUpdateFeePayload: new_fee_bps must be in [1, 500]")]
    fn admin_update_fee_payload_rejects_zero_fee() {
        AdminUpdateFeePayload::new(0);
    }

    #[test]
    #[should_panic(expected = "AdminUpdateFeePayload: new_fee_bps must be in [1, 500]")]
    fn admin_update_fee_payload_rejects_over_500_bps() {
        AdminUpdateFeePayload::new(501);
    }

    #[test]
    fn admin_update_fee_payload_accepts_boundary_values() {
        // MIN = 1 bps
        let min = AdminUpdateFeePayload::new(1);
        assert_eq!(min.new_fee_bps, 1);
        // MAX = 500 bps
        let max = AdminUpdateFeePayload::new(500);
        assert_eq!(max.new_fee_bps, 500);
    }

    // -----------------------------------------------------------------------
    // AdminWithdrawFeesPayload
    // -----------------------------------------------------------------------

    #[test]
    fn admin_withdraw_fees_payload_correct_arg_count() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let payload = AdminWithdrawFeesPayload::new(1_000_i128, destination);
        let args = payload.to_args(&env);
        assert_eq!(args.len(), 2, "withdraw_fees must have exactly 2 arguments");
    }

    #[test]
    fn admin_withdraw_fees_payload_function_name() {
        assert_eq!(AdminWithdrawFeesPayload::FUNCTION_NAME, "withdraw_fees");
    }

    #[test]
    fn admin_withdraw_fees_payload_correct_arg_order() {
        let env = Env::default();
        let destination = Address::generate(&env);
        let amount = 3_000_i128;
        let payload = AdminWithdrawFeesPayload::new(amount, destination.clone());
        let args = payload.to_args(&env);

        let got_amount: i128 = args.get(0).unwrap().try_into_val(&env).unwrap();
        let got_dest: Address = args.get(1).unwrap().try_into_val(&env).unwrap();
        assert_eq!(got_amount, amount);
        assert_eq!(got_dest, destination);
    }

    #[test]
    #[should_panic(expected = "AdminWithdrawFeesPayload: amount must be > 0")]
    fn admin_withdraw_fees_payload_rejects_zero_amount() {
        let env = Env::default();
        let destination = Address::generate(&env);
        AdminWithdrawFeesPayload::new(0, destination);
    }

    // -----------------------------------------------------------------------
    // Reusability: payloads are Clone + Debug + PartialEq
    // -----------------------------------------------------------------------

    #[test]
    fn admin_clawback_payload_is_clonable_and_comparable() {
        let env = Env::default();
        let dest = Address::generate(&env);
        let p1 = AdminClawbackPayload::new(1_u64, 1_000_i128, dest.clone());
        let p2 = p1.clone();
        assert_eq!(p1, p2, "cloned payload must equal original");
    }

    #[test]
    fn all_function_names_are_unique() {
        let names = [
            AdminClawbackPayload::FUNCTION_NAME,
            AdminCancelTradePayload::FUNCTION_NAME,
            AdminUpdateFeePayload::FUNCTION_NAME,
            AdminWithdrawFeesPayload::FUNCTION_NAME,
        ];
        let mut set = BTreeSet::new();
        for name in &names {
            assert!(set.insert(name), "duplicate FUNCTION_NAME: {name}");
        }
    }
}
