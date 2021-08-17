import { BigNumber } from './utils';
import {ProAMMPool} from '../../typechain';
export enum SwapTitle {
  BEFORE_SWAP,
  AFTER_SWAP,
}
let titleMap = {
  [SwapTitle.BEFORE_SWAP]: 'BEFORE SWAP',
  [SwapTitle.AFTER_SWAP]: 'AFTER SWAP',
};

export async function logSwapState(title: SwapTitle, pool: ProAMMPool) {
  console.log(`=== ${titleMap[title]} ===`);
  let poolState = await pool.getPoolState();
  let reinvestmentState = await pool.getReinvestmentState();
  console.log(`tick: ${poolState._poolTick.toString()}`);
  console.log(`price: ${poolState._poolSqrtPrice.toString()}`);
  console.log(`reinvestment: ${reinvestmentState._poolReinvestmentLiquidity.toString()}`);
}

export function logBalanceChange(token0Change: BigNumber, token1Change: BigNumber) {
    console.log(`=== BALANCE CHANGES ===`);
    console.log(`token0 delta: ${token0Change.toString()}`);
    console.log(`token1 delta: ${token1Change.toString()}`);
}
