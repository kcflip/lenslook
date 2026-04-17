# Snowsniffer — Reddit Lens Popularity Scraper

## What We're Building

A TypeScript tool that scrapes posts from `r/sonyalpha` and `r/photography`, detects which Sony-ecosystem lens is mentioned in each post title, and tracks popularity metrics (score, upvote ratio, comment count) per lens.

---

## Steps Taken

### 1. Defined scope
- **Subreddits:** r/sonyalpha, r/photography
- **Data:** Posts only (no comments for now)
- **Output:** JSON
- **API:** Reddit OAuth (client credentials — no user login needed for public data)
- **Language:** TypeScript

### 2. Decided on lens data structure
Canonical name + model code + aliases to handle the many ways people refer to the same lens in post titles (e.g. "85GM", "85 1.4 GM", "SEL85F14GM").

```json
{
  "id": "sony-fe-85-1.4-gm",
  "brand": "Sony",
  "name": "FE 85mm f/1.4 GM",
  "model": "SEL-85F14GM",
  "focalLength": "85mm",
  "maxAperture": "f/1.4",
  "mount": "FE (Full-Frame)",
  "aliases": ["85GM", "85 1.4 GM", "SEL85F14GM", "85mm GM"]
}
```

### 3. Built `lenses.json`
Sourced from:
- [Wikipedia — List of Sony E-mount lenses](https://en.wikipedia.org/wiki/List_of_Sony_E-mount_lenses)
- [Wikipedia — List of third-party Sony E-mount lenses](https://en.wikipedia.org/wiki/List_of_third-party_Sony_E-mount_lenses)

Covers ~120 lenses across:
- **Sony** — APS-C primes, APS-C zooms, FE primes, FE zooms (including GM, G, Zeiss/ZA lines)
- **Sigma** — APS-C DC DN and full-frame DG DN primes and zooms
- **Tamron** — APS-C Di III-A and full-frame Di III primes and zooms

---

## Next Steps

### Step 4 — Project scaffold
- `npm init` + TypeScript config
- Folder structure: `src/`, `data/`, `output/`
- Dependencies: none beyond built-in `fetch` (Node 18+)

### Step 5 — Reddit OAuth setup
- Create a Reddit app at reddit.com/prefs/apps (script type)
- Store `CLIENT_ID`, `CLIENT_SECRET` in `.env`
- Implement `getAccessToken()` using client credentials flow

### Step 6 — Scraper
- `fetchPosts(subreddit, sort, limit)` — paginate via `after` cursor, up to configurable limit
- Fields to capture per post: `id`, `title`, `score`, `upvote_ratio`, `num_comments`, `created_utc`, `url`, `subreddit`

### Step 7 — Lens matcher
- Normalize post title (lowercase, strip punctuation)
- Check against each lens's `name` and `aliases` (case-insensitive)
- Return matched lens ID(s) — a post can mention multiple lenses

### Step 8 — Output
- Write matched posts to `output/results.json`
- Aggregate popularity per lens: total posts, avg score, avg upvote ratio

### Step 9 — Iteration
- Tune aliases based on missed/false matches
- Consider fuzzy matching for common misspellings
- Potentially expand to comments
