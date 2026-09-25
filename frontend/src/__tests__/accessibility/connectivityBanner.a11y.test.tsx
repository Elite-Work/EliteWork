import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { ConnectivityBanner } from "@/components/ui/ConnectivityBanner";

expect.extend(toHaveNoViolations);

let mockOffline = { isOffline: false, wasOffline: false };

jest.mock("@/hooks/useOffline", () => ({
  useOffline: () => ({ ...mockOffline, isOnline: !mockOffline.isOffline, retryOnline: jest.fn() }),
}));
jest.mock("@/hooks/useToast", () => ({
  useToast: () => ({ addToast: jest.fn(), addToastWithCorrelation: jest.fn() }),
}));
jest.mock("@/lib/api/client", () => ({ request: jest.fn() }));

describe("ConnectivityBanner — screen-reader announcements", () => {
  it("keeps a polite live region mounted while online", () => {
    mockOffline = { isOffline: false, wasOffline: false };
    render(<ConnectivityBanner />);
    const region = screen.getByTestId("connectivity-live-region");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region).toBeEmptyDOMElement();
  });

  it("announces the offline transition in the same live region", () => {
    mockOffline = { isOffline: false, wasOffline: false };
    const { rerender } = render(<ConnectivityBanner />);
    const region = screen.getByTestId("connectivity-live-region");

    mockOffline = { isOffline: true, wasOffline: true };
    rerender(<ConnectivityBanner />);
    expect(screen.getByTestId("connectivity-live-region")).toBe(region);
    expect(region).toHaveTextContent(/offline/i);
  });

  it("announces the back-online transition even when nothing is queued", () => {
    mockOffline = { isOffline: true, wasOffline: true };
    const { rerender } = render(<ConnectivityBanner />);
    const region = screen.getByTestId("connectivity-live-region");

    mockOffline = { isOffline: false, wasOffline: true };
    rerender(<ConnectivityBanner />);
    expect(screen.getByTestId("connectivity-live-region")).toBe(region);
    expect(region).toHaveTextContent("Back online.");
  });

  it("has no axe violations while offline", async () => {
    mockOffline = { isOffline: true, wasOffline: true };
    const { container } = render(<ConnectivityBanner />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
