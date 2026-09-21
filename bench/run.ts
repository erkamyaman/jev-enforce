import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findViolations, type Kind } from '../src/check.js';
import { createAsk } from '../src/jev.js';
import { classify, type Rule, type Scope } from '../src/rules.js';

interface BenchCase {
  id: string;
  kind: Kind;
  breaks: number[];
  text: string;
}
interface Bench {
  rules: { text: string; scope: Scope }[];
  cases: BenchCase[];
}

const PRICE_PER_INPUT_TOKEN = 0.042 / 1e6;
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bench: Bench = JSON.parse(readFileSync(join(root, 'bench', 'cases.json'), 'utf8'));
const useFake = process.argv.includes('--fake');

let inputTokens = 0;
async function makeFetch(): Promise<typeof fetch> {
  const base = useFake ? (await import('../test/fake-jev.js')).fakeJev() : globalThis.fetch;
  return (async (url: string, init: RequestInit) => {
    const res = await base(url, init);
    const json = await res.clone().json().catch(() => null);
    inputTokens += json?.usage?.input_tokens ?? 0;
    return res;
  }) as typeof fetch;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

async function main() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey && !useFake) {
    console.error('Set TYPESAFE_API_KEY, or pass --fake to smoke-test the harness offline.');
    process.exit(2);
  }
  const ask = createAsk({ apiKey: apiKey ?? 'fake', fetch: await makeFetch() });

  const classified = await classify(
    bench.rules.map((r) => ({ text: r.text, source: 'bench' })),
    ask,
    mkdtempSync(join(tmpdir(), 'jev-enforce-bench-')),
  );
  const scopeMisses = classified
    .map((r, i) => ({ rule: r.text, got: r.scope, want: bench.rules[i].scope }))
    .filter((m) => m.got !== m.want);

  const rules: Rule[] = bench.rules.map((r) => ({ ...r, source: 'bench' }));
  const pairs: { caseId: string; rule: number; p: number; broken: boolean }[] = [];
  const latencies: number[] = [];
  for (const c of bench.cases) {
    const started = performance.now();
    const scored = await findViolations({ text: c.text, kind: c.kind, rules, ask, threshold: 0 });
    latencies.push(performance.now() - started);
    for (const v of scored) {
      const rule = bench.rules.findIndex((r) => r.text === v.rule);
      pairs.push({ caseId: c.id, rule, p: v.p, broken: c.breaks.includes(rule) });
    }
  }

  const rows = THRESHOLDS.map((t) => {
    const tp = pairs.filter((x) => x.broken && x.p >= t).length;
    const fp = pairs.filter((x) => !x.broken && x.p >= t).length;
    const fn = pairs.filter((x) => x.broken && x.p < t).length;
    const cleanCases = bench.cases.filter((c) => !c.breaks.length);
    const falseAlarms = cleanCases.filter((c) => pairs.some((x) => x.caseId === c.id && x.p >= t)).length;
    return `| ${t} | ${pct(tp, tp + fp)} | ${pct(tp, tp + fn)} | ${falseAlarms} of ${cleanCases.length} |`;
  });

  const misses = pairs.filter((x) => x.broken !== x.p >= 0.8).map((x) => `- ${x.caseId}, rule ${x.rule}: p=${x.p.toFixed(2)}, expected ${x.broken ? 'broken' : 'clean'}`);

  const report = [
    `# jev-enforce benchmark${useFake ? ' (FAKE JEV, harness smoke test only)' : ''}`,
    '',
    `${bench.cases.length} cases, ${bench.rules.length} rules, ${pairs.length} rule checks. Run ${new Date().toISOString().slice(0, 10)}.`,
    '',
    '## Catching broken rules',
    '',
    '| Threshold | Precision | Recall | Clean texts wrongly flagged |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Sorting rules (reply / code / both / none)',
    '',
    `${bench.rules.length - scopeMisses.length} of ${bench.rules.length} sorted as expected.`,
    ...scopeMisses.map((m) => `- "${m.rule}": got ${m.got}, expected ${m.want}`),
    '',
    '## Speed and cost',
    '',
    `- Latency per check: p50 ${quantile(latencies, 0.5).toFixed(0)}ms, p95 ${quantile(latencies, 0.95).toFixed(0)}ms`,
    `- Input tokens: ${inputTokens}, about $${(inputTokens * PRICE_PER_INPUT_TOKEN).toFixed(5)} for the whole run`,
    '',
    '## Mistakes at threshold 0.8',
    '',
    ...(misses.length ? misses : ['None.']),
    '',
  ].join('\n');

  console.log(report);
  if (!useFake) writeFileSync(join(root, 'bench', 'results.md'), report);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
