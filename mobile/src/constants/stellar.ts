/**
 * Stellar network configuration used when signing and submitting
 * transactions from the mobile app.
 *
 * `EXPO_PUBLIC_STELLAR_NETWORK` accepts the friendly names already used in
 * `.env.example` (`testnet` | `public`). A full network passphrase is also
 * accepted so the value stays interchangeable with the web frontend, which
 * reads the passphrase from the same variable name.
 */
const NETWORKS = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  public: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
  },
} as const;

const configured = process.env.EXPO_PUBLIC_STELLAR_NETWORK ?? 'testnet';

const preset =
  configured === 'public'
    ? NETWORKS.public
    : configured === 'testnet'
      ? NETWORKS.testnet
      : null;

/** Network passphrase the wallet must sign against. */
export const STELLAR_NETWORK_PASSPHRASE: string =
  preset?.passphrase ?? configured;

/**
 * Soroban RPC endpoint that receives the signed transaction. Override with
 * `EXPO_PUBLIC_STELLAR_RPC_URL` (e.g. a private/paid RPC provider).
 */
export const STELLAR_RPC_URL: string =
  process.env.EXPO_PUBLIC_STELLAR_RPC_URL ||
  preset?.rpcUrl ||
  NETWORKS.testnet.rpcUrl;
