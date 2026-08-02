# Task Completion

- For documentation/spec changes: run `git diff --check` and validate modified JSON with `jq empty <file>`.
- For code changes: run `pnpm check`; run `pnpm knip` once dependencies/workspaces exist; run the affected workspace's documented tests after they are added.
- Run `pnpm format` only when formatting changes are intended, then re-run `pnpm check`.
- Do not claim build, test, or deployment verification until those commands exist in the repository.