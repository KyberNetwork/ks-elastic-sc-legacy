## Install hardhat first
- yarn install

## How to flatten 
- TS_NODE_TRANSPILE_ONLY=1 npx hardhat flatten YOUR_SRC_SC > YOUR_DES_SC
  - ie TS_NODE_TRANSPILE_ONLY=1 hh flatten ./contracts/periphery/Router.sol > Flatten_Router.sol

## Compile your contract
- yarn compile
### Note
  - Because hardhat flatten not automatically convert alias import to it name, we should manually convert them
    i.e import {MathConstants as C} from ...; and use like C.TWO_POW_96, we should replace A.m to MathConstants.TWO_POW_96;
  - Delete all license in contract, only keep one on top as MIT in flatten file
  - Delete all pragma abicoder v2; in flatten file

## How to find your bytecode
1. Run compile, make sure all flatten file not in .sol format because it have issue with multiple SPDX license in one file
2. go to artifacts/contracts/YOUR_CONTRACT_NAME.SOL/YOUR_CONTRACT_NAME.json and search *bytecode* key

## Deployment order
 1. Factory
 2. Router
 3. Quoter
 4. TokenPositionDescriptor
 5. AntisnipAttack or BasePositionManager
 6. TicksFeesReader