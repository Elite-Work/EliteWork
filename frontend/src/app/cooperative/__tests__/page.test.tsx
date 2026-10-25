import { redirect } from "next/navigation";
import CooperativePage from "../page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

describe("CooperativePage", () => {
  it("redirects to /cooperative/bulk-import", () => {
    CooperativePage();
    expect(redirect).toHaveBeenCalledWith("/cooperative/bulk-import");
  });
});
