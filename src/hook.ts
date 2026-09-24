import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { findViolations, formatReason, type Violation } from './check.js';
import { createAsk } from './jev.js';
import { loadRules } from './rules.js';

export interface HookInput {
  cwd?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    new_string?: string;
    content?: string;
    edits?: { new_string?: string }[];
  };
}

export interface HookOutput {
  decision: 'block';
  reason: string;
  systemMessage: string;
}

export interface Deps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  home?: string;
}

export type HookEvent = 'stop' | 'post-edit';

function editedText(input: HookInput): string | undefined {
  const t = input.tool_input ?? {};
  switch (input.tool_name) {
    case 'Edit':
      return t.new_string;
    case 'Write':
      return t.content;
    case 'MultiEdit':
      return Array.isArray(t.edits) ? t.edits.map((e) => e.new_string ?? '').join('\n') : undefined;
    default:
      return undefined;
  }
}

const isRuleFile = (filePath: string) =>
  /^(CLAUDE|AGENTS).*\.md$/i.test(basename(filePath)) || /[\\/]\.claude[\\/]rules[\\/]/.test(filePath);

/** Edits waiting for the end-of-turn check in `JEV_ENFORCE_MODE=end`, keyed by file path. */
type Pending = Record<string, string[]>;

function pendingFile(dataDir: string, sessionId = 'default'): string {
  return join(dataDir, 'pending', `${sessionId.replace(/[^\w-]/g, '_')}.json`);
}

function readPending(file: string): Pending {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function brokenResult(n: number, reason: string): HookOutput {
  return {
    decision: 'block',
    reason,
    systemMessage: `jev-enforce: ${n} CLAUDE.md rule${n === 1 ? '' : 's'} broken, sent back to Claude`,
  };
}

/** Runs one hook event. Returns the JSON to print, or null to let Claude continue untouched. */
export async function runHook(event: HookEvent, input: HookInput, deps: Deps = {}): Promise<HookOutput | null> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey || env.JEV_ENFORCE_OFF === '1') return null;

  const atEnd = env.JEV_ENFORCE_MODE === 'end';
  const dataDir = env.CLAUDE_PLUGIN_DATA || join(home, '.cache', 'jev-enforce');
  const queue = pendingFile(dataDir, input.session_id);

  let text: string | undefined;
  let filePath: string | undefined;
  if (event === 'stop') {
    if (input.stop_hook_active) return null;
    text = input.last_assistant_message;
  } else {
    filePath = input.tool_input?.file_path;
    if (filePath && isRuleFile(filePath)) return null;
    text = editedText(input);
  }
  const hasText = !!text && text.trim().length >= 20;

  if (atEnd && event === 'post-edit') {
    if (!hasText) return null;
    const pending = readPending(queue);
    (pending[filePath ?? ''] ??= []).push(text!);
    mkdirSync(join(dataDir, 'pending'), { recursive: true });
    writeFileSync(queue, JSON.stringify(pending));
    return null;
  }

  const edits = atEnd ? readPending(queue) : {};
  if (atEnd) rmSync(queue, { force: true });
  if (!hasText && !Object.keys(edits).length) return null;

  const threshold = Number(env.JEV_ENFORCE_THRESHOLD) || 0.7;
  const ask = createAsk({ apiKey, fetch: deps.fetch });
  const rules = await loadRules(input.cwd ?? process.cwd(), home, ask, dataDir);

  if (!atEnd) {
    const kind = event === 'stop' ? 'reply' : 'code';
    const violations = await findViolations({ text: text!, kind, filePath, rules, ask, threshold });
    return violations.length ? brokenResult(violations.length, formatReason(violations, kind)) : null;
  }

  const checks: Promise<{ label: string; kind: 'reply' | 'code'; violations: Violation[] }>[] = [];
  if (hasText) {
    checks.push(
      findViolations({ text: text!, kind: 'reply', rules, ask, threshold }).then((violations) => ({
        label: 'reply',
        kind: 'reply' as const,
        violations,
      })),
    );
  }
  for (const [file, parts] of Object.entries(edits)) {
    checks.push(
      findViolations({ text: parts.join('\n'), kind: 'code', filePath: file, rules, ask, threshold }).then(
        (violations) => ({ label: file, kind: 'code' as const, violations }),
      ),
    );
  }
  const broken = (await Promise.all(checks)).filter((c) => c.violations.length);
  if (!broken.length) return null;

  const n = broken.reduce((sum, c) => sum + c.violations.length, 0);
  const reason = broken
    .map((c) => (c.kind === 'code' ? `In ${c.label}: ${formatReason(c.violations, c.kind)}` : formatReason(c.violations, c.kind)))
    .join('\n\n');
  return brokenResult(n, reason);
}
