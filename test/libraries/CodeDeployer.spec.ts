import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {MockCodeDeployer, MockCodeDeployer__factory} from '../../typechain';

let codeDeployer: MockCodeDeployer;
let CodeDeployer: MockCodeDeployer__factory;

describe('CodeDeployer', () => {
  async function fixture() {
    CodeDeployer = (await ethers.getContractFactory('MockCodeDeployer')) as MockCodeDeployer__factory;
    return await CodeDeployer.deploy();
  }

  beforeEach('load fixture', async () => {
    codeDeployer = await loadFixture(fixture);
  });

  it('deploys with no code', async () => {
    await deployCodeAndVerify('0x');
  });

  it('deploys with some code', async () => {
    await deployCodeAndVerify('0x1234');
  });

  it('deploys code with maximum length (24kb) ', async () => {
    await deployCodeAndVerify(`0x${'ff'.repeat(24 * 1024)}`);
  });
});

async function deployCodeAndVerify(data: string) {
  await codeDeployer.deploy(data);
  let destination = await codeDeployer.destination();
  expect(await ethers.provider.getCode(destination)).to.be.eq(data);
}
