const accounts = require(`./test-wallets`).accounts;

module.exports = {
  mocha: {
    enableTimeouts: false
  },
  providerOptions: {
    default_balance_ether: 100000000000000,
    accounts: accounts
  },
  skipFiles: ['./mock', './interfaces', './misc'],
  istanbulReporter: ['html', 'json']
};
