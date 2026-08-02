# Project Core

- Documentation-first Flare hackathon repository; executable application/contracts are not committed yet.
- Product direction: ReserveFlow Credit converts FDC-verified XRPL reserve events plus FTSO price data into a Coston2 testnet credit line; test-only rfUSD, no mainnet lending.
- Current implementation source of truth is the approved requirements plus unapproved design in `.kiro/specs/reserveflow-credit/`; read it before architectural or scope work.
- Protocol contract addresses must be resolved through Flare Contract Registry, never hardcoded. FDC proof data is untrusted until on-chain verification; freshness is a borrow gate.
- Read `mem:tech_stack` for installed tooling, `mem:conventions` for project/spec conventions, `mem:suggested_commands` for commands, and `mem:task_completion` before handoff.