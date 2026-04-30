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

export function recordPrice(productId: string, retailer: "amazon" | "bh" | "adorama" | string, price: number, scrapedAt: string): void {
  mkdirSync("output", { recursive: true });
  const history = load();
  if (!history[productId]) history[productId] = {};
  if (retailer === "amazon" || retailer === "bh" || retailer === "adorama") {
    const points = history[productId][retailer] ?? [];
    points.push({ price, scrapedAt });
    history[productId][retailer] = points;
  } else {
    if (!history[productId].retailers) history[productId].retailers = {};
    const points = history[productId].retailers![retailer] ?? [];
    points.push({ price, scrapedAt });
    history[productId].retailers![retailer] = points;
  }
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
