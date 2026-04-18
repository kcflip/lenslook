# Lenslook
Investigating the popularity of sony lenses on reddit.

## Setup
```bash
npm install
```

## Run

```bash
npm start
```

## Reddit Posts
Posts are fetched from Reddit's public JSON endpoints

Each matched post is assigned a weight using two signals combined 80/20 as a very rudimentary weighting system.

```
weight = (score * upvote_ratio) * 0.8 + log(1 + num_comments) * 0.2
```

