import {BigNumber, constants, Signature, Wallet} from 'ethers';
import {splitSignature} from 'ethers/lib/utils';
import {BasePositionManager} from '../../typechain';

export default async function getEC721PermitSignature(
  wallet: Wallet,
  positionManager: BasePositionManager,
  spender: string,
  tokenId: BigNumber,
  deadline: BigNumber = constants.MaxUint256,
  permitConfig?: {nonce?: BigNumber; name?: string; chainId?: number; version?: string}
): Promise<Signature> {
  const [nonce, name, version, chainId] = await Promise.all([
    permitConfig?.nonce ?? (await positionManager.positions(tokenId)).pos.nonce,
    permitConfig?.name ?? positionManager.name(),
    permitConfig?.version ?? '1',
    permitConfig?.chainId ?? wallet.getChainId(),
  ]);

  return splitSignature(
    await wallet._signTypedData(
      {
        name,
        version,
        chainId,
        verifyingContract: positionManager.address,
      },
      {
        Permit: [
          {
            name: 'spender',
            type: 'address',
          },
          {
            name: 'tokenId',
            type: 'uint256',
          },
          {
            name: 'nonce',
            type: 'uint256',
          },
          {
            name: 'deadline',
            type: 'uint256',
          },
        ],
      },
      {
        owner: wallet.address,
        spender,
        tokenId,
        nonce,
        deadline,
      }
    )
  );
}
