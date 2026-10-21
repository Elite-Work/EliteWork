import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '../constants/stellar';

export type SigningErrorCode =
  /** Freighter cannot be reached from this device (no extension / not installed). */
  | 'WALLET_UNAVAILABLE'
  /** The user declined the signature request in the wallet. */
  | 'USER_REJECTED'
  /** The wallet failed to produce a signed transaction. */
  | 'SIGNING_FAILED'
  /** The signed transaction could not be submitted to the Stellar network. */
  | 'SUBMISSION_FAILED';

export class TransactionSigningError extends Error {
  public readonly code: SigningErrorCode;

  constructor(code: SigningErrorCode, message: string) {
    super(message);
    this.name = 'TransactionSigningError';
    this.code = code;
  }
}

export interface SubmittedTransaction {
  /** Transaction hash returned by the Soroban RPC. */
  hash: string;
}

/** How long to wait for Freighter to answer a connection probe. */
const AVAILABILITY_TIMEOUT_MS = 3000;
/** How long the user has to approve the request inside the wallet. */
const SIGN_TIMEOUT_MS = 120_000;
/** How long to wait for the RPC to accept the transaction. */
const SUBMIT_TIMEOUT_MS = 20_000;

const UNAVAILABLE_MESSAGE =
  "Freighter isn't available on this device. Copy the unsigned XDR and sign it with a Stellar wallet instead.";

type FreighterApi = typeof import('@stellar/freighter-api');

/**
 * `@stellar/freighter-api` talks to the Freighter browser extension. It is
 * required lazily (Metro only evaluates a module on its first `require`) so
 * that merely importing a screen never touches it, and so that a runtime
 * where the package cannot initialise degrades to `WALLET_UNAVAILABLE`
 * instead of crashing the app.
 */
function loadFreighter(): FreighterApi {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@stellar/freighter-api') as FreighterApi;
  } catch {
    throw new TransactionSigningError('WALLET_UNAVAILABLE', UNAVAILABLE_MESSAGE);
  }
}

/** Rejects with `onTimeout()` if `promise` has not settled within `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

const REJECTION_PATTERN = /reject|declin|denied|cancel/i;

/** True when Freighter can be reached from the current runtime. */
export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const freighter = loadFreighter();
    const result = await withTimeout(
      freighter.isConnected(),
      AVAILABILITY_TIMEOUT_MS,
      () => new Error('Freighter connection check timed out'),
    );
    return !result.error && result.isConnected === true;
  } catch {
    return false;
  }
}

/**
 * Asks Freighter to sign `unsignedXdr` for the configured network.
 *
 * @throws {TransactionSigningError} `WALLET_UNAVAILABLE`, `USER_REJECTED` or
 * `SIGNING_FAILED`.
 */
export async function signWithFreighter(
  unsignedXdr: string,
  options: { address?: string } = {},
): Promise<string> {
  if (!(await isFreighterAvailable())) {
    throw new TransactionSigningError('WALLET_UNAVAILABLE', UNAVAILABLE_MESSAGE);
  }
  const freighter = loadFreighter();

  let result: Awaited<ReturnType<FreighterApi['signTransaction']>>;
  try {
    result = await withTimeout(
      freighter.signTransaction(unsignedXdr, {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        address: options.address,
      }),
      SIGN_TIMEOUT_MS,
      () => new Error('Timed out waiting for the wallet to sign'),
    );
  } catch (error) {
    throw new TransactionSigningError(
      'SIGNING_FAILED',
      errorMessage(error, 'The wallet failed to sign the transaction.'),
    );
  }

  if (result.error) {
    const message = errorMessage(result.error, 'Signing failed.');
    throw new TransactionSigningError(
      REJECTION_PATTERN.test(message) ? 'USER_REJECTED' : 'SIGNING_FAILED',
      message,
    );
  }
  if (!result.signedTxXdr) {
    throw new TransactionSigningError(
      'SIGNING_FAILED',
      'The wallet did not return a signed transaction.',
    );
  }
  return result.signedTxXdr;
}

interface SendTransactionResponse {
  error?: { message?: string };
  result?: {
    status?: 'PENDING' | 'DUPLICATE' | 'TRY_AGAIN_LATER' | 'ERROR';
    hash?: string;
  };
}

/**
 * Submits a signed transaction through the Soroban RPC `sendTransaction`
 * method (the same call the web frontend makes).
 *
 * `PENDING` and `DUPLICATE` both mean the network has the transaction, so
 * both resolve with its hash.
 *
 * @throws {TransactionSigningError} `SUBMISSION_FAILED`.
 */
export async function submitSignedTransaction(
  signedTxXdr: string,
): Promise<SubmittedTransaction> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  let body: SendTransactionResponse;
  try {
    const response = await fetch(STELLAR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: { transaction: signedTxXdr },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Stellar RPC responded with HTTP ${response.status}`);
    }
    body = (await response.json()) as SendTransactionResponse;
  } catch (error) {
    throw new TransactionSigningError(
      'SUBMISSION_FAILED',
      controller.signal.aborted
        ? 'Submitting the transaction timed out. Check your connection and try again.'
        : errorMessage(error, 'Could not reach the Stellar network.'),
    );
  } finally {
    clearTimeout(timer);
  }

  if (body.error) {
    throw new TransactionSigningError(
      'SUBMISSION_FAILED',
      errorMessage(body.error, 'The Stellar network rejected the transaction.'),
    );
  }

  const status = body.result?.status;
  const hash = body.result?.hash;
  if ((status === 'PENDING' || status === 'DUPLICATE') && hash) {
    return { hash };
  }
  if (status === 'TRY_AGAIN_LATER') {
    throw new TransactionSigningError(
      'SUBMISSION_FAILED',
      'The Stellar network is busy. Try again in a moment.',
    );
  }
  throw new TransactionSigningError(
    'SUBMISSION_FAILED',
    'The Stellar network rejected the transaction.',
  );
}

/** Signs `unsignedXdr` with Freighter and submits it to the network. */
export async function signAndSubmitXdr(
  unsignedXdr: string,
  options: { address?: string } = {},
): Promise<SubmittedTransaction> {
  const signedTxXdr = await signWithFreighter(unsignedXdr, options);
  return submitSignedTransaction(signedTxXdr);
}
