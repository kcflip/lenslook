import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { PriceHistoryData } from "../shared/types.js";

const HISTORY_FILE = "output/price-history.json";

function load(): PriceHistoryData {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function recordPrice(lensId: string, retailer: "amazon" | "bh", price: number, scrapedAt: string): void {
  mkdirSync("output", { recursive: true });
  const history = load();
  if (!history[lensId]) history[lensId] = {};
  const points = history[lensId][retailer] ?? [];
  points.push({ price, scrapedAt });
  history[lensId][retailer] = points;
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
