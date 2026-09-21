# rulekeeper

Claude Code plugin that makes Claude actually follow your CLAUDE.md: every reply and every file edit is checked against each of your rules in one parallel TypeSafe Jev request, and anything that breaks a rule goes straight back to Claude to fix.

## Why

You wrote "no em dashes", "don't add explanatory comments", "never say load-bearing". Claude read it, agreed, and did it anyway three turns later. CLAUDE.md is a suggestion the model weighs against everything else in context, and the longer the session, the weaker it gets.

rulekeeper turns those lines into checks. Jev (TypeSafe's System One model) answers typed yes/no questions instead of generating text, so asking "does this reply break rule N?" for every rule at once costs a fraction of a cent and comes back in about 100ms.

## Install

```sh
claude plugin marketplace add erkamyaman/rulekeeper
claude plugin install rulekeeper@rulekeeper
```

Then give the hooks your key (from [console.typesafe.ai](https://console.typesafe.ai)), for example in `~/.claude/settings.json`:

```json
{ "env": { "TYPESAFE_API_KEY": "..." } }
```

Without a key the hooks do nothing, so installing it can never break a session.

## How it works

1. **Find rules.** The same files Claude Code loads: `~/.claude/CLAUDE.md`, `~/.claude/rules/**/*.md`, and `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**/*.md` in every directory from the project root down to the working directory. Each bullet is one rule; prose paragraphs are split into sentences. Code blocks and headings are skipped.
2. **Sort rules.** One Jev `choice` question per rule decides what it constrains: `reply` (how Claude writes to you), `code` (what it writes into files), `both`, or `none` (workflow, git, permissions, background facts that can't be judged from one message). Results are cached by rule text, so this runs once per rule change.
3. **Check replies.** A `Stop` hook sends Claude's final message and one `noul` question per `reply`/`both` rule. Any rule scored at or above the threshold blocks the stop, and Claude gets the broken rules quoted back with an instruction to rewrite.
4. **Check edits.** A `PostToolUse` hook on `Edit`, `Write` and `MultiEdit` does the same for the new text against `code`/`both` rules, so Claude fixes the file in its next step.
5. **Never loop.** A reply that was already sent back once is let through (`stop_hook_active`). Edits to CLAUDE.md and rule files themselves are skipped. Any error fails open.

## Try it without Claude Code

From a clone (`npm link` puts `rulekeeper` on your PATH):

```sh
rulekeeper rules                         # which rules were found and how each is classified
echo "Happy to help — here's the fix." | rulekeeper check --as reply
rulekeeper check --as code src/app.ts    # exits 1 if a rule is broken
```

## Settings

| Env | Default | |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | none | Required. No key, no checks |
| `RULEKEEPER_THRESHOLD` | `0.8` | Minimum Jev probability that a rule is broken before Claude is told |
| `RULEKEEPER_OFF` | unset | Set to `1` to disable for a session |

## Limitations

- Jev judges meaning, not bytes. Rules about exact counts, dates or arithmetic ("keep replies under 200 words") are unreliable; put those in a linter.
- Only the final reply of a turn and the new text of each edit are checked, not intermediate messages or whole files.
- A rule Jev classifies as `none` is never enforced. Run `rulekeeper rules` to see how yours were sorted, and reword a rule if it landed in the wrong bucket.
- Your reply text, edit text and rules are sent to TypeSafe's API.
- Jev access is early access; keys come from the waitlist at [console.typesafe.ai](https://console.typesafe.ai).

## Development

```sh
npm test
```

No runtime dependencies. Tests use a fake Jev, so they run offline.

## License

MIT
