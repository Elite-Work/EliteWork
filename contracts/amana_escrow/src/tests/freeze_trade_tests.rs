/// Issue #498 — freeze_trade / unfreeze_trade emergency per-trade pause tests
#[cfg(test)]
#[allow(clippy::module_inception)]
mod freeze_trade_tests {
    use crate::test_fixture::admin_address;
    use crate::{EscrowContract, EscrowContractClient, TradeStatus};
    use soroban_sdk::{
        Address, Env, IntoVal, symbol_short,
        testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
        token,
        xdr::{ContractEventBody, ScVal},
    };

    fn setup(env: &Env, amount: i128) -> (Address, Address, Address, Address, Address) {
        let admin = admin_address(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &token_id).mint(&buyer, &(amount * 2));
        client.initialize(&admin, &token_id, &treasury, &100u32, &token_id);
        (contract_id, admin, buyer, seller, token_id)
    }

    #[test]
    fn freeze_trade_sets_flag_and_emits_event_without_affecting_other_trades() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_1 = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);
        let trade_2 = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);

        assert!(!client.is_trade_frozen(&trade_1));
        assert!(!client.is_trade_frozen(&trade_2));

        client.freeze_trade(&trade_1);

        assert!(client.is_trade_frozen(&trade_1));
        assert!(!client.is_trade_frozen(&trade_2));

        // Verify TradeFrozenEvent ("TRDFRZ") was emitted
        let all = env.events().all();
        let events = all.events();
        let last = events.last().unwrap();
        let topics = match &last.body {
            ContractEventBody::V0(v0) => &v0.topics,
        };
        let expected_topic =
            ScVal::try_from_val(&env, &symbol_short!("TRDFRZ").into_val(&env)).unwrap();
        assert_eq!(topics.get(0).unwrap(), &expected_topic);

        // Unfrozen trade_2 can still deposit, confirm delivery, and release funds
        client.deposit(&trade_2);
        client.confirm_delivery(&trade_2);
        client.release_funds(&trade_2, &buyer);
        assert_eq!(client.get_trade(&trade_2).status, TradeStatus::Completed);
    }

    #[test]
    #[should_panic(expected = "trade is frozen")]
    fn frozen_trade_blocks_deposit() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);
        client.freeze_trade(&trade_id);
        client.deposit(&trade_id);
    }

    #[test]
    #[should_panic(expected = "trade is frozen")]
    fn frozen_trade_blocks_release_funds() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);
        client.freeze_trade(&trade_id);
        client.release_funds(&trade_id, &buyer);
    }

    #[test]
    #[should_panic(expected = "trade is frozen")]
    fn frozen_trade_blocks_admin_clawback() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);
        client.deposit(&trade_id);
        client.freeze_trade(&trade_id);
        client.admin_clawback(&trade_id, &5_000, &admin);
    }

    #[test]
    fn unfreeze_trade_restores_lifecycle_operations() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);
        client.freeze_trade(&trade_id);
        assert!(client.is_trade_frozen(&trade_id));

        client.unfreeze_trade(&trade_id);
        assert!(!client.is_trade_frozen(&trade_id));

        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id, &buyer);
        assert_eq!(client.get_trade(&trade_id).status, TradeStatus::Completed);
    }

    #[test]
    #[should_panic]
    fn freeze_trade_rejects_non_admin_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, buyer, seller, _token_id) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000, &5000, &5000, &None);

        let stranger = Address::generate(&env);
        client
            .mock_auths(&[MockAuth {
                address: &stranger,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "freeze_trade",
                    args: soroban_sdk::vec![
                        &env,
                        IntoVal::<Env, soroban_sdk::Val>::into_val(&trade_id, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .freeze_trade(&trade_id);
    }
}
