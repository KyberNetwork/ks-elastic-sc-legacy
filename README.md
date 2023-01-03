# KyberSwap Elastic

Main smart contract repo for KyberSwap Elastic

## Deployed contracts

Contracts are available on: Ethereum, Polygon, BNB Chain, Avalanche, Arbitrum, Optimism, Fantom, BitTorrent, Cronos, Oasis, Velas.

### Main contracts:
- Factory: **0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a**
- Router: **0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83**
- AntiSnippingAttackPositionManager: **0x2B1c7b41f6A8F2b2bc45C3233a5d5FB3cD6dC9A8**


### Helpers
- QuoterV2: **0x0D125c15D54cA1F8a813C74A81aEe34ebB508C1f**
- TickFeesReader: **0x165c68077ac06c83800d19200e6E2B08D02dE75D**


### Others
- TokenPositionDescriptor (implementation): **0xDA474537cE9b687b78B236452A05631f09B6EB6A**
- TokenPositionDescriptor (proxy): **0x8abd8c92F1901cf204590c16b5EF690a35b3741E**

## Whitepaper

Check out **audit_docs/KyberSwap_Elastic_Whitepaper_180622.pdf** file for the latest KyberSwap Elastic whitepaper.

## Audit report

KyberSwap Elastic – [Security Audit Report](https://chainsecurity.com/security-audit/kyberswap-elastic/) by [Chain Security](https://chainsecurity.com/)

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

## Echidna
`docker-compose up -d` (Runs a new echidna-test container)

`docker exec -it elastic-echidna bash` (Accesses to the container)

- `./echidna.sh` (Runs echidna-test for all contracts)
- `echidna-test . --contract {{Contract Name}} --config echidna.config.yml --test-mode assertion` (Runs echidna-test for each contract)

## Deploy
`npx hardhat deployTokenPositionDescriptor --input xxx --network nnn` to deploy token descriptor proxy + implementation contracts.
- Example: `npx hardhat deployTokenPositionDescriptor --input mainnet.json --network mainnet`

`npx hardhat deployElastic --input xxx --gasprice ggg --network nnn` to deploy all contracts.
- Example: `npx hardhat deployElastic --input mainnet.json --gasprice 5 --network mainnet`

