// Backfills lens.model from scraped MPN data for lenses where model is just
// the lens name restated. Run this after a B&H or Adorama scrape pass to
// promote captured MPNs into the canonical model field.
//
// Usage: npx tsx src/backfill-model-from-mpn.ts [--dry-run]

import { readFileSync, writeFileSync } from "fs";
import type { Lens } from "../shared/types.js";
import { modelIsJustName } from "./scraper-shared.js";

const LENSES_FILE = "lenses.json";
const dryRun = process.argv.includes("--dry-run");

const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));

let updated = 0;
let skipped = 0;
let conflict = 0;

for (const lens of lenses) {
  if (!modelIsJustName(lens)) continue;

  const bhMpn = lens.bh?.mpn?.trim();
  const adoramaMpn = lens.adorama?.mpn?.trim();

  // Prefer B&H MPN — spec table is more reliable than JSON-LD.
  const candidate = bhMpn ?? adoramaMpn;
  if (!candidate) {
    console.log(`  skip  ${lens.id} — no MPN captured yet`);
    skipped++;
    continue;
  }

  // If both sources returned something, flag disagreements rather than
  // silently picking one — a mismatch usually means we landed on wrong pages.
  if (bhMpn && adoramaMpn && bhMpn.toLowerCase() !== adoramaMpn.toLowerCase()) {
    console.log(`  ⚠ conflict  ${lens.id}: B&H="${bhMpn}" vs Adorama="${adoramaMpn}" — skipping`);
    conflict++;
    continue;
  }

  console.log(`  ${dryRun ? "(dry) " : ""}update  ${lens.id}: "${lens.model}"  →  "${candidate}"`);
  if (!dryRun) lens.model = candidate;
  updated++;
}

if (!dryRun && updated > 0) {
  writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
}

console.log(`\n${dryRun ? "[dry run] " : ""}${updated} updated, ${skipped} skipped (no MPN), ${conflict} skipped (conflict).`);
