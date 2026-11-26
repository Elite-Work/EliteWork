import { render, screen } from "@testing-library/react";
import AdminDashboardPage from "../page";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { adminApi } from "@/lib/api/admin";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => "/admin"),
}));

jest.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(() => ({
    token: "admin-jwt-token",
    isAuthenticated: true,
    isLoading: false,
  })),
}));

jest.mock("@/lib/api/admin", () => {
  const actual = jest.requireActual("@/lib/api/admin");
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      dlq: {
        list: jest.fn(),
        replay: jest.fn(),
      },
    },
  };
});

const mockUseIsAdmin = useIsAdmin as jest.Mock;
const mockDlqList = adminApi.dlq.list as jest.Mock;

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDlqList.mockResolvedValue({
      queue: "webhooks",
      depth: 0,
      page: 1,
      limit: 25,
      events: [],
    });
  });

  it("renders the admin dashboard with the DLQ viewer panel for admins", async () => {
    mockUseIsAdmin.mockReturnValue(true);

    render(<AdminDashboardPage />);

    expect(screen.getByRole("heading", { name: "Admin Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("dlq-viewer-panel")).toBeInTheDocument();
    expect(await screen.findByTestId("dlq-empty")).toBeInTheDocument();
  });

  it("renders ForbiddenState for non-admins", () => {
    mockUseIsAdmin.mockReturnValue(false);

    render(<AdminDashboardPage />);

    expect(screen.queryByTestId("dlq-viewer-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-dashboard-page")).toBeInTheDocument();
  });
});
