import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nextDir = path.join(root, '.next', 'static', 'chunks');
const budgetBytes = Number(process.env.BUNDLE_BUDGET_BYTES ?? '3000000');
const budgetKib = (budgetBytes / 1024).toFixed(1);

if (!fs.existsSync(nextDir)) {
  console.error('Bundle budget check failed: .next/static/chunks was not found. Run the production build first.');
  process.exit(1);
}

let totalBytes = 0;
for (const entry of fs.readdirSync(nextDir, { withFileTypes: true })) {
  const fullPath = path.join(nextDir, entry.name);
  if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.css'))) {
    totalBytes += fs.statSync(fullPath).size;
  }
}

const humanReadable = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
};

console.log(`Bundle budget: ${humanReadable(totalBytes)} / ${humanReadable(budgetBytes)} (${budgetKib} KiB)`);
if (totalBytes > budgetBytes) {
  console.error(`Bundle budget exceeded: ${humanReadable(totalBytes)} > ${humanReadable(budgetBytes)}.`);
  console.error('Consider reducing client-side imports, splitting route chunks, or optimizing large dependencies.');
  process.exit(1);
}

console.log('Bundle budget check passed.');
