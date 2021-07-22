import hardhat from 'hardhat';

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
