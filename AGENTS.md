# Repository Guidelines

## Project Structure & Module Organization

ReserveFlow Credit is a pnpm monorepo. Keep executable code inside its existing boundary:

- `apps/web/src/` contains the user-facing dashboard and wallet integration.
- `apps/attestation-worker/src/` coordinates FDC attestation progress; it must not hold financial authority.
- `packages/shared/src/` owns cross-boundary TypeScript domain types, unit conversions, and user-safe errors.
- `packages/sdk/src/` re-exports typed client-facing contracts.
- `packages/contracts/src/` contains Solidity contracts; `packages/contracts/test/` contains Foundry tests.
- `docs/` holds research and the standalone UI prototype. `.kiro/specs/reserveflow-credit/` is the approved implementation plan.

Organize code by domain (reserve, proof, risk, credit), not by UI screen. Keep UI and worker code dependent on shared contracts, never the reverse.

## Build, Test, and Development Commands

Use pnpm 10.33.0 from the repository root.

- `pnpm test` runs shared Vitest tests.
- `pnpm typecheck` type-checks all TypeScript workspaces.
- `pnpm check` runs Biome linting, formatting, and import organization checks.
- `pnpm format` applies Biome formatting.
- `pnpm --filter @reserveflow/contracts test` runs Foundry contract tests.
- `pnpm --filter @reserveflow/contracts typecheck` runs `forge build`.

Run the relevant focused test first, then the complete validation set before opening a pull request.

## Coding Style & Naming Conventions

TypeScript is strict: avoid `any`, use `bigint` for monetary values, and preserve branded types such as `Wad`, `Drops`, `AccountId`, and `ProofId`. Biome uses spaces and double quotes; run `pnpm check` rather than hand-formatting.

Use explicit domain names (`ReserveFlowCore`, `RiskSnapshot`, `STALE_PRICE`). Solidity uses `pragma solidity 0.8.30`, Cancun EVM, OpenZeppelin imports, `PascalCase` contracts, and custom errors for rejected state transitions.

## Testing & Security

Write a failing test before implementation. Name tests after observable behavior, for example `testReplayAndOutOfOrderLedgersDoNotChangeTheLedger`. Test both valid flows and that rejected proofs leave state unchanged.

FDC proofs are untrusted until `IFdcVerification` succeeds. Keep contracts and configuration Coston2/testXRP/rfUSD-only; never commit private keys, `.env` files, real asset flows, or production addresses.

Resolve FTSO contract addresses through Flare's Contract Registry (for example, `getContractAddressByName("FtsoV2")`) instead of embedding a feed contract address. Keep the registry address and feed IDs chain-specific, and cover registry resolution with a local Foundry test.

## Commits & Pull Requests

Existing history uses short lowercase subjects (`add`, `update`); prefer a specific imperative subject such as `add reserve proof replay guard`. Keep commits focused. PRs should summarize behavior, list validation commands, link the relevant spec task, and include screenshots for user-visible changes.
