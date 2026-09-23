# jev-enforce

Claude Code plugin that makes Claude actually follow your CLAUDE.md: every reply and every file edit is checked against each of your rules in one parallel TypeSafe Jev request, and anything that breaks a rule goes straight back to Claude to fix.

## Why

### The problem

You put rules in CLAUDE.md: "no em dashes", "don't add explanatory comments", "never say load-bearing". They hold for the first few turns. Then an em dash comes back, then a `// increment the counter` comment, then "the retry wrapper is load-bearing". By turn thirty you are restating the rule in chat, which works for exactly one turn.

It is not your prompt. The most-reacted open issues on the Claude Code tracker are this same failure:

| Issue | Reactions |
| --- | --- |
| [Repetitive rhetorical tics despite explicit style instructions](https://github.com/anthropics/claude-code/issues/77136) | 575 |
| [Verbose code comments by default, ignores instructions to stop](https://github.com/anthropics/claude-code/issues/65961) | 239 |
| [Claude Code cannot stop using the word "load-bearing"](https://github.com/anthropics/claude-code/issues/53454) | 181 |
| [CLAUDE.md mandatory rules consistently ignored](https://github.com/anthropics/claude-code/issues/2544) | 45 |

Three mechanics, none of which you can prompt your way out of:

1. **CLAUDE.md is context, not a constraint.** It is prepended to the conversation as ordinary tokens. It carries no more weight than a stack trace you pasted or a file the agent just read, and the sampler is free to ignore all of it.
2. **Its share of the context decays.** Your 40-line rules file is a meaningful fraction of a fresh session. Thirty turns in, competing with file reads, diffs and test output, it is a fraction of a percent of the window, and compaction can summarize it away entirely.
3. **There is no validation step.** Generate, then emit. Nothing between the model's output and your terminal compares the two against the spec you wrote. An unenforced rule is a comment.

The fix is not a better-worded rule. It is a check that runs on every turn, which is what hooks are for.

### What jev-enforce does

It adds the missing validation step, as two hooks:

```text
Stop hook            final assistant message ─┐
PostToolUse hook     Edit/Write/MultiEdit    ─┴→ one Jev request, one yes/no question per rule
                                                    │
                                    all below threshold → turn ends normally
                                    any above          → decision: "block", rules quoted in reason,
                                                         Claude rewrites in the same turn
```

Your rules stop being context the model may weigh and become a gate on every turn.

### Why Jev makes this practical

The obvious implementation is a second LLM call per turn: "here are 20 rules and a reply, list the violations". You pay a couple of seconds and full output-token pricing on every turn, then parse prose into a decision, and the judge itself can hallucinate a violation that isn't there.

Jev is a System One model from TypeSafe. It emits no tokens: you send state plus typed questions and get back typed answers, in this case a calibrated 0 to 1 probability per question, all evaluated in the same request. jev-enforce sends one `noul` question per rule ("does this text break rule N?") and gets back a vector of probabilities:

- **Flat latency in rule count.** Questions are answered in parallel, so 5 rules and 50 rules cost about the same wall clock: 368ms p50, 417ms p95 on the benchmark below. Requests are batched to stay under Jev's 32k state budget.
- **Output tokens are free.** Input is $0.042 per 1M, so the whole 270-check benchmark run cost $0.0015, about 3 cents per 1,000 checks.
- **The output is a number, not prose.** One threshold (`JEV_ENFORCE_THRESHOLD`, 0.7) turns the probability into allow or block, so you can trade precision against recall with the table below instead of rewriting a judge prompt.

One check on the wire, trimmed:

```jsonc
// POST https://api.typesafe.ai/v1/systemone
{
  "model": "jev-latest",
  "state": { "kind": "A chat reply an AI coding assistant wrote to the developer", "text": "Happy to help — I fixed the login bug." },
  "questions": {
    "v0": { "type": "noul", "instructions": "Rule: \"Never use em dashes.\"\nDoes the text break this rule?",
            "criteria": { "true": "The text clearly breaks the rule.", "false": "The text follows the rule, or the rule does not apply to this text." } },
    "v1": { "type": "noul", "instructions": "Rule: \"Don't open a reply with \\\"Happy to\\\".\"\nDoes the text break this rule?" }
  }
}
// → { "answers": { "v0": { "type": "noul", "noul": 0.92 }, "v1": { "type": "noul", "noul": 0.80 } } }
```

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
