import { BULK_IMPORT_MAX_ROWS, parseBulkCsv } from "../bulkImport";

const SELLER_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const SELLER_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("parseBulkCsv (issue #45)", () => {
  it("parses valid rows with default loss splits", () => {
    const { rows, errors } = parseBulkCsv(`${SELLER_A},25.50\n${SELLER_B},10`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { sellerAddress: SELLER_A, amountUsdc: "25.50", buyerLossBps: 5000, sellerLossBps: 5000 },
      { sellerAddress: SELLER_B, amountUsdc: "10", buyerLossBps: 5000, sellerLossBps: 5000 },
    ]);
  });

  it("skips blank lines, comments, and a header row", () => {
    const { rows, errors } = parseBulkCsv(
      ["sellerAddress,amountUsdc", "", "# comment", `${SELLER_A},1`].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("reports per-line errors without dropping valid rows", () => {
    const { rows, errors } = parseBulkCsv(
      [`not-an-address,10`, `${SELLER_A},0`, `${SELLER_A},5,6000,6000`, `${SELLER_B},7`].join(
        "\n",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((error) => error.line)).toEqual([1, 2, 3]);
  });

  it("rejects batches over the row cap", () => {
    const csv = Array.from({ length: BULK_IMPORT_MAX_ROWS + 1 }, () => `${SELLER_A},1`).join(
      "\n",
    );
    const { rows, errors } = parseBulkCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
