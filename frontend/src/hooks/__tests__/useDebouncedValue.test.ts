import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "../useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("maize", 300));
    expect(result.current).toBe("maize");
  });

  it("only publishes the latest value once the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "" } },
    );

    rerender({ value: "ma" });
    rerender({ value: "mai" });
    rerender({ value: "maize" });

    // Nothing emitted yet — every keystroke restarted the timer.
    expect(result.current).toBe("");

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current).toBe("");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe("maize");
  });

  it("cancels the pending update when unmounted", () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    unmount();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current).toBe("a");
  });
});
