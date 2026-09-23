/**
 * CSV parsing for the cooperative bulk-import UI (issue #45).
 *
 * Pure helper (no React) so it is unit-testable in isolation. Expected
 * columns per line:
 *
 *   sellerAddress, amountUsdc[, buyerLossBps[, sellerLossBps]]
 *
 * Loss splits default to 5000/5000. Lines starting with `#` and blank lines
 * are skipped; the first line is treated as a header and skipped when it
 * does not look like a Stellar address.
 */

export interface BulkTradeRow {
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
}

export interface BulkCsvError {
  line: number;
  message: string;
}

export interface BulkCsvResult {
  rows: BulkTradeRow[];
  errors: BulkCsvError[];
}

const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;
export const BULK_IMPORT_MAX_ROWS = 50;

function parseBps(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000 ? parsed : null;
}

export function parseBulkCsv(text: string): BulkCsvResult {
  const rows: BulkTradeRow[] = [];
  const errors: BulkCsvError[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const cells = line.split(",").map((cell) => cell.trim());
    const [sellerAddress = "", amountUsdc = "", buyerBpsRaw, sellerBpsRaw] = cells;

    // Skip a header row ("sellerAddress,amountUsdc,...").
    if (lineNumber === 1 && !STELLAR_ADDRESS_PATTERN.test(sellerAddress)) {
      if (/seller/i.test(sellerAddress)) return;
    }

    if (!STELLAR_ADDRESS_PATTERN.test(sellerAddress)) {
      errors.push({ line: lineNumber, message: "Invalid sellerAddress" });
      return;
    }
    if (!AMOUNT_PATTERN.test(amountUsdc) || Number(amountUsdc) <= 0) {
      errors.push({ line: lineNumber, message: "Invalid amountUsdc" });
      return;
    }
    const buyerLossBps = parseBps(buyerBpsRaw, 5000);
    const sellerLossBps = parseBps(sellerBpsRaw, 5000);
    if (buyerLossBps === null || sellerLossBps === null) {
      errors.push({ line: lineNumber, message: "Loss splits must be integers 0-10000" });
      return;
    }
    if (buyerLossBps + sellerLossBps !== 10000) {
      errors.push({ line: lineNumber, message: "Loss splits must sum to 10000" });
      return;
    }
    rows.push({ sellerAddress, amountUsdc, buyerLossBps, sellerLossBps });
  });

  if (rows.length > BULK_IMPORT_MAX_ROWS) {
    return {
      rows: [],
      errors: [
        {
          line: 0,
          message: `Too many rows: ${rows.length} (maximum ${BULK_IMPORT_MAX_ROWS} per request)`,
        },
      ],
    };
  }

  return { rows, errors };
}
