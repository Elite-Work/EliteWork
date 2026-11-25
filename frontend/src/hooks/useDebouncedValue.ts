import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delayMs` (300 ms by
 * default). Used by the trades list search box (#505) so typing does not fire
 * one request per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
