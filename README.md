# emergent — paper-finder × pattern-borrow integration

One research question in → ranked code patterns out. Built 2026-10-03 (tansy lane).

## Pipeline

```
"<research query>"
      │  hop 1 (timed): paper legs race — arXiv + alphaXiv + s2 + openalex + hf
      │  (race_papers.py, HFT: concurrent legs, fail-fast, sufficiency-not-exhaustion)
      ▼
  ranked papers (title / source / arXiv id / url / relevance line)
      │  term derivation (mechanical): query phrase + query words +
      │  most-frequent distinctive title tokens (stopwords + filler dropped)
      ▼
  borrow terms
      │  hop 2 (timed): GitHub-wide pattern borrow
      │  (pattern-borrow.ts: code search + 8-factor ranking — recency, size,
      │   prevalence, stars, issues, forks, test coverage, bug-relevance)
      ▼
  ranked patterns + TOP 3 TO MERGE
```

Nothing here is invented: the paper racer is the `paper-search` skill's
`bin/race_papers.py`, the ranker is `estate/scripts/pattern-borrow.ts`.
This directory is the seam that wires them together.

## Usage

```bash
cd /home/toxic/estate/ranch
GITHUB_TOKEN=$(gh auth token) bun run emergent/paper-borrow.ts "hedged requests tail latency" \
  --maxn 6 --terms 5 --top 5 --perPage 3 --jsonl emergent/demo/transcript-2026-10-03.json
```

Env: `GITHUB_TOKEN` (or `GH_TOKEN`) — required by the borrow leg for GitHub code search.
Tool paths overridable via `PAPER_BORROW_RACE_PAPERS` / `PAPER_BORROW_PATTERN_BORROW`.

## Inherited behaviors (from the borrowed tools, not bugs in this seam)

- `pattern-borrow.ts` takes `--perPage` (camelCase) — its `--help` text says
  `--per-page`, which the arg parser rejects.
- The borrow leg sleeps ~1.2s between terms and fetches repo stats serially;
  a 5-term run takes ~30–60s. Speeding that up is a pattern-borrow.ts change,
  out of scope here.
- With a single borrow term every score normalizes to 0.0 — ranking needs ≥2 terms.
- The paper leg's s2 leg fails intermittently; the race is designed so a dead
  leg never blocks the others.

## Demo

`demo/transcript-2026-10-03.md` — full end-to-end run of the query
`"hedged requests tail latency"`: 6 papers raced in ~2s, 5 borrow terms
derived, ranked GitHub-wide, top-3 merge list produced. Machine-readable
twin: `demo/transcript-2026-10-03.json`.
