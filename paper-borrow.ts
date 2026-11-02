#!/usr/bin/env bun
/**
 * paper-borrow.ts — paper-finder × pattern-borrow integration (emergent lane).
 *
 * One research question in → paper legs race (arXiv + alphaXiv + s2 + openalex + hf)
 * → distinctive terms derived from the winning papers' titles
 * → GitHub-wide pattern borrow ranks those terms → ranked code patterns out.
 *
 * Borrows, not invents:
 *   papers: python3 /home/toxic/pens/ranch/products/paper-poller/bin/race_papers.py  (canonical paper-poller)
 *   borrow: bun <azurite code-patterns bin/pattern-borrow.ts> --json  (canonical pattern-forge)
 *
 * Usage:
 *   bun run emergent/paper-borrow.ts "hedged requests tail latency" \
 *     [--maxn 6] [--terms 5] [--top 5] [--perPage 3] [--jsonl transcript.json]
 *
 * Env:
 *   GITHUB_TOKEN (or GH_TOKEN) — required by the borrow leg (GitHub code search).
 *   PAPER_BORROW_RACE_PAPERS / PAPER_BORROW_PATTERN_BORROW — override tool paths.
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";

const RACE_PAPERS =
  process.env.PAPER_BORROW_RACE_PAPERS ??
  "/home/toxic/pens/ranch/products/paper-poller/bin/race_papers.py";
const PATTERN_BORROW =
  process.env.PAPER_BORROW_PATTERN_BORROW ??
  "/home/toxic/pens/geode/products/azurite/skills/04_code_intelligence/code-patterns/bin/pattern-borrow.ts";

const STOPWORDS = new Set(
  "a an and are as at be been by for from has have how in is it its of on or that the their there this to was were what when where which who why with".split(
    " ",
  ),
);
const GENERIC = new Set(
  "software paper papers method methods approach approaches system systems model models using used based via novel new framework study studies analysis towards toward real improved state art survey review application applications results result data code design".split(
    " ",
  ),
);

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9][\w.+-]*/g)) {
    const w = m[0].toLowerCase();
    if (w.length >= 3 && !STOPWORDS.has(w) && !GENERIC.has(w)) out.push(w);
  }
  return out;
}

function trunc(s: string, width: number): string {
  if (s.length <= width) return s;
  const cut = s.slice(0, width);
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut) + "…";
}

function oneLine(p: any, width = 160): string {
  const bits: string[] = [];
  const topics = ((p.topics ?? []) as string[]).filter(Boolean).slice(0, 3);
  if (topics.length) bits.push("[" + topics.join(", ") + "]");
  const summ = String(p.summary ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (summ) bits.push(trunc(summ, width));
  return bits.join(" ") || "(no abstract)";
}

function run(
  cmd: string,
  args: string[],
): { stdout: string; stderr: string; ms: number; code: number } {
  const t0 = Bun.nanoseconds();
  const r = Bun.spawnSync([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const ms = (Bun.nanoseconds() - t0) / 1e6;
  return {
    stdout: Buffer.from(r.stdout).toString("utf8"),
    stderr: Buffer.from(r.stderr).toString("utf8"),
    ms,
    code: r.exitCode ?? 1,
  };
}

function deriveTerms(query: string, papers: any[], k: number): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      terms.push(t);
    }
  };
  const qwords = tokens(query);
  if (qwords.length >= 2) push(qwords.join(" ")); // whole query as a phrase term
  for (const w of qwords) push(w); // then each query word
  // Distinctive title tokens, most frequent first — the papers' own vocabulary.
  const freq = new Map<string, number>();
  for (const p of papers)
    for (const w of tokens(String(p.title ?? ""))) freq.set(w, (freq.get(w) ?? 0) + 1);
  for (const [w] of [...freq.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  ))
    push(w);
  return terms.slice(0, k);
}

interface BorrowedRow {
  term: string;
  score: number;
  repos: number;
  stars: number;
  issues: number;
  testFrac: number;
}

function parseBorrowed(stdout: string): BorrowedRow[] {
  // The canonical CLI emits BorrowResult JSON (--json): ranked[] with
  // { source, item, score }. Derive the same summary columns from it.
  const rows: BorrowedRow[] = [];
  try {
    // Event NDJSON lines (source_done/borrow_done) precede the pretty-printed
    // final result; grab the last top-level object and parse just that.
    const objStart = stdout.lastIndexOf('\n{\n');
    const body = objStart >= 0 ? stdout.slice(objStart + 1) : stdout;
    const parsed: unknown = JSON.parse(body);
    const ranked: unknown[] =
      parsed !== null &&
      typeof parsed === "object" &&
      "ranked" in parsed &&
      Array.isArray(parsed.ranked)
        ? parsed.ranked
        : [];
    const code: { score: number; item: { repo: unknown; stars?: unknown } }[] = [];
    for (const r of ranked) {
      if (
        r !== null &&
        typeof r === "object" &&
        "score" in r &&
        "item" in r &&
        r.item !== null &&
        typeof r.item === "object" &&
        "repo" in r.item
      ) {
        const score = typeof r.score === "number" ? r.score : 0;
        const repo = r.item.repo;
        const stars = "stars" in r.item && typeof r.item.stars === "number" ? r.item.stars : 0;
        code.push({ score, item: { repo, stars } });
      }
    }
    const repos = new Set(
      code.map((r) => String(r.item.repo)).filter((v) => v && v !== "null"),
    );
    const stars = code.reduce(
      (a: number, r) => a + (typeof r.item.stars === "number" ? r.item.stars : 0),
      0,
    );
    rows.push({
      score: code.length
        ? code.reduce((a: number, r) => a + r.score, 0) / code.length
        : 0,
      repos: repos.size,
      stars,
      issues: 0,
      testFrac: 0,
      term:
        parsed !== null && typeof parsed === "object" && "query" in parsed
          ? String(parsed.query)
          : "(query)",
    });
  } catch {
    // fall through with empty rows — the caller reports no matches
  }
  return rows;
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    maxn: { type: "string" },
    terms: { type: "string" },
    top: { type: "string" },
    perPage: { type: "string" },
    jsonl: { type: "string" },
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || !positionals.length) {
  console.log(
    `Usage: bun run emergent/paper-borrow.ts "<query>" [--maxn 6] [--terms 5] [--top 5] [--perPage 3] [--jsonl transcript.json]`,
  );
  process.exit(positionals.length ? 0 : 1);
}

const query = positionals.join(" ");
const MAXN = Number(values.maxn ?? 6);
const NTERMS = Number(values.terms ?? 5);
const TOP = Number(values.top ?? 5);
const PERPAGE = Number(values.perPage ?? 3);

const token = Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN;
if (!token) {
  console.error("no GITHUB_TOKEN/GH_TOKEN — the borrow leg needs GitHub code search auth");
  process.exit(1);
}

// Hop 1 — the paper legs race (arXiv + alphaXiv + s2 + openalex + hf).
const h1 = run("python3", [RACE_PAPERS, query, "--maxn", String(MAXN)]);
const papers = h1.stdout
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((p) => p && !p.error);
const legSummary = (h1.stderr.match(/SUMMARY .*/) ?? ["(no summary)"])[0];
if (!papers.length) {
  console.error(
    `paper leg returned no papers (exit ${h1.code}). stderr:\n${h1.stderr.slice(0, 800)}`,
  );
  process.exit(1);
}

// Hop 2 — derive borrow terms from the papers, rank them GitHub-wide.
const borrowTerms = deriveTerms(query, papers, NTERMS);
// One canonical query per derived term (the CLI takes a single positional
// query; --json gives structured ranked output for the transcript).
const h2 = run("bun", [PATTERN_BORROW, borrowTerms[0] ?? query, "--top", String(TOP), "--per-source", String(PERPAGE), "--json"]);
const borrowed = parseBorrowed(h2.stdout);
const toMerge = borrowed.slice(0, Math.min(3, borrowed.length)).map((r) => r.term);

const totalMs = h1.ms + h2.ms;
const transcript = {
  query,
  timing_ms: {
    papers: Math.round(h1.ms),
    borrow: Math.round(h2.ms),
    total: Math.round(totalMs),
  },
  leg_summary: legSummary,
  papers: papers.map((p) => ({
    title: p.title,
    source: p.source,
    arxiv_id: p.arxiv_id ?? null,
    url: p.url,
    published: p.published,
    relevance: oneLine(p),
  })),
  derived_terms: borrowTerms,
  borrowed,
  top_to_merge: toMerge,
};

console.log(`=== PAPER-BORROW TRANSCRIPT ===`);
console.log(`query: ${query}`);
console.log(
  `timing: papers ${(h1.ms / 1000).toFixed(2)}s | borrow ${(h2.ms / 1000).toFixed(2)}s | total ${(totalMs / 1000).toFixed(2)}s`,
);
console.log(`legs: ${legSummary}`);
console.log(`\n--- PAPERS (${papers.length}) ---`);
for (const p of transcript.papers)
  console.log(
    `- ${p.title} [${p.source}${p.arxiv_id ? ", " + p.arxiv_id : ""}, ${p.published}] ${p.url}\n  ${p.relevance}`,
  );
console.log(`\n--- DERIVED BORROW TERMS ---`);
for (const t of borrowTerms) console.log(`- ${t}`);
console.log(`\n--- RANKED PATTERNS (GitHub-wide) ---`);
for (const r of borrowed)
  console.log(
    `${r.score.toFixed(1).padStart(5)}  repos=${r.repos} stars=${r.stars} issues=${r.issues} test=${r.testFrac.toFixed(2)}  ${r.term}`,
  );
console.log(`\nTOP ${toMerge.length} TO MERGE:`);
for (const t of toMerge) console.log(`  - ${t}`);

if (values.jsonl) {
  writeFileSync(values.jsonl, JSON.stringify(transcript, null, 2));
  console.log(`\ntranscript JSON: ${values.jsonl}`);
}
