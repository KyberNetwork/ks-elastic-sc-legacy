import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-typechain';
import 'hardhat-contract-sizer';

import {HardhatUserConfig, SolcUserConfig} from 'hardhat/types';
import * as dotenv from 'dotenv';

dotenv.config();

import './deployment/deploy.ts';
import {accounts} from './test-wallets';

const solcConfig: SolcUserConfig = {
  version: '0.8.9',
  settings: {
    optimizer: {
      enabled: true,
      runs: 100000,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
};

const lowRunSolcConfig = {
  ...solcConfig,
  settings: {
    ...solcConfig.settings,
    optimizer: {
      enabled: true,
      runs: 8000,
    },
  },
};

const veryLowRunSolcConfig = {
  ...solcConfig,
  settings: {
    ...solcConfig.settings,
    optimizer: {
      enabled: true,
      runs: 2000
    }
  }
};

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',

  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
  },

  networks: {
    hardhat: {
      accounts: accounts,
      allowUnlimitedContractSize: true,
      initialBaseFeePerGas: 0,
      gas: 15000000,
    },
  },

  solidity: {
    compilers: [solcConfig],
    overrides: {
      'contracts/periphery/BasePositionManager.sol': lowRunSolcConfig,
      'contracts/periphery/AntiSnipAttackPositionManager.sol': veryLowRunSolcConfig,
      'contracts/Factory.sol': veryLowRunSolcConfig,
      'contracts/Pool.sol': veryLowRunSolcConfig,
      'contracts/mock/MockPool.sol': veryLowRunSolcConfig,
    },
  },

  paths: {
    sources: './contracts',
    tests: './test',
  },

  mocha: {
    timeout: 0,
  },

  typechain: {
    target: 'ethers-v5',
  },

  contractSizer: {
    runOnCompile: true,
    disambiguatePaths: false,
  },
};

const INFURA_API_KEY: string = process.env.INFURA_API_KEY || '';
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || '';
const ETHERSCAN_KEY: string = process.env.ETHERSCAN_KEY || '';
const BSCSCAN_KEY: string = process.env.BSCSCAN_KEY || '';

if (INFURA_API_KEY != '' && PRIVATE_KEY != '') {
  config.networks!.kovan = {
    url: `https://kovan.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.rinkeby = {
    url: `https://rinkeby.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
    blockGasLimit: 30000000
  };

  config.networks!.ropsten = {
    url: `https://ropsten.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.mainnet = {
    url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.bsc_testnet = {
    url: `https://data-seed-prebsc-1-s1.binance.org:8545/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
    blockGasLimit: 30000000
  };
}

if (ETHERSCAN_KEY != '' || BSCSCAN_KEY != '') {
  config.etherscan = {
    apiKey: ETHERSCAN_KEY == '' ? BSCSCAN_KEY : ETHERSCAN_KEY,
  };
}

export default config;
