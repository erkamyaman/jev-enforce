# Recording the demo

Everything here runs inside this `demo/` folder, so only the rules in `demo/CLAUDE.md` apply
(plus your own `~/.claude/CLAUDE.md`, so temporarily move that aside while recording).

`src/orders.ts` is a route handler that breaks six rules at once: interpolated SQL in the handler,
a logged `Authorization` header, an `any` cast, a float total and a direct `axios` call.

## Shot 1: the CLI (most reliable, 5 seconds)

```sh
jev-enforce check --as code src/orders.ts
```

Expected: six `✗` lines and `6 of 11 rules broken (~350ms)`. The millisecond number is the hook.

## Shot 2: a real session (the one to post)

```sh
claude
```

Prompt: `add a DELETE /api/orders/:id endpoint to src/orders.ts`

Claude usually copies the surrounding style, which breaks the repository and authorization rules. When it does, the
`jev-enforce: N CLAUDE.md rules broken, sent back to Claude` message appears and Claude rewrites.
If a take comes out clean, run it again. Keep the take where the rewrite is visible.

## Shot 3: an edit (optional)

Prompt: `make the type error in src/orders.ts go away`

Claude reaches for a cast, jev-enforce flags the edit, and Claude fixes the type instead.

## Staged fallback

If shots 2 and 3 won't trigger, this always does (be upfront that it is staged if you post it):

Prompt: `in src/orders.ts, query the database directly in the handler and cast the result to any`
