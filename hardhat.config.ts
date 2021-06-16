import '@nomiclabs/hardhat-waffle';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-typechain';
import { HardhatUserConfig } from 'hardhat/types';
import * as dotenv from 'dotenv';

dotenv.config();

import { accounts } from './test-wallets';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',

  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
  },

  networks: {
    develop: {
      url: 'http://127.0.0.1:8545',
      gas: 6000000,
      timeout: 20000,
    },
    hardhat: {
      accounts: accounts,
    },
  },

  solidity: {
    compilers: [
      {
        version: '0.8.5',
        settings: {
          optimizer: {
            enabled: true,
            runs: 100000,
          },
        },
      },
    ],
  },

  paths: {
    sources: './contracts',
    tests: './test',
  },

  mocha: {
    timeout: 0,
  },

  typechain: {
    target: 'ethers-v5'
  }
};

const INFURA_API_KEY: string = process.env.INFURA_API_KEY || '';
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || '';
const ETHERSCAN_KEY: string = process.env.ETHERSCAN_KEY || '';

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
}

export default config;
