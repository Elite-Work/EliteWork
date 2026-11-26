import { fireEvent, render, screen } from "@testing-library/react";
import {
  FeatureFlagsProvider,
  useFlags,
} from "@/components/FeatureFlagsProvider";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { FeatureFlags, FlagName } from "@/lib/featureFlags";

jest.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: jest.fn(),
}));

const defaultFlags: FeatureFlags = {
  adminUI: false,
  clawbackUI: false,
  advancedReporting: false,
  offlineBanner: true,
  tradeWizardV2: false,
};

function renderFlagsProvider(
  flags: FeatureFlags,
  isLoading: boolean,
  refresh = jest.fn(),
) {
  const isFeatureEnabled = (flag: FlagName) => flags[flag];
  jest.mocked(useFeatureFlags).mockReturnValue({
    ...flags,
    isLoading,
    isFeatureEnabled,
    refresh,
  });

  function Consumer() {
    const value = useFlags();
    return (
      <div>
        <span role="status">{value.isLoading ? "Loading flags" : "Flags loaded"}</span>
        <span data-testid="admin-ui">{String(value.isFeatureEnabled("adminUI"))}</span>
        <span data-testid="offline-banner">{String(value.offlineBanner)}</span>
        <button onClick={value.refresh}>Refresh flags</button>
      </div>
    );
  }

  return {
    ...render(
      <FeatureFlagsProvider>
        <Consumer />
      </FeatureFlagsProvider>,
    ),
    refresh,
  };
}

describe("FeatureFlagsProvider", () => {
  beforeEach(() => {
    jest.mocked(useFeatureFlags).mockReset();
  });

  it("provides the loading state and fail-safe flags while flags are loading", () => {
    renderFlagsProvider(defaultFlags, true);

    expect(screen.getByRole("status")).toHaveTextContent("Loading flags");
    expect(screen.getByTestId("admin-ui")).toHaveTextContent("false");
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("true");
  });

  it("renders fail-safe defaults when the provider is no longer loading", () => {
    renderFlagsProvider(defaultFlags, false);

    expect(screen.getByRole("status")).toHaveTextContent("Flags loaded");
    expect(screen.getByTestId("admin-ui")).toHaveTextContent("false");
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("true");
  });

  it("provides populated flags and the refresh action after loading", () => {
    const flags = { ...defaultFlags, adminUI: true };
    const refresh = jest.fn();
    renderFlagsProvider(flags, false, refresh);

    expect(screen.getByRole("status")).toHaveTextContent("Flags loaded");
    expect(screen.getByTestId("admin-ui")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Refresh flags" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("requires consumers to be rendered within the provider", () => {
    function Consumer() {
      useFlags();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow(
      "useFlags must be used within a FeatureFlagsProvider",
    );
  });
});
