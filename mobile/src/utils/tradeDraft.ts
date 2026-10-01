import AsyncStorage from '@react-native-async-storage/async-storage';

/** Same key as the web TradeContext draft so both platforms stay aligned. */
export const TRADE_DRAFT_KEY = 'amana:draft-trade';

export interface TradeDraft<T> {
  data: Partial<T>;
  step: number;
  savedAt: string;
}

/** Reads the saved CreateTrade draft, or null when absent or unreadable. */
export async function loadTradeDraft<T>(): Promise<TradeDraft<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(TRADE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TradeDraft<T>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists the in-progress draft; failures are ignored (best effort). */
export async function saveTradeDraft<T>(data: T, step: number): Promise<void> {
  try {
    await AsyncStorage.setItem(
      TRADE_DRAFT_KEY,
      JSON.stringify({ data, step, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Draft persistence is best effort; the form keeps working without it.
  }
}

/** Drops the saved draft, e.g. once the trade has been created. */
export async function clearTradeDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRADE_DRAFT_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
