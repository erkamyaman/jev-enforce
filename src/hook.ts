import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { findViolations, formatReason } from './check.js';
import { createAsk } from './jev.js';
import { loadRules } from './rules.js';

export interface HookInput {
  cwd?: string;
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

/** Runs one hook event. Returns the JSON to print, or null to let Claude continue untouched. */
export async function runHook(event: HookEvent, input: HookInput, deps: Deps = {}): Promise<HookOutput | null> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey || env.JEV_ENFORCE_OFF === '1') return null;

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
  if (!text || text.trim().length < 20) return null;

  const kind = event === 'stop' ? 'reply' : 'code';
  const threshold = Number(env.JEV_ENFORCE_THRESHOLD) || 0.7;
  const ask = createAsk({ apiKey, fetch: deps.fetch });
  const cacheDir = env.CLAUDE_PLUGIN_DATA || join(home, '.cache', 'jev-enforce');
  const rules = await loadRules(input.cwd ?? process.cwd(), home, ask, cacheDir);
  const violations = await findViolations({ text, kind, filePath, rules, ask, threshold });
  if (!violations.length) return null;

  const n = violations.length;
  return {
    decision: 'block',
    reason: formatReason(violations, kind),
    systemMessage: `jev-enforce: ${n} CLAUDE.md rule${n === 1 ? '' : 's'} broken, sent back to Claude`,
  };
}
