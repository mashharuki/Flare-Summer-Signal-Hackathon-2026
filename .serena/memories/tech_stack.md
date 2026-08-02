# Tech Stack

- Package manager pin: pnpm 10.33.0. Root currently has no dependencies and no executable source workspace.
- Declared language direction: TypeScript; planned contracts use Solidity/Foundry, web uses Next.js/React with viem/wagmi, and FDC coordination uses Node.js/TypeScript. Add these only when implementing the approved design.
- Formatting/lint: Biome schema 2.5.6; recommended rules, spaces, double quotes, VCS ignore integration, import organization assist.
- Knip config has only the `-lintignore` tag.
- No Node.js version, dev/build/test command, or deployment configuration is committed; do not assume one.