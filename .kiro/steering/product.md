# Product Overview

ReserveFlow Credit is a cross-chain credit product for people and organizations that hold crypto assets outside Flare. It lets them establish a verifiable reserve and borrow against a conservative credit limit without selling or moving the underlying asset.

## Core Capabilities

- Register an external reserve account and submit a transaction-based proof of its balance or movement.
- Verify reserve evidence through Flare Data Connector (FDC) before it can affect credit.
- Value verified reserves from an FTSO price feed, then apply a haircut and loan-to-value limit.
- Let a user borrow and repay rfUSD only while the position remains healthy.
- Recalculate availability and surface risk alerts when a new proof or price change reduces coverage.

## Target Use Cases

- An XRP holder who needs stablecoin liquidity but does not want to sell or bridge XRP.
- A treasury or DAO that wants a credit line based on verifiable reserves held on another chain.
- A borrower who needs transparent, data-freshness-aware monitoring of collateral coverage.

## Value Proposition

ReserveFlow turns externally held assets into usable, verifiable credit on Flare. The product combines proof of external-chain events with on-chain price data, so the credit decision is based on current, auditable data rather than self-reported holdings. Conservative limits and health-state controls make risk visible before additional borrowing is allowed.

## Product Principles

- A reserve is creditworthy only after a valid, fresh proof has been verified.
- Value and borrowing power are distinct: apply explicit safety adjustments before extending credit.
- Treat balance reductions and price drops as first-class lifecycle events, not exceptional cases.
- Show the state of a position, its data freshness, and the reason for blocked actions clearly.

---
_Focus on product behavior and decision principles; individual assets, feeds, and UI screens belong in implementation documentation._

## Current MVP Boundary (Implemented)

The current executable MVP is intentionally narrower than the product vision:

- It supports one approved borrower, `testXRP` on XRPL Testnet, Coston2, and test-only rfUSD.
- A verified `XRPPayment` proves one payment event, not a comprehensive external balance, address ownership, or production collateral claim.
- FDC verification and FTSO freshness are mandatory borrowing inputs. Stale, warning, margin-call, frozen, or paused positions cannot open new debt; repayment remains available.
- The web app explains and previews the flow. Its current values are demo snapshots, not a real-time lending interface.
- This is not production lending, a mainnet product, or a real-asset/fiat service.

## Durable Product Rules

- Preserve the distinction between an off-chain proof-progress record and an on-chain verified reserve update.
- Add assets, chains, or lending features only after defining their proof model, freshness policy, risk limits, and failure behavior.
- Do not market an XRPL payment attestation as a proof of total reserves.
