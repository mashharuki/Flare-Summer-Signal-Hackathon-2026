# Risk Engine

- `packages/contracts/src/RiskEngine.sol` is Coston2-only. It resolves `FtsoV2` from the official Flare Contract Registry address (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`) at construction and reads the XRP/USD `getFeedByIdInWei` feed (`0x015852502f55534400000000000000000000000000`).
- It uses `Math.mulDiv` for flooring: gross USD WAD = drops × price / 1,000,000; then applies 3,000 BPS haircut and 5,000 BPS advance rate. `availableCreditWad` clamps at zero.
- Fixed policy: price TTL 60s, reserve TTL 900s, warning 12,000 BPS, margin-call 10,000 BPS. Price/reserve staleness and non-ACTIVE reserve accounts prohibit borrowing through their risk status.
- `RiskSnapshot.healthIsInfinite` is the explicit debt-zero representation; it does not overload a numeric maximum. `simulatePriceDrop` is read-only and validates a 0–10,000 BPS shock.
- Tests use `vm.etch` to place a Registry mock at the official address, then mock only typed FTSO and ledger interfaces.