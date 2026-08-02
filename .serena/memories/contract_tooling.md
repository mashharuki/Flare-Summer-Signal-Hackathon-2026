# Contract Tooling

- Solidity contracts live in `packages/contracts` and use Foundry with the Cancun EVM.
- `packages/contracts/package.json` pins OpenZeppelin Contracts v5.6.1; `packages/contracts/remappings.txt` resolves `@openzeppelin/contracts/...` imports through the local workspace dependency. Solidity tests use Foundry cheat-code interfaces directly, so no vendored test library is required.
- Run contract tests with `pnpm --filter @reserveflow/contracts test` or `forge test` from `packages/contracts`; format check with `forge fmt --check`.
- `MockUSD` is deployed only on Coston2 (chain ID 114), mints exactly 1,000,000 rfUSD to the constructor-supplied vault, then revokes both `MINTER_ROLE` and `DEFAULT_ADMIN_ROLE`. It is test-only, not a production asset.