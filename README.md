# KyberSwap v2

Main smart contract repo for KyberSwap v2

## Whitepaper

Check out **audit_docs/Dynamic_Market_Making_v2_whitepaper.pdf** file for the latest KyberSwap v2 whitepaper.

## Technical documentation

The implementation details can be found [here](https://hackmd.io/sgADNlGNS8eSGU_8mZYqDQ?view)

## Compilation
`yarn c` to compile contracts for all solidity versions.

## Testing with Hardhat
1. If contracts have not been compiled, run `yarn c`. This step can be skipped subsequently.
2. Run `yarn test`

### Example Commands
- `yarn test` (Runs all tests)
- `yarn test test/Pool.spec.ts` (Test only Pool.spec.ts)


## Coverage
`yarn coverage` (Runs coverage for all applicable files)
