# Shop API

## Architecture

- Route handlers must not touch the database. Use a repository in `src/repo`.
- Use the `apiFetch` wrapper. Never call `fetch` or an HTTP library directly.
- Never add an npm dependency. Use what is already in package.json.

## Data

- Money is integer cents. Never use a float for money.
- Migrations are append-only. Never edit an existing migration.

## Security

- Every endpoint reading user data must check authorization first.
- Never log request bodies, tokens, or the `Authorization` header.

## Tests

- Never skip or weaken a failing test to get green. Fix the cause.
- Never cast to `any` to silence a type error.
