import {task} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import '@nomiclabs/hardhat-ethers';
import * as fs from 'fs';
import * as path from 'path';

import {
  AntiSnipAttackPositionManager__factory,
  Factory__factory,
  Factory,
  MockTokenPositionDescriptor__factory,
  QuoterV2__factory,
  Router__factory,
  Router,
  QuoterV2,
  MockTokenPositionDescriptor,
  AntiSnipAttackPositionManager,
  BasePositionManager__factory,
  BasePositionManager,
  TicksFeesReader__factory,
  TicksFeesReader,
  PoolOracle__factory,
  PoolOracle
} from '../typechain';

let gasPrice;

async function verifyContract(hre: HardhatRuntimeEnvironment, contractAddress: string, ctorArgs: any[]) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let deployerAddress: string;
let admin: string;
let weth: string;
let vestingPeriod: number;
let baseDescriptor: string;
let enableWhitelist: boolean;
let deployQuoter: string;
let outputFilename: string;

let poolOralce: PoolOracle;
let factory: Factory;
let router: Router;
let quoter: QuoterV2;
let descriptor: MockTokenPositionDescriptor;
let posManager: AntiSnipAttackPositionManager | BasePositionManager;
let ticksFeesReader: TicksFeesReader;

task('deployElastic', 'deploy router, factory and position manager')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .addParam('input', 'Input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const BN = hre.ethers.BigNumber;
    const [deployer] = await hre.ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`);

    let outputData: any = {};
    gasPrice = BN.from(10 ** 9 * taskArgs.gasprice);
    console.log(`Deploy gas price: ${gasPrice.toString()} (${taskArgs.gasprice} gwei)`);

    console.log(`deploying pool oracle...`);
    const PoolOracle = (await hre.ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;
    poolOralce = await PoolOracle.deploy({gasPrice: gasPrice});
    await poolOralce.deployed();
    console.log(`pool oracle address: ${poolOralce.address}`);
    outputData['poolOracle'] = poolOralce.address;

    console.log(`deploying factory...`);
    const Factory = (await hre.ethers.getContractFactory('Factory')) as Factory__factory;
    factory = await Factory.deploy(vestingPeriod, poolOralce.address, {gasPrice: gasPrice});
    await factory.deployed();
    console.log(`factory address: ${factory.address}`);
    outputData['factory'] = factory.address;

    console.log(`deploying router...`);
    const Router = (await hre.ethers.getContractFactory('Router')) as Router__factory;
    router = await Router.deploy(factory.address, weth, {gasPrice: gasPrice});
    await router.deployed();
    console.log(`router address: ${router.address}`);
    outputData['router'] = router.address;

    if (deployQuoter) {
      console.log(`deploying quoter...`);
      const Quoter = (await hre.ethers.getContractFactory('QuoterV2')) as QuoterV2__factory;
      quoter = await Quoter.deploy(factory.address, {gasPrice: gasPrice});
      await quoter.deployed();
      console.log(`quoter address: ${quoter.address}`);
      outputData['quoter'] = quoter.address;
    }

    if (baseDescriptor == '') {
      console.log(`deploying MockTokenPositionDescriptor...`);
      const Descriptor = (await hre.ethers.getContractFactory(
        'MockTokenPositionDescriptor'
      )) as MockTokenPositionDescriptor__factory;
      descriptor = await Descriptor.deploy();
      await descriptor.deployed();
      baseDescriptor = descriptor.address;
      console.log(`descriptor address: ${baseDescriptor}`);
      outputData['mockDescriptor'] = baseDescriptor;
    }

    enableWhitelist = vestingPeriod != 0;
    if (enableWhitelist) {
      console.log(`deploying AntiSnipAttackPositionManager...`);
      const PosManager = (await hre.ethers.getContractFactory(
        'AntiSnipAttackPositionManager'
      )) as AntiSnipAttackPositionManager__factory;
      posManager = await PosManager.deploy(factory.address, weth, baseDescriptor, {gasPrice: gasPrice});
      await posManager.deployed();
      console.log(`posManager address: ${posManager.address}`);

      console.log('whitelisting position manager...');
      await factory.addNFTManager(posManager.address, {gasPrice: gasPrice});
    } else {
      console.log(`deploying BasePositionManager...`);
      const PosManager = (await hre.ethers.getContractFactory('BasePositionManager')) as BasePositionManager__factory;
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

    console.log(`deploying tick and fees helper...`);
    const TicksFeesReader = (await hre.ethers.getContractFactory(
      'TicksFeesReader'
    )) as TicksFeesReader__factory;
    ticksFeesReader = await TicksFeesReader.deploy();
    await ticksFeesReader.deployed();
    console.log(`ticksFeesReader address: ${ticksFeesReader.address}`);
    outputData['ticksFeesReader'] = ticksFeesReader.address;

    exportAddresses(outputData);

    // verify addresses
    console.log('verifying addresses...');
    await verifyContract(hre, factory.address, [vestingPeriod]);
    await verifyContract(hre, router.address, [factory.address, weth]);
    if (descriptor) await verifyContract(hre, descriptor.address, []);
    if (deployQuoter) await verifyContract(hre, quoter.address, [factory.address]);
    await verifyContract(hre, posManager.address, [factory.address, weth, baseDescriptor]);
    await verifyContract(hre, ticksFeesReader.address, []);

    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput: any) {
  admin = jsonInput['admin'];
  vestingPeriod = jsonInput['vestingPeriod'];
  weth = jsonInput['weth'];
  baseDescriptor = jsonInput['baseDescriptor'];
  deployQuoter = jsonInput['deployQuoter'];
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput: string) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}
