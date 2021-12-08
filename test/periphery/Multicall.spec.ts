import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {MockMulticall, MockMulticall__factory} from '../../typechain';
import {loadFixture} from '@ethereum-waffle/provider';

let multicall: MockMulticall;

describe('Multicall', async () => {
  const [caller] = waffle.provider.getWallets();

  async function fixture() {
    const multicallTestFactory = (await ethers.getContractFactory('MockMulticall')) as MockMulticall__factory;
    return await multicallTestFactory.deploy();
  }

  beforeEach('load fixture', async () => {
    multicall = (await loadFixture(fixture)) as MockMulticall;
  });

  it('returns revert messages', async () => {
    await expect(
      multicall.multicall([multicall.interface.encodeFunctionData('revertWithInputError', ['KyberSwap2'])])
    ).to.be.revertedWith('KyberSwap2');
  });

  it('returns reverts without messages', async () => {
    await expect(multicall.multicall([multicall.interface.encodeFunctionData('revertNoReason')])).to.be.reverted;
  });

  it('correctly returns encoded data', async () => {
    let data = await multicall.callStatic.multicall([multicall.interface.encodeFunctionData('outputTuple', [5, 10])]);
    const {
      tuple: {a, b},
    } = multicall.interface.decodeFunctionResult('outputTuple', data[0]);
    expect(a).to.eq(10);
    expect(b).to.eq(5);
  });

  describe('context is preserved', () => {
    it('msg.value', async () => {
      await multicall.multicall([multicall.interface.encodeFunctionData('pay')], {value: 10});
      expect(await multicall.paid()).to.eq(10);
    });

    it('msg.value used twice', async () => {
      await multicall.multicall(
        [multicall.interface.encodeFunctionData('pay'), multicall.interface.encodeFunctionData('pay')],
        {value: 10}
      );
      expect(await multicall.paid()).to.eq(30);
    });

    it('msg.sender', async () => {
      expect(await multicall.returnSender()).to.eq(caller.address);
    });
  });
});
