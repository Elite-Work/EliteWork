import {
  isFreighterAvailable,
  signAndSubmitXdr,
  signWithFreighter,
  submitSignedTransaction,
  TransactionSigningError,
} from './freighterSigner';
import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '../constants/stellar';

const mockIsConnected = jest.fn();
const mockSignTransaction = jest.fn();

// Set to simulate the package failing to initialise at import time.
let mockLoadError: Error | null = null;

jest.mock('@stellar/freighter-api', () => {
  if (mockLoadError) throw mockLoadError;
  return {
    isConnected: (...args: unknown[]) => mockIsConnected(...args),
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  };
});

const mockFetch = jest.fn();

const UNSIGNED = 'AAAAunsigned';
const SIGNED = 'AAAAsigned';
const ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';

function rpcResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<TransactionSigningError> {
  try {
    await promise;
  } catch (e) {
    return e as TransactionSigningError;
  }
  throw new Error('expected promise to reject');
}

describe('freighterSigner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockSignTransaction.mockResolvedValue({
      signedTxXdr: SIGNED,
      signerAddress: ADDRESS,
    });
    mockFetch.mockResolvedValue(
      rpcResponse({ result: { status: 'PENDING', hash: 'abc123' } }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  describe('isFreighterAvailable', () => {
    it('is true when Freighter reports a connection', async () => {
      await expect(isFreighterAvailable()).resolves.toBe(true);
    });

    it('is false when Freighter is not connected', async () => {
      mockIsConnected.mockResolvedValueOnce({ isConnected: false });

      await expect(isFreighterAvailable()).resolves.toBe(false);
    });

    it('is false when Freighter reports an error (e.g. non-browser runtime)', async () => {
      mockIsConnected.mockResolvedValueOnce({
        isConnected: false,
        error: { code: -1, message: 'Node environment is not supported' },
      });

      await expect(isFreighterAvailable()).resolves.toBe(false);
    });

    it('is false when the probe throws', async () => {
      mockIsConnected.mockRejectedValueOnce(new Error('postMessage is not a function'));

      await expect(isFreighterAvailable()).resolves.toBe(false);
    });

    it('is false when the probe never answers', async () => {
      jest.useFakeTimers();
      mockIsConnected.mockReturnValueOnce(new Promise(() => undefined));

      const result = isFreighterAvailable();
      await jest.advanceTimersByTimeAsync(3000);

      await expect(result).resolves.toBe(false);
    });

    it('is false when the freighter package cannot be loaded', async () => {
      mockLoadError = new Error('cannot initialise');
      jest.resetModules();

      try {
        await expect(isFreighterAvailable()).resolves.toBe(false);
        const error = await failureOf(signWithFreighter(UNSIGNED));
        expect(error.code).toBe('WALLET_UNAVAILABLE');
        expect(mockSignTransaction).not.toHaveBeenCalled();
      } finally {
        mockLoadError = null;
        jest.resetModules();
      }
    });
  });

  describe('signWithFreighter', () => {
    it('returns the signed XDR and signs for the configured network', async () => {
      const result = await signWithFreighter(UNSIGNED, { address: ADDRESS });

      expect(result).toBe(SIGNED);
      expect(mockSignTransaction).toHaveBeenCalledWith(UNSIGNED, {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        address: ADDRESS,
      });
    });

    it('defaults to the testnet passphrase', () => {
      expect(STELLAR_NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
    });

    it('fails with WALLET_UNAVAILABLE without prompting when Freighter is not reachable', async () => {
      mockIsConnected.mockResolvedValueOnce({ isConnected: false });

      const error = await failureOf(signWithFreighter(UNSIGNED));

      expect(error).toBeInstanceOf(TransactionSigningError);
      expect(error.code).toBe('WALLET_UNAVAILABLE');
      expect(error.message).toMatch(/Copy the unsigned XDR/);
      expect(mockSignTransaction).not.toHaveBeenCalled();
    });

    it.each([
      'User declined access',
      'The user rejected this request',
      'Request denied',
      'Cancelled by user',
    ])('maps the wallet message %p to USER_REJECTED', async (message) => {
      mockSignTransaction.mockResolvedValueOnce({
        signedTxXdr: '',
        signerAddress: '',
        error: { code: -4, message },
      });

      const error = await failureOf(signWithFreighter(UNSIGNED));

      expect(error.code).toBe('USER_REJECTED');
      expect(error.message).toBe(message);
    });

    it('maps any other wallet error to SIGNING_FAILED', async () => {
      mockSignTransaction.mockResolvedValueOnce({
        signedTxXdr: '',
        signerAddress: '',
        error: { code: -1, message: 'The wallet encountered an internal error.' },
      });

      const error = await failureOf(signWithFreighter(UNSIGNED));

      expect(error.code).toBe('SIGNING_FAILED');
      expect(error.message).toBe('The wallet encountered an internal error.');
    });

    it('fails with SIGNING_FAILED when the wallet returns no signed XDR', async () => {
      mockSignTransaction.mockResolvedValueOnce({
        signedTxXdr: '',
        signerAddress: ADDRESS,
      });

      const error = await failureOf(signWithFreighter(UNSIGNED));

      expect(error.code).toBe('SIGNING_FAILED');
      expect(error.message).toMatch(/did not return a signed transaction/);
    });

    it('wraps a thrown wallet error as SIGNING_FAILED', async () => {
      mockSignTransaction.mockRejectedValueOnce(new Error('extension crashed'));

      const error = await failureOf(signWithFreighter(UNSIGNED));

      expect(error.code).toBe('SIGNING_FAILED');
      expect(error.message).toBe('extension crashed');
    });

    it('gives up with SIGNING_FAILED when the user never answers', async () => {
      jest.useFakeTimers();
      mockSignTransaction.mockReturnValueOnce(new Promise(() => undefined));

      const pending = failureOf(signWithFreighter(UNSIGNED));
      await jest.advanceTimersByTimeAsync(120_000);
      const error = await pending;

      expect(error.code).toBe('SIGNING_FAILED');
      expect(error.message).toMatch(/Timed out/);
    });
  });

  describe('submitSignedTransaction', () => {
    it('POSTs a JSON-RPC sendTransaction request to the configured RPC', async () => {
      const result = await submitSignedTransaction(SIGNED);

      expect(result).toEqual({ hash: 'abc123' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(STELLAR_RPC_URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: { transaction: SIGNED },
      });
    });

    it('defaults to the Soroban testnet RPC', () => {
      expect(STELLAR_RPC_URL).toBe('https://soroban-testnet.stellar.org');
    });

    it('treats DUPLICATE as success (the network already has the transaction)', async () => {
      mockFetch.mockResolvedValueOnce(
        rpcResponse({ result: { status: 'DUPLICATE', hash: 'dup456' } }),
      );

      await expect(submitSignedTransaction(SIGNED)).resolves.toEqual({
        hash: 'dup456',
      });
    });

    it('reports a busy network for TRY_AGAIN_LATER', async () => {
      mockFetch.mockResolvedValueOnce(
        rpcResponse({ result: { status: 'TRY_AGAIN_LATER' } }),
      );

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toMatch(/busy/);
    });

    it('rejects an ERROR status', async () => {
      mockFetch.mockResolvedValueOnce(
        rpcResponse({ result: { status: 'ERROR', hash: 'bad789' } }),
      );

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toMatch(/rejected the transaction/);
    });

    it('rejects a PENDING status that carries no hash', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse({ result: { status: 'PENDING' } }));

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
    });

    it('surfaces a JSON-RPC error message', async () => {
      mockFetch.mockResolvedValueOnce(
        rpcResponse({ error: { message: 'invalid transaction envelope' } }),
      );

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toBe('invalid transaction envelope');
    });

    it('surfaces a non-2xx HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(rpcResponse({}, { ok: false, status: 503 }));

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toBe('Stellar RPC responded with HTTP 503');
    });

    it('surfaces a network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

      const error = await failureOf(submitSignedTransaction(SIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toBe('Network request failed');
    });

    it('aborts and reports a timeout when the RPC never answers', async () => {
      jest.useFakeTimers();
      mockFetch.mockImplementationOnce(
        (
          _url: string,
          init: { signal: { addEventListener: (e: string, cb: () => void) => void } },
        ) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('Aborted')),
            );
          }),
      );

      const pending = failureOf(submitSignedTransaction(SIGNED));
      await jest.advanceTimersByTimeAsync(20_000);
      const error = await pending;

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(error.message).toMatch(/timed out/);
    });
  });

  describe('signAndSubmitXdr', () => {
    it('signs, submits the signed XDR and returns the hash', async () => {
      const result = await signAndSubmitXdr(UNSIGNED, { address: ADDRESS });

      expect(result).toEqual({ hash: 'abc123' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.transaction).toBe(SIGNED);
    });

    it('does not submit anything when signing fails', async () => {
      mockSignTransaction.mockResolvedValueOnce({
        signedTxXdr: '',
        signerAddress: '',
        error: { code: -4, message: 'User declined access' },
      });

      const error = await failureOf(signAndSubmitXdr(UNSIGNED));

      expect(error.code).toBe('USER_REJECTED');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates a submission failure after a successful signature', async () => {
      mockFetch.mockRejectedValueOnce(new Error('offline'));

      const error = await failureOf(signAndSubmitXdr(UNSIGNED));

      expect(error.code).toBe('SUBMISSION_FAILED');
      expect(mockSignTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
