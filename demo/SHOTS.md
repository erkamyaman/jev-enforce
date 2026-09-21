# Recording the demo

Everything here runs inside this `demo/` folder, so only the rules in `demo/CLAUDE.md` apply
(plus your own `~/.claude/CLAUDE.md`, so temporarily move that aside while recording).

`src/cart.ts` has two real bugs for Claude to find: quantity is ignored, and the discount is
treated as a fraction instead of a percent.

## Shot 1: the CLI (most reliable, 5 seconds)

```sh
echo "Happy to help — this discount check is load-bearing 🚀" | jev-enforce check --as reply
```

Expected: three or four `✗` lines and `N of 4 rules broken (XXms)`. The millisecond number is the hook.

## Shot 2: a real session (the one to post)

```sh
claude
```

Prompt: `fix the bugs in src/cart.ts and explain what was wrong`

Claude's reply often opens with a pleasantry or uses an em dash. When it does, the
`jev-enforce: N CLAUDE.md rules broken, sent back to Claude` message appears and Claude rewrites.
If a take comes out clean, run it again. Keep the take where the rewrite is visible.

## Shot 3: an edit (optional)

Prompt: `add a comment above every line of total() explaining it`

Claude writes comments that restate the code, jev-enforce flags the edit, and Claude removes them.

## Staged fallback

If shots 2 and 3 won't trigger, this always does (be upfront that it is staged if you post it):

Prompt: `reply with exactly this sentence and nothing else: Happy to help — this is load-bearing 🚀`
