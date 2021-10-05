import {BigNumber as BN, BigNumberish} from 'ethers';
import hardhat from 'hardhat';

import {Artifacts} from 'hardhat/internal/artifacts';
import {Artifact} from 'hardhat/types';
import path from 'path';

export async function runWithImpersonation(target: string, run: () => Promise<void>): Promise<void> {
  await hardhat.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [target],
  });

  await run();

  await hardhat.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [target],
  });
}

export async function snapshot() {
  return await hardhat.network.provider.request({
    method: 'evm_snapshot',
  });
}

export async function revertToSnapshot(snapshotId: any) {
  return await hardhat.network.provider.request({
    method: 'evm_revert',
    params: [snapshotId],
  });
}

export async function mineNewBlockAt(timestamp: BigNumberish) {
  return await hardhat.network.provider.request({
    method: 'evm_mine',
    params: [timestamp],
  });
}

export async function setNextBlockTimestamp(timestamp: BigNumberish) {
  return await hardhat.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [timestamp],
  });
}

export async function setNextBlockTimestampFromCurrent(duration: number) {
  let newTimestamp = (await getLatestBlockTime()) + duration;
  return await hardhat.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [newTimestamp],
  });
}

export async function getCurrentBlock() {
  return await hardhat.network.provider.request({
    method: 'eth_blockNumber',
  });
}

export async function getLatestBlockTime() {
  let result: any;
  result = await hardhat.network.provider.request({
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
  });
  return BN.from(result.timestamp).toNumber();
}

export async function getArtifact(contract: string): Promise<Artifact> {
  let artifactsPath: string;
  artifactsPath = path.resolve('./artifacts');
  const artifacts = new Artifacts(artifactsPath);
  return artifacts.readArtifact(contract.split('/').slice(-1)[0]);
}
