import lenses from "../lenses.json" with { type: "json" };

const SOURCES = ["amazon", "bh", "adorama"] as const;

type Source = (typeof SOURCES)[number];

interface Row {
  id: string;
  brand: string;
  name: string;
  missing: Source[];
}

const rows: Row[] = lenses
  .map((lens) => {
    const missing = SOURCES.filter(
      (s) => !(lens as Record<string, unknown>)[s]
    ) as Source[];
    return { id: lens.id, brand: lens.brand, name: lens.name, missing };
  })
  .filter((r) => r.missing.length > 0)
  .sort((a, b) => b.missing.length - a.missing.length);

if (rows.length === 0) {
  console.log("All lenses have all sources.");
  process.exit(0);
}

const colWidth = Math.max(...rows.map((r) => r.brand.length +r.name.length), 4) + 2;

console.log(
  `${"Lens".padEnd(colWidth)}Missing sources (${rows.length}/${lenses.length} lenses)\n${"─".repeat(colWidth + 30)}`
);

for (const { brand, name, missing } of rows) {
  console.log(`${brand} ${name.padEnd(colWidth)}${missing.join(", ")}`);
}

console.log(`\nSummary:`);
for (const s of SOURCES) {
  const n = lenses.filter((l) => !(l as Record<string, unknown>)[s]).length;
  if (n > 0) console.log(`  ${s}: ${n} missing`);
}
