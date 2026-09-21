// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { askAll } from './jev.js';

/** @typedef {'reply' | 'code' | 'both' | 'none'} Scope */
/** @typedef {{ text: string, scope: Scope, source: string }} Rule */

export const SCOPES = {
  reply: 'Constrains how the assistant writes its chat replies to the user: tone, wording, phrasing, punctuation, formatting, length.',
  code: 'Constrains the content of code or files the assistant writes: style, comments, naming, patterns, forbidden APIs or libraries.',
  both: 'Constrains both chat replies and the code or files the assistant writes.',
  none: 'Cannot be checked from one reply or one file edit: workflow, process, when to ask, tool usage, permissions, git actions, facts about the project, or background context.',
};

/** @param {string} dir */
function mdFilesIn(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFilesIn(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * CLAUDE.md files Claude Code would load for `cwd`: user-level, then every ancestor directory down to `cwd`.
 * @param {string} cwd
 * @param {string} home
 */
export function findRuleFiles(cwd, home) {
  const files = [join(home, '.claude', 'CLAUDE.md'), ...mdFilesIn(join(home, '.claude', 'rules'))];
  /** @type {string[]} */
  const dirs = [];
  for (let d = cwd; ; d = dirname(d)) {
    if (d === home) break;
    dirs.unshift(d);
    if (d === parse(d).root) break;
  }
  for (const d of dirs) {
    files.push(join(d, 'CLAUDE.md'), join(d, '.claude', 'CLAUDE.md'), join(d, 'CLAUDE.local.md'));
    files.push(...mdFilesIn(join(d, '.claude', 'rules')));
  }
  return [...new Set(files)].filter((f) => existsSync(f) && statSync(f).isFile());
}

/** @param {string} text */
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`"*(])/);
}

/**
 * Pulls candidate rules out of markdown: each bullet is one candidate, prose paragraphs are split into sentences.
 * @param {string} md
 */
export function extractCandidates(md) {
  /** @type {string[]} */
  const out = [];
  let inFence = false;
  /** @type {string[]} */
  let buf = [];
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

/** @param {string} text */
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Asks Jev which rules constrain replies, code, both, or neither. Results are cached by rule text.
 * @param {{ text: string, source: string }[]} candidates
 * @param {import('./jev.js').Ask} ask
 * @param {string} cacheDir
 * @returns {Promise<Rule[]>}
 */
export async function classify(candidates, ask, cacheDir) {
  const cacheFile = join(cacheDir, 'scopes.json');
  /** @type {Record<string, Scope>} */
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {}

  const missing = [...new Set(candidates.map((c) => c.text))].filter((t) => !(hash(t) in cache));
  if (missing.length) {
    const state = {
      context: 'Instructions a developer wrote in CLAUDE.md for an AI coding assistant.',
      rules: Object.fromEntries(missing.map((t, i) => [`r${i}`, t])),
    };
    const questions = Object.fromEntries(
      missing.map((_, i) => [
        `r${i}`,
        { type: /** @type {const} */ ('choice'), instructions: `What does rule r${i} constrain?`, criteria: SCOPES },
      ]),
    );
    const answers = await askAll(ask, state, questions);
    missing.forEach((t, i) => {
      const a = answers[`r${i}`];
      if (a && a.type === 'choice' && a.choice in SCOPES) cache[hash(t)] = /** @type {Scope} */ (a.choice);
    });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }
  return candidates.map((c) => ({ ...c, scope: cache[hash(c.text)] ?? 'none' }));
}

/**
 * @param {string} cwd
 * @param {string} home
 * @param {import('./jev.js').Ask} ask
 * @param {string} cacheDir
 */
export async function loadRules(cwd, home, ask, cacheDir) {
  const candidates = findRuleFiles(cwd, home).flatMap((source) =>
    extractCandidates(readFileSync(source, 'utf8')).map((text) => ({ text, source })),
  );
  return classify(candidates, ask, cacheDir);
}
