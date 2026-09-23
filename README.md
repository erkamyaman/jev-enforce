# jev-enforce

Claude Code plugin that makes Claude actually follow your CLAUDE.md: every reply and every file edit is checked against each of your rules in one parallel TypeSafe Jev request, and anything that breaks a rule goes straight back to Claude to fix.

## Why

### The problem

You put rules in CLAUDE.md: "no em dashes", "don't add explanatory comments", "never say load-bearing". Claude follows them for a while, then breaks them a few turns later.

That happens because CLAUDE.md is only context. Claude reads it once at the start of the session. After that it competes with everything else Claude has seen, like your code, the tool output, and the chat so far. As the session grows, your rules become a smaller part of what Claude pays attention to. Nothing checks the output against them.

### What jev-enforce does

It checks each reply and each file edit against your rules, then sends anything that breaks one back to Claude:

```text
Claude writes a reply  →  jev-enforce checks it against every rule  →  a rule is broken?
                                                                       ├─ no:  the reply goes through
                                                                       └─ yes: Claude gets the rule quoted back and rewrites
```

Your rules stop being reminders and become checks that run every time.

### Why Jev makes this practical

You could ask a normal LLM "does this reply break any of my rules?", but it would add seconds and real cost to every single turn, and its answer would be text you still have to parse.

Jev is a different kind of model from TypeSafe. It doesn't write text. It answers typed questions, such as yes/no with a probability, and it answers many of them in parallel in one request. So jev-enforce asks one yes/no question per rule ("does this text break rule 3?"), all at once:

- **Fast:** about 370ms for the whole check, whether you have 5 rules or 50.
- **Cheap:** about 3 cents per 1,000 checks, because Jev charges only for input.
- **Tunable:** every answer comes with a probability. You choose how sure it must be before Claude is told (0.7 by default).

## Benchmark

46 labeled examples (26 replies, 20 file edits) against 12 rules, which is 270 individual checks. Run it yourself with `npm run bench`, and see [bench/results.md](bench/results.md) for the full output including every mistake.

| Threshold | Precision | Recall | Clean texts wrongly flagged |
| --- | --- | --- | --- |
| 0.5 | 71.4% | 100.0% | 7 of 22 |
| 0.6 | 85.7% | 100.0% | 4 of 22 |
| **0.7 (default)** | **93.5%** | **96.7%** | **2 of 22** |
| 0.8 | 93.3% | 93.3% | 2 of 22 |
| 0.9 | 96.4% | 90.0% | 1 of 22 |

Sorting rules into reply, code, both or none was right 10 times out of 12. Speed was 368ms at p50 and 417ms at p95. The whole run cost $0.0015.

The four mistakes at 0.8 show where it's weak, and both weaknesses are the same kind of thing:

- **Characters it can't see.** An en dash (`2019–2024`) was flagged as an em dash at 0.97. Jev judges meaning, not bytes.
- **Code flow it can't trace.** "Use `const` when a variable is never reassigned" caused three of the four errors, because answering it means tracking whether a variable is written to later. That belongs in a linter (`prefer-const`), not here.

## Install

```sh
claude plugin marketplace add erkamyaman/jev-enforce
claude plugin install jev-enforce@jev-enforce
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

From a clone (`npm install && npm run build && npm link` puts `jev-enforce` on your PATH):

```sh
jev-enforce rules                        # which rules were found and how each is classified
echo "Happy to help — here's the fix." | jev-enforce check --as reply
jev-enforce check --as code src/app.ts   # exits 1 if a rule is broken
```

## Settings

| Env | Default | |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | none | Required. No key, no checks |
| `JEV_ENFORCE_THRESHOLD` | `0.7` | Minimum Jev probability that a rule is broken before Claude is told |
| `JEV_ENFORCE_OFF` | unset | Set to `1` to disable for a session |

## Limitations

- Jev judges meaning, not bytes. Rules about exact characters, counts, dates or arithmetic ("keep replies under 200 words", "no em dashes" where an en dash is fine) are unreliable, and rules that need code flow analysis (`prefer-const`) belong in a linter. See the benchmark above.
- Only the final reply of a turn and the new text of each edit are checked, not intermediate messages or whole files.
- A rule Jev classifies as `none` is never enforced. Run `jev-enforce rules` to see how yours were sorted, and reword a rule if it landed in the wrong bucket.
- Your reply text, edit text and rules are sent to TypeSafe's API.
- Jev access is early access; keys come from the waitlist at [console.typesafe.ai](https://console.typesafe.ai).

## Development

```sh
npm install
npm test          # compiles src/ and test/, then runs the tests against the compiled output
npm run bench     # scores bench/cases.json against the real Jev API, writes bench/results.md
```

Written in TypeScript. The compiled `dist/src/` is committed because Claude Code runs plugin hooks straight from the repo with no build step, so run `npm run build` and commit `dist/src/` with every source change (`npm run check-dist` fails if they are out of sync). No runtime dependencies. Tests use a fake Jev, so they run offline.

## License

MIT
