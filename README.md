# Lenslook

Scrapes posts from r/sonyalpha and r/photography, detects which Sony-ecosystem lenses are mentioned in each title, and aggregates popularity metrics (score, upvote ratio, comment count) per lens.

## Lenses tracked

~120 lenses across Sony (APS-C and full-frame, including GM, G, and Zeiss lines), Sigma, and Tamron — all for the Sony E-mount.

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Create a Reddit app**

Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and create a new **script** app. Use any valid URL for the redirect URI (e.g. this repo's URL).

**3. Configure credentials**

```bash
cp .env.example .env
```

Fill in your client ID and secret:

```
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
```

## Run

```bash
npm start
```

Results are written to `output/results.json` with per-post match data and aggregate stats per lens.

## Output shape

```json
{
  "fetchedAt": "2026-04-16T00:00:00.000Z",
  "subreddits": ["sonyalpha", "photography"],
  "stats": [
    {
      "lensId": "sony-fe-85-1.4-gm",
      "postCount": 42,
      "avgScore": 1840,
      "avgUpvoteRatio": 0.97,
      "avgComments": 38
    }
  ],
  "posts": [...]
}
```
