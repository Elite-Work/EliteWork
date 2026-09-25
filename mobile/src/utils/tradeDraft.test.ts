import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  TRADE_DRAFT_KEY,
  clearTradeDraft,
  loadTradeDraft,
  saveTradeDraft,
} from './tradeDraft';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe('tradeDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves the draft with its step under the shared key', async () => {
    await saveTradeDraft({ commodity: 'Maize' }, 1);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = storage.setItem.mock.calls[0];
    expect(key).toBe(TRADE_DRAFT_KEY);
    expect(JSON.parse(value)).toMatchObject({ data: { commodity: 'Maize' }, step: 1 });
  });

  it('loads a previously saved draft', async () => {
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ data: { commodity: 'Rice' }, step: 2, savedAt: 'x' }),
    );

    const draft = await loadTradeDraft<{ commodity: string }>();

    expect(draft?.data.commodity).toBe('Rice');
    expect(draft?.step).toBe(2);
  });

  it('returns null when nothing is stored or the payload is corrupt', async () => {
    storage.getItem.mockResolvedValueOnce(null);
    expect(await loadTradeDraft()).toBeNull();

    storage.getItem.mockResolvedValueOnce('{not json');
    expect(await loadTradeDraft()).toBeNull();
  });

  it('clears the draft', async () => {
    await clearTradeDraft();
    expect(storage.removeItem).toHaveBeenCalledWith(TRADE_DRAFT_KEY);
  });
});
