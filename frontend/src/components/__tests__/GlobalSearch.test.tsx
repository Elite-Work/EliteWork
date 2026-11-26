import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalSearch from "../GlobalSearch";

describe("GlobalSearch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("renders the search input", () => {
    render(<GlobalSearch />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows a loading state while searching", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;

    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "alice");

    expect(await screen.findByText(/loading/i)).toBeInTheDocument();

    resolveFetch({
      ok: true,
      json: async () => ({ results: [] }),
    });
  });

  it("renders populated results", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: "1", name: "Alice", username: "alice" },
          { id: "2", name: "Bob", username: "bob" },
        ],
      }),
    })) as unknown as typeof fetch;

    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "a");

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders an empty state when there are no results", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch;

    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");

    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it("renders an error state when the request fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;

    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "alice");

    await waitFor(() => {
      expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
    });
  });
});
