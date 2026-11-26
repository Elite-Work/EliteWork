import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CooperativePage from "../page";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    cooperatives: {
      pilotRegister: jest.fn(),
    },
  },
}));

describe("CooperativePage pilot registration flow (#495)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the pilot registration form with all required fields", () => {
    render(<CooperativePage />);

    expect(screen.getByRole("heading", { name: /cooperative pilot program/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/cooperative name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin stellar wallet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /register cooperative for pilot/i }),
    ).toBeInTheDocument();
  });

  it("submits the form and displays the confirmation state", async () => {
    (api.cooperatives.pilotRegister as jest.Mock).mockResolvedValueOnce({
      id: "coop-pilot-test123",
      name: "Northern Farmers Alliance",
      adminWallet: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS",
      contactEmail: "admin@northernfarmers.org",
      region: "Kaduna",
      trialPeriod: true,
      isTrialPeriod: true,
      trialDays: 90,
      trialEndsAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
      status: "ACTIVE",
    });

    render(<CooperativePage />);

    fireEvent.change(screen.getByLabelText(/cooperative name/i), {
      target: { value: "Northern Farmers Alliance" },
    });
    fireEvent.change(screen.getByLabelText(/admin stellar wallet/i), {
      target: { value: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS" },
    });
    fireEvent.change(screen.getByLabelText(/contact email/i), {
      target: { value: "admin@northernfarmers.org" },
    });
    fireEvent.change(screen.getByLabelText(/region/i), {
      target: { value: "Kaduna" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /register cooperative for pilot/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-state")).toBeInTheDocument();
    });

    expect(screen.getByText(/pilot registration confirmed!/i)).toBeInTheDocument();
    expect(screen.getByText("Northern Farmers Alliance")).toBeInTheDocument();
    expect(screen.getByText("coop-pilot-test123")).toBeInTheDocument();
    expect(screen.getByText(/90 days active/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to bulk import/i })).toBeInTheDocument();
  });

  it("displays error state when pilot registration fails", async () => {
    (api.cooperatives.pilotRegister as jest.Mock).mockRejectedValueOnce(
      new Error("Wallet address is already registered in another pilot cohort"),
    );

    render(<CooperativePage />);

    fireEvent.change(screen.getByLabelText(/cooperative name/i), {
      target: { value: "Duplicate Coop" },
    });
    fireEvent.change(screen.getByLabelText(/admin stellar wallet/i), {
      target: { value: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS" },
    });
    fireEvent.change(screen.getByLabelText(/contact email/i), {
      target: { value: "dup@coop.org" },
    });
    fireEvent.change(screen.getByLabelText(/region/i), {
      target: { value: "Kano" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /register cooperative for pilot/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/wallet address is already registered in another pilot cohort/i),
    ).toBeInTheDocument();
  });
});
