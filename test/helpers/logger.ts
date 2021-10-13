import {BigNumber} from 'ethers';
import {MockPool, Pool} from '../../typechain';
export enum SwapTitle {
  BEFORE_SWAP,
  AFTER_SWAP,
}
let titleMap = {
  [SwapTitle.BEFORE_SWAP]: 'BEFORE SWAP',
  [SwapTitle.AFTER_SWAP]: 'AFTER SWAP',
};

export async function logSwapState(title: SwapTitle, pool: Pool | MockPool) {
  console.log(`=== ${titleMap[title]} ===`);
  let poolState = await pool.getPoolState();
  let reinvestmentState = await pool.getLiquidityState();
  console.log(`current tick: ${poolState.currentTick.toString()}`);
  console.log(`nearest current tick: ${poolState.nearestCurrentTick.toString()}`);
  console.log(`price: ${poolState.sqrtP.toString()}`);
  console.log(`baseL: ${reinvestmentState.baseL.toString()}`);
  console.log(`reinvestL: ${reinvestmentState.reinvestL.toString()}`);
}

export function logBalanceChange(token0Change: BigNumber, token1Change: BigNumber) {
  console.log(`=== BALANCE CHANGES ===`);
  console.log(`token0 delta: ${token0Change.toString()}`);
  console.log(`token1 delta: ${token1Change.toString()}`);
}
