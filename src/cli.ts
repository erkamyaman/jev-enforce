#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findViolations } from './check.js';
import { runHook } from './hook.js';
import { createAsk } from './jev.js';
import { extractCandidates, findRuleFiles, loadRules } from './rules.js';

const USAGE = `jev-enforce: make Claude Code follow your CLAUDE.md, checked by TypeSafe Jev

  jev-enforce rules                    list rules found for this directory and what each one constrains
  jev-enforce check [--as reply|code] [file]
                                       check a file (or stdin) against your rules; exits 1 on violations
  jev-enforce hook <stop|post-edit>    Claude Code hook entry point (reads hook JSON on stdin)

  env: TYPESAFE_API_KEY (required), JEV_ENFORCE_THRESHOLD (default 0.7), JEV_ENFORCE_OFF=1,
       JEV_ENFORCE_MODE=end (check all edits once when the turn ends)`;

const readStdin = () => readFileSync(0, 'utf8');
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function requireKey(): string {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error('jev-enforce: set TYPESAFE_API_KEY (get one at https://console.typesafe.ai)');
    process.exit(2);
  }
  return apiKey;
}

const cacheDir = () => process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.cache', 'jev-enforce');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'hook') {
    const event = args[0];
    if (event !== 'stop' && event !== 'post-edit') throw new Error(`unknown hook event: ${event}`);
    try {
      const out = await runHook(event, JSON.parse(readStdin()));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (err) {
      console.error(`jev-enforce: ${message(err)}`);
    }
    return;
  }

  if (cmd === 'rules') {
    const cwd = process.cwd();
    if (!process.env.TYPESAFE_API_KEY) {
      for (const f of findRuleFiles(cwd, homedir())) {
        console.log(`\n${f}`);
        for (const r of extractCandidates(readFileSync(f, 'utf8'))) console.log(`  ?      ${r}`);
      }
      console.log('\n(set TYPESAFE_API_KEY to see which rules jev-enforce enforces)');
      return;
    }
    const rules = await loadRules(cwd, homedir(), createAsk({ apiKey: requireKey() }), cacheDir());
    let source = '';
    for (const r of rules) {
      if (r.source !== source) console.log(`\n${(source = r.source)}`);
      console.log(`  ${r.scope.padEnd(6)} ${r.text}`);
    }
    return;
  }

  if (cmd === 'check') {
    const asIdx = args.indexOf('--as');
    const kind = asIdx >= 0 ? args.splice(asIdx, 2)[1] : 'reply';
    if (kind !== 'reply' && kind !== 'code') throw new Error('--as must be reply or code');
    const file = args[0];
    const text = !file || file === '-' ? readStdin() : readFileSync(file, 'utf8');
    const ask = createAsk({ apiKey: requireKey() });
    const rules = await loadRules(process.cwd(), homedir(), ask, cacheDir());
    const threshold = Number(process.env.JEV_ENFORCE_THRESHOLD) || 0.7;
    const started = Date.now();
    const violations = await findViolations({ text, kind, filePath: file, rules, ask, threshold });
    const checked = rules.filter((r) => r.scope === kind || r.scope === 'both').length;
    for (const v of violations) console.log(`✗ ${v.p.toFixed(2)}  ${v.rule}`);
    console.log(`${violations.length} of ${checked} rules broken (${Date.now() - started}ms)`);
    process.exitCode = violations.length ? 1 : 0;
    return;
  }

  console.log(USAGE);
  if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exitCode = 2;
}

main().catch((err) => {
  console.error(`jev-enforce: ${message(err)}`);
  process.exit(2);
});
