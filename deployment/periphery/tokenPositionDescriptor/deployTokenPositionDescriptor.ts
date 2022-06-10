import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {task} from 'hardhat/config';
import fs from 'fs';
import path from 'path';

let deployerAddress: string;
let outputFilename: string;

async function verifyContract(hre: HardhatRuntimeEnvironment, contractAddress: string, ctorArgs: string[]) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

task('deployTokenPositionDescriptor', 'deploy proxy of TokenPositionDescriptor')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const [deployer] = await hre.ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`);

    const TokenPositionDescriptor = await hre.ethers.getContractFactory('TokenPositionDescriptor');
    let outputData: {[key: string]: string} = {};
    let descriptorProxy = await hre.upgrades.deployProxy(TokenPositionDescriptor, [], {
      initializer: 'initialize',
    });

    await descriptorProxy.deployed();

    const descriptorAddress = await hre.upgrades.erc1967.getImplementationAddress(descriptorProxy.address);

    console.log('TokenPositionDescriptorProxy deployed to:', descriptorProxy.address);
    console.log('TokenPositionDescriptor deployed to:', descriptorAddress);

    outputData['descriptorProxy'] = descriptorProxy.address;
    outputData['descriptor'] = descriptorAddress;

    try {
      console.log(`Verify descriptor at: ${descriptorAddress}`);
      await verifyContract(hre, descriptorAddress, []);
      console.log(`Verify successfully`);
    } catch (e: any) {
      console.log(`Error in verify distributor, ${e.toString()} || continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

const parseInput = (jsonInput: any) => {
  outputFilename = jsonInput['outputFilename'];
};

const exportAddresses = (dictOutput: {[key: string]: string}) => {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
};
