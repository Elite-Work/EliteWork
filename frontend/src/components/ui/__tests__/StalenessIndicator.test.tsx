/**
 * Tests for the StalenessIndicator component.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { StalenessIndicator, LIVE_REFRESH_MS } from "../StalenessIndicator";

describe("StalenessIndicator", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing when data is fresh and online", () => {
    const { container } = render(
      <StalenessIndicator
        isStale={false}
        isOffline={false}
        cachedAt={Date.now()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Stale' badge when isStale=true", () => {
    render(
      <StalenessIndicator
        isStale={true}
        isOffline={false}
        cachedAt={Date.now() - 6 * 60 * 1000}
      />,
    );
    expect(screen.getByTestId("staleness-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("staleness-indicator")).toHaveTextContent("Stale");
  });

  it("renders 'Offline' badge when isOffline=true", () => {
    render(
      <StalenessIndicator
        isStale={true}
        isOffline={true}
        cachedAt={Date.now() - 2 * 60 * 1000}
      />,
    );
    expect(screen.getByTestId("staleness-indicator")).toHaveTextContent("Offline");
  });

  it("renders with role=status for screen readers", () => {
    render(
      <StalenessIndicator
        isStale={true}
        isOffline={false}
        cachedAt={Date.now() - 90_000}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows elapsed time in stale badge (e.g. 1m ago)", () => {
    render(
      <StalenessIndicator
        isStale={true}
        isOffline={false}
        cachedAt={Date.now() - 90_000} // 1m 30s ago
      />,
    );
    expect(screen.getByTestId("staleness-indicator").textContent).toMatch(
      /1m ago/,
    );
  });

  it("does not show elapsed time in offline badge", () => {
    render(
      <StalenessIndicator
        isStale={true}
        isOffline={true}
        cachedAt={Date.now() - 90_000}
      />,
    );
    expect(
      screen.getByTestId("staleness-indicator").textContent,
    ).not.toMatch(/ago/);
  });

  describe("live variant (opt-in)", () => {
    it("re-reads the clock every minute so a long-open page stays truthful", () => {
      jest.useFakeTimers();
      render(
        <StalenessIndicator
          isStale={true}
          isOffline={false}
          cachedAt={Date.now() - 60_000}
          live
        />,
      );

      const badge = screen.getByTestId("staleness-indicator");
      expect(badge).toHaveAttribute("data-live", "true");
      expect(badge).toHaveTextContent("1m ago");

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_MS);
      });
      expect(badge).toHaveTextContent("2m ago");

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_MS);
      });
      expect(badge).toHaveTextContent("3m ago");
    });

    it("keeps reading Date.now() once per render unless live is set", () => {
      jest.useFakeTimers();
      render(
        <StalenessIndicator
          isStale={true}
          isOffline={false}
          cachedAt={Date.now() - 60_000}
        />,
      );

      const badge = screen.getByTestId("staleness-indicator");
      expect(badge).toHaveAttribute("data-live", "false");
      expect(badge).toHaveTextContent("1m ago");

      act(() => {
        jest.advanceTimersByTime(5 * 60_000);
      });
      expect(badge).toHaveTextContent("1m ago");
    });

    it("starts no timer while nothing is rendered (fresh data)", () => {
      jest.useFakeTimers();
      render(
        <StalenessIndicator
          isStale={false}
          isOffline={false}
          cachedAt={Date.now()}
          live
        />,
      );

      expect(screen.queryByTestId("staleness-indicator")).not.toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(0);
    });

    it("clears its interval on unmount", () => {
      jest.useFakeTimers();
      const { unmount } = render(
        <StalenessIndicator
          isStale={true}
          isOffline={false}
          cachedAt={Date.now() - 90_000}
          live
        />,
      );

      expect(jest.getTimerCount()).toBe(1);
      unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
