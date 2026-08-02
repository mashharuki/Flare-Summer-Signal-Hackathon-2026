# Project Conventions

- Keep the product boundary explicit: FDC verification, risk calculation, credit/vault state, and UI are separate domains.
- Use consistent domain names: reserve, proof, valuation, credit limit, debt, health, freshness. State/error names must describe the condition, e.g. `CREDIT_NOT_HEALTHY`.
- TypeScript production boundaries use precise types and `bigint` for asset units; do not use `any` or floating-point values for drops, WAD, or BPS.
- Specifications are Japanese. Requirement headings and traceability IDs are numeric; acceptance criteria use EARS form.
- Kiro steering documents describe durable patterns, not file/dependency catalogs. Preserve custom steering content additively.