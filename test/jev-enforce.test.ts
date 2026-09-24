import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runHook } from '../src/hook.js';
import { askAll, createAsk } from '../src/jev.js';
import { extractCandidates, findRuleFiles } from '../src/rules.js';
import { fakeJev, type FakeLog } from './fake-jev.js';

const CLAUDE_MD = `# Working agreement

Follow the \`karpathy-guidelines\` skill.

- **Git verbs**: never \`git commit\` unless I say so.
  Each verb is its own authorization.
- Micro-step permission: don't ask, just do it.

Writing: no em dashes (use periods, commas, or parens). Don't open offers with "Happy to". No explanatory comments added to files you change.

\`\`\`sh
npm test
\`\`\`
`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'rk-home-'));
  const project = join(home, 'code', 'app');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), CLAUDE_MD);
  const env = { TYPESAFE_API_KEY: 'test-key', CLAUDE_PLUGIN_DATA: join(home, 'data') };
  return { home, project, env };
}

test('extractCandidates keeps bullets whole, splits prose, skips headings and code', () => {
  assert.deepEqual(extractCandidates(CLAUDE_MD), [
    'Follow the `karpathy-guidelines` skill.',
    'Git verbs: never `git commit` unless I say so. Each verb is its own authorization.',
    "Micro-step permission: don't ask, just do it.",
    'Writing: no em dashes (use periods, commas, or parens).',
    'Don\'t open offers with "Happy to".',
    'No explanatory comments added to files you change.',
  ]);
});

test('findRuleFiles collects user and ancestor CLAUDE.md files in load order', () => {
  const { home, project } = setup();
  writeFileSync(join(home, 'code', 'CLAUDE.md'), '- rule one here');
  mkdirSync(join(project, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(project, '.claude', 'rules', 'style.md'), '- rule two here');
  writeFileSync(join(project, 'CLAUDE.local.md'), '- rule three here');
  assert.deepEqual(findRuleFiles(project, home), [
    join(home, '.claude', 'CLAUDE.md'),
    join(home, 'code', 'CLAUDE.md'),
    join(project, 'CLAUDE.local.md'),
    join(project, '.claude', 'rules', 'style.md'),
  ]);
});

test('createAsk sends the documented request shape', async () => {
  const log: FakeLog = { calls: [] };
  const ask = createAsk({ apiKey: 'k', fetch: fakeJev(log) });
  await ask({ rules: { r0: 'no em dashes' } }, { r0: { type: 'choice', instructions: 'x', criteria: { a: 'b' } } });
  const call = log.calls[0];
  assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(call.headers.Authorization, 'Bearer k');
  assert.equal(call.req.model, 'jev-latest');
});

test('askAll batches questions and merges answers', async () => {
  const log: FakeLog = { calls: [] };
  const ask = createAsk({ apiKey: 'k', fetch: fakeJev(log) });
  const questions = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [`v${i}`, { type: 'noul' as const, instructions: 'x' }]),
  );
  const answers = await askAll(ask, { text: 'hi' }, questions, 3);
  assert.equal(Object.keys(answers).length, 7);
  assert.equal(log.calls.length, 3);
});

test('stop hook blocks a reply that breaks a reply rule', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'stop',
    { cwd: project, last_assistant_message: 'Happy to help — here is the fix for your login bug.' },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out?.decision, 'block');
  assert.match(out?.reason ?? '', /em dashes/);
  assert.match(out?.reason ?? '', /Happy to/);
  assert.doesNotMatch(out?.reason ?? '', /git commit/);
  assert.match(out?.systemMessage ?? '', /2 CLAUDE\.md rules broken/);
});

test('stop hook lets a clean reply through', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'stop',
    { cwd: project, last_assistant_message: 'Fixed the login bug. The token check now runs first.' },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out, null);
});

test('stop hook never blocks twice in a row', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'stop',
    { cwd: project, stop_hook_active: true, last_assistant_message: 'Happy to help — again, with feeling.' },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out, null);
});

test('post-edit hook checks only code rules against the new text', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'post-edit',
    {
      cwd: project,
      tool_name: 'Edit',
      tool_input: { file_path: join(project, 'a.ts'), new_string: '// increment the counter by one\ncount++;' },
    },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out?.decision, 'block');
  assert.match(out?.reason ?? '', /explanatory comments/);
  assert.doesNotMatch(out?.reason ?? '', /em dashes/);
});

test('post-edit hook ignores edits to CLAUDE.md itself', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'post-edit',
    { cwd: project, tool_name: 'Write', tool_input: { file_path: join(project, 'CLAUDE.md'), content: '// a comment line here' } },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out, null);
});

test('rule scopes are cached so the second run skips classification', async () => {
  const { home, project, env } = setup();
  const log: FakeLog = { calls: [] };
  const input = { cwd: project, last_assistant_message: 'Fixed the login bug. The token check now runs first.' };
  await runHook('stop', input, { env, home, fetch: fakeJev() });
  await runHook('stop', input, { env, home, fetch: fakeJev(log) });
  const calls = log.calls;
  assert.equal(calls.length, 1);
  assert.equal((Object.values(calls[0].req.questions)[0] as { type: string }).type, 'noul');
  assert.ok(Object.keys(JSON.parse(readFileSync(join(env.CLAUDE_PLUGIN_DATA, 'scopes.json'), 'utf8'))).length > 0);
});

test('without an API key the hooks do nothing', async () => {
  const { home, project } = setup();
  const out = await runHook('stop', { cwd: project, last_assistant_message: 'Happy to help — sure thing, friend.' }, { env: {}, home });
  assert.equal(out, null);
});

test('AGENTS.md is read when the project has no CLAUDE.md', () => {
  const { home, project } = setup();
  writeFileSync(join(project, 'AGENTS.md'), '- rule from agents file');
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(join(project, '.claude', 'AGENTS.md'), '- another agents rule');
  assert.deepEqual(findRuleFiles(project, home), [
    join(home, '.claude', 'CLAUDE.md'),
    join(project, 'AGENTS.md'),
    join(project, '.claude', 'AGENTS.md'),
  ]);
});

test('a project CLAUDE.md wins over AGENTS.md, as in Claude Code', () => {
  const { home, project } = setup();
  writeFileSync(join(project, 'AGENTS.md'), '- rule from agents file');
  writeFileSync(join(home, 'code', 'CLAUDE.md'), '- rule from an ancestor claude file');
  assert.deepEqual(findRuleFiles(project, home), [
    join(home, '.claude', 'CLAUDE.md'),
    join(home, 'code', 'CLAUDE.md'),
  ]);
});

test('.claude/rules files load alongside AGENTS.md', () => {
  const { home, project } = setup();
  writeFileSync(join(project, 'AGENTS.md'), '- rule from agents file');
  mkdirSync(join(project, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(project, '.claude', 'rules', 'style.md'), '- a scoped rule here');
  assert.deepEqual(findRuleFiles(project, home), [
    join(home, '.claude', 'CLAUDE.md'),
    join(project, 'AGENTS.md'),
    join(project, '.claude', 'rules', 'style.md'),
  ]);
});

test('post-edit hook ignores edits to AGENTS.md itself', async () => {
  const { home, project, env } = setup();
  const out = await runHook(
    'post-edit',
    { cwd: project, tool_name: 'Write', tool_input: { file_path: join(project, 'AGENTS.md'), content: '// a comment line here' } },
    { env, home, fetch: fakeJev() },
  );
  assert.equal(out, null);
});

test('end mode queues edits without calling Jev, then checks them all at stop', async () => {
  const { home, project, env } = setup();
  const endEnv = { ...env, JEV_ENFORCE_MODE: 'end' };
  const log: FakeLog = { calls: [] };
  const fetch = fakeJev(log);
  const edit = (file: string, new_string: string) =>
    runHook(
      'post-edit',
      { cwd: project, session_id: 's1', tool_name: 'Edit', tool_input: { file_path: join(project, file), new_string } },
      { env: endEnv, home, fetch },
    );
  assert.equal(await edit('a.ts', '// increment the counter by one\ncount++;'), null);
  assert.equal(await edit('b.ts', 'export const total = items.length;'), null);
  assert.equal(log.calls.length, 0);

  const out = await runHook(
    'stop',
    { cwd: project, session_id: 's1', last_assistant_message: 'Fixed the login bug. The token check now runs first.' },
    { env: endEnv, home, fetch },
  );
  assert.equal(out?.decision, 'block');
  assert.match(out?.reason ?? '', /a\.ts/);
  assert.doesNotMatch(out?.reason ?? '', /b\.ts/);
  assert.match(out?.reason ?? '', /explanatory comments/);
  assert.match(out?.systemMessage ?? '', /1 CLAUDE\.md rule broken/);
});

test('end mode clears the queue after a check', async () => {
  const { home, project, env } = setup();
  const endEnv = { ...env, JEV_ENFORCE_MODE: 'end' };
  await runHook(
    'post-edit',
    { cwd: project, session_id: 's2', tool_name: 'Write', tool_input: { file_path: join(project, 'a.ts'), content: '// increment the counter by one\ncount++;' } },
    { env: endEnv, home, fetch: fakeJev() },
  );
  const stop = { cwd: project, session_id: 's2', last_assistant_message: 'Done.' };
  assert.equal((await runHook('stop', stop, { env: endEnv, home, fetch: fakeJev() }))?.decision, 'block');
  assert.equal(await runHook('stop', stop, { env: endEnv, home, fetch: fakeJev() }), null);
});
