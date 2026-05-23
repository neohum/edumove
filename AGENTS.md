# edumove — Engineering Conventions

> Loaded by Codex (and other agents) at the start of every session.
> Generated 2026-05-23 by `create-agent-harness`. Edit freely — this is *your* contract with the agents.

## Role boundaries (the harness's central rule)

Three agents operate on this repo. Keep them in their lanes:

| Agent          | CLI       | Owns                                                | Avoid                          |
| -------------- | --------- | --------------------------------------------------- | ------------------------------ |
| **architect**  | `Codex`  | architecture, hard reasoning, UI/UX, business logic | bulk completion, mass research |
| **researcher** | `gemini`  | long-context analysis, RAG, doc/PDF/HWP parsing     | implementation, refactors      |
| **typist**     | `codex`   | inline completion, snippets, mechanical edits       | architecture, design calls     |

Run `node scripts/route.mjs "<task>"` to see which agent the router picks.
Override with `--agent=architect|researcher|typist`.

## Senior-engineer defaults (apply to all agents)

- **Read before you write.** Open the file, scan callers, then edit. Prefer `Edit` over `Write`.
- **No speculative scope.** Bug fix ≠ refactor. Don't add features, layers, or "future-proofing" the user didn't ask for.
- **No dead validation.** Don't guard against scenarios that can't happen. Validate at system boundaries only.
- **No silent failures.** If you can't do it, say so — don't fabricate a partial fix and claim done.
- **Comments only for the non-obvious.** Code says *what*; comments are for the *why* that would surprise a reader. Skip otherwise.
- **Errors point at root causes.** Don't suppress, don't `--no-verify`, don't retry in a sleep loop.
- **Run it.** For UI changes, start the dev server and click through. Type-check ≠ feature-correct.
- **Confirm before destructive ops.** `rm -rf`, `git reset --hard`, `force push`, dropping tables, killing processes — always pause first.

## Project facts (fill these in)

- **Stack:** _e.g. Next.js 16, React 19, TypeScript, Postgres_
- **Package manager:** _pnpm | npm | yarn_
- **Entry points:** _e.g. `app/(routes)`, `lib/server`_
- **Test runner:** _e.g. `pnpm test` (vitest)_
- **Lint / typecheck:** _e.g. `pnpm typecheck`_
- **Dev server:** _e.g. `pnpm dev` on http://localhost:3000_
- **Deploy:** _e.g. Railway via `git push`_

## Domain glossary (fill these in)

| Term  | Meaning                       |
| ----- | ----------------------------- |
| _foo_ | _what foo means in this repo_ |

## See also

- [`lat.md`](./lat.md) — code-graph / file-level map of the repo
- [`DESIGN.md`](./DESIGN.md) — UI/UX system & component contract
- [`docs/HARNESS.md`](./docs/HARNESS.md) — how the multi-agent harness works
