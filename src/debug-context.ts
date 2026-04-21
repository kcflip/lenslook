import { readFileSync } from "fs";
import { EOS, matchLensesWithPositions } from "./matcher.js";

const LENS = process.argv[2] ?? "tamron-20-2.8-macro";
const KEYWORD = process.argv[3] ?? "expensive";
const WINDOW = 30;

const data = JSON.parse(readFileSync("output/results.json", "utf8"));
const hits: { source: string; postRef: string; ctx: string; scoped: boolean }[] = [];

function scan(text: string, source: string, postRef: string) {
  const { matches, normalized } = matchLensesWithPositions(text);
  for (const m of matches) {
    if (m.id !== LENS) continue;
    const before = normalized.slice(0, m.index).trim().split(/\s+/).filter(Boolean);
    const after = normalized.slice(m.index).trim().split(/\s+/).filter(Boolean);
    // Sentence-scoped window (matches sentiment analyzer behavior)
    const beforeScoped: string[] = [];
    for (let i = before.length - 1; i >= 0 && beforeScoped.length < WINDOW; i--) {
      if (before[i] === EOS) break;
      beforeScoped.unshift(before[i]);
    }
    const afterScoped: string[] = [];
    for (let i = 0; i < after.length && afterScoped.length < WINDOW + 1; i++) {
      if (after[i] === EOS) break;
      afterScoped.push(after[i]);
    }
    const scopedWin = [...beforeScoped, ...afterScoped];
    // Raw window (ignoring sentence boundaries) for "why was this filtered out" visibility
    const rawWin = [...before.slice(-WINDOW), ...after.slice(0, WINDOW + 1)];
    for (let i = 0; i < rawWin.length; i++) {
      if (rawWin[i] === KEYWORD) {
        const ctx = rawWin.slice(Math.max(0, i - 8), i + 9).join(" ");
        const scoped = scopedWin.includes(KEYWORD);
        hits.push({ source, postRef, ctx, scoped });
      }
    }
  }
}

for (const post of data.posts) {
  scan(post.title + " " + (post.selftext ?? ""), "post", post.title.slice(0, 70));
  for (const c of post.matchedComments ?? []) scan(c.body, "comment", post.title.slice(0, 70));
}

const counted = hits.filter((h) => h.scoped).length;
const filtered = hits.length - counted;
console.log(`Found ${hits.length} "${KEYWORD}" mentions within ±${WINDOW} words of ${LENS}`);
console.log(`  ${counted} counted (same sentence), ${filtered} filtered out by sentence boundary\n`);
for (const h of hits) {
  const tag = h.scoped ? "[COUNTED]" : "[FILTERED]";
  console.log(`${tag} [${h.source}] in post: "${h.postRef}"`);
  console.log(`  … ${h.ctx} …\n`);
}
