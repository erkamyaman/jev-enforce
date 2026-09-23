import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { askAll, type Ask, type Question } from './jev.js';

export type Scope = 'reply' | 'code' | 'both' | 'none';
export interface Rule {
  text: string;
  scope: Scope;
  source: string;
}

export const SCOPES: Record<Scope, string> = {
  reply: 'Constrains how the assistant writes its chat replies to the user: tone, wording, phrasing, punctuation, formatting, length.',
  code: 'Constrains the content of code or files the assistant writes: style, comments, naming, patterns, forbidden APIs or libraries.',
  both: 'Constrains both chat replies and the code or files the assistant writes.',
  none: 'Cannot be checked from one reply or one file edit: workflow, process, when to ask, tool usage, permissions, git actions, facts about the project, or background context.',
};

const isScope = (s: string): s is Scope => s in SCOPES;

function mdFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFilesIn(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const isFile = (f: string) => existsSync(f) && statSync(f).isFile();

/**
 * The instruction files Claude Code would load for `cwd`: user-level files, then every ancestor
 * directory down to `cwd`. AGENTS.md follows Claude Code's default `claude-md-or-agents-md` rule,
 * so it is read only when no project-level CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists.
 */
export function findRuleFiles(cwd: string, home: string): string[] {
  const userFiles = [join(home, '.claude', 'CLAUDE.md'), ...mdFilesIn(join(home, '.claude', 'rules'))];
  const dirs: string[] = [];
  for (let d = cwd; ; d = dirname(d)) {
    if (d === home) break;
    dirs.unshift(d);
    if (d === parse(d).root) break;
  }

  const claudeFiles: string[] = [];
  const ruleDirFiles: string[] = [];
  for (const d of dirs) {
    claudeFiles.push(join(d, 'CLAUDE.md'), join(d, '.claude', 'CLAUDE.md'), join(d, 'CLAUDE.local.md'));
    ruleDirFiles.push(...mdFilesIn(join(d, '.claude', 'rules')));
  }

  const projectFiles = claudeFiles.filter(isFile);
  if (!projectFiles.length) {
    for (const d of dirs) projectFiles.push(join(d, 'AGENTS.md'), join(d, '.claude', 'AGENTS.md'));
  }

  return [...new Set([...userFiles, ...projectFiles, ...ruleDirFiles])].filter(isFile);
}

const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z`"*(])/);

/** Pulls candidate rules out of markdown: each bullet is one candidate, prose paragraphs are split into sentences. */
export function extractCandidates(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  let buf: string[] = [];
  let isBullet = false;
  const flush = () => {
    if (buf.length) {
      const text = buf.join(' ');
      out.push(...(isBullet ? [text] : splitSentences(text)));
    }
    buf = [];
    isBullet = false;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line || /^(#|<|@|\||---|===)/.test(line)) {
      flush();
      continue;
    }
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flush();
      isBullet = true;
      buf.push(bullet[1]);
      continue;
    }
    buf.push(line);
  }
  flush();
  const cleaned = out.map((r) => r.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
  return [...new Set(cleaned)].filter((r) => r.length >= 8 && r.length <= 600);
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Asks Jev which rules constrain replies, code, both, or neither. Results are cached by rule text. */
export async function classify(
  candidates: { text: string; source: string }[],
  ask: Ask,
  cacheDir: string,
): Promise<Rule[]> {
  const cacheFile = join(cacheDir, 'scopes.json');
  let cache: Record<string, Scope> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {}

  const missing = [...new Set(candidates.map((c) => c.text))].filter((t) => !(hash(t) in cache));
  if (missing.length) {
    const state = {
      context: 'Instructions a developer wrote in CLAUDE.md for an AI coding assistant.',
      rules: Object.fromEntries(missing.map((t, i) => [`r${i}`, t])),
    };
    const questions: Record<string, Question> = Object.fromEntries(
      missing.map((_, i) => [`r${i}`, { type: 'choice', instructions: `What does rule r${i} constrain?`, criteria: SCOPES }]),
    );
    const answers = await askAll(ask, state, questions);
    missing.forEach((t, i) => {
      const a = answers[`r${i}`];
      if (a?.type === 'choice' && isScope(a.choice)) cache[hash(t)] = a.choice;
    });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }
  return candidates.map((c) => ({ ...c, scope: cache[hash(c.text)] ?? 'none' }));
}

export async function loadRules(cwd: string, home: string, ask: Ask, cacheDir: string): Promise<Rule[]> {
  const candidates = findRuleFiles(cwd, home).flatMap((source) =>
    extractCandidates(readFileSync(source, 'utf8')).map((text) => ({ text, source })),
  );
  return classify(candidates, ask, cacheDir);
}
