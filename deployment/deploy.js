require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');

let gasPrice;

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let deployerAddress;
let admin;
let weth;
let vestingPeriod;
let baseDescriptor;
let enableWhitelist;
let deployQuoter;
let outputFilename;

let factory;
let router;
let quoter;
let descriptor;
let posManager;

task('deployDmmV2', 'deploy router, factory and position manager')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .addParam('input', 'Input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const BN = ethers.BigNumber;
    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`);

    let outputData = {};
    gasPrice = new BN.from(10 ** 9 * taskArgs.gasprice);
    console.log(`Deploy gas price: ${gasPrice.toString()} (${taskArgs.gasprice} gwei)`);

    console.log(`deploying factory...`);
    const Factory = await ethers.getContractFactory('Factory');
    factory = await Factory.deploy(vestingPeriod, {gasPrice: gasPrice});
    await factory.deployed();
    console.log(`factory address: ${factory.address}`);
    outputData['factory'] = factory.address;

    console.log(`deploying router...`);
    const Router = await ethers.getContractFactory('Router');
    router = await Router.deploy(factory.address, weth, {gasPrice: gasPrice});
    await router.deployed();
    console.log(`router address: ${router.address}`);
    outputData['router'] = router.address;

    if (deployQuoter) {
      console.log(`deploying quoter...`);
      const Quoter = await ethers.getContractFactory('QuoterV2');
      quoter = await Quoter.deploy(factory.address, {gasPrice: gasPrice});
      await quoter.deployed();
      console.log(`quoter address: ${quoter.address}`);
      outputData['quoter'] = quoter.address;
    }

    if (baseDescriptor == "") {
      console.log(`deploying MockTokenPositionDescriptor...`);
      const Descriptor = await ethers.getContractFactory('MockTokenPositionDescriptor');
      descriptor = await Descriptor.deploy();
      await descriptor.deployed();
      baseDescriptor = descriptor.address;
      console.log(`descriptor address: ${baseDescriptor}`);
      outputData['mockDescriptor'] = baseDescriptor;
    }

    enableWhitelist = vestingPeriod != 0;
    if (enableWhitelist) {
      console.log(`deploying AntiSnipAttackPositionManager...`);
      const PosManager = await ethers.getContractFactory('AntiSnipAttackPositionManager');
      posManager = await PosManager.deploy(factory.address, weth, baseDescriptor, {gasPrice: gasPrice});
      await posManager.deployed();
      console.log(`posManager address: ${posManager.address}`);

      console.log('whitelisting position manager...');
      await factory.addNFTManager(posManager.address, {gasPrice: gasPrice});
    } else {
      console.log(`deploying BasePositionManager...`);
      const PosManager = await ethers.getContractFactory('BasePositionManager');
      posManager = await PosManager.deploy(factory.address, weth, baseDescriptor, {gasPrice: gasPrice});
      await posManager.deployed();
      console.log(`posManager address: ${posManager.address}`);

      console.log('disabling whitelist...');
      await factory.disableWhitelist({gasPrice: gasPrice});
    }
    outputData['posManager'] = posManager.address;

    // transfer ownership to admin
    console.log(`updating config master...`);
    await factory.updateConfigMaster(admin, {gasPrice: gasPrice});

    exportAddresses(outputData);

    // verify addresses
    console.log('verifying addresses...');
    await verifyContract(hre, factory.address, [vestingPeriod]);
    await verifyContract(hre, router.address, [factory.address, weth]);
    if (descriptor)
        await verifyContract(hre, descriptor.address, []);
    if (deployQuoter)
        await verifyContract(hre, quoter.address, [factory.address]);
    await verifyContract(hre, posManager.address, [factory.address, weth, baseDescriptor]);

    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  admin = jsonInput['admin'];
  vestingPeriod = jsonInput['vestingPeriod'];
  weth = jsonInput['weth'];
  baseDescriptor = jsonInput['baseDescriptor'];
  deployQuoter = jsonInput['deployQuoter'];
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}
