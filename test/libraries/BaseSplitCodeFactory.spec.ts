import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {MockSplitCodeFactory, MockSplitCodeFactory__factory} from '../../typechain';
import {getArtifact} from '../helpers/hardhat';

let factory: MockSplitCodeFactory;
let Factory: MockSplitCodeFactory__factory;
let contract: string;
const INVALID_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
const id = '0x0123456789012345678901234567890123456789012345678901234567890123';

describe('BaseSplitCodeFactory', () => {
  async function fixture() {
    Factory = (await ethers.getContractFactory('MockSplitCodeFactory')) as MockSplitCodeFactory__factory;
    return await Factory.deploy();
  }

  beforeEach('load fixture', async () => {
    factory = await loadFixture(fixture);
  });

  it('returns the contract creation code storage addresses', async () => {
    const {contractA, contractB} = await factory.getCreationCodeContracts();

    const codeA = await ethers.provider.getCode(contractA);
    const codeB = await ethers.provider.getCode(contractB);

    const artifact = await getArtifact('MockFactoryCreatedContract');
    expect(codeA.concat(codeB.slice(2))).to.equal(artifact.bytecode); // Slice to remove the '0x' prefix
  });

  it('returns the contract creation code', async () => {
    const artifact = await getArtifact('MockFactoryCreatedContract');
    const poolCreationCode = await factory.getCreationCode();

    expect(poolCreationCode).to.equal(artifact.bytecode);
  });

  it('creates a contract', async () => {
    await expect(factory.create(id)).to.emit(factory, 'ContractCreated');
  });

  it('reverts and bubbles up revert reasons', async () => {
    await expect(factory.create(INVALID_ID)).to.be.revertedWith('NON_ZERO_ID');
  });

  describe('with created pool', async () => {
    beforeEach('create contract', async () => {
      await factory.create(id);
      contract = await factory.destination();
    });

    it('deploys correct bytecode', async () => {
      const code = await ethers.provider.getCode(contract);
      const artifact = await getArtifact('MockFactoryCreatedContract');
      expect(code).to.equal(artifact.deployedBytecode);
    });

    it('passes constructor arguments correctly', async () => {
      const contractObject = await ethers.getContractAt('MockFactoryCreatedContract', contract);
      expect(await contractObject.getId()).to.equal(id);
    });
  });
});
