import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-typechain';
import 'hardhat-contract-sizer';
import '@openzeppelin/hardhat-upgrades';

import {HardhatUserConfig, SolcUserConfig} from 'hardhat/types';
import * as dotenv from 'dotenv';

dotenv.config();

import './deployment/deployElastic.ts';
import './deployment/periphery/tokenPositionDescriptor/deployTokenPositionDescriptor.ts';
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
      runs: 500,
    },
  },
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

  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_KEY == '' ? '' : process.env.BSCSCAN_KEY,
      bsc: process.env.BSCSCAN_KEY == '' ? '' : process.env.BSCSCAN_KEY,
      mainnet: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      goerli: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      optimisticEthereum: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      optimisticKovan: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      polygon: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      polygonMumbai: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      arbitrumOne: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      arbitrumTestnet: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      avalanche: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      avalancheFujiTestnet: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
      opera: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,  // Fantom mainnet
      ftmTestnet: process.env.ETHERSCAN_KEY == '' ? '' : process.env.ETHERSCAN_KEY,
    }
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
    blockGasLimit: 30000000,
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
    blockGasLimit: 30000000,
  };

  config.networks!.bsc = {
    url: `https://bsc-dataseed1.ninicoin.io/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.cronos_testnet = {
    url: `https://cronos-testnet-3.crypto.org:8545/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.cronos = {
    url: `https://evm-cronos.crypto.org/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.aurora_testnet = {
    url: `https://testnet.aurora.dev/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.aurora = {
    url: `https://mainnet.aurora.dev/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.polygon_testnet = {
    url: `https://rpc-mumbai.maticvigil.com/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.polygon = {
    url: `https://polygon-rpc.com/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.avax_testnet = {
    url: `https://api.avax-test.network/ext/bc/C/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.avax = {
    url: `https://api.avax.network/ext/bc/C/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.fantom_testnet = {
    url: `https://rpc.testnet.fantom.network/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.fantom = {
    url: `https://rpc.ftm.tools/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.optimism = {
    url: `https://optimistic.etherscan.io`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.optimism_testnet = {
    url: `https://kovan.optimism.io`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.arbitrum = {
    url: `https://arb1.arbitrum.io/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.arbitrum_testnet = {
    url: `https://rinkeby.arbitrum.io/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.bttc = {
    url: `https://bttc.dev.kyberengineering.io`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.bttc_testnet = {
    url: `https://pre-rpc.bt.io`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.oasis = {
    url: `https://emerald.oasis.dev`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.oasis_testnet = {
    url: `https://testnet.emerald.oasis.dev`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.velas = {
    url: `https://evmexplorer.velas.com/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  config.networks!.velas_testnet = {
    url: `https://explorer.testnet.velas.com/rpc`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };
}

export default config;
