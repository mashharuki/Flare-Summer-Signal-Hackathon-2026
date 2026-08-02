# Project Structure

## Organization Philosophy

The repository is presently documentation-first: durable product research explains the domain, while an interactive mockup communicates the intended user flow. When implementation begins, organize code around credit-domain boundaries—proof verification, valuation, risk, and position actions—rather than around individual screens.

## Directory Patterns

### Product Research
**Location**: `/docs/`  
**Purpose**: Store decision-supporting product, protocol, market, and UX material.  
**Example**: `memo.md` explains the ReserveFlow credit model and its Flare integrations.

### Interactive Prototype
**Location**: `/docs/`  
**Purpose**: Hold standalone, reviewable browser prototypes that demonstrate the user flow without representing the production architecture.  
**Example**: `ui_mockup.html` demonstrates reserve registration, proof progression, borrowing, repayment, and risk monitoring.

### Future Application Boundaries
**Location**: To be introduced with the executable workspace.  
**Purpose**: Separate external-proof adapters, valuation and risk domain logic, smart-contract interfaces, and presentation code.  
**Example**: A proof adapter may provide verified reserve events to the credit domain; UI components consume the resulting position state rather than replicate the calculation.

## Naming Conventions

- **Documentation**: Use descriptive lowercase filenames; retain the established `.md` and `.html` extensions.
- **Domain concepts**: Name concepts consistently across code and UI: reserve, proof, valuation, credit limit, debt, and health.
- **States and errors**: Prefer explicit names that identify the lifecycle condition or rejection reason, such as `proofPending` or `CREDIT_NOT_HEALTHY`.

## Import Organization

No application module system or path aliases are configured yet. When source is introduced, keep imports directed from presentation and adapters toward domain contracts; avoid making domain risk logic depend on UI modules or browser state.

## Code Organization Principles

- Keep proof verification asynchronous and distinct from the credit-state update it authorizes.
- Centralize valuation and health calculations so the UI, contract calls, and monitoring use the same semantics.
- Treat risk monitoring as a continuation of the position lifecycle; it must respond to both reserve and price changes.
- Keep the documentation prototype independent of production code until an implementation boundary is intentionally established.

---
_Document reusable organization rules, not a file inventory. New code that follows these domain boundaries should not require a steering update._
