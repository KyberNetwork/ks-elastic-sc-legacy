const accounts = require(`./test-wallets`).accounts;

module.exports = {
  mocha: {
    enableTimeouts: false,
    grep: '@skip-on-coverage', // Find everything with this tag
    invert: true // Run the grep's inverse set.
  },
  providerOptions: {
    default_balance_ether: 100000000000000,
    accounts: accounts
  },
  skipFiles: ['./mock', './interfaces', './misc'],
  // including echidna files causes bad coverage reports for some reason
  istanbulReporter: ['html', 'json']
};
