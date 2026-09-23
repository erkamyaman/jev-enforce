# Shop API

## Architecture

- Route handlers must not touch the database directly. Go through a repository in `src/repo`.
- Use the shared `apiFetch` wrapper for outbound HTTP. Never call `fetch` or an HTTP library directly.
- Never add a new npm dependency. Use what is already in package.json.

## Data

- Money is always an integer number of cents. Never use a float for money.
- Migrations are append-only. Never edit an existing migration file.

## Security

- Every endpoint that reads user data must check the caller's authorization first.
- Never log request bodies, tokens, or anything from the `Authorization` header.

## Tests

- Never skip, delete, or weaken a failing test to make the suite pass. Fix the cause.
- Never cast to `any` to silence a type error.
