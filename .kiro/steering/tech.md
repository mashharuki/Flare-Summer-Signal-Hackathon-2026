# Technology Stack

## Architecture

The intended product is a Flare-native credit application: external-chain reserve events are verified through FDC, asset value is sourced from FTSO, and the resulting credit state governs on-chain borrowing and repayment. The user experience must make proof status, price freshness, credit limits, and health state observable.

The repository currently contains product research and a browser-based interactive UI mockup, not an implemented application or smart-contract workspace. Treat framework, runtime, deployment, and test choices as undecided until source and configuration are added.

## Core Technologies

- **Language**: TypeScript is the registered project language; the current mockup also embeds browser JavaScript.
- **Blockchain platform**: Flare EVM for credit logic and data-protocol integration.
- **Data protocols**: Flare Data Connector (FDC) for external-chain event verification; Flare Time Series Oracle (FTSO) for price data.
- **Prototype delivery**: A standalone HTML UI mockup in `docs/`, designed to run in a browser.

## Key Libraries

No application dependencies are committed yet. Choose libraries only when they support the agreed client, contract, and data-integration boundaries; record durable conventions here once they are established.

## Development Standards

### Type Safety

- Use TypeScript for production application and integration code.
- Model proof lifecycle, data freshness, credit limits, and health states explicitly; do not collapse them into display-only flags.
- Keep units and decimal handling explicit at every price, reserve, and debt boundary.

### Code Quality

- Keep external data verification, valuation, risk calculation, and UI presentation separable.
- Validate stale, invalid, replayed, or mismatched proofs before credit state changes.
- Make the reason for a rejected borrow or risk-state transition machine-readable and user-visible.

### Testing

- Test the credit state machine across verified reserve increases/decreases, price changes, stale data, and boundary health values.
- Exercise FDC integration as an asynchronous lifecycle rather than assuming proofs are immediately available.

## Development Environment

### Required Tools

- A modern Node.js and TypeScript toolchain will be required once an application workspace is introduced.
- An EVM development toolchain and access to the appropriate Flare network are required for contract and data-protocol integration.

### Common Commands

No package manifest or project commands exist yet. Add commands together with the first executable workspace and update this section only with stable workflow conventions.

## Key Technical Decisions

- Credit decisions must be derived from verified external-chain evidence and oracle data, not a user-declared balance.
- FDC proof status and FTSO freshness are risk inputs; they must be represented in the domain model and action guards.
- The current mockup is a product prototype, not a production-framework decision.

---
_Document stable engineering standards and system boundaries, not proposed dependencies or implementation wish lists._

## Current Implementation Baseline

The executable workspace uses pnpm 10.33.0 and strict TypeScript. The frontend is Next.js 16 with React 19; the worker uses Node.js TypeScript, viem, xrpl, and sql.js; contracts use Solidity 0.8.30, Foundry, Cancun EVM, and OpenZeppelin 5.6.

Use Coston2 (chain ID 114) and XRPL Testnet only. Resolve FDC, FTSO, and other Flare protocol contracts through the Coston2 Contract Registry; do not place protocol addresses in app configuration. Monetary values remain `bigint` through domain logic, with branded types for drops, WAD, BPS, addresses, account IDs, and proof IDs.

## Runtime and Delivery Decisions

- The FDC coordinator persists only resumable progress in SQLite. Financial state remains on-chain, and DA Layer output is untrusted until `FdcVerification` succeeds.
- FDC request, proof retrieval, and Coston2 smoke checks are explicit CLI commands. The worker has no public HTTP server or permanent service process yet.
- The web app may be deployed to Vercel from `apps/web`; browser-visible configuration is limited to `NEXT_PUBLIC_*` values. Verifier API keys, XRPL seeds, and private keys never belong in browser or Vercel frontend configuration.

## Validation Baseline

Run focused tests first, then the workspace checks: shared, worker, and web Vitest suites; Foundry contract tests including fuzz/invariant coverage; `pnpm typecheck`; `pnpm check`; and the Next.js production build. Foundry may need system proxy discovery disabled in this desktop environment; that workaround does not change test semantics.
